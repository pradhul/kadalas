import { ClassificationResult, DocumentMetadata, ScanCandidate, VaultCategory } from '../types/document';
import { formatCoverageType, normalizeVehicleCoverageType } from './coverageSlots';
import { categoryLabel, isValidCategory } from './folders';
import { isVehicleReviewFamily } from './subjectSuggestions';

export type ConfidenceBand = 'high' | 'medium' | 'low';

/** Internal / product-code shaped strings must never leak into the UI. */
export function looksLikeInternalKey(value?: string | null): boolean {
  if (!value) return false;
  const v = value.trim();
  if (!v) return false;
  if (/^[A-Za-z]+(\.[A-Za-z][A-Za-z0-9]*)+$/.test(v)) return true; // TermLoans.CreditCar
  if (/^[A-Z][a-z]+(?:[A-Z][a-z0-9]+){2,}$/.test(v) && !/\s/.test(v) && v.length > 18) return true;
  if (/^(od_only|tp_only|comprehensive|unknown|own_damage|third_party)$/i.test(v)) return true;
  if (/^[a-z_]+$/i.test(v) && v.includes('_') && !/\s/.test(v)) return true;
  return false;
}

export function plainDisplayText(value?: string | null): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  if (!v || looksLikeInternalKey(v)) return undefined;
  // Collapse dotted product codes that slipped through
  if (v.includes('.') && !/\s/.test(v) && /[A-Z]/.test(v) && /[a-z]/.test(v)) return undefined;
  return v;
}

export function confidenceBand(score: number | undefined | null): ConfidenceBand {
  const n = typeof score === 'number' && Number.isFinite(score) ? score : 0;
  if (n >= 0.75) return 'high';
  if (n >= 0.45) return 'medium';
  return 'low';
}

export function confidenceLabel(band: ConfidenceBand): string {
  switch (band) {
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    default:
      return 'Low';
  }
}

export function collectClassificationSignals(input: {
  from?: string;
  subject?: string;
  fileName?: string;
  snippet?: string;
  category?: VaultCategory;
  metadata?: DocumentMetadata;
}): string[] {
  const signals: string[] = [];
  const from = input.from || '';
  const fileName = input.fileName || '';
  const hay = [input.subject, input.snippet, fileName, from].filter(Boolean).join(' ');

  if (/@[a-z0-9.-]+\.(com|in|co\.in|bank)/i.test(from)) {
    const domain = /@([a-z0-9.-]+)/i.exec(from)?.[1];
    if (domain) signals.push(`Sender domain (${domain})`);
  }
  if (/statement|policy|invoice|receipt|aadhaar|aadhar|\bpan\b|form\s*16|ticket|boarding/i.test(fileName)) {
    signals.push('Filename keywords');
  }
  if (/statement|policy|invoice|receipt|aadhaar|premium|renewal|loan|emi/i.test(hay)) {
    signals.push('Email keywords');
  }
  if (input.metadata?.referenceNumber) signals.push('Reference / account number');
  if (input.metadata?.registrationNumber) signals.push('Vehicle registration');
  if (input.category && input.category !== 'Other') signals.push(`Category: ${categoryLabel(input.category)}`);
  return [...new Set(signals)];
}

/** Calibrate confidence from how strong the matched signals are. */
export function calibrateConfidence(input: {
  baseConfidence?: number;
  signals: string[];
  category: VaultCategory;
  hasDocumentHint: boolean;
}): { confidence: number; band: ConfidenceBand } {
  let score = typeof input.baseConfidence === 'number' ? input.baseConfidence : 0.4;
  if (input.signals.length >= 3 && input.hasDocumentHint) score = Math.max(score, 0.82);
  else if (input.signals.length >= 2) score = Math.max(score, 0.6);
  else if (input.signals.length === 1) score = Math.min(Math.max(score, 0.4), 0.55);
  else score = Math.min(score, 0.3);
  if (input.category === 'Other') score = Math.min(score, 0.35);
  score = Math.max(0, Math.min(1, score));
  return { confidence: score, band: confidenceBand(score) };
}

export function displayIssuer(metadata?: DocumentMetadata, from?: string): string | undefined {
  const plain = plainDisplayText(metadata?.issuer);
  if (plain) return plain;
  // Fall back to a friendly From display name when issuer was an internal key
  if (from) {
    const angle = /^(?:"?([^"<]+)"?\s*)?<?([^>]+@[^>]+)>?$/.exec(from.trim());
    const name = angle?.[1]?.trim();
    if (name && !looksLikeInternalKey(name)) return name;
    const domain = angle?.[2]?.split('@')[1];
    if (domain) return domain.replace(/\.(com|in|co\.in)$/i, '');
  }
  return undefined;
}

export function displayDocumentType(metadata?: DocumentMetadata): string | undefined {
  return plainDisplayText(metadata?.documentType);
}

/** Coverage label only when we truly know the subtype — never invent "comprehensive". */
export function displayCoverageLabel(
  category: VaultCategory | undefined,
  documentType: string | undefined,
  coverageType: string | undefined,
): string | undefined {
  if (!isVehicleReviewFamily(category, documentType)) return undefined;
  const normalized = normalizeVehicleCoverageType(coverageType);
  if (normalized === 'unknown') return undefined;
  return formatCoverageType(coverageType);
}

export function reviewCardSubtitle(c: ScanCandidate): string {
  const m = c.classification?.metadata ?? {};
  const parts: string[] = [];
  parts.push(c.classification?.category ? categoryLabel(c.classification.category) : 'Unclassified');
  const issuer = displayIssuer(m, c.from);
  if (issuer) parts.push(issuer);
  const coverage = displayCoverageLabel(c.classification?.category, m.documentType, m.coverageType);
  if (coverage) parts.push(coverage);
  else {
    const docType = displayDocumentType(m);
    if (docType) parts.push(docType);
  }
  return parts.join(' · ');
}

export function ensureClassificationDisplay(result: ClassificationResult, ctx?: {
  from?: string;
  subject?: string;
  fileName?: string;
  snippet?: string;
}): ClassificationResult {
  const metadata = { ...result.metadata };
  if (looksLikeInternalKey(metadata.issuer)) {
    metadata.issuer = displayIssuer(metadata, ctx?.from) || undefined;
    if (looksLikeInternalKey(metadata.issuer)) delete metadata.issuer;
  }
  if (looksLikeInternalKey(metadata.documentType)) {
    delete metadata.documentType;
  }
  if (looksLikeInternalKey(metadata.coverageType) || normalizeVehicleCoverageType(metadata.coverageType) === 'unknown') {
    // Keep unknown coverage out of display path
    if (normalizeVehicleCoverageType(metadata.coverageType) === 'unknown') {
      delete metadata.coverageType;
    }
  }
  const category = isValidCategory(result.category) ? result.category : 'Other';
  const signals =
    result.signals?.length
      ? result.signals
      : collectClassificationSignals({
          from: ctx?.from,
          subject: ctx?.subject,
          fileName: ctx?.fileName,
          snippet: ctx?.snippet,
          category,
          metadata,
        });
  const hasDocumentHint = signals.some((s) => /filename|keyword|reference|registration/i.test(s));
  const { confidence } = calibrateConfidence({
    baseConfidence: result.confidence,
    signals,
    category,
    hasDocumentHint,
  });
  return {
    ...result,
    category,
    metadata,
    confidence,
    signals,
    reason: plainDisplayText(result.reason) || result.reason || 'Matched available email signals',
  };
}
