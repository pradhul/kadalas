import { VaultCategory } from './document';

export const ORGANIZE_UNDO_FILENAME = 'organize-undo.json';

export interface OrganizeUndoMove {
  docId: string;
  driveFileId: string;
  fromParentId: string;
  toParentId: string;
  fromPath: string;
  toCategory: VaultCategory;
}

export interface OrganizeUndoState {
  version: 1;
  moves: OrganizeUndoMove[];
  appliedAt: string;
}

export function emptyOrganizeUndo(): OrganizeUndoState {
  return { version: 1, moves: [], appliedAt: new Date(0).toISOString() };
}