# Kadalas v0.1.0 (pre-release)

First public pre-release of **Kadalas** (*kadalas* — Malayalam for papers/documents) — an Expo (iOS / Android / web) personal document vault with no app-owned backend.

## Highlights

- Google Drive vault folder **Kadalas** (`drive.file`) + Gmail scan (`gmail.readonly`) + bring-your-own AI key
- **Mock mode by default** — try the full UI without credentials
- Resumable full-mailbox scan: search → rules → batched metadata triage → classify → entity grouping
- Scan state persisted to Drive; quota pause/resume; incremental review
- Entity grouping by subject (e.g. vehicle registration), not policy number
- Vehicle OD/TP coverage slots (package / Standalone OD / Liability Only)
- Unit tests for scan resume, grouping, and coverage slots

## Known limitations

- **Mock mode by default** — set `EXPO_PUBLIC_USE_MOCKS=false` and configure OAuth + AI keys for real APIs
- **Gmail restricted-scope verification** — production OAuth for arbitrary users needs Google approval
- **Free-tier AI caps** — large first-run scans pause on 429; resume as needed
- `drive.file` only sees files this app creates

## Install

```bash
git clone https://github.com/pradhul/kadalas.git
cd kadalas
npm install
npm run web
```

See [README.md](../README.md) and [CHANGELOG.md](../CHANGELOG.md).
