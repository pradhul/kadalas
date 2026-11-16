import type { StorageKind, StorageMode } from './settings';

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

/** Drive root folder created by the app (Malayalam for papers/documents). */
export const VAULT_ROOT_FOLDER = 'Kadalas';
/** Legacy name — still detected so existing Drive vaults keep working. */
export const LEGACY_VAULT_ROOT_FOLDER = 'Document Vault';
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
  /** Vehicle registration / plate (primary vehicle subject) */
  registrationNumber?: string;
  chassisNumber?: string;
  engineNumber?: string;
  vehicleMakeModel?: string;
  /** Property / device / other entity identifiers */
  propertyAddress?: string;
  deviceSerial?: string;
  /**
   * Stable entity key for grouping versions of the same document subject
   * (e.g. vehicle:reg:ka01ab1234). Prefer subject over policy number —
   * policy numbers change on renewal / insurer switch.
   */
  subjectKey?: string;
  subjectLabel?: string;
  subjectConfidence?: string; // "0"–"1" as string for index JSON simplicity
  /**
   * Multi-part coverage (generic). For vehicle insurance:
   * comprehensive | od_only | tp_only
   */
  coverageType?: string;
  /** Comma-separated slot ids this document fills (e.g. "own_damage,third_party") */
  coverageSlots?: string;
  policyStartDate?: string;
  notes?: string;
  [key: string]: string | undefined;
}

export interface DocumentVersion {
  id: string;
  /**
   * Drive file id when a copy was uploaded.
   * Empty string for gmail_index entries (bytes stay in Gmail until opened).
   */
  driveFileId: string;
  /** Where bytes live: gmail_index (default for new Approves) or drive_copy. */
  storageKind?: StorageKind;
  fileName: string;
  mimeType: string;
  hash: string;
  sizeBytes: number;
  createdAt: string; // ISO
  source: 'upload' | 'gmail' | 'sync';
  gmailMessageId?: string;
  gmailAttachmentId?: string;
  /** Sender captured at index time (gmail_index). */
  gmailFrom?: string;
  /** Email subject captured at index time. */
  gmailSubject?: string;
  /** Email date captured at index time (ISO). */
  gmailDate?: string;
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
  /** User preferences stored in the tiny vault-index.json (overwrite only). */
  settings?: {
    storageMode?: StorageMode;
  };
}

export interface ClassificationResult {
  category: VaultCategory;
  title: string;
  metadata: DocumentMetadata;
  /** 0–1 calibrated confidence */
  confidence: number;
  isImportantDocument: boolean;
  /** One-line plain-language reason (never internal keys). */
  reason?: string;
  /** Human-readable signals that supported the classification. */
  signals?: string[];
}

/** Cached "Ask AI for more detail" response on a review candidate. */
export interface AiDetailSummary {
  documentType?: string;
  issuer?: string;
  /** Masked policy / account number */
  referenceMasked?: string;
  holderName?: string;
  registrationNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  summary: string;
  confidence: number;
  requestedAt: string;
}

export type ScanCandidateStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'duplicate'
  | 'skipped'
  | 'needs_subject_confirm';

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
  status: ScanCandidateStatus;
  duplicateOfId?: string;
  /** Base64 or mock content handle for saving */
  contentRef?: string;
  /** Entity grouping (document type + subject key) */
  groupId?: string;
  groupLabel?: string;
  /** True when this candidate is the latest in its group */
  isGroupLatest?: boolean;
  /** Other version candidate ids in the same group (older) */
  olderVersionIds?: string[];
  groupVersionCount?: number;
  /** Ambiguous subject — user should confirm/merge */
  subjectAmbiguous?: boolean;
  /** Suggested subject keys when status is needs_subject_confirm */
  possibleSubjectKeys?: string[];
  /** Human summary from entity grouping (e.g. "4 versions found, keeping 2026-27 policy") */
  groupSummary?: string;
  /** Last Approve failure — shown on the card with Retry */
  saveError?: string;
  /** Drive file id after a confirmed successful Approve */
  driveFileId?: string;
  /** Drive webViewLink after a confirmed successful Approve */
  driveWebViewLink?: string;
  /**
   * Why this item was auto-skipped (e.g. "Filtered: email decoration").
   * Shown under Show skipped; user can restore.
   */
  skipReason?: string;
  /** Cached Ask-AI detail for this review item. */
  aiDetail?: AiDetailSummary;
  /** User-corrected category before Approve. */
  categoryOverride?: VaultCategory;
}

export interface SyncSuggestion {
  documentId: string;
  candidate: ScanCandidate;
  isSamePolicy: boolean;
  isNewer: boolean;
  confidence: number;
  reason: string;
}

export type AiProviderId = 'gemini' | 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'mock';

export interface AiUsageStats {
  requestsToday: number;
  lastRequestAt: string | null;
  lastError: string | null;
  queueDepth: number;
  rateLimitedUntil: string | null;
}
