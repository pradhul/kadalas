# Kadalas v0.1.5 (pre-release)

## Scan review: stop demo plate leak + always Approve/Skip

### Root cause

`buildPossibleSubjectKeys` in `src/lib/grouping.ts` pushed hardcoded demo plates `vehicle:reg:KA01AB1234` and `vehicle:reg:MH12XY9876` whenever AI/rule extraction left subject keys empty. Those chips replaced Approve/Skip on the review screen for any ambiguous doc (including bank statements and health policies).

### Fixes

1. Removed demo defaults; mock plates never enter real-mode suggestion lists
2. Ungrounded / demo registrations stripped before subject resolution; AI prompts forbid inventing plates
3. Vehicle chips only for vehicle categories, sourced from the user’s vault + grounded plates in the doc
4. Friendly chip labels + “Group this with:” helper; Approve/Skip always present (chips are toggles)
5. Deduplicate review items by Gmail attachment id or content hash
6. “Unknown cover” only for vehicle insurance
7. On real vault load, re-key index metadata that still points at demo plates (metadata overwrite only — no Drive deletes)

### Upgrade

Pull `main` at v0.1.5, rebuild/reload. Opening the vault once migrates contaminated index entries automatically.
