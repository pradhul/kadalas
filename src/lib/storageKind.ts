import { DocumentVersion } from '../types/document';
import { StorageKind } from '../types/settings';

export const ORIGINAL_EMAIL_GONE = 'Original email no longer available';

export function versionStorageKind(version: DocumentVersion | undefined): StorageKind {
  if (!version) return 'drive_copy';
  if (version.storageKind === 'gmail_index') return 'gmail_index';
  if (version.storageKind === 'drive_copy') return 'drive_copy';
  if (version.driveFileId) return 'drive_copy';
  if (version.gmailMessageId && version.gmailAttachmentId) return 'gmail_index';
  return 'drive_copy';
}

export function isGmailIndexVersion(version: DocumentVersion | undefined): boolean {
  return versionStorageKind(version) === 'gmail_index';
}
