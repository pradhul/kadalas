# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.3]: https://github.com/pradhul/kadalas/releases/tag/v0.1.3
[0.1.2]: https://github.com/pradhul/kadalas/releases/tag/v0.1.2
[0.1.1]: https://github.com/pradhul/kadalas/releases/tag/v0.1.1
[0.1.0]: https://github.com/pradhul/kadalas/releases/tag/v0.1.0
