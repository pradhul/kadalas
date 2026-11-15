# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-15

First public pre-release.

### Added

- Expo (React Native + TypeScript + Expo Router) Document Vault for iOS, Android, and web
- Google OAuth with `gmail.readonly` + `drive.file` (mock mode by default — no credentials required to try the UI)
- Drive-backed vault folders, `vault-index.json`, and `_versions` history
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

[0.1.0]: https://github.com/pradhul/document-vault/releases/tag/v0.1.0
