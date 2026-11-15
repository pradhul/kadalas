import {
  AiProviderId,
  AiUsageStats,
  ClassificationResult,
  DocumentMetadata,
  VaultDocument,
} from '../../types/document';

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

export interface AiProvider {
  id: AiProviderId;
  displayName: string;
  classifyDocument(input: AiFileInput): Promise<ClassificationResult>;
  confirmVersion(input: VersionConfirmInput): Promise<VersionConfirmResult>;
}

export interface AiService {
  getProviderId(): AiProviderId;
  setProvider(id: AiProviderId): Promise<void>;
  hasApiKey(): Promise<boolean>;
  classifyDocument(input: AiFileInput): Promise<ClassificationResult>;
  confirmVersion(input: VersionConfirmInput): Promise<VersionConfirmResult>;
  getUsage(): AiUsageStats;
  subscribeUsage(listener: (stats: AiUsageStats) => void): () => void;
}
