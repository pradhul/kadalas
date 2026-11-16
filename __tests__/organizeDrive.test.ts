import { proposeMoves, applyMoves, undoLastOrganize } from '../src/lib/organizeDrive';
import { DriveService } from '../src/services/drive/types';
import { VaultDocument, VaultIndex } from '../src/types/document';
import { OrganizeUndoState } from '../src/types/organize';

function doc(partial: Partial<VaultDocument> & Pick<VaultDocument, 'id' | 'category' | 'driveFolderPath'>): VaultDocument {
  return {
    title: partial.title ?? partial.id,
    metadata: {},
    currentVersionId: 'v1',
    versions: [
      {
        id: 'v1',
        fileName: `${partial.id}.pdf`,
        mimeType: 'application/pdf',
        size: 10,
        driveFileId: `drive-${partial.id}`,
        contentHash: 'h',
        createdAt: '2026-01-01T00:00:00Z',
        source: 'gmail',
      },
    ],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  };
}

function makeDrive(): DriveService & {
  moves: Array<{ fileId: string; to: string; from?: string }>;
  savedIndex: VaultIndex | null;
  undo: OrganizeUndoState | null;
} {
  const folders: Record<string, string> = {
    Banking: 'folder-banking',
    Other: 'folder-other',
    Tax: 'folder-tax',
  };
  const state = {
    moves: [] as Array<{ fileId: string; to: string; from?: string }>,
    savedIndex: null as VaultIndex | null,
    undo: null as OrganizeUndoState | null,
  };

  const drive = {
    ...state,
    async getFolderIdForCategory(cat: string) {
      return folders[cat] ?? `folder-${cat}`;
    },
    async getFileParentId() {
      return folders.Other;
    },
    async moveFile(fileId: string, toParentId: string, fromParentId?: string) {
      state.moves.push({ fileId, to: toParentId, from: fromParentId });
    },
    async saveIndex(index: VaultIndex) {
      state.savedIndex = index;
    },
    async saveOrganizeUndo(undo: OrganizeUndoState) {
      state.undo = undo;
    },
    async loadOrganizeUndo() {
      return state.undo;
    },
  } as unknown as DriveService & typeof state;

  return Object.assign(drive, state);
}

describe('organizeDrive', () => {
  it('proposes moves when Drive folder path disagrees with category', () => {
    const documents = [
      doc({
        id: 'd1',
        category: 'Banking',
        driveFolderPath: 'Other',
        title: 'HDFC Bank statement Q1',
      }),
      doc({
        id: 'd2',
        category: 'Tax',
        driveFolderPath: 'Tax',
        title: 'Form 16',
      }),
    ];
    const moves = proposeMoves(documents);
    expect(moves).toHaveLength(1);
    expect(moves[0].docId).toBe('d1');
    expect(moves[0].toCategory).toBe('Banking');
    expect(moves[0].fromPath).toBe('Other');
  });

  it('applies moves via moveFile only and supports undo', async () => {
    const index: VaultIndex = {
      version: 1,
      vaultFolderId: 'vault',
      lastScanAt: null,
      updatedAt: '2026-01-01T00:00:00Z',
      documents: [
        doc({
          id: 'd1',
          category: 'Banking',
          driveFolderPath: 'Other',
          title: 'HDFC Bank statement Q1',
        }),
      ],
    };
    const drive = makeDrive();
    const moves = proposeMoves(index.documents);
    const applied = await applyMoves(drive, index, moves);
    expect(applied.applied).toBe(1);
    expect(drive.moves).toHaveLength(1);
    expect(drive.moves[0].to).toBe('folder-banking');
    expect(applied.index.documents[0].driveFolderPath).toBe('Banking');
    expect(drive.undo?.moves.length).toBe(1);

    const undone = await undoLastOrganize(drive, applied.index);
    expect(undone.restored).toBe(1);
    expect(undone.index.documents[0].driveFolderPath).toBe('Other');
    expect(drive.undo?.moves.length ?? 0).toBe(0);
  });
});
