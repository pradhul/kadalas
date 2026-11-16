import { VaultDocument } from '../types/document';
import { getCurrentVersion } from './versioning';
import { ORIGINAL_EMAIL_GONE } from './storageKind';
import { getDriveService } from '../services/drive';
import { getGmailService } from '../services/gmail';
import { getOfflineBlob, putOfflineBlob } from '../services/offlineCache';

export { isGmailIndexVersion, ORIGINAL_EMAIL_GONE, versionStorageKind } from './storageKind';

export type OpenDocumentResult =
  | {
      ok: true;
      source: 'offline' | 'drive' | 'gmail';
      dataBase64?: string;
      openUrl?: string;
      fileName: string;
      mimeType: string;
    }
  | { ok: false; error: string };

/**
 * Resolve bytes / URL for viewing a vault document.
 * Prefers offline cache, then Drive copy, then live Gmail attachment fetch.
 */
export async function openDocumentContent(
  doc: VaultDocument,
  opts?: { cacheOffline?: boolean },
): Promise<OpenDocumentResult> {
  const version = getCurrentVersion(doc);
  if (!version) return { ok: false, error: 'No file version on this document' };

  const offline = await getOfflineBlob(doc.id, version.id);
  if (offline) {
    return {
      ok: true,
      source: 'offline',
      dataBase64: offline.dataBase64,
      fileName: version.fileName,
      mimeType: version.mimeType,
    };
  }

  if (version.driveFileId) {
    try {
      const url = await getDriveService().getDownloadUrl(version.driveFileId);
      return {
        ok: true,
        source: 'drive',
        openUrl: url,
        fileName: version.fileName,
        mimeType: version.mimeType,
      };
    } catch (e) {
      // Fall through to Gmail if this was also indexed from mail
      if (!version.gmailMessageId || !version.gmailAttachmentId) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : 'Could not open Drive file',
        };
      }
    }
  }

  if (version.gmailMessageId && version.gmailAttachmentId) {
    try {
      const content = await getGmailService().getAttachment(
        version.gmailMessageId,
        version.gmailAttachmentId,
        {
          messageId: version.gmailMessageId,
          attachmentId: version.gmailAttachmentId,
          filename: version.fileName,
          mimeType: version.mimeType,
          size: version.sizeBytes,
        },
      );
      if (!content.dataBase64) {
        return { ok: false, error: ORIGINAL_EMAIL_GONE };
      }
      if (opts?.cacheOffline) {
        await putOfflineBlob({
          docId: doc.id,
          versionId: version.id,
          fileName: version.fileName,
          mimeType: version.mimeType,
          sizeBytes: version.sizeBytes || content.size,
          dataBase64: content.dataBase64,
        }).catch(() => undefined);
      }
      return {
        ok: true,
        source: 'gmail',
        dataBase64: content.dataBase64,
        fileName: version.fileName,
        mimeType: version.mimeType,
      };
    } catch {
      return { ok: false, error: ORIGINAL_EMAIL_GONE };
    }
  }

  return { ok: false, error: 'No Drive file or Gmail attachment on this document' };
}
