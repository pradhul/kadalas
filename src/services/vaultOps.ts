import { shouldConsiderAttachment, classifyWithRules } from '../lib/categorisation';
import { dedupeScanCandidates, findDuplicateInVault } from '../lib/dedup';
import { hashBytes } from '../lib/hash';
import { buildGmailSearchQuery, isNewerVersion } from '../lib/matching';
import { createInitialDocument, getCurrentVersion, promoteVersion } from '../lib/versioning';
import {
  ClassificationResult,
  ScanCandidate,
  SyncSuggestion,
  VaultDocument,
  VaultIndex,
} from '../types/document';
import { getAiService } from './ai';
import { getDriveService } from './drive';
import { getGmailService } from './gmail';
import { MOCK_SCAN_CANDIDATES } from '../mocks/data';
import { useMocks } from './config';

function lookbackQuery(sinceIso: string | null, lookbackDays: number): string {
  const after = sinceIso
    ? new Date(sinceIso)
    : new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const y = after.getUTCFullYear();
  const m = String(after.getUTCMonth() + 1).padStart(2, '0');
  const d = String(after.getUTCDate()).padStart(2, '0');
  return `has:attachment (filename:pdf OR filename:jpg OR filename:jpeg OR filename:png) after:${y}/${m}/${d}`;
}

export async function scanGmailForDocuments(options: {
  lookbackDays?: number;
  index: VaultIndex;
  onProgress?: (message: string, current: number, total: number) => void;
}): Promise<{ candidates: ScanCandidate[]; skipped: number }> {
  const lookbackDays = options.lookbackDays ?? 90;
  const gmail = getGmailService();
  const ai = getAiService();
  const query = lookbackQuery(options.index.lastScanAt, lookbackDays);

  options.onProgress?.('Searching Gmail…', 0, 1);
  const attachments = await gmail.searchMessagesWithAttachments({ query, maxResults: 40 });

  let skipped = 0;
  const filtered = attachments.filter((a) => {
    const ok = shouldConsiderAttachment({
      subject: a.subject,
      from: a.from,
      snippet: a.snippet,
      fileName: a.filename,
      mimeType: a.mimeType,
    });
    if (!ok) skipped += 1;
    return ok;
  });

  // In mock mode, seed richer demo candidates if search is sparse
  let working = filtered;
  if (useMocks() && working.length < 2) {
    working = MOCK_SCAN_CANDIDATES.filter((c) => c.status !== 'skipped').map((c) => ({
      messageId: c.gmailMessageId,
      attachmentId: c.gmailAttachmentId,
      filename: c.fileName,
      mimeType: c.mimeType,
      size: c.sizeBytes,
      subject: c.subject,
      from: c.from,
      date: c.date,
      snippet: c.previewSnippet || '',
    }));
    skipped += MOCK_SCAN_CANDIDATES.filter((c) => c.status === 'skipped').length;
  }

  const candidates: ScanCandidate[] = [];
  for (let i = 0; i < working.length; i++) {
    const att = working[i];
    options.onProgress?.(`Classifying ${att.filename}…`, i + 1, working.length);

    let classification: ClassificationResult;
    let contentRef: string | undefined;

    try {
      const content = await gmail.getAttachment(att.messageId, att.attachmentId);
      contentRef = await hashBytes(content.dataBase64);
      const hasKey = await ai.hasApiKey();
      if (hasKey) {
        classification = await ai.classifyDocument({
          fileName: att.filename,
          mimeType: att.mimeType,
          dataBase64: content.dataBase64,
          subject: att.subject,
          from: att.from,
          textExcerpt: att.snippet,
        });
      } else {
        classification = classifyWithRules({
          subject: att.subject,
          from: att.from,
          fileName: att.filename,
          mimeType: att.mimeType,
          snippet: att.snippet,
        });
      }
    } catch {
      classification = classifyWithRules({
        subject: att.subject,
        from: att.from,
        fileName: att.filename,
        mimeType: att.mimeType,
        snippet: att.snippet,
      });
    }

    const dup = findDuplicateInVault(
      {
        hash: contentRef,
        metadata: classification.metadata,
        title: classification.title,
        category: classification.category,
      },
      options.index.documents,
    );

    candidates.push({
      id: `scan_${att.messageId}_${att.attachmentId}`,
      gmailMessageId: att.messageId,
      gmailAttachmentId: att.attachmentId,
      subject: att.subject,
      from: att.from,
      date: att.date,
      fileName: att.filename,
      mimeType: att.mimeType,
      sizeBytes: att.size,
      previewSnippet: att.snippet,
      classification,
      contentRef,
      status: dup.isDuplicate
        ? 'duplicate'
        : classification.isImportantDocument
          ? 'pending'
          : 'skipped',
      duplicateOfId: dup.duplicateOfId,
    });
  }

  const deduped = dedupeScanCandidates(candidates, options.index.documents, (c) => c.contentRef);
  return { candidates: deduped, skipped };
}

export async function syncDocumentFromGmail(
  doc: VaultDocument,
  onProgress?: (message: string) => void,
): Promise<SyncSuggestion | null> {
  const gmail = getGmailService();
  const ai = getAiService();
  const current = getCurrentVersion(doc);
  const after = current?.createdAt || doc.updatedAt;
  const query = buildGmailSearchQuery(doc, after);

  onProgress?.('Searching Gmail for newer versions…');
  const hits = await gmail.searchMessagesWithAttachments({ query, maxResults: 10 });
  if (!hits.length) return null;

  for (const hit of hits) {
    if (!isNewerVersion(after, hit.date)) continue;
    onProgress?.(`Evaluating ${hit.filename}…`);

    let dataBase64: string | undefined;
    try {
      const content = await gmail.getAttachment(hit.messageId, hit.attachmentId);
      dataBase64 = content.dataBase64;
    } catch {
      // continue with metadata only
    }

    const confirm = await ai.confirmVersion({
      existing: doc,
      candidate: {
        title: hit.subject,
        fileName: hit.filename,
        emailDate: hit.date,
        textExcerpt: hit.snippet,
        metadata: {
          issuer: doc.metadata.issuer,
          referenceNumber: doc.metadata.referenceNumber,
          documentType: doc.metadata.documentType,
        },
      },
    });

    if (confirm.isSamePolicy && confirm.isNewer) {
      const candidate: ScanCandidate = {
        id: `sync_${hit.messageId}`,
        gmailMessageId: hit.messageId,
        gmailAttachmentId: hit.attachmentId,
        subject: hit.subject,
        from: hit.from,
        date: hit.date,
        fileName: hit.filename,
        mimeType: hit.mimeType,
        sizeBytes: hit.size,
        previewSnippet: hit.snippet,
        contentRef: dataBase64 ? await hashBytes(dataBase64) : undefined,
        status: 'pending',
        classification: confirm.classification || {
          category: doc.category,
          title: doc.title,
          metadata: doc.metadata,
          confidence: confirm.confidence,
          isImportantDocument: true,
        },
      };
      return {
        documentId: doc.id,
        candidate,
        isSamePolicy: true,
        isNewer: true,
        confidence: confirm.confidence,
        reason: confirm.reason,
      };
    }
  }

  return null;
}

export type SaveCandidateResult = {
  document: VaultDocument;
  driveFileId: string;
  webViewLink?: string;
  parentFolderId: string;
  category: VaultDocument['category'];
};

export async function saveCandidateToVault(
  candidate: ScanCandidate,
  overrides?: Partial<ClassificationResult>,
): Promise<SaveCandidateResult> {
  const drive = getDriveService();
  const gmail = getGmailService();
  const classification = {
    ...(candidate.classification || classifyWithRules({ fileName: candidate.fileName, subject: candidate.subject })),
    ...overrides,
    metadata: {
      ...(candidate.classification?.metadata || {}),
      ...(overrides?.metadata || {}),
    },
  };

  if (!candidate.gmailMessageId || !candidate.gmailAttachmentId) {
    throw new Error('Missing Gmail message/attachment id — cannot download the file');
  }

  const folderId = await drive.getFolderIdForCategory(classification.category);
  // Never silently substitute a placeholder — a failed Gmail fetch must surface to the user.
  const content = await gmail.getAttachment(
    candidate.gmailMessageId,
    candidate.gmailAttachmentId,
    {
      messageId: candidate.gmailMessageId,
      attachmentId: candidate.gmailAttachmentId,
      filename: candidate.fileName,
      mimeType: candidate.mimeType,
      size: candidate.sizeBytes,
      subject: candidate.subject,
      from: candidate.from,
      date: candidate.date,
      snippet: candidate.previewSnippet || '',
    },
  );
  if (!content.dataBase64) {
    throw new Error('Gmail returned an empty attachment');
  }

  const hash = candidate.contentRef || (await hashBytes(content.dataBase64));
  const uploaded = await drive.uploadFile({
    name: sanitizeFileName(classification.title || candidate.fileName),
    mimeType: candidate.mimeType || content.mimeType,
    contentBase64: content.dataBase64,
    parentFolderId: folderId,
  });
  if (!uploaded?.id) {
    throw new Error('Drive upload returned no file id');
  }

  const doc = createInitialDocument({
    title: classification.title,
    category: classification.category,
    metadata: classification.metadata,
    driveFolderPath: classification.category,
    version: {
      driveFileId: uploaded.id,
      fileName: uploaded.name,
      mimeType: candidate.mimeType,
      hash,
      sizeBytes: candidate.sizeBytes,
      createdAt: new Date().toISOString(),
      source: 'gmail',
      gmailMessageId: candidate.gmailMessageId,
      gmailAttachmentId: candidate.gmailAttachmentId,
    },
  });

  await drive.upsertDocument(doc);
  return {
    document: doc,
    driveFileId: uploaded.id,
    webViewLink: uploaded.webViewLink,
    parentFolderId: folderId,
    category: classification.category,
  };
}

export async function applySyncSuggestion(suggestion: SyncSuggestion): Promise<VaultDocument> {
  const drive = getDriveService();
  const gmail = getGmailService();
  const index = await drive.loadIndex();
  const doc = index.documents.find((d) => d.id === suggestion.documentId);
  if (!doc) throw new Error('Document not found');

  const structure = await drive.ensureVaultStructure();
  const versionsFolderId = structure.folderIdsByPath['_versions'];
  const current = getCurrentVersion(doc);
  if (current) {
    await drive.archiveToVersions(current.driveFileId, versionsFolderId);
  }

  let contentBase64 = '';
  try {
    const content = await gmail.getAttachment(
      suggestion.candidate.gmailMessageId,
      suggestion.candidate.gmailAttachmentId,
    );
    contentBase64 = content.dataBase64;
  } catch {
    contentBase64 = btoa(`sync:${suggestion.candidate.fileName}`);
  }

  const folderId = await drive.getFolderIdForCategory(doc.category);
  const uploaded = await drive.uploadFile({
    name: sanitizeFileName(suggestion.candidate.fileName),
    mimeType: suggestion.candidate.mimeType,
    contentBase64,
    parentFolderId: folderId,
  });

  const hash = suggestion.candidate.contentRef || (await hashBytes(contentBase64));
  let updated = promoteVersion(doc, {
    driveFileId: uploaded.id,
    fileName: uploaded.name,
    mimeType: suggestion.candidate.mimeType,
    hash,
    sizeBytes: suggestion.candidate.sizeBytes,
    createdAt: new Date().toISOString(),
    source: 'sync',
    gmailMessageId: suggestion.candidate.gmailMessageId,
    gmailAttachmentId: suggestion.candidate.gmailAttachmentId,
  });

  if (suggestion.candidate.classification?.metadata) {
    updated = {
      ...updated,
      metadata: { ...updated.metadata, ...suggestion.candidate.classification.metadata },
      title: suggestion.candidate.classification.title || updated.title,
    };
  }

  await drive.upsertDocument(updated);
  return updated;
}

export async function addLocalDocument(input: {
  fileName: string;
  mimeType: string;
  contentBase64: string;
  classification: ClassificationResult;
}): Promise<VaultDocument> {
  const drive = getDriveService();
  const folderId = await drive.getFolderIdForCategory(input.classification.category);
  const hash = await hashBytes(input.contentBase64);
  const uploaded = await drive.uploadFile({
    name: sanitizeFileName(input.classification.title || input.fileName),
    mimeType: input.mimeType,
    contentBase64: input.contentBase64,
    parentFolderId: folderId,
  });

  const doc = createInitialDocument({
    title: input.classification.title,
    category: input.classification.category,
    metadata: input.classification.metadata,
    driveFolderPath: input.classification.category,
    version: {
      driveFileId: uploaded.id,
      fileName: uploaded.name,
      mimeType: input.mimeType,
      hash,
      sizeBytes: Math.floor((input.contentBase64.length * 3) / 4),
      createdAt: new Date().toISOString(),
      source: 'upload',
    },
  });

  await drive.upsertDocument(doc);
  return doc;
}

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'document';
  return cleaned.toLowerCase().endsWith('.pdf') || /\.\w{2,4}$/.test(cleaned)
    ? cleaned
    : `${cleaned}.pdf`;
}

function btoa(value: string): string {
  if (typeof globalThis.btoa === 'function') return globalThis.btoa(value);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  for (let i = 0; i < value.length; i += 3) {
    const a = value.charCodeAt(i);
    const b = i + 1 < value.length ? value.charCodeAt(i + 1) : NaN;
    const c = i + 2 < value.length ? value.charCodeAt(i + 2) : NaN;
    const bitmap = (a << 16) | ((Number.isNaN(b) ? 0 : b) << 8) | (Number.isNaN(c) ? 0 : c);
    output += chars.charAt((bitmap >> 18) & 63);
    output += chars.charAt((bitmap >> 12) & 63);
    output += Number.isNaN(b) ? '=' : chars.charAt((bitmap >> 6) & 63);
    output += Number.isNaN(c) ? '=' : chars.charAt(bitmap & 63);
  }
  return output;
}
