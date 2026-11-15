/** Vault category paths that map to Google Drive folders. */
export type VaultCategory =
  | 'Insurance/Vehicle'
  | 'Insurance/Health'
  | 'Insurance/Home'
  | 'Insurance/Life'
  | 'Banking'
  | 'Tax'
  | 'Identity'
  | 'Bills'
  | 'Warranties'
  | 'Travel'
  | 'Other';

export const VAULT_CATEGORIES: VaultCategory[] = [
  'Insurance/Vehicle',
  'Insurance/Health',
  'Insurance/Home',
  'Insurance/Life',
  'Banking',
  'Tax',
  'Identity',
  'Bills',
  'Warranties',
  'Travel',
  'Other',
];

export const VAULT_ROOT_FOLDER = 'Document Vault';
export const VERSIONS_FOLDER = '_versions';
export const INDEX_FILENAME = 'vault-index.json';

export interface DocumentMetadata {
  issuer?: string;
  documentType?: string;
  referenceNumber?: string;
  holderName?: string;
  issueDate?: string; // ISO date YYYY-MM-DD
  expiryDate?: string; // ISO date YYYY-MM-DD
  renewalDate?: string;
  notes?: string;
  [key: string]: string | undefined;
}

export interface DocumentVersion {
  id: string;
  driveFileId: string;
  fileName: string;
  mimeType: string;
  hash: string;
  sizeBytes: number;
  createdAt: string; // ISO
  source: 'upload' | 'gmail' | 'sync';
  gmailMessageId?: string;
  gmailAttachmentId?: string;
}

export interface VaultDocument {
  id: string;
  title: string;
  category: VaultCategory;
  metadata: DocumentMetadata;
  currentVersionId: string;
  versions: DocumentVersion[];
  driveFolderPath: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
}

export interface VaultIndex {
  version: 1;
  vaultFolderId: string;
  lastScanAt: string | null;
  documents: VaultDocument[];
  updatedAt: string;
}

export interface ClassificationResult {
  category: VaultCategory;
  title: string;
  metadata: DocumentMetadata;
  confidence: number;
  isImportantDocument: boolean;
  reason?: string;
}

export interface ScanCandidate {
  id: string;
  gmailMessageId: string;
  gmailAttachmentId: string;
  subject: string;
  from: string;
  date: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  previewSnippet?: string;
  classification?: ClassificationResult;
  status: 'pending' | 'approved' | 'rejected' | 'duplicate' | 'skipped';
  duplicateOfId?: string;
  /** Base64 or mock content handle for saving */
  contentRef?: string;
}

export interface SyncSuggestion {
  documentId: string;
  candidate: ScanCandidate;
  isSamePolicy: boolean;
  isNewer: boolean;
  confidence: number;
  reason: string;
}

export type AiProviderId = 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'mock';

export interface AiUsageStats {
  requestsToday: number;
  lastRequestAt: string | null;
  lastError: string | null;
  queueDepth: number;
  rateLimitedUntil: string | null;
}
