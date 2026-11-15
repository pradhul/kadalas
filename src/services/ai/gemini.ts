import { classifyWithRules, mergeClassification } from '../../lib/categorisation';
import { normalizeCategory } from '../../lib/folders';
import { isNewerVersion, scoreDocumentMatch } from '../../lib/matching';
import { ClassificationResult } from '../../types/document';
import { AiFileInput, AiProvider, VersionConfirmInput, VersionConfirmResult } from './types';

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

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

      const prompt = `You are a personal document vault classifier.
Return ONLY JSON with keys:
category (one of: Insurance/Vehicle, Insurance/Health, Insurance/Home, Insurance/Life, Banking, Tax, Identity, Bills, Warranties, Travel, Other),
title (clean short title),
issuer, documentType, referenceNumber, holderName, issueDate (YYYY-MM-DD), expiryDate (YYYY-MM-DD),
isImportantDocument (boolean), confidence (0-1), reason (short).
Skip promos/newsletters (isImportantDocument=false).`;

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

      const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
      });

      if (!res.ok) {
        const err = new Error(`Gemini error ${res.status}`) as Error & { status: number };
        err.status = res.status;
        throw err;
      }

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '{}';
      return parseClassification(text, input);
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

      const res = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
      });
      if (!res.ok) {
        const err = new Error(`Gemini error ${res.status}`) as Error & { status: number };
        err.status = res.status;
        throw err;
      }
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
