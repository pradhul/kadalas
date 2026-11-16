# Kadalas v0.1.11

## Root cause (why Home stayed empty after Approve)

Under Google’s `drive.file` scope, creating `vault-index.json` more than once (find miss / race / reload without a stored file id) leaves **duplicate files with the same name**. Pre-0.1.11 code did:

```ts
fields=files(id)&pageSize=1  // no orderBy, no stored fileId
```

After reload it often opened an **empty/older** copy. Review then ran `reclaimFalseApprovals` against that empty index → **Approved 0**, and My documents listed nothing. Gmail-index entries were not filtered out for missing `driveFileId`; the wrong index file was read.

**Fix:** list all duplicates (`orderBy=modifiedTime desc`), merge documents across them, persist the preferred file id + a local index mirror, surface save errors with Retry. Never trash duplicates.

## Also in this release

- Review search + Approve/Skip all matching (with undo)
- Integration tests proving buggy arbitrary-first loses 3 docs after reload; fixed path keeps them (gmail_index + drive_copy)

## Upgrade

Pull `main`, `npm install`, `npm test`, `npm run web`.
