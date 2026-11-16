import { AiDetailSummary, ScanCandidate, VaultCategory } from '../types/document';
import { getAiService } from '../services/ai';
import { getGmailService } from '../services/gmail';
import { extractPdfText } from './pdfTextLite';
import { ensureClassificationDisplay, looksLikeInternalKey, plainDisplayText } from './reviewLabels';
import { normalizeCategory } from './folders';

function maskReference(ref?: string): string | undefined {
  if (!ref) return undefined;
  const t = ref.trim();
  if (t.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(8, t.length - 4))}${t.slice(-4)}`;
}

/**
 * Ask the user's AI key for a short document summary; cache on the candidate.
 * Uses subject+sender+snippet + optional PDF text (first pages).
 */
export async function askAiForDetail(candidate: ScanCandidate): Promise<AiDetailSummary> {
  if (candidate.aiDetail) return candidate.aiDetail;

  let pdfText = '';
  try {
    if (/pdf/i.test(candidate.mimeType) || /\.pdf$/i.test(candidate.fileName)) {
      const att = await getGmailService().getAttachment(
        candidate.gmailMessageId,
        candidate.gmailAttachmentId,
        {
          filename: candidate.fileName,
          mimeType: candidate.mimeType,
          size: candidate.sizeBytes,
          subject: candidate.subject,
          from: candidate.from,
          date: candidate.date,
        },
      );
      pdfText = await extractPdfText(att.dataBase64);
    }
  } catch {
    pdfText = '';
  }

  const ai = getAiService();
  const excerpt = [
    `Subject: ${candidate.subject}`,
    `From: ${candidate.from}`,
    `Attachment: ${candidate.fileName} (${candidate.mimeType}, ${candidate.sizeBytes} bytes)`,
    `Snippet: ${candidate.previewSnippet || ''}`,
    pdfText ? `PDF text (first pages):\n${pdfText.slice(0, 6000)}` : 'PDF text unavailable.',
  ].join('\n');

  const classified = await ai.classifyDocument({
    fileName: candidate.fileName,
    mimeType: candidate.mimeType,
    subject: candidate.subject,
    from: candidate.from,
    textExcerpt: `${excerpt}

Respond with careful extraction. Prefer empty fields over guesses.
Also include a one-paragraph summary of what this document is.`,
  });

  const cleaned = ensureClassificationDisplay(classified, {
    from: candidate.from,
    subject: candidate.subject,
    fileName: candidate.fileName,
    snippet: candidate.previewSnippet,
  });

  const summary: AiDetailSummary = {
    documentType: plainDisplayText(cleaned.metadata.documentType),
    issuer: plainDisplayText(cleaned.metadata.issuer),
    referenceMasked: maskReference(cleaned.metadata.referenceNumber),
    holderName: plainDisplayText(cleaned.metadata.holderName),
    registrationNumber: plainDisplayText(cleaned.metadata.registrationNumber),
    issueDate: cleaned.metadata.issueDate,
    expiryDate: cleaned.metadata.expiryDate,
    summary:
      plainDisplayText(cleaned.reason) ||
      cleaned.title ||
      'AI could not produce a confident summary — check the email yourself.',
    confidence: cleaned.confidence,
    requestedAt: new Date().toISOString(),
  };

  // Strip any leaked internal keys
  if (looksLikeInternalKey(summary.issuer)) summary.issuer = undefined;
  if (looksLikeInternalKey(summary.documentType)) summary.documentType = undefined;

  return summary;
}

export function applyCategoryOverride(
  candidate: ScanCandidate,
  category: VaultCategory,
): ScanCandidate {
  const nextCat = normalizeCategory(category);
  return {
    ...candidate,
    categoryOverride: nextCat,
    classification: candidate.classification
      ? {
          ...candidate.classification,
          category: nextCat,
        }
      : candidate.classification,
  };
}
