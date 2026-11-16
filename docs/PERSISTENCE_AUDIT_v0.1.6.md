# Persistence audit (v0.1.6)

What survives a web reload / app reopen, and where it lives.

## Verdict on the earlier user message

> “Approvals go to their Drive and skips/review live only in the browser.”

**Half right before v0.1.6; wrong after.**

| Data | Before 0.1.6 (at 8f2ad5d) | After 0.1.6 |
| --- | --- | --- |
| **Approved docs** | Drive file + `vault-index.json` immediately | Same |
| **Skips** | React memory only — lost on reload | Drive `review-state.json` + localStorage |
| **Pending review queue** | Partially in `scan-state.json` from last scan persist; approve/skip mutations after the scan did **not** write back | Drive `review-state.json` + localStorage; restored on reopen |
| **Scan progress** | Drive `scan-state.json` + localStorage | Same |

## Approved documents — Drive, immediate

1. `approveCandidates` calls `saveCandidateToVault`  
   (`src/context/VaultContext.tsx` ~359)
2. `saveCandidateToVault` uploads the attachment bytes to the category folder, then `drive.upsertDocument`  
   (`src/services/vaultOps.ts` 225–276)
3. `upsertDocument` loads the index, inserts/updates the doc, **`saveIndex`**  
   (`src/services/drive/googleDrive.ts` 227–233, `saveIndex` at 144)
4. Context also refreshes `lastScanAt` via `saveIndex` again  
   (`src/context/VaultContext.tsx` ~391)

**Closing the app is safe for approvals** — files and index are already on Google Drive under the Kadalas folder.

## Skips + review queue — Drive `review-state.json` (new)

- Filename: `review-state.json` (`src/types/review.ts` 4)
- Shape: candidates + `skippedIds` (`messageId::attachmentId`) + `lastSyncedAt`
- Write path: `saveReviewState` → localStorage `kadalas_review_state_v1` then Drive overwrite  
  (`src/services/reviewPersist.ts` 9–49; Drive writer `googleDrive.ts` 273)
- Skip: `rejectCandidate` → status `rejected` + skipped id → `persistReview`  
  (`VaultContext.tsx` 401–413)
- Restore/Undo: `restoreSkippedCandidate` removes the skipped id  
  (`VaultContext.tsx` ~417–427)
- Future scans: `applyClassificationResult` marks matching attachments `rejected`  
  (`src/lib/scanPipeline.ts`, `skippedAttachmentIds` option; engine passes the set)

**Overwrite only — never trash/delete Drive files.**

## Scan progress — Drive `scan-state.json` + localStorage

- Filename: `scan-state.json` (`src/types/scan.ts` 108)
- `saveScanJobState` / `loadScanJobState`  
  (`src/services/scanPersist.ts` 6–57; local key `dv_scan_job_state_v1`)
- Engine persists during the loop (`src/services/scanEngine.ts` `persist`)

On reopen: engine `hydrate()` loads scan-state; VaultContext merges with review-state so prior skips/approves win.

## localStorage roles (web)

| Key | Purpose |
| --- | --- |
| `kadalas_review_state_v1` | Fast cache for review queue + skipped ids |
| `dv_scan_job_state_v1` | Fast cache for in-progress / last scan job |
| `dv_mock_drive_v1` | Mock Drive only |
| `kadalas_force_demo` | Demo mode flag |

Drive is source of truth when online; localStorage is the fast cache / offline fallback.
