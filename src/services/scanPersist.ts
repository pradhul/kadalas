import { Platform } from 'react-native';
import { ScanJobState } from '../types/scan';
import { slimScanStateForPersist } from '../lib/scanPersistSlim';
import { getDriveService } from './drive';

const LOCAL_KEY = 'dv_scan_job_state_v1';
let memoryFallback: ScanJobState | null = null;

async function localGet(): Promise<ScanJobState | null> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (!raw) return memoryFallback;
      return JSON.parse(raw) as ScanJobState;
    } catch {
      return memoryFallback;
    }
  }
  return memoryFallback;
}

async function localSet(state: ScanJobState | null): Promise<void> {
  memoryFallback = state;
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    try {
      if (!state) localStorage.removeItem(LOCAL_KEY);
      else localStorage.setItem(LOCAL_KEY, JSON.stringify(slimScanStateForPersist(state)));
    } catch {
      // QuotaExceeded / private mode — keep in-memory fallback only
    }
  }
}

export async function saveScanJobState(state: ScanJobState): Promise<void> {
  const slim = slimScanStateForPersist(state);
  await localSet(slim);
  try {
    await getDriveService().saveScanState(slim);
  } catch {
    // local / memory cache remains
  }
}

export async function loadScanJobState(): Promise<ScanJobState | null> {
  const local = await localGet();
  try {
    const remote = await getDriveService().loadScanState();
    if (!remote) return local;
    if (!local) {
      await localSet(remote);
      return remote;
    }
    return remote.updatedAt >= local.updatedAt ? remote : local;
  } catch {
    return local;
  }
}

/** Clear scan job — overwrite Drive file with null JSON; never trash/delete. */
export async function clearScanJobState(): Promise<void> {
  await localSet(null);
  try {
    await getDriveService().saveScanState(null);
  } catch {
    // ignore
  }
}
