# Kadalas v0.1.7 (pre-release)

## Approve must land a real Drive file

### Root cause

`approveCandidates` marked every requested id `approved` and the review UI always showed “Saved to your Google Drive”, even when:

1. `toSave` was empty (status / `isGroupLatest` filter matched nothing), or
2. `saveCandidateToVault` never ran / failed after the status flip path

So the phone could show success with **zero** new files under Kadalas.

### Fixes

- Upload-first approve flow (`src/lib/approveFlow.ts`): only `approved` after a Drive file id
- Card error + Retry; scan debug log on failure; toast only on success with Open in Drive
- No silent Gmail placeholder; binary-safe Drive multipart
- Reclaim false approvals on vault load
- Clear Approve/Skip copy + destination folder on each card

### drive.file scope

Files and the `Kadalas` folder are created by the app, so they appear in My Drive under **Kadalas/** (category subfolders). Open the folder from Home / Review.
