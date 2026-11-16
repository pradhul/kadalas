import { classifyWithRules, mergeClassification } from '../../lib/categorisation';
import { fetchWithTimeout } from '../../lib/fetchWithTimeout';
import { normalizeCategory } from '../../lib/folders';
import { isNewerVersion, scoreDocumentMatch } from '../../lib/matching';
import { ruleTriage } from '../../lib/ruleTriage';
import { ClassificationResult } from '../../types/document';
import {
  AiFileInput,
  AiProvider,
  TriageItemInput,
  TriageItemResult,
  VersionConfirmInput,
  VersionConfirmResult,
} from './types';

export { ruleTriage } from '../../lib/ruleTriage';

/** Default Gemini model (verified against Google AI Studio docs). */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite';
/** Alias fallback when the pinned model returns 404 / NOT_FOUND. */
export const GEMINI_FALLBACK_MODEL = 'gemini-flash-latest';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function geminiUrl(model: string, key: string): string {
  return `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`;
}

/**
 * Parse Gemini error JSON and throw `Gemini <status>: <message>` with `.status` preserved
 * so 429 / RESOURCE_EXHAUSTED still count as quota.
 */
export async function throwGeminiHttpError(res: Response): Promise<never> {
  let detail = res.statusText || 'request failed';
  const text = await res.text().catch(() => '');
  if (text) {
    try {
      const body = JSON.parse(text) as {
        error?: { message?: string; status?: string; code?: number };
      };
      if (body.error?.message) detail = body.error.message;
      else if (body.error?.status) detail = body.error.status;
      else detail = text.slice(0, 300);
    } catch {
      detail = text.slice(0, 300);
    }
  }
  const err = new Error(`Gemini ${res.status}: ${detail}`) as Error & {
    status: number;
    code?: string;
  };
  err.status = res.status;
  if (/RESOURCE_EXHAUSTED/i.test(detail)) err.code = 'RESOURCE_EXHAUSTED';
  throw err;
}

function isModelNotFound(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; message?: string };
  if (e.status === 404) return true;
  const msg = (e.message || '').toLowerCase();
  return msg.includes('not_found') || msg.includes('not found') || msg.includes('is not found');
}

async function geminiFetch(
  key: string,
  body: Record<string, unknown>,
  model: string = GEMINI_DEFAULT_MODEL,
): Promise<Response> {
  const res = await fetchWithTimeout(geminiUrl(model, key), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) return res;

  try {
    await throwGeminiHttpError(res);
  } catch (err) {
    if (model !== GEMINI_FALLBACK_MODEL && isModelNotFound(err)) {
      const retry = await fetchWithTimeout(geminiUrl(GEMINI_FALLBACK_MODEL, key), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (retry.ok) return retry;
      await throwGeminiHttpError(retry);
    }
    throw err;
  }
  // unreachable
  throw new Error('Gemini request failed');
}

export function createGeminiProvider(getApiKey: () => Promise<string | null>): AiProvider {
  return {
    id: 'gemini',
    displayName: 'Google AI Studio (Gemini)',

    async classifyDocument(input) {
      const key = await getApiKey();
      if (!key) {
        return classifyWithRules({
          subject: input.subject,
          from: input.from,
          fileName: input.fileName,
          mimeType: input.mimeType,
          textExcerpt: input.textExcerpt,
        });
      }

      const prompt = `You are a classifier for Kadalas, a personal papers vault.
Return ONLY JSON with keys:
category (one of: Insurance/Vehicle, Insurance/Health, Insurance/Home, Insurance/Life, Banking, Tax, Identity, Bills, Warranties, Travel, Other),
title (clean short title),
issuer, documentType, referenceNumber, holderName, issueDate (YYYY-MM-DD), expiryDate (YYYY-MM-DD),
registrationNumber, chassisNumber, engineNumber, vehicleMakeModel,
propertyAddress, deviceSerial,
isImportantDocument (boolean), confidence (0-1), reason (short).
Rules:
- Set registrationNumber / chassisNumber ONLY when that exact identifier is clearly visible in the document or email text. Never invent, guess, or use placeholder plates.
- For non-vehicle categories (Banking, Health, Tax, etc.) leave registrationNumber empty.
- For vehicle documents, extract the plate when visible — policy numbers change on renewal.
- Skip promos/newsletters (isImportantDocument=false).`;

      const parts: Array<Record<string, unknown>> = [{ text: prompt }];
      if (input.subject || input.from) {
        parts.push({ text: `Email subject: ${input.subject || ''}\nFrom: ${input.from || ''}` });
      }
      if (input.textExcerpt) parts.push({ text: `Text excerpt:\n${input.textExcerpt.slice(0, 8000)}` });
      if (input.dataBase64 && input.mimeType) {
        parts.push({
          inline_data: {
            mime_type: input.mimeType,
            data: input.dataBase64,
          },
        });
      }

      const res = await geminiFetch(key, {
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      });

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
      return parseClassification(text, input);
    },

    async triageBatch(items: TriageItemInput[]): Promise<TriageItemResult[]> {
      const key = await getApiKey();
      if (!key) return ruleTriage(items);

      const prompt = `You triage email attachments for Kadalas, a personal papers vault.
For each item, decide if it is likely an important personal document (policy, statement, tax, ID, bill, warranty, travel itinerary) vs promo/newsletter/noise.
Return ONLY JSON: { "results": [ { "id": "...", "isLikelyImportant": true/false, "confidence": 0-1, "reason": "short" } ] }
Items:\n${JSON.stringify(
        items.map((i) => ({
          id: i.id,
          from: i.attachment.from,
          subject: i.attachment.subject,
          filename: i.attachment.filename,
          mimeType: i.attachment.mimeType,
          snippet: i.attachment.snippet,
          size: i.attachment.size,
        })),
      )}`;

      const res = await geminiFetch(key, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      });
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
      try {
        const parsed = JSON.parse(extractJson(text)) as {
          results?: TriageItemResult[];
        };
        if (Array.isArray(parsed.results) && parsed.results.length) return parsed.results;
      } catch {
        // fall through
      }
      return ruleTriage(items);
    },

    async confirmVersion(input) {
      const key = await getApiKey();
      if (!key) {
        return fallbackConfirm(input);
      }

      const prompt = `Compare an existing vault document with a Gmail attachment candidate.
Existing: ${JSON.stringify(input.existing)}
Candidate: ${JSON.stringify(input.candidate)}
Return ONLY JSON: { isSamePolicy, isNewer, confidence, reason, classification: { category, title, issuer, documentType, referenceNumber, holderName, issueDate, expiryDate, isImportantDocument } }`;

      const res = await geminiFetch(key, {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
      });
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
      return parseConfirm(text, input);
    },
  };
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
        issuer: str(json.issuer),
        documentType: str(json.documentType),
        referenceNumber: str(json.referenceNumber),
        holderName: str(json.holderName),
        issueDate: str(json.issueDate),
        expiryDate: str(json.expiryDate),
        registrationNumber: str(json.registrationNumber),
        chassisNumber: str(json.chassisNumber),
        engineNumber: str(json.engineNumber),
        vehicleMakeModel: str(json.vehicleMakeModel),
        propertyAddress: str(json.propertyAddress),
        deviceSerial: str(json.deviceSerial),
      },
    });
  } catch {
    return fallback;
  }
}

function parseConfirm(text: string, input: VersionConfirmInput): VersionConfirmResult {
  try {
    const json = JSON.parse(extractJson(text)) as Record<string, unknown>;
    const classificationRaw = (json.classification || {}) as Record<string, unknown>;
    return {
      isSamePolicy: Boolean(json.isSamePolicy),
      isNewer: Boolean(json.isNewer),
      confidence: Number(json.confidence ?? 0.5),
      reason: String(json.reason || ''),
      classification: {
        category: normalizeCategory(String(classificationRaw.category || input.existing.category)),
        title: String(classificationRaw.title || input.existing.title),
        confidence: Number(json.confidence ?? 0.5),
        isImportantDocument: true,
        metadata: {
          issuer: str(classificationRaw.issuer) || input.existing.metadata.issuer,
          documentType: str(classificationRaw.documentType) || input.existing.metadata.documentType,
          referenceNumber: str(classificationRaw.referenceNumber) || input.existing.metadata.referenceNumber,
          holderName: str(classificationRaw.holderName) || input.existing.metadata.holderName,
          issueDate: str(classificationRaw.issueDate),
          expiryDate: str(classificationRaw.expiryDate),
        },
      },
    };
  } catch {
    return fallbackConfirm(input);
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

function str(value: unknown): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  return s || undefined;
}

