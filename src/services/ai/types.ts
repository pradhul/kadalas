import {
  AiProviderId,
  AiUsageStats,
  ClassificationResult,
  DocumentMetadata,
  VaultDocument,
} from '../../types/document';
import { GmailAttachmentMeta } from '../gmail/types';

export interface AiFileInput {
  fileName: string;
  mimeType: string;
  /** Standard base64 (no data: prefix) */
  dataBase64?: string;
  textExcerpt?: string;
  subject?: string;
  from?: string;
}

export interface VersionConfirmInput {
  existing: Pick<VaultDocument, 'title' | 'metadata' | 'category'>;
  candidate: {
    title?: string;
    metadata?: DocumentMetadata;
    textExcerpt?: string;
    fileName?: string;
    emailDate?: string;
  };
}

export interface VersionConfirmResult {
  isSamePolicy: boolean;
  isNewer: boolean;
  confidence: number;
  reason: string;
  classification?: ClassificationResult;
}

export interface TriageItemInput {
  id: string;
  attachment: Pick<GmailAttachmentMeta, 'from' | 'subject' | 'filename' | 'mimeType' | 'snippet' | 'size'>;
}

export interface TriageItemResult {
  id: string;
  isLikelyImportant: boolean;
  confidence: number;
  reason?: string;
}

export interface AiProvider {
  id: AiProviderId;
  displayName: string;
  classifyDocument(input: AiFileInput): Promise<ClassificationResult>;
  confirmVersion(input: VersionConfirmInput): Promise<VersionConfirmResult>;
  /** Cheap metadata-only batch triage (no file bytes). */
  triageBatch?(items: TriageItemInput[]): Promise<TriageItemResult[]>;
}

export interface AiService {
  getProviderId(): AiProviderId;
  setProvider(id: AiProviderId): Promise<void>;
  hasApiKey(): Promise<boolean>;
  classifyDocument(input: AiFileInput): Promise<ClassificationResult>;
  confirmVersion(input: VersionConfirmInput): Promise<VersionConfirmResult>;
  triageBatch(items: TriageItemInput[]): Promise<TriageItemResult[]>;
  /** Tiny live request to verify the saved API key for the current provider. */
  testKey(): Promise<{ ok: boolean; message: string }>;
  getUsage(): AiUsageStats;
  subscribeUsage(listener: (stats: AiUsageStats) => void): () => void;
  /** Test hook — force next N AI calls to fail with 429 */
  __setMockQuotaFailAfter?: (n: number) => void;
}
