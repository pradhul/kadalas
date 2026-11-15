import { ScanCandidate, VaultDocument } from '../types/document';
import { referencesMatch, issuersMatch, scoreDocumentMatch } from './matching';

export interface DedupeResult {
  isDuplicate: boolean;
  duplicateOfId?: string;
  reason?: string;
}

/**
 * Detect duplicates against the vault index by content hash first,
 * then by strong metadata overlap (issuer + reference).
 */
export function findDuplicateInVault(
  candidate: {
    hash?: string;
    fileName?: string;
    metadata?: VaultDocument['metadata'];
    title?: string;
    category?: string;
  },
  documents: VaultDocument[],
): DedupeResult {
  if (candidate.hash) {
    for (const doc of documents) {
      const hit = doc.versions.find((v) => v.hash === candidate.hash);
      if (hit) {
        return {
          isDuplicate: true,
          duplicateOfId: doc.id,
          reason: `Identical file hash as "${doc.title}"`,
        };
      }
    }
  }

  for (const doc of documents) {
    if (
      referencesMatch(doc.metadata.referenceNumber, candidate.metadata?.referenceNumber) &&
      issuersMatch(doc.metadata.issuer, candidate.metadata?.issuer)
    ) {
      return {
        isDuplicate: true,
        duplicateOfId: doc.id,
        reason: `Same issuer and reference as "${doc.title}"`,
      };
    }

    const match = scoreDocumentMatch(doc, candidate);
    if (match.score >= 0.85) {
      return {
        isDuplicate: true,
        duplicateOfId: doc.id,
        reason: match.reasons.join('; ') || `Very similar to "${doc.title}"`,
      };
    }
  }

  return { isDuplicate: false };
}

/** Deduplicate a batch of scan candidates against each other and the vault. */
export function dedupeScanCandidates(
  candidates: ScanCandidate[],
  documents: VaultDocument[],
  getHash?: (c: ScanCandidate) => string | undefined,
): ScanCandidate[] {
  const seenHashes = new Set<string>();
  const result: ScanCandidate[] = [];

  for (const candidate of candidates) {
    const hash = getHash?.(candidate) ?? candidate.contentRef;
    if (hash && seenHashes.has(hash)) {
      result.push({
        ...candidate,
        status: 'duplicate',
        duplicateOfId: result.find((r) => (getHash?.(r) ?? r.contentRef) === hash)?.id,
      });
      continue;
    }

    const vaultDup = findDuplicateInVault(
      {
        hash,
        fileName: candidate.fileName,
        metadata: candidate.classification?.metadata,
        title: candidate.classification?.title,
        category: candidate.classification?.category,
      },
      documents,
    );

    if (vaultDup.isDuplicate) {
      result.push({
        ...candidate,
        status: 'duplicate',
        duplicateOfId: vaultDup.duplicateOfId,
      });
      continue;
    }

    if (hash) seenHashes.add(hash);
    result.push(candidate);
  }

  return result;
}
