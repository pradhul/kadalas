import { Platform } from 'react-native';
import {
  emptyReviewState,
  ReviewState,
  REVIEW_STATE_FILENAME,
} from '../types/review';
import { getDriveService } from './drive';

const LOCAL_KEY = 'kadalas_review_state_v1';
let memoryFallback: ReviewState | null = null;

export { REVIEW_STATE_FILENAME };

async function localGet(): Promise<ReviewState | null> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return memoryFallback;
      return JSON.parse(raw) as ReviewState;
    } catch {
      return memoryFallback;
    }
  }
  return memoryFallback;
}

async function localSet(state: ReviewState | null): Promise<void> {
  memoryFallback = state;
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      if (!state) localStorage.removeItem(LOCAL_KEY);
      else localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
    } catch {
      // QuotaExceeded / private mode — memory only
    }
  }
}

/** Persist review queue + skipped ids. Overwrite Drive file; never delete. */
export async function saveReviewState(state: ReviewState): Promise<ReviewState> {
  const next: ReviewState = {
    ...state,
    version: 1,
    updatedAt: new Date().toISOString(),
    lastSyncedAt: new Date().toISOString(),
  };
  await localSet(next);
  try {
    await getDriveService().saveReviewState(next);
  } catch {
    // local / memory cache remains; lastSyncedAt still set locally as best-effort
  }
  return next;
}

export async function loadReviewState(): Promise<ReviewState> {
  const local = await localGet();
  try {
    const remote = await getDriveService().loadReviewState();
    if (!remote) {
      return local ?? emptyReviewState();
    }
    if (!local) {
      await localSet(remote);
      return remote;
    }
    const prefer = remote.updatedAt >= local.updatedAt ? remote : local;
    if (prefer === remote) await localSet(remote);
    return prefer;
  } catch {
    return local ?? emptyReviewState();
  }
}

/** Overwrite review-state.json with an empty document — never trash the file. */
export async function clearReviewState(): Promise<void> {
  const empty = emptyReviewState();
  await localSet(empty);
  try {
    await getDriveService().saveReviewState(empty);
  } catch {
    // ignore
  }
}
