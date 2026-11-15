# Document Vault

A self-contained personal document vault built with **Expo (React Native + TypeScript + Expo Router)**. One codebase runs on **iOS, Android, and web**.

There is **no app-owned backend or database**:

- Every user’s files live in **their own Google Drive** (`drive.file` — only files this app creates).
- Email scanning uses **Gmail** (`gmail.readonly`).
- AI uses a **bring-your-own key** (Gemini by default; OpenAI / Anthropic / OpenRouter pluggable). Keys stay on-device.

By default the app runs in **mock mode** so you can exercise every screen without Google or AI credentials.

---

## Quick start (mock mode)

```bash
npm install
npm run web          # http://localhost:43123
npm test             # unit tests (matching, dedup, versioning, categorisation)
npm run typecheck    # Expo / TypeScript checks
```

Native:

```bash
npm start            # then press i / a, or scan QR with Expo Go
npm run ios
npm run android
```

Set `EXPO_PUBLIC_USE_MOCKS=false` (and configure OAuth client IDs) when you want real Google APIs.

---

## What you get

1. **Add documents** — pick PDF/image (or demo sample); AI or rules suggest category/title/metadata; save into the right Drive folder.
2. **Per-document Sync** — search Gmail for a newer version of the same *subject* (e.g. registration), not just policy number; confirm; promote to current and keep history in `_versions`.
3. **Scan Gmail** — resumable full-mailbox / lookback / incremental pipeline (search → rules → cheap AI triage → classify → entity grouping). Pauses on free-tier AI quota; progress + pause/resume UI; approve while scanning continues.
4. **Entity grouping + coverage slots** — documents group by subject key (registration / chassis / …). Vehicle insurance uses generic **coverage slots** `own_damage` and `third_party`: a **comprehensive / package / bundled** policy fills both; **Standalone OD** / **Liability Only** / **Act Only** fill one. A vault can hold several *current* docs per vehicle (e.g. 5-year TP + annual OD). Newer comprehensive supersedes both slots; newer OD-only leaves an active long-term TP alone. See the **vehicle cover** screen.
5. **Browse / search / expiring** — folder tree, vehicles list, metadata search, per-slot gaps & upcoming expiry in Expiring soon.
6. **Settings** — paste Gemini (or other) API key; usage / queue / 429 backoff; works without a key via rule-based categorisation.

### Vehicle cover (India-style OD + TP)

Example subject `KA-01-AB-1234`:

> KA-01-AB-1234: OD covered by Progressive until Feb 2027, TP covered by Go Digit until Feb 2030

AI extraction sets `coverageType`: `comprehensive` | `od_only` | `tp_only` (also recognises Package Policy, Bundled, Standalone OD, Liability Only, Act Only). The slot model in `src/lib/coverageSlots.ts` is generic so other multi-part document types can reuse it later.

### Architecture

| Module | Role |
|--------|------|
| `src/services/auth` | Google OAuth (+ mock), token refresh |
| `src/services/drive` | Document Vault folder tree, uploads, `vault-index.json` |
| `src/services/gmail` | Attachment search + download |
| `src/services/ai` | Pluggable providers + request queue / rate limits |
| `src/lib/*` | Matching, dedupe, versioning, categorisation, subject keys, coverage slots, scan pipeline (unit-tested) |
| `src/services/scanEngine` | Resumable staged mailbox scan + Drive/local persistence | |
| `src/app/*` | Expo Router screens |

**Scopes**

- `https://www.googleapis.com/auth/drive.file` — preferred; app only sees files/folders it creates (vault + uploads + index).
- `https://www.googleapis.com/auth/gmail.readonly` — required to search mail and read attachments. This is a **restricted** Google scope.

We do **not** request full Drive access. The vault index is a JSON file inside the app-created **Document Vault** folder (works with `drive.file`). `drive.appdata` was not needed.

---

## Google Cloud setup (for pradhul)

Exact steps to wire real Google sign-in, Gmail, and Drive.

### 1. Create a Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project, e.g. `document-vault`.
3. Note the project ID.

### 2. Enable APIs

APIs & Services → Library → enable:

- **Gmail API**
- **Google Drive API**

### 3. OAuth consent screen

1. APIs & Services → **OAuth consent screen**.
2. User type: **External**.
3. App name: `Document Vault`; support email: yours.
4. Add scopes:
   - `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`
   - `.../auth/gmail.readonly`
   - `.../auth/drive.file`
5. **Publishing status: Testing** first.
6. Add **test users** (your Gmail addresses). Only test users can sign in while in Testing.

#### Going public / verification (important)

`gmail.readonly` is a **restricted** scope. Before production / “In production” for arbitrary users, Google requires:

- OAuth verification / security assessment (often including a CASA assessment for restricted Gmail scopes),
- Privacy policy + demo video showing how Gmail data is used,
- Justification that Drive uses least privilege (`drive.file`).

Until verified, keep the app in **Testing** with allowlisted test users. See [Google’s restricted scope verification](https://support.google.com/cloud/answer/9110914) and [OAuth API verification FAQ](https://support.google.com/cloud/answer/13464326).

### 4. Create OAuth client IDs

APIs & Services → Credentials → **Create credentials** → OAuth client ID:

| Platform | Application type | Notes |
|----------|------------------|-------|
| Web | Web application | Authorized JS origins: `http://localhost:43123`, your production origin. Redirect URIs: Expo AuthSession redirect (e.g. `https://auth.expo.io/@your-user/document-vault` and/or `http://localhost:43123`) |
| iOS | iOS | Bundle ID: `com.pradhul.documentvault` (matches `app.json`) |
| Android | Android | Package: `com.pradhul.documentvault`; add your SHA-1 debug/release fingerprints |

Put IDs in env (never commit secrets; public OAuth client IDs are fine in env files that stay local):

```bash
cp .env.example .env
```

```env
EXPO_PUBLIC_USE_MOCKS=false
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=....apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=....apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=....apps.googleusercontent.com
```

You can also mirror them under `app.json` → `expo.extra` for non-secret client IDs.

Mobile/web PKCE flows should **not** embed a client secret in the app.

### 5. Gemini (optional)

1. Open [Google AI Studio](https://aistudio.google.com/apikey).
2. Create an API key.
3. In the app: **Settings** → paste under Gemini. Stored via `expo-secure-store` on native; `localStorage` on web (with an in-app warning).

---

## Run on each platform

| Target | Command | Notes |
|--------|---------|-------|
| Web | `npm run web` | Mock mode works immediately |
| iOS simulator | `npm run ios` | macOS + Xcode; or Expo Go |
| Android | `npm run android` | Emulator / device; or Expo Go |
| Dev client | `npx expo run:ios` / `run:android` | Needed when native modules exceed Expo Go |

Scheme: `documentvault://` (see `app.json`).

---

## Deploy the web build

`app.json` uses `"web": { "output": "single" }` (SPA). That avoids Metro SSR issues in local web dev and still exports a hostable web bundle.

```bash
npm run web:export
# outputs to dist/
```

Host `dist/` on any static host (Netlify, Cloudflare Pages, Firebase Hosting, nginx, etc.). Configure SPA fallback to `index.html` for client routes.

For per-route static HTML, switch `expo.web.output` to `"static"` and re-export (requires a clean Metro cache; prefer SPA unless you need SEO for every screen).

Configure the same origin + redirect URI on your **Web** OAuth client. Set `EXPO_PUBLIC_USE_MOCKS=false` and client IDs in the host’s environment for production builds.

Example Netlify: publish directory `dist`, build command `npm run web:export`.

---

## Folder layout in Drive

```
Document Vault/
  vault-index.json          # metadata, versions, lastScanAt, hashes
  _versions/                # previous file versions
  Insurance/
    Vehicle/
    Health/
    Home/
    Life/
  Banking/
  Tax/
  Identity/
  Bills/
  Warranties/
  Travel/
  Other/
```

---

## Known limitations

- **Gmail restricted scope verification** blocks public OAuth until Google approves the app.
- **Free-tier AI caps** — the in-app queue rate-limits and backs off on HTTP 429; large first scans still take time / may exhaust quotas.
- **Mock mode** persists vault state in `localStorage` on web only; native mocks are in-memory for the process.
- **OpenAI / Anthropic paths** are text-oriented; prefer **Gemini** for direct PDF/image multimodal classification.
- **drive.file** cannot read arbitrary existing Drive files the user created outside the app — by design.
- Token refresh requires a refresh token (`access_type=offline` + consent). Revoking access in Google Account settings forces re-consent.

---

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run web` | Web dev server on port **43123** |
| `npm start` | Expo dev tools |
| `npm test` | Jest unit tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run web:export` | Static web export to `dist/` |
