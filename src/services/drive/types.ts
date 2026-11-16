import { VaultCategory, VaultDocument, VaultIndex } from '../../types/document';
import { ReviewState } from '../../types/review';
import { ScanJobState } from '../../types/scan';

export interface DriveFileRef {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  webViewLink?: string;
  webContentLink?: string;
  size?: number;
}

export interface UploadInput {
  name: string;
  mimeType: string;
  /** Base64 content without data-URL prefix, or raw text for JSON */
  contentBase64?: string;
  contentText?: string;
  parentFolderId: string;
}

export interface DriveService {
  ensureVaultStructure(): Promise<{ vaultFolderId: string; folderIdsByPath: Record<string, string> }>;
  loadIndex(): Promise<VaultIndex>;
  saveIndex(index: VaultIndex): Promise<void>;
  uploadFile(input: UploadInput): Promise<DriveFileRef>;
  moveFile(fileId: string, newParentId: string, oldParentId?: string): Promise<void>;
  renameFile(fileId: string, newName: string): Promise<void>;
  getDownloadUrl(fileId: string): Promise<string>;
  getFolderIdForCategory(category: VaultCategory): Promise<string>;
  archiveToVersions(fileId: string, versionsFolderId: string): Promise<DriveFileRef>;
  /** Convenience used by vault context after metadata edits */
  upsertDocument(doc: VaultDocument): Promise<VaultIndex>;
  saveScanState(state: ScanJobState | null): Promise<void>;
  loadScanState(): Promise<ScanJobState | null>;
  /** Overwrite-only review queue + skipped ids (never trash). */
  saveReviewState(state: ReviewState): Promise<void>;
  loadReviewState(): Promise<ReviewState | null>;
}
