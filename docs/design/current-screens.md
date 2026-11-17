# Kadalas v0.1.12 — current UI screenshots

Captured from a local mock-mode web build of [pradhul/kadalas](https://github.com/pradhul/kadalas) at commit `8edc831` (v0.1.12).  
Build: `EXPO_PUBLIC_USE_MOCKS=true`, served locally. No deploy, no commit.

Viewports:

- **mobile** — 390×844 CSS pixels, `deviceScaleFactor: 2` (PNG is 780×1688 for a first-viewport shot)
- **desktop** — 1440×900 CSS pixels, `deviceScaleFactor: 1`

Files ending in `-full` or taken of long screens (Settings, Scan review, Document detail, etc.) are full-page captures of the scrolling content. First-viewport shots keep the real phone/desktop chrome (tab bar included).

Demo data is a seeded vault for “Pradhul” (`pradhul@example.com`): 9 documents including vehicle insurance for KA-01-AB-1234 (split OD + TP) and MH-12-XY-9876, health, banking, tax, passport, and a warranty that expires soon.

Storage of PNGs: `/workspace/kadalas-design/screenshots/`

---

## Sign-in / onboarding

| File | What it is / main actions |
| --- | --- |
| `mobile-01-signin.png` | Sign-in screen. Brand, “Your papers, in your Drive.” Explains that files and AI keys stay in the user’s account. **Continue with mock Google**. (Production builds show **Continue with Google** plus **Try demo data**.) |
| `desktop-01-signin.png` | Same screen at desktop: left-aligned hero, lots of unused right space. |

---

## Home / My documents

| File | What it is / main actions |
| --- | --- |
| `mobile-02-home.png` | Main vault: “Pradhul’s documents”, Docs / Review / Expiring counts, **Search your documents**, category chips, dense document rows grouped under Recent and category sections. Actions: **Scan Gmail**, **Add**, tap a row to open a document, tap a count chip (Review / Expiring), filter by category, tab bar (Home, Scan, Expiring, Settings). First viewport — this is the phone layout. |
| `mobile-02-home-full.png` | Same screen scrolled through the full list (all groups). |
| `desktop-02-home.png` | Same Home layout stretched to 1440px; cards go full width, tab bar at the bottom. |
| `desktop-02-home-full.png` | Full scrolled Home on desktop. |

---

## Document detail

| File | What it is / main actions |
| --- | --- |
| `mobile-03-document-detail.png` | Detail for a vault document (Progressive Standalone OD · KA-01-AB-1234). Editable title, category chips, issuer, document type, policy #, holder, dates; **Save metadata**. Current file (preview/download, share, make available offline). **Ask AI for more detail**. **Sync** from Gmail for a newer version. Version history. |
| `desktop-03-document-detail.png` | Same document detail at desktop width. |

View email on this screen only appears when the stored version has a Gmail message id. The seeded vault copies do not, so there is no document-detail email sheet. The email viewer was captured from Scan review instead (`*-09-scan-review-email.png`).

---

## Scan tab

Because the demo vault already has a prior scan (`lastScanAt`), idle Scan is the *returning-user* state (incremental + “run full again”), not the first-run “Full mailbox scan / Lookback” choice cards.

| File | What it is / main actions |
| --- | --- |
| `mobile-04-scan-idle.png` | Idle Scan Gmail: last completed scan, **Scan for new documents (since last scan)**, **Run full mailbox scan again**. |
| `desktop-04-scan-idle.png` | Same idle Scan at desktop width. |
| `mobile-05-scan-progress.png` | Scan running: progress panel (stage, emails checked, attachments, bar, **Pause** / **Cancel**) plus the Scan status / event log card (**Copy log**, **Reset scan**). |
| `desktop-05-scan-progress.png` | Same in-progress state at desktop width. |
| `mobile-06-scan-paused.png` | Quota pause: “Paused — AI quota / rate limit”, **Resume**, **Cancel**, **Review (N)**. Status stage `paused_quota`. |
| `desktop-06-scan-paused.png` | Same paused state at desktop width. |

---

## Scan review

Loaded with the in-app **Load demo review list** (grouped vehicle policies, including 4 versions of DL-01-CD-4321).

| File | What it is / main actions |
| --- | --- |
| `mobile-07-scan-review.png` | Review queue: counts, explanation of Approve vs Skip (Gmail-index mode), search box, **Show skipped**, **Approve all**, **Skip all**, grouped cards with category chips, **Approve** / **Skip** / **View email** / **Ask AI**, and **Why?**. |
| `desktop-07-scan-review.png` | Same review list at desktop width. |
| `mobile-08-scan-review-why.png` | Same screen with **Why?** expanded (**Hide details**): subject, sender, date, snippet, attachment, confidence, reason; category and “Group this with” chips. |
| `desktop-08-scan-review-why.png` | Expanded Why? details at desktop width. |
| `mobile-09-scan-review-email.png` | **View email** as a full-screen sheet: subject, from, date, **Open in Gmail**, body snippet, attachment name, **Close**. The PDF preview area shows “Failed to load PDF document” because mock attachment bytes are not a real PDF. |
| `desktop-09-scan-review-email.png` | **View email** as a right-hand dock next to the review card (wide-screen layout, width ≥ 900). |

---

## Expiring

| File | What it is / main actions |
| --- | --- |
| `mobile-10-expiring.png` | Expiring tab: documents and vehicle coverage slots due in the next 60 days. Demo data shows Framework Laptop Warranty (14 days). Tap a row to open the document or the vehicle coverage view. |
| `desktop-10-expiring.png` | Same Expiring list at desktop width. |

---

## Search

This is the dedicated Search route (`/search`), not the Home filter box. Home also has its own “Search your documents” field (`*-02-home.png`).

| File | What it is / main actions |
| --- | --- |
| `mobile-11-search-empty.png` | Empty search: field plus “Search Kadalas” empty state. |
| `desktop-11-search-empty.png` | Same empty Search at desktop width. |
| `mobile-11-search.png` | Results for query “KA-01”: matching vehicle policies, tap a row to open the document. |
| `desktop-11-search.png` | Same results at desktop width. |

---

## Settings

| File | What it is / main actions |
| --- | --- |
| `mobile-12-settings.png` | Full Settings, default mock provider. **Storage**: Gmail index vs Drive copies, **Keep documents on this device**. Signed-in account and **Sign out**. AI provider list (Gemini, OpenRouter, Groq, OpenAI, Anthropic, Offline heuristics). Usage. **Organize Drive** / **Undo last organize**. Scopes & privacy. Tab bar. |
| `desktop-12-settings.png` | Same Settings at desktop width (content column is capped, left-aligned). |
| `mobile-12-settings-ai-key.png` | Settings after selecting **Google AI Studio (Gemini)**: key instructions, **Get a free key**, API key field (Show/hide), **Save key**, **Test key**, **Clear**. |
| `desktop-12-settings-ai-key.png` | Same Gemini + API key UI at desktop width. |
| `mobile-13-settings-organize.png` | After tapping **Organize Drive**: preview of proposed moves (2 files in the demo), reasons, **Confirm organize**, **Cancel preview**. Moves parents only; nothing is deleted. |
| `desktop-13-settings-organize.png` | Same Organize Drive preview at desktop width. |

---

## Vehicle coverage

| File | What it is / main actions |
| --- | --- |
| `mobile-14-vehicle.png` | Coverage slots for KA-01-AB-1234. Summary, health banner, **Own Damage (OD)** and **Third Party (TP)** cards (insurer, dates, policy #), **Open current document**, version history. **Back**. |
| `desktop-14-vehicle.png` | Same vehicle coverage view at desktop width. |

---

## Other screens (also in the app)

| File | What it is / main actions |
| --- | --- |
| `mobile-15-add.png` | **Add document** modal: pick a PDF or image for AI/rules to classify before saving. **Choose file**, **Use demo sample PDF**. |
| `desktop-15-add.png` | Same Add document screen at desktop width. |
| `mobile-16-folder.png` | Folder browser for `Insurance/Vehicle`: list of documents in that category, tap a row to open detail. |
| `desktop-16-folder.png` | Same folder view at desktop width. |

---

## Screens / states we could not reach

All requested main screens were captured at both sizes. These *states* were not available in the mock demo:

1. **First-run Scan choice cards** (“Full mailbox scan” vs “Lookback (90 days)”) — the seeded vault already has a last scan, so idle Scan is the returning-user incremental UI. See `*-04-scan-idle.png`.
2. **View email on document detail** — seeded vault versions have no `gmailMessageId`, so the button is hidden there. The email viewer was captured from Scan review (`*-09-scan-review-email.png`).
3. **Ask AI result / summary banner** — the **Ask AI** and **Ask AI for more detail** buttons are visible on review cards and document detail; the post-click summary was not captured as a separate frame.
4. **Home empty state** (“No documents yet”) — the demo vault has 9 documents.
5. **Email attachment PDF preview** — the sheet/dock itself is real, but the in-sheet PDF preview shows “Failed to load PDF document” because mock attachment bytes are not a valid PDF.

