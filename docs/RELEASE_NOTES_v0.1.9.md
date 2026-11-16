# Kadalas v0.1.9

Storage modes for nearly-full Google Drive, plus optional offline device cache.

## Highlights

1. **Gmail index (default)** — Approve stores `{gmailMessageId, attachmentId, filename, mimeType, size, category, subject, dates, sender}` in `vault-index.json` only. No Drive file upload. Open fetches from Gmail; deleted mail shows “Original email no longer available”.
2. **Drive copies** — previous Approve upload path, still selectable in Settings. Existing Drive files keep working.
3. **Mode switch safety** — never deletes or trashes Gmail/Drive files when changing modes.
4. **Offline on this device** — optional local cache (IndexedDB / file system) with storage-used + per-doc offline state; removing cache clears device copies only.
5. **Copy** — Approve toast/banner match the mode (“Saved to your vault” vs “Saved to Drive”).
