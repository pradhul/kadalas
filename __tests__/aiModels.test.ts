import {
  GROQ_DEFAULT_MODEL,
  OPENROUTER_DEFAULT_MODEL,
  OPENROUTER_FALLBACK_MODEL,
  SHUTDOWN_MODEL_IDS,
} from '../src/services/ai/catalog';
import { GEMINI_DEFAULT_MODEL, GEMINI_FALLBACK_MODEL, throwGeminiHttpError } from '../src/services/ai/gemini';
import { formatProviderHttpError } from '../src/services/ai/openaiCompatible';
import { friendlyTestKeyMessage } from '../src/services/ai/testKeyMessages';
import { ruleTriage } from '../src/services/ai/gemini';
import {
  applyTriageBatch,
  createScanJob,
  ingestSearchPage,
  takeTriageBatch,
} from '../src/lib/scanPipeline';
import { GmailAttachmentMeta } from '../src/services/gmail/types';

describe('AI model catalog (post-shutdown)', () => {
  it('does not use shut-down model IDs', () => {
    const live = [
      GEMINI_DEFAULT_MODEL,
      GEMINI_FALLBACK_MODEL,
      GROQ_DEFAULT_MODEL,
      OPENROUTER_DEFAULT_MODEL,
      OPENROUTER_FALLBACK_MODEL,
    ];
    for (const id of SHUTDOWN_MODEL_IDS) {
      expect(live).not.toContain(id);
    }
    expect(GEMINI_DEFAULT_MODEL).toBe('gemini-3.5-flash-lite');
    expect(GEMINI_FALLBACK_MODEL).toBe('gemini-flash-latest');
    expect(GROQ_DEFAULT_MODEL).toBe('openai/gpt-oss-20b');
    expect(OPENROUTER_DEFAULT_MODEL).toBe('openrouter/free');
    expect(OPENROUTER_FALLBACK_MODEL).toBe('google/gemma-4-31b-it:free');
  });
});

describe('provider error body formatting', () => {
  it('formats Gemini errors as Gemini <status>: <message> with .status', async () => {
    const res = new Response(JSON.stringify({ error: { message: 'model not found', status: 'NOT_FOUND' } }), {
      status: 404,
      statusText: 'Not Found',
    });
    await expect(throwGeminiHttpError(res)).rejects.toMatchObject({
      message: 'Gemini 404: model not found',
      status: 404,
    });
  });

  it('formats OpenAI-compatible errors with body message and status', async () => {
    const res = new Response(JSON.stringify({ error: { message: 'Model does not exist' } }), {
      status: 404,
      statusText: 'Not Found',
    });
    const err = await formatProviderHttpError('Groq', res);
    expect(err.message).toBe('Groq 404: Model does not exist');
    expect(err.status).toBe(404);
  });
});

describe('friendlyTestKeyMessage', () => {
  it('maps 400 key-invalid, 404, and 429', () => {
    expect(
      friendlyTestKeyMessage(Object.assign(new Error('Gemini 400: API key not valid. Please pass a valid API key.'), { status: 400 })),
    ).toBe('Key rejected — copy it again from AI Studio');
    expect(friendlyTestKeyMessage(Object.assign(new Error('Gemini 404: not found'), { status: 404 }))).toBe(
      'Model unavailable — update app',
    );
    expect(friendlyTestKeyMessage(Object.assign(new Error('Gemini 429: RESOURCE_EXHAUSTED'), { status: 429 }))).toBe(
      'Free quota used up, try later',
    );
  });
});

describe('triage fallback lets scan continue', () => {
  function att(id: string): GmailAttachmentMeta {
    return {
      messageId: `msg_${id}`,
      attachmentId: `att_${id}`,
      filename: 'policy.pdf',
      mimeType: 'application/pdf',
      size: 40_000,
      subject: `Vehicle insurance renewal ${id}`,
      from: 'insurer@example.com',
      date: '2026-03-01T00:00:00.000Z',
      snippet: 'policy renewal registration KA-01-AB-1234',
    };
  }

  it('rule triage after AI failure still advances classify queue', () => {
    let state = createScanJob({ mode: 'full' });
    state = ingestSearchPage(state, {
      attachments: [att('1'), att('2')],
      nextPageToken: null,
      estimatedTotal: 2,
      messagesInPage: 2,
    });
    expect(state.stage).toBe('triage');
    const batch = takeTriageBatch(state, 10);
    // Simulate what scanEngine does on non-quota AI failure
    const decisions = ruleTriage(
      batch.map((b) => ({
        id: b.id,
        attachment: {
          from: b.attachment.from,
          subject: b.attachment.subject,
          filename: b.attachment.filename,
          mimeType: b.attachment.mimeType,
          snippet: b.attachment.snippet,
          size: b.attachment.size,
        },
      })),
    );
    state = {
      ...applyTriageBatch(state, decisions),
      lastWarning: 'AI triage unavailable (Gemini 404: model not found); using rule triage',
    };
    expect(state.lastWarning).toMatch(/rule triage/i);
    expect(state.classifyQueue.length + state.stats.triageSkipped).toBeGreaterThan(0);
    expect(state.stage).not.toBe('cancelled');
    expect(['classify', 'dedupe', 'search', 'triage']).toContain(state.stage);
  });
});
