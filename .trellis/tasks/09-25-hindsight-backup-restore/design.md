# Design: Hindsight backup, restore and common recovery point (Stage 3)

The contracts are `research/stage3-seams.md` §5 unless a leader ruling below changes them. File:line evidence lives there.

## Shape

- Core-first capture (§5.2): pause Hindsight writers and the replica scheduler -> read Core identity -> `Database.backupTo`
  -> native snapshot -> pair check -> seal -> release in `finally`. Intent-first Core writes make the native snapshot a
  superset of every Core terminal success; the pair verifier proves it per artifact instead of assuming it.
- One producer `core/memory/hindsight-backup/` (service, pair verifier, artifact store, custody, emergency seal) behind
  three operator-only kinds `backup.capture`, `backup.admit`, `backup.verify` in the new exclusive family
  `hindsight-backup` (§5.1). The native route sits behind an interface (`HindsightBackupRoute`) with a test double until
  the owner answers PR02.
- Rollback detection (§5.7) and the status/emergency section (§5.8) close G5/G7 independently of the route.

## Leader rulings (2026-09-26)

1. Invariant 1: capture/admit/verify are operator kinds; no agent tool reaches them. Core writes only below
   `<dataDir>/backups/` (same ownership as `taki.db`), paths are derived from `dataDir` + a validated `backupId`, never
   caller-supplied. Route-b admission reads only from `<dataDir>/backups/inbox/<fileName>` (validated plain file name),
   never an arbitrary path.
2. Storage variant c-native-host (§6): the native ZIP stays on the native host; the Taki manifest references it with
   sha256/bytes. Core never streams the ZIP (512 KiB client cap).
3. Receipt membership: W2 maps every Core terminal write kind to its native receipt table; a kind with no native receipt
   is compared by cursors only and listed in the spec as such. The mapping is a test-pinned table, not prose.
4. `node:sqlite` `backup()` (Node 24.18 verified: `typeof backup === "function"`), not `VACUUM INTO` (rowid order).
   `db/sqlite.ts` stays the only importer; the artifact store owns partial/rename/hash (`sqlite.ts` does no fs).
5. D86 closes through the verifier's exact `nativeBankId` comparison. D88 stays Stage 5 (restore never fixes
   `target_conflict`). Retention and the production Core data-dir restore tool are deferred (D90, D91).
6. The fence is in-memory: a restart drops it and capture settles `outcome_unknown` through `observeBoot`.
7. Emergency seal is a hook only (Core copy + incident manifest, never native); the takeover that calls it is Stage 4.

## Waves (one implementer each; a wave is committed only when all gates pass)

| Wave | Scope | Depends |
| --- | --- | --- |
| W1 | Shared schemas/codes/status section; `Database.backupTo`; artifact store; pure pair verifier | - |
| W2 | `fenceHindsightWriters` + scheduler pause; family + `backup.capture` + `observeBoot`; route interface + double; rollback detection | W1 |
| W3 | `backup.admit` / `backup.verify`; custody + missing-credential read-back; status age/missing interval; emergency seal | W2 |
| W4 | Desktop Home backup block (fixtures, generic controller) | W3 |
| W5 | Native route in `H:/hindsight` (owner PR02 = route c, default-off, native-host ZIP, single-flight) + CLI proof for the route-b fallback + Core route client | W2 |
| W6 | Restore drill on the native-smoke harness (environment evidence, AC11) | W5, native-smoke harness |
