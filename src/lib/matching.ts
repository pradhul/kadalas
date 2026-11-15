import { DocumentMetadata, VaultDocument } from '../types/document';

export interface MatchScore {
  score: number;
  reasons: string[];
  isLikelySame: boolean;
}

const SAME_THRESHOLD = 0.65;

function normalize(value?: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function stripPunctuation(value: string): string {
  return value.replace(/[^a-z0-9]/gi, '');
}

/** Compare two reference numbers with light normalization. */
export function referencesMatch(a?: string, b?: string): boolean {
  const left = stripPunctuation(normalize(a));
  const right = stripPunctuation(normalize(b));
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

export function issuersMatch(a?: string, b?: string): boolean {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.includes(right) || right.includes(left);
}

export function documentTypesMatch(a?: string, b?: string): boolean {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return false;
  const leftTokens = new Set(left.split(/[\s/_-]+/).filter(Boolean));
  const rightTokens = right.split(/[\s/_-]+/).filter(Boolean);
  const overlap = rightTokens.filter((t) => leftTokens.has(t)).length;
  return overlap > 0 && overlap / Math.max(rightTokens.length, 1) >= 0.5;
}

/**
 * Score whether a candidate (from Gmail/AI) refers to the same policy/account
 * as an existing vault document.
 */
export function scoreDocumentMatch(
  existing: Pick<VaultDocument, 'title' | 'metadata' | 'category'>,
  candidate: { title?: string; metadata?: DocumentMetadata; category?: string },
): MatchScore {
  const reasons: string[] = [];
  let score = 0;

  if (referencesMatch(existing.metadata.referenceNumber, candidate.metadata?.referenceNumber)) {
    score += 0.45;
    reasons.push('Matching reference number');
  }

  if (issuersMatch(existing.metadata.issuer, candidate.metadata?.issuer)) {
    score += 0.25;
    reasons.push('Matching issuer');
  }

  if (
    documentTypesMatch(existing.metadata.documentType, candidate.metadata?.documentType) ||
    (existing.category && candidate.category && existing.category === candidate.category)
  ) {
    score += 0.15;
    reasons.push('Matching document type / category');
  }

  if (issuersMatch(existing.metadata.holderName, candidate.metadata?.holderName)) {
    score += 0.1;
    reasons.push('Matching holder name');
  }

  const titleA = normalize(existing.title);
  const titleB = normalize(candidate.title);
  if (titleA && titleB && (titleA.includes(titleB) || titleB.includes(titleA))) {
    score += 0.1;
    reasons.push('Similar title');
  }

  score = Math.min(1, score);
  return {
    score,
    reasons,
    isLikelySame: score >= SAME_THRESHOLD,
  };
}

/** Build a Gmail search query for finding newer versions of a document. */
export function buildGmailSearchQuery(
  doc: Pick<VaultDocument, 'metadata' | 'title'>,
  afterDateIso: string,
): string {
  const parts: string[] = ['has:attachment', '(filename:pdf OR filename:jpg OR filename:jpeg OR filename:png)'];

  const issuer = doc.metadata.issuer?.trim();
  if (issuer) {
    parts.push(`(from:(${quote(issuer)}) OR subject:(${quote(issuer)}) OR "${issuer}")`);
  }

  const ref = doc.metadata.referenceNumber?.trim();
  if (ref) {
    parts.push(`"${ref}"`);
  }

  const type = doc.metadata.documentType?.trim();
  if (type) {
    parts.push(`(${type.split(/\s+/).slice(0, 3).join(' OR ')})`);
  } else if (doc.title) {
    const keywords = doc.title.split(/\s+/).slice(0, 4).join(' ');
    parts.push(`"${keywords}"`);
  }

  const after = toGmailAfter(afterDateIso);
  if (after) parts.push(`after:${after}`);

  return parts.join(' ');
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '')}"`;
}

/** Gmail after: uses YYYY/MM/DD */
export function toGmailAfter(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

/** True if candidateDate is strictly after currentDate. */
export function isNewerVersion(currentDateIso: string, candidateDateIso: string): boolean {
  const a = new Date(currentDateIso).getTime();
  const b = new Date(candidateDateIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return b > a;
}
