import { PipelineItem, ScanJobState } from '../types/scan';

const MAX_EVENT_LOG = 20;

/** Drop heavy fields before writing to localStorage / Drive. */
export function slimScanStateForPersist(state: ScanJobState): ScanJobState {
  const items: Record<string, PipelineItem> = {};
  for (const [id, item] of Object.entries(state.items)) {
    if (item.status === 'filtered_out' || item.status === 'triaged_skip') {
      items[id] = { id, status: item.status };
      continue;
    }
    const att = item.attachment;
    items[id] = {
      ...item,
      attachment: att
        ? {
            ...att,
            snippet: '',
          }
        : undefined,
      classification: item.classification
        ? {
            ...item.classification,
            reason: item.classification.reason?.slice(0, 120),
          }
        : undefined,
    };
  }

  return {
    ...state,
    items,
    eventLog: (state.eventLog ?? []).slice(-MAX_EVENT_LOG),
    processedMessageIds: state.processedMessageIds.slice(-5000),
  };
}

export function appendScanEvent(
  state: ScanJobState,
  message: string,
  nowIso = new Date().toISOString(),
): ScanJobState {
  const eventLog = [...(state.eventLog ?? []), { at: nowIso, message }].slice(-MAX_EVENT_LOG);
  return { ...state, eventLog, updatedAt: nowIso };
}
