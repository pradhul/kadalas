import { Platform } from 'react-native';
import { ScanJobState } from '../types/scan';
import { getDriveService } from './drive';

const LOCAL_KEY = 'dv_scan_job_state_v1';
let memoryFallback: ScanJobState | null = null;

async function localGet(): Promise<ScanJobState | null> {
  if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return memoryFallback;
    try {
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
    if (!state) localStorage.removeItem(LOCAL_KEY);
    else localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  }
}

export async function saveScanJobState(state: ScanJobState): Promise<void> {
  await localSet(state);
  try {
    await getDriveService().saveScanState(state);
  } catch {
    // local cache remains
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

export async function clearScanJobState(): Promise<void> {
  await localSet(null);
  try {
    await getDriveService().saveScanState(null);
  } catch {
    // ignore
  }
}
