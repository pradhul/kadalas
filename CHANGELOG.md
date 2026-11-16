# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.9] - 2026-11-16

### Added

- **Storage modes** (Settings): default **Gmail index** for new users — Approve writes a tiny vault-index pointer (no Drive upload); opening fetches the attachment live from Gmail with a clear “Original email no longer available” error when mail is gone
- **Drive copies** mode keeps the previous upload-to-Kadalas behavior; existing Drive files always keep working; switching modes never deletes Gmail or Drive files
- **Keep documents on this device** offline toggle (IndexedDB on web / expo-file-system on native) with storage-used indicator and per-document available-offline state; clearing cache only removes the device copy
- Approve confirmation copy matches the mode (“Saved to your vault” vs “Saved to Drive”)

### Changed

- Version bump to **0.1.9**

## [0.1.8] - 2026-11-16

### Fixed

- Root `ErrorBoundary` catches render crashes (including scan-review white screens) with a recovery path home
- Single global Google session banner; silent token renew + reconnect without duplicate prompts
- Scan progress emits are throttled; engine yields between Gmail batches to reduce UI jank
- Scan-review loads with a safe empty/loading state and FlatList grouping

### Added

- Home/Scan CTA driven by live scan state (progress / resume / review / scan)
- India-first category guidance (banks, Form 16/ITR, Aadhaar/PAN, motor OD/TP) for rules + AI prompts
- **Organize Drive** (Settings): preview folder moves, confirm via addParents/removeParents only, one-shot undo — never deletes Drive files
- Split `ScanProgressContext` so progress ticks do not re-render the full vault tree

### Changed

- Version bump to **0.1.8**

## [0.1.7] - 2026-11-16

### Fixed

- **Approve no longer lies**: a candidate is marked approved and the success toast is shown only after Drive returns a file id. Empty selection or upload failure keeps the item pending with a visible card error + Retry; failures are logged to the scan debug log
- Gmail attachment download failures are no longer replaced with a silent placeholder upload
- Drive multipart upload is binary-safe (PDF/image bytes)
- Grouping no longer resets `approved` / `rejected` statuses back to pending
- False approvals (marked approved with no vault Drive file) are reclaimed to pending on load

### Added

- Review helper copy explaining Approve vs Skip; each card shows `Will save to: Kadalas/<category>`
- Success toast includes **Open in Drive** when `webViewLink` is present
- Home shows vault document count + **Open Kadalas folder in Drive**

### Changed

- Version bump to **0.1.7**

## [0.1.6] - 2026-11-16

### Fixed

- Scan review Skip now shows a snackbar with **Undo** (5s) and collapses into a Skipped row; Approve shows “Saved to your Google Drive › Kadalas/…”
- Review header counts: `N to review · N approved · N skipped`, plus a **Show skipped** toggle to restore
- Review queue + skip decisions persist to Drive `review-state.json` (overwrite only) with localStorage as a fast cache — survives close/reopen
- Previously skipped Gmail attachments are never re-suggested by future scans (`skippedIds`)

### Added

- Persistent safety note on Home and Review: approvals live in Google Drive; closing the app is safe; last-synced time + open Drive folder link

### Changed

- Version bump to **0.1.6**

## [0.1.5] - 2026-11-16

### Fixed

- Scan review no longer injects demo plates `KA01AB1234` / `MH12XY9876` when subject keys are empty (real Google vaults)
- AI-extracted registration / chassis must appear in document text; ungrounded and demo plates are dropped
- Vehicle subject chips only for vehicle categories, and only vault vehicles + grounded plates from the doc
- Every review item always shows **Approve** and **Skip**; subject chips are optional toggles (“Group this with:”) with friendly labels (never raw `vehicle:reg:…` / `weak:…`)
- Review list dedupes by Gmail `messageId`+`attachmentId` or content hash
- “Unknown cover” only shown for vehicle insurance coverage slots
- On vault load (non-mock), index metadata with fake demo plate subjects is re-keyed to a non-vehicle subject — Drive files are never deleted

### Changed

- Version bump to **0.1.5**

## [0.1.4] - 2026-11-15

### Fixed

- Full-mailbox scan now **interleaves** triage/classify after each Gmail page (docs appear before the whole mailbox is listed)
- Progress is stage-weighted (search 0–60 / triage 60–80 / classify 80–100), never shrinks, shows “about N”
- `getAttachment` reuses scan metadata (no per-classify `format=full` refetch)
- Scan persistence: throttle (every 5 steps / 15s), slim state, localStorage try/catch + memory fallback; **never trash/delete** Drive files — clear overwrites `scan-state.json` with `null`
- Stalled scans (active stage, engine not running) show Resume and auto-resume when the Scan tab opens
- Silent GIS renew times out at 10s → reconnect; all fetches time out at 30s
- Broader rule-triage keywords; AI-missing triage ids fall back to rules (not auto-skip)

### Added

- Scan debug card (stage, engine running, pages, triage/classify counts, last API, token expiry) + capped event log with Copy log + Reset scan

### Changed

- Version bump to **0.1.4**

## [0.1.3] - 2026-11-15

### Fixed

- Replaced shut-down AI model IDs: Gemini → `gemini-3.5-flash-lite` (fallback `gemini-flash-latest`), Groq → `openai/gpt-oss-20b`, OpenRouter → `openrouter/free` (fallback `google/gemma-4-31b-it:free`)
- Provider errors now include response body (`Gemini 404: …`) with `.status` so quota detection still works
- Scan **triage** no longer aborts the whole job on non-quota AI failures (e.g. model 404); falls back to rule triage and continues to review/vault
- Settings **Test key** maps 400/404/429 to friendly copy
- Starting a scan when the Drive vault index is missing throws a visible reconnect error
- After GIS token grant, verify Gmail + Drive scopes via `hasGrantedAllScopes`
- Anthropic browser calls send `anthropic-dangerous-direct-browser-access: true`; retry without `response_format` on 400

### Changed

- Version bump to **0.1.3**

## [0.1.2] - 2026-11-15

### Fixed

- **Web Google sign-in** no longer uses authorization-code + PKCE against a Web client (Google required `client_secret`). Web now uses **Google Identity Services** token client (`google.accounts.oauth2.initTokenClient`) — popup, no secret, works on mobile browsers
- Friendly sign-in errors instead of raw Google OAuth text (e.g. “client_secret is missing”)
- Production UI no longer shows the OAuth developer hint (kept under `__DEV__` only)

### Added

- Web access-token expiry handling (~1h, no refresh token): silent GIS re-request (`prompt: ''`); if interaction is required, **Session expired — tap to reconnect Google** banner + scan pause (reuses quota-pause persistence) with Resume after reconnect
- Native Android/iOS path still uses authorization-code + PKCE for future clients

### Changed

- Version bump to **0.1.2**; README documents web GIS auth vs native PKCE

## [0.1.1] - 2026-11-15

### Added

- Settings AI helpers: **Get a free key** links (Gemini / OpenRouter / Groq) via `Linking` / `expo-web-browser`, one-line instructions, OpenAI & Anthropic marked **paid**
- **Groq** provider through the existing OpenAI-compatible client (`https://api.groq.com/openai/v1`, default `llama-3.1-8b-instant`)
- OpenRouter default model switched to a free `:free` model
- **Test key** button (one tiny classify request; success/error banner)
- Mobile-friendly API key field (no autocorrect/autocapitalize, Show/Hide toggle)
- Sign-in **Try demo data** when built with real mode (`EXPO_PUBLIC_USE_MOCKS=false`)
- Web OAuth redirect URI = `window.location.origin` for arbitrary deploy hosts (documented in README)
- `npm run build:web` → static `dist/` plus Netlify SPA `dist/_redirects` (`/* /index.html 200`)

### Changed

- Version bump to **0.1.1**
- README: build-time env vars, OAuth origin setup, free-key table, phone-oriented web notes

## [0.1.0] - 2026-11-15

First public pre-release of **Kadalas** (*kadalas* — Malayalam for papers/documents).

### Added

- Expo (React Native + TypeScript + Expo Router) app for iOS, Android, and web
- Google OAuth with `gmail.readonly` + `drive.file` (mock mode by default — no credentials required to try the UI)
- Drive-backed **Kadalas** folder tree, `vault-index.json`, and `_versions` history (reuses a legacy `Document Vault` folder if present)
- Bring-your-own AI key (Gemini default; OpenAI / Anthropic / OpenRouter pluggable)
- Resumable full-mailbox Gmail scan: search → rule filter → batched metadata triage → classify → entity grouping
- Scan state persistence (Drive `scan-state.json` + local cache), quota pause/resume, progress UI, incremental review
- Entity-aware grouping by subject key (registration / chassis / …), not policy number
- Vehicle coverage slots (`own_damage` / `third_party`) for India-style OD + long-term TP / package policies
- Vehicle cover view, Expiring soon (including per-slot gaps), Settings, Add, Search, Sync
- Unit tests for matching, dedupe, versioning, coverage slots, grouping, and scan resume/quota

### Known limitations

- **Mock mode is the default** — set `EXPO_PUBLIC_USE_MOCKS=false` and configure OAuth + AI keys for real Google/AI APIs
- **Gmail `readonly` is a restricted Google scope** — production use for arbitrary users needs Google OAuth verification
- **Free-tier AI caps** — the scan pauses on 429 / quota; large first-run mailbox scans may take multiple resume cycles
- Drive `drive.file` only sees files this app creates (by design)
- Web mock vault state uses `localStorage`; native mocks are in-memory for the process

[0.1.7]: https://github.com/pradhul/kadalas/releases/tag/v0.1.7
[0.1.6]: https://github.com/pradhul/kadalas/releases/tag/v0.1.6
[0.1.5]: https://github.com/pradhul/kadalas/releases/tag/v0.1.5
[0.1.4]: https://github.com/pradhul/kadalas/releases/tag/v0.1.4
[0.1.3]: https://github.com/pradhul/kadalas/releases/tag/v0.1.3
[0.1.2]: https://github.com/pradhul/kadalas/releases/tag/v0.1.2
[0.1.1]: https://github.com/pradhul/kadalas/releases/tag/v0.1.1
[0.1.0]: https://github.com/pradhul/kadalas/releases/tag/v0.1.0
