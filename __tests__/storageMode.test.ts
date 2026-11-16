import { isGmailIndexVersion, ORIGINAL_EMAIL_GONE, versionStorageKind } from '../src/lib/storageKind';
import { settingsFromIndex, withVaultSettings } from '../src/lib/vaultSettings';
import { DocumentVersion, VaultIndex } from '../src/types/document';
import { DEFAULT_STORAGE_MODE } from '../src/types/settings';

describe('storage mode defaults', () => {
  it('defaults new vaults to gmail_index', () => {
    expect(DEFAULT_STORAGE_MODE).toBe('gmail_index');
    expect(settingsFromIndex(null).storageMode).toBe('gmail_index');
    expect(settingsFromIndex({} as VaultIndex).storageMode).toBe('gmail_index');
  });

  it('persists storageMode on the vault index without deleting documents', () => {
    const index: VaultIndex = {
      version: 1,
      vaultFolderId: 'v',
      lastScanAt: null,
      documents: [
        {
          id: 'd1',
          title: 'Keep me',
          category: 'Banking',
          metadata: {},
          currentVersionId: 'v1',
          versions: [
            {
              id: 'v1',
              driveFileId: 'drive_keep',
              storageKind: 'drive_copy',
              fileName: 'a.pdf',
              mimeType: 'application/pdf',
              hash: 'h',
              sizeBytes: 1,
              createdAt: '2026-01-01T00:00:00Z',
              source: 'gmail',
            },
          ],
          driveFolderPath: 'Banking',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
      updatedAt: '2026-01-01T00:00:00Z',
      settings: { storageMode: 'drive_copies' },
    };
    const next = withVaultSettings(index, { storageMode: 'gmail_index' });
    expect(next.settings?.storageMode).toBe('gmail_index');
    expect(next.documents).toHaveLength(1);
    expect(next.documents[0].versions[0].driveFileId).toBe('drive_keep');
  });
});

describe('version storage kind', () => {
  it('detects gmail_index versions', () => {
    const v: DocumentVersion = {
      id: 'v1',
      driveFileId: '',
      storageKind: 'gmail_index',
      fileName: 'p.pdf',
      mimeType: 'application/pdf',
      hash: 'gmail:m:a',
      sizeBytes: 10,
      createdAt: '2026-01-01T00:00:00Z',
      source: 'gmail',
      gmailMessageId: 'm',
      gmailAttachmentId: 'a',
    };
    expect(isGmailIndexVersion(v)).toBe(true);
    expect(versionStorageKind(v)).toBe('gmail_index');
  });

  it('treats legacy Drive ids as drive_copy', () => {
    const v: DocumentVersion = {
      id: 'v1',
      driveFileId: 'abc',
      fileName: 'p.pdf',
      mimeType: 'application/pdf',
      hash: 'h',
      sizeBytes: 10,
      createdAt: '2026-01-01T00:00:00Z',
      source: 'gmail',
    };
    expect(versionStorageKind(v)).toBe('drive_copy');
  });

  it('exposes gone-email copy', () => {
    expect(ORIGINAL_EMAIL_GONE).toMatch(/Original email no longer available/);
  });
});
