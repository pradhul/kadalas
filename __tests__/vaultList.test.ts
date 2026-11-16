import {
  buildVaultList,
  documentDisplayTitle,
  documentStorageBadges,
  groupVaultList,
  listDocumentsFromIndex,
} from '../src/lib/vaultList';
import { VaultDocument, VaultIndex } from '../src/types/document';

function doc(partial: Partial<VaultDocument> & Pick<VaultDocument, 'id' | 'category'>): VaultDocument {
  return {
    title: partial.title ?? partial.id,
    metadata: partial.metadata ?? {},
    currentVersionId: 'v1',
    versions: partial.versions ?? [
      {
        id: 'v1',
        driveFileId: '',
        storageKind: 'gmail_index',
        fileName: `${partial.id}.pdf`,
        mimeType: 'application/pdf',
        hash: 'h',
        sizeBytes: 100,
        createdAt: '2026-01-01T00:00:00Z',
        source: 'gmail',
        gmailMessageId: 'm1',
        gmailAttachmentId: 'a1',
        gmailFrom: 'Federal Bank <noreply@federalbank.co.in>',
        gmailSubject: 'Statement',
        gmailDate: '2026-10-01T00:00:00Z',
      },
    ],
    driveFolderPath: partial.category,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

describe('vaultList from index (both storage modes)', () => {
  it('lists Gmail-index entries with empty driveFileId', () => {
    const index: VaultIndex = {
      version: 1,
      vaultFolderId: 'v',
      lastScanAt: null,
      updatedAt: '2026-01-01T00:00:00Z',
      settings: { storageMode: 'gmail_index' },
      documents: [
        doc({
          id: 'g1',
          category: 'Banking',
          title: 'Federal Bank statement',
          metadata: { issuer: 'Federal Bank', documentType: 'Account statement' },
        }),
      ],
    };
    const listed = listDocumentsFromIndex(index);
    expect(listed).toHaveLength(1);
    expect(listed[0].versions[0].driveFileId).toBe('');
    expect(documentStorageBadges(listed[0])).toContain('Gmail');
    expect(documentDisplayTitle(listed[0])).toMatch(/Federal Bank/i);
  });

  it('lists Drive-copy entries alongside Gmail-index', () => {
    const index: VaultIndex = {
      version: 1,
      vaultFolderId: 'v',
      lastScanAt: null,
      updatedAt: '2026-01-01T00:00:00Z',
      documents: [
        doc({ id: 'g1', category: 'Banking' }),
        doc({
          id: 'd1',
          category: 'Tax',
          title: 'Form 16',
          metadata: { documentType: 'Form 16', issuer: 'Employer' },
          versions: [
            {
              id: 'v1',
              driveFileId: 'drive_abc',
              storageKind: 'drive_copy',
              fileName: 'form16.pdf',
              mimeType: 'application/pdf',
              hash: 'h2',
              sizeBytes: 200,
              createdAt: '2026-02-01T00:00:00Z',
              source: 'gmail',
              gmailMessageId: 'm2',
              gmailAttachmentId: 'a2',
            },
          ],
        }),
      ],
    };
    const items = buildVaultList(index);
    expect(items).toHaveLength(2);
    expect(items.find((i) => i.id === 'g1')?.storageBadges).toContain('Gmail');
    expect(items.find((i) => i.id === 'd1')?.storageBadges).toContain('Drive');
  });

  it('filters by category and search query over index fields', () => {
    const index: VaultIndex = {
      version: 1,
      vaultFolderId: 'v',
      lastScanAt: null,
      updatedAt: '2026-01-01T00:00:00Z',
      documents: [
        doc({
          id: 'g1',
          category: 'Banking',
          title: 'Federal Bank statement',
          metadata: { issuer: 'Federal Bank', documentType: 'Account statement' },
        }),
        doc({
          id: 't1',
          category: 'Tax',
          title: 'Form 16',
          metadata: { documentType: 'Form 16' },
        }),
      ],
    };
    expect(buildVaultList(index, { category: 'Tax' })).toHaveLength(1);
    expect(buildVaultList(index, { query: 'federal' })[0].id).toBe('g1');
  });

  it('groups Salary / Medical / Insurance with counts from index entries', () => {
    const index: VaultIndex = {
      version: 1,
      vaultFolderId: 'v',
      lastScanAt: null,
      updatedAt: '2026-01-01T00:00:00Z',
      documents: [
        doc({
          id: 's1',
          category: 'Tax',
          title: 'March salary slip',
          metadata: { documentType: 'Salary slip', issuer: 'Acme' },
        }),
        doc({
          id: 'm1',
          category: 'Other',
          title: 'Lab report',
          metadata: { documentType: 'Medical report' },
        }),
        doc({
          id: 'i1',
          category: 'Insurance/Vehicle',
          title: 'Motor policy',
          metadata: { documentType: 'Motor insurance', issuer: 'ICICI Lombard' },
        }),
      ],
    };
    const groups = groupVaultList(buildVaultList(index));
    expect(groups.find((g) => g.id === 'Salary')?.count).toBe(1);
    expect(groups.find((g) => g.id === 'Medical')?.count).toBe(1);
    expect(groups.find((g) => g.id === 'Insurance')?.count).toBe(1);
    expect(groups.find((g) => g.id === 'Tax')).toBeUndefined();
  });
});
