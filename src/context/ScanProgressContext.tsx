import React, { createContext, useContext, useMemo } from 'react';
import { ScanJobState } from '../types/scan';

/** Lightweight progress slice — updates here should not rerender the whole vault tree. */
export type ScanProgressValue = {
  scanJob: ScanJobState | null;
  scanEngineRunning: boolean;
  /** Throttled high-water percent for UI */
  progressPercent: number;
  stageLabel: string;
};

const ScanProgressContext = createContext<ScanProgressValue>({
  scanJob: null,
  scanEngineRunning: false,
  progressPercent: 0,
  stageLabel: 'idle',
});

export function ScanProgressProvider({
  value,
  children,
}: {
  value: ScanProgressValue;
  children: React.ReactNode;
}) {
  const memo = useMemo(
    () => value,
    [value.scanJob?.stage, value.scanJob?.updatedAt, value.scanEngineRunning, value.progressPercent, value.stageLabel],
  );
  return <ScanProgressContext.Provider value={memo}>{children}</ScanProgressContext.Provider>;
}

export function useScanProgress() {
  return useContext(ScanProgressContext);
}
