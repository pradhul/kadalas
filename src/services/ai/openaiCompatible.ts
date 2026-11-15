import { classifyWithRules, mergeClassification } from '../../lib/categorisation';
import { normalizeCategory } from '../../lib/folders';
import { isNewerVersion, scoreDocumentMatch } from '../../lib/matching';
import { AiProviderId, ClassificationResult } from '../../types/document';
import { AiFileInput, AiProvider, VersionConfirmInput, VersionConfirmResult } from './types';

interface CompatibleConfig {
  id: AiProviderId;
  displayName: string;
  baseUrl: string;
  model: string;
  /** Optional model to try once if the primary returns 404 / model-not-found. */
  fallbackModel?: string;
  getApiKey: () => Promise<string | null>;
  /** anthropic uses x-api-key + anthropic-version */
  style: 'openai' | 'anthropic';
}

/**
 * Pluggable OpenAI / OpenRouter / Anthropic / Groq providers.
 * File bytes are described in text when the API path is chat-completions style;
 * prefer Gemini for direct PDF/image multimodal when available.
 */
export function createOpenAiCompatibleProvider(config: CompatibleConfig): AiProvider {
  return {
    id: config.id,
    displayName: config.displayName,

    async classifyDocument(input) {
      const key = await config.getApiKey();
      if (!key) {
        return classifyWithRules({
          subject: input.subject,
          from: input.from,
          fileName: input.fileName,
          mimeType: input.mimeType,
          textExcerpt: input.textExcerpt,
        });
      }

      const userContent = [
        'Classify this personal document. Return ONLY JSON with keys:',
        'category, title, issuer, documentType, referenceNumber, holderName, issueDate, expiryDate, isImportantDocument, confidence, reason.',
        `fileName=${input.fileName}`,
        `mimeType=${input.mimeType}`,
        input.subject ? `subject=${input.subject}` : '',
        input.from ? `from=${input.from}` : '',
        input.textExcerpt ? `excerpt=${input.textExcerpt.slice(0, 6000)}` : '',
        input.dataBase64 ? `(binary attachment present, ${input.dataBase64.length} base64 chars — describe from available text)` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const text = await chat(config, key, userContent);
      return parseClassification(text, input);
    },

    async confirmVersion(input) {
      const key = await config.getApiKey();
      if (!key) return fallbackConfirm(input);
      const text = await chat(
        config,
        key,
        `Compare vault doc vs candidate. Return ONLY JSON {isSamePolicy,isNewer,confidence,reason}.\nExisting:${JSON.stringify(input.existing)}\nCandidate:${JSON.stringify(input.candidate)}`,
      );
      try {
        const json = JSON.parse(extractJson(text)) as Record<string, unknown>;
        return {
          isSamePolicy: Boolean(json.isSamePolicy),
          isNewer: Boolean(json.isNewer),
          confidence: Number(json.confidence ?? 0.5),
          reason: String(json.reason || ''),
        };
      } catch {
        return fallbackConfirm(input);
      }
    },
  };
}

export async function formatProviderHttpError(
  providerLabel: string,
  res: Response,
): Promise<Error & { status: number }> {
  let detail = res.statusText || 'request failed';
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      const body = JSON.parse(text) as {
        error?: { message?: string; type?: string; code?: string } | string;
        message?: string;
      };
      if (typeof body.error === 'string') detail = body.error;
      else if (body.error && typeof body.error === 'object' && body.error.message) detail = body.error.message;
      else if (body.message) detail = body.message;
      else detail = text.slice(0, 300);
    } catch {
      detail = text.slice(0, 300);
    }
  }
  const err = new Error(`${providerLabel} ${res.status}: ${detail}`) as Error & { status: number };
  err.status = res.status;
  return err;
}

function isModelMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; message?: string };
  if (e.status === 404) return true;
  const msg = (e.message || '').toLowerCase();
  return msg.includes('model') && (msg.includes('not found') || msg.includes('does not exist') || msg.includes('invalid'));
}

function isResponseFormatRejected(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; message?: string };
  if (e.status !== 400) return false;
  const msg = (e.message || '').toLowerCase();
  return (
    msg.includes('response_format') ||
    msg.includes('json_object') ||
    msg.includes('response format') ||
    msg.includes('structured output')
  );
}

async function chat(config: CompatibleConfig, key: string, userContent: string): Promise<string> {
  if (config.style === 'anthropic') {
    return anthropicChat(config, key, userContent);
  }
  return openAiStyleChat(config, key, userContent, config.model, true);
}

async function anthropicChat(config: CompatibleConfig, key: string, userContent: string): Promise<string> {
  const res = await fetch(`${config.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      // Required for browser / SPA calls without a backend proxy
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!res.ok) throw await formatProviderHttpError('Anthropic', res);
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return data.content?.map((c) => c.text || '').join('') || '{}';
}

async function openAiStyleChat(
  config: CompatibleConfig,
  key: string,
  userContent: string,
  model: string,
  useResponseFormat: boolean,
): Promise<string> {
  const label = config.displayName || 'OpenAI-compatible';
  const body: Record<string, unknown> = {
    model,
    temperature: 0.1,
    messages: [
      { role: 'system', content: 'You classify personal documents. Reply with JSON only.' },
      { role: 'user', content: userContent },
    ],
  };
  if (useResponseFormat) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await formatProviderHttpError(label, res);
    if (useResponseFormat && isResponseFormatRejected(err)) {
      return openAiStyleChat(config, key, userContent, model, false);
    }
    if (
      config.fallbackModel &&
      model === config.model &&
      isModelMissing(err)
    ) {
      return openAiStyleChat(config, key, userContent, config.fallbackModel, useResponseFormat);
    }
    throw err;
  }

  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content || '{}';
}

function parseClassification(text: string, input: AiFileInput): ClassificationResult {
  const fallback = classifyWithRules({
    subject: input.subject,
    from: input.from,
    fileName: input.fileName,
    mimeType: input.mimeType,
    textExcerpt: input.textExcerpt,
  });
  try {
    const json = JSON.parse(extractJson(text)) as Record<string, unknown>;
    return mergeClassification(fallback, {
      category: normalizeCategory(String(json.category || fallback.category)),
      title: String(json.title || fallback.title),
      confidence: Number(json.confidence ?? fallback.confidence),
      isImportantDocument: Boolean(json.isImportantDocument ?? fallback.isImportantDocument),
      reason: json.reason ? String(json.reason) : fallback.reason,
      metadata: {
        issuer: opt(json.issuer),
        documentType: opt(json.documentType),
        referenceNumber: opt(json.referenceNumber),
        holderName: opt(json.holderName),
        issueDate: opt(json.issueDate),
        expiryDate: opt(json.expiryDate),
      },
    });
  } catch {
    return fallback;
  }
}

function fallbackConfirm(input: VersionConfirmInput): VersionConfirmResult {
  const match = scoreDocumentMatch(input.existing, {
    title: input.candidate.title,
    metadata: input.candidate.metadata,
  });
  const currentDate = input.existing.metadata.issueDate || new Date(0).toISOString();
  const candidateDate = input.candidate.emailDate || input.candidate.metadata?.issueDate || new Date().toISOString();
  return {
    isSamePolicy: match.isLikelySame,
    isNewer: isNewerVersion(currentDate, candidateDate),
    confidence: match.score,
    reason: match.reasons.join('; ') || 'Rule-based comparison (no AI key)',
  };
}

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function opt(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s || undefined;
}
