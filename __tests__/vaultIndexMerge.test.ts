import {
  mergeVaultIndexes,
  pickArbitraryIndexFileId,
  pickCanonicalIndexFileId,
  sortIndexFilesNewestFirst,
} from '../src/lib/vaultIndexMerge';
import { VaultIndex } from '../src/types/document';

function idx(docs: string[], updatedAt: string): VaultIndex {
  return {
    version: 1,
    vaultFolderId: 'v',
    lastScanAt: null,
    updatedAt,
    documents: docs.map((id) => ({
      id,
      title: id,
      category: 'Other' as const,
      metadata: {},
      currentVersionId: 'v1',
      versions: [
        {
          id: 'v1',
          driveFileId: '',
          fileName: `${id}.pdf`,
          mimeType: 'application/pdf',
          hash: id,
          sizeBytes: 1,
          createdAt: updatedAt,
          source: 'gmail' as const,
        },
      ],
      driveFolderPath: 'Other',
      createdAt: updatedAt,
      updatedAt,
    })),
    settings: { storageMode: 'gmail_index' },
  };
}

describe('vaultIndexMerge', () => {
  it('picks preferred file id when present, else newest', () => {
    const files = [
      { id: 'old', modifiedTime: '2020-01-01T00:00:00Z' },
      { id: 'new', modifiedTime: '2026-01-01T00:00:00Z' },
    ];
    expect(pickCanonicalIndexFileId(files, 'old')).toBe('old');
    expect(pickCanonicalIndexFileId(files, null)).toBe('new');
    expect(pickArbitraryIndexFileId(files)).toBe('old');
  });

  it('merges documents across duplicate index files without dropping either', () => {
    const merged = mergeVaultIndexes(
      [
        { index: idx(['a'], '2026-01-01T00:00:00Z'), modifiedTime: '2026-01-01T00:00:00Z' },
        { index: idx(['b'], '2026-02-01T00:00:00Z'), modifiedTime: '2026-02-01T00:00:00Z' },
      ],
      'v',
    );
    expect(merged.documents.map((d) => d.id).sort()).toEqual(['a', 'b']);
  });

  it('sorts newest first', () => {
    const sorted = sortIndexFilesNewestFirst([
      { id: 'a', modifiedTime: '2020-01-01T00:00:00Z' },
      { id: 'b', modifiedTime: '2026-01-01T00:00:00Z' },
    ]);
    expect(sorted[0].id).toBe('b');
  });
});
