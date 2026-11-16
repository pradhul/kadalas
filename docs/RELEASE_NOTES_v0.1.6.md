# Kadalas v0.1.6 (pre-release)

## Scan review feedback + durable review/skip state

### What was wrong (v0.1.5 phone test)

- Skip had no visible feedback and did not persist — React state only.
- Users could not tell whether closing the app would keep their review queue.

### What persists now

See `docs/PERSISTENCE_AUDIT_v0.1.6.md`.

### UX

- Skip → snackbar + Undo (5s) + Skipped row; Show skipped toggle to restore
- Approve → toast with Drive path; card marked approved
- Header counts + Drive safety note + last synced + Open Drive link
