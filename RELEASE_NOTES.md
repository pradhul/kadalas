# Kadalas v0.1.10

## Highlights

- **My documents is Home** — every approved entry from `vault-index.json` shows up (Gmail pointer, Drive copy, or on-device), grouped by category with search and filter chips.
- **Empty Home after Approve fixed** — approving no longer wiped Gmail-index upserts by saving a stale React index snapshot.
- Dashboard tiles for document count, pending review, and expiring soon.
- Review: junk/decoration auto-skip, optimistic Approve/Skip + Approve all, Why?, Ask AI, plain labels.

## Upgrade

Pull `main`, `npm install`, `npm test`, `npm run web`.
