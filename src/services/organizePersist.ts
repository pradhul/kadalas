import { Platform } from 'react-native';
import {
  emptyOrganizeUndo,
  OrganizeUndoState,
  ORGANIZE_UNDO_FILENAME,
} from '../types/organize';
import { DriveService } from './drive/types';
import { getDriveService } from './drive';

const LOCAL_KEY = 'kadalas_organize_undo_v1';
let memoryFallback: OrganizeUndoState = emptyOrganizeUndo();

export { ORGANIZE_UNDO_FILENAME };

async function localGet(): Promise<OrganizeUndoState> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return memoryFallback;
      return JSON.parse(raw) as OrganizeUndoState;
    } catch {
      return memoryFallback;
    }
  }
  return memoryFallback;
}

async function localSet(state: OrganizeUndoState): Promise<void> {
  memoryFallback = state;
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
    } catch {
      // quota / private mode
    }
  }
}

/** Overwrite organize-undo.json on Drive; never trash/delete. */
export async function persistOrganizeUndo(
  drive: DriveService,
  state: OrganizeUndoState,
): Promise<OrganizeUndoState> {
  const next: OrganizeUndoState = {
    ...state,
    version: 1,
    appliedAt: state.appliedAt || new Date().toISOString(),
  };
  await localSet(next);
  try {
    await drive.saveOrganizeUndo(next);
  } catch {
    // local cache remains
  }
  return next;
}

export async function loadOrganizeUndoForDrive(drive: DriveService): Promise<OrganizeUndoState> {
  const local = await localGet();
  try {
    const remote = await drive.loadOrganizeUndo();
    if (!remote) return local;
    if (!local.moves.length) {
      await localSet(remote);
      return remote;
    }
    const prefer = remote.appliedAt >= local.appliedAt ? remote : local;
    if (prefer === remote) await localSet(remote);
    return prefer;
  } catch {
    return local;
  }
}

export async function saveOrganizeUndo(state: OrganizeUndoState): Promise<OrganizeUndoState> {
  return persistOrganizeUndo(getDriveService(), state);
}

export async function loadOrganizeUndo(): Promise<OrganizeUndoState> {
  return loadOrganizeUndoForDrive(getDriveService());
}