import { DocumentVersion, VaultDocument } from '../types/document';

export function getCurrentVersion(doc: VaultDocument): DocumentVersion | undefined {
  return doc.versions.find((v) => v.id === doc.currentVersionId) ?? doc.versions[doc.versions.length - 1];
}

export function listVersionHistory(doc: VaultDocument): DocumentVersion[] {
  return [...doc.versions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/**
 * Promote a new version to current while retaining prior versions.
 * Versions are ordered newest-first in history views but stored as an append-only list.
 */
export function promoteVersion(
  doc: VaultDocument,
  next: Omit<DocumentVersion, 'id'> & { id?: string },
  nowIso: string = new Date().toISOString(),
): VaultDocument {
  const id = next.id ?? `ver_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const version: DocumentVersion = { ...next, id };

  return {
    ...doc,
    versions: [...doc.versions, version],
    currentVersionId: id,
    updatedAt: nowIso,
  };
}

/** Move current file into logical _versions history (index-side). Drive move is handled by DriveService. */
export function archiveCurrentAsPrevious(
  doc: VaultDocument,
  archivedDriveFileId: string,
  nowIso: string = new Date().toISOString(),
): VaultDocument {
  const current = getCurrentVersion(doc);
  if (!current) return doc;

  const versions = doc.versions.map((v) =>
    v.id === current.id ? { ...v, driveFileId: archivedDriveFileId } : v,
  );

  return {
    ...doc,
    versions,
    updatedAt: nowIso,
  };
}

export function createInitialDocument(input: {
  id?: string;
  title: string;
  category: VaultDocument['category'];
  metadata: VaultDocument['metadata'];
  version: Omit<DocumentVersion, 'id'> & { id?: string };
  driveFolderPath: string;
  nowIso?: string;
}): VaultDocument {
  const now = input.nowIso ?? new Date().toISOString();
  const versionId = input.version.id ?? `ver_${Date.now()}`;
  return {
    id: input.id ?? `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: input.title,
    category: input.category,
    metadata: input.metadata,
    currentVersionId: versionId,
    versions: [{ ...input.version, id: versionId }],
    driveFolderPath: input.driveFolderPath,
    createdAt: now,
    updatedAt: now,
  };
}

/** Documents with expiry/renewal within the next `withinDays` days (including overdue). */
export function findExpiringSoon(
  documents: VaultDocument[],
  withinDays: number,
  now: Date = new Date(),
): Array<{ document: VaultDocument; date: string; kind: 'expiry' | 'renewal'; daysLeft: number }> {
  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + withinDays);
  const results: Array<{ document: VaultDocument; date: string; kind: 'expiry' | 'renewal'; daysLeft: number }> = [];

  for (const document of documents) {
    const candidates: Array<{ date: string; kind: 'expiry' | 'renewal' }> = [];
    if (document.metadata.expiryDate) candidates.push({ date: document.metadata.expiryDate, kind: 'expiry' });
    if (document.metadata.renewalDate) candidates.push({ date: document.metadata.renewalDate, kind: 'renewal' });

    for (const c of candidates) {
      const d = parseDateOnly(c.date);
      if (!d) continue;
      if (d.getTime() <= end.getTime()) {
        const daysLeft = Math.ceil((d.getTime() - startOfUtcDay(now).getTime()) / (24 * 60 * 60 * 1000));
        results.push({ document, date: c.date, kind: c.kind, daysLeft });
      }
    }
  }

  return results.sort((a, b) => a.daysLeft - b.daysLeft);
}

function parseDateOnly(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
