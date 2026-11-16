/**
 * End-to-end vault index persistence under drive.file semantics.
 *
 * Root cause under test: with drive.file, each create of vault-index.json can
 * leave duplicates; pre-0.1.11 find used pageSize=1 with no orderBy / no stored
 * fileId, so after reload Home read an empty/older copy → "Approved 0".
 */
import { createFakeDriveFileBackend } from '../src/services/drive/fakeDriveFileBackend';
import { createVaultIndexStore } from '../src/services/drive/vaultIndexStore';
import { resetIndexMirrorForTests } from '../src/services/indexMirror';
import { buildVaultList, listDocumentsFromIndex } from '../src/lib/vaultList';
import { VaultDocument, VaultIndex } from '../src/types/document';
import { StorageMode } from '../src/types/settings';

function memoryIds() {
  let preferred: string | null = null;
  return {
    async getPreferredFileId() {
      return preferred;
    },
    async setPreferredFileId(id: string) {
      preferred = id;
    },
    clear() {
      preferred = null;
    },
  };
}

function memoryMirror() {
  let mirror: VaultIndex | null = null;
  return {
    async load() {
      return mirror ? structuredClone(mirror) : null;
    },
    async save(index: VaultIndex) {
      mirror = structuredClone(index);
    },
    clear() {
      mirror = null;
    },
  };
}

function gmailDoc(id: string, title: string): VaultDocument {
  return {
    id,
    title,
    category: 'Banking',
    metadata: { issuer: 'Federal Bank', documentType: 'Account statement' },
    currentVersionId: 'v1',
    versions: [
      {
        id: 'v1',
        driveFileId: '',
        storageKind: 'gmail_index',
        fileName: `${id}.pdf`,
        mimeType: 'application/pdf',
        hash: `h_${id}`,
        sizeBytes: 100,
        createdAt: '2026-10-01T00:00:00.000Z',
        source: 'gmail',
        gmailMessageId: `msg_${id}`,
        gmailAttachmentId: `att_${id}`,
        gmailFrom: 'Federal Bank <noreply@federalbank.co.in>',
        gmailSubject: title,
        gmailDate: '2026-10-01T00:00:00.000Z',
      },
    ],
    driveFolderPath: 'Banking',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };
}

function driveCopyDoc(id: string, title: string): VaultDocument {
  const doc = gmailDoc(id, title);
  doc.versions[0].driveFileId = `drive_${id}`;
  doc.versions[0].storageKind = 'drive_copy';
  return doc;
}

async function approveThree(
  store: ReturnType<typeof createVaultIndexStore>,
  vaultFolderId: string,
  mode: StorageMode,
) {
  const mk = mode === 'gmail_index' ? gmailDoc : driveCopyDoc;
  await store.upsertDocument(vaultFolderId, mk('d1', 'Statement Jan'));
  await store.upsertDocument(vaultFolderId, mk('d2', 'Statement Feb'));
  await store.upsertDocument(vaultFolderId, mk('d3', 'Statement Mar'));
}

function homeCounts(index: VaultIndex) {
  const docs = listDocumentsFromIndex(index);
  const list = buildVaultList(index);
  return { documentCount: docs.length, listCount: list.length };
}

describe('vault index persist integration (drive.file)', () => {
  beforeEach(() => {
    resetIndexMirrorForTests();
  });

  it('BUGGY arbitrary-first: loses all 3 approvals after reload when empty duplicate is listed first', async () => {
    const backend = createFakeDriveFileBackend();
    const ids = memoryIds();
    // No preferred-id persistence in buggy mode (ids unused for pick)
    const store = createVaultIndexStore({
      api: backend.api,
      ids,
      mode: 'buggy_arbitrary_first',
    });

    await approveThree(store, backend.vaultFolderId, 'gmail_index');
    expect(homeCounts(await store.loadIndex(backend.vaultFolderId)).documentCount).toBe(3);

    // Simulate Drive returning an older empty vault-index.json first (pageSize=1)
    backend.injectEmptyDuplicateFirst();
    store.clearSessionCache();
    ids.clear();

    const afterReload = await store.loadIndex(backend.vaultFolderId);
    const counts = homeCounts(afterReload);
    // This is the live-site failure mode: Home shows 0 / Approved 0
    expect(counts.documentCount).toBe(0);
    expect(counts.listCount).toBe(0);
  });

  it('FIXED gmail_index: after approve 3 + full reload, Home shows 3 and My documents lists them', async () => {
    const backend = createFakeDriveFileBackend();
    const ids = memoryIds();
    const mirror = memoryMirror();
    const store = createVaultIndexStore({
      api: backend.api,
      ids,
      mirror,
      mode: 'fixed',
    });

    await approveThree(store, backend.vaultFolderId, 'gmail_index');
    const preferred = await ids.getPreferredFileId();
    expect(preferred).toBeTruthy();

    backend.injectEmptyDuplicateFirst();
    store.clearSessionCache();
    // preferred id survives in ids store (localStorage on device)

    const afterReload = await store.loadIndex(backend.vaultFolderId);
    const counts = homeCounts(afterReload);
    expect(counts.documentCount).toBe(3);
    expect(counts.listCount).toBe(3);
    expect(afterReload.documents.every((d) => d.versions[0].driveFileId === '')).toBe(true);
    // Mirror kept for instant Home paint
    expect((await mirror.load())?.documents).toHaveLength(3);
  });

  it('FIXED drive_copy: after approve 3 + full reload, Home shows 3', async () => {
    const backend = createFakeDriveFileBackend();
    const ids = memoryIds();
    const store = createVaultIndexStore({
      api: backend.api,
      ids,
      mode: 'fixed',
    });

    await approveThree(store, backend.vaultFolderId, 'drive_copy');
    backend.injectEmptyDuplicateFirst();
    store.clearSessionCache();

    const afterReload = await store.loadIndex(backend.vaultFolderId);
    expect(homeCounts(afterReload).documentCount).toBe(3);
    expect(afterReload.documents.every((d) => Boolean(d.versions[0].driveFileId))).toBe(true);
  });

  it('FIXED merges docs scattered across duplicate index files', async () => {
    const backend = createFakeDriveFileBackend();
    const ids = memoryIds();
    const store = createVaultIndexStore({ api: backend.api, ids, mode: 'fixed' });

    await store.upsertDocument(backend.vaultFolderId, gmailDoc('a', 'A'));
    const fileA = store.getSessionFileId()!;
    // Force a second file as if a race created another index
    store.clearSessionCache();
    ids.clear();
    backend.seedEmptyIndex('2021-01-01T00:00:00.000Z');
    // Creating via upsert without preferred id may update newest or create — write B into a new create path
    await store.upsertDocument(backend.vaultFolderId, gmailDoc('b', 'B'));

    store.clearSessionCache();
    const merged = await store.loadIndex(backend.vaultFolderId);
    expect(merged.documents.map((d) => d.id).sort()).toEqual(['a', 'b']);
    void fileA;
  });

  it('appDataFolder without drive.appdata is skipped (403), not used as vault', async () => {
    const backend = createFakeDriveFileBackend({ grantAppData: false });
    backend.seedAppDataIndex();
    const ids = memoryIds();
    const store = createVaultIndexStore({ api: backend.api, ids, mode: 'fixed' });

    // Listing vault folder should not include appData; reading appData file throws if forced
    await expect(backend.api.readIndexFile([...backend.files.keys()][0])).rejects.toThrow(/403/);

    await approveThree(store, backend.vaultFolderId, 'gmail_index');
    store.clearSessionCache();
    expect(homeCounts(await store.loadIndex(backend.vaultFolderId)).documentCount).toBe(3);
  });
});
