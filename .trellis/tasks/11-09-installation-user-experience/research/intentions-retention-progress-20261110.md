# Local and Legacy intentions retention application

Date: 2026-11-10. Scope: the authorized live-configuration task. No Hindsight folder was edited.

## Behavior and APIs

- `startRetentionSweeper` and `createCanonicalLocalRetention` accept
  `intentionsDefaultDays: number | (() => number)`. Each future sweep captures once.
  Legacy entries without an explicit expiry use that new fallback on the next sweep.
  Explicit stored expiries remain authoritative; a setting edit does not resurrect archived data.
- `createCanonicalMemoryRun` and canonical tool factory inputs add optional numeric
  `intentionsDefaultDays`. The number is copied before asynchronous capability/coordinator
  admission. Older tools keep their captured number while later Runs use the new one.
- `LocalMemoryProvider.captureRetention(days)` returns a small immutable facade overriding
  only reclassification mutation and ingestion preparation closures. It retains original
  repositories, retrieval, vector state, ingestion receipts and other method ownership.
  Root wires a captured facade into a per-Run coordinator before asynchronous admission.
- `writeCanonicalObservedMemory` accepts optional numeric `intentionsDefaultDays` for the
  trusted observed-write operation.
- `CanonicalLocalIngestionDeps.captureRetentionDays?: () => number` is evaluated before
  per-Character enqueue; the corresponding provider facade follows that operation through
  extraction, preparation and retries. The original provider remains the fallback when
  neither callback nor construction config supplies a value.
- Tidy passes the already admitted `deps.config.intentionsDefaultDays` through optional
  `TidyReviewOptions.intentionsDefaultDays` into each revision-fresh queued review. Local
  refile/supersede consume the copied numeric option; caller mutation and later config
  changes cannot change old review tools. Existing explicit expiries are preserved.

Canonical policy schemas require a concrete expiry for every intention, so the live fallback
only changes future Local writes/reclassification. The existing-row no-expiry case belongs
to Legacy and is tested there; no invalid nullable Canonical policy was introduced.

## Shared signature boundary

The optional canonical Run/tools and Tidy review fields are additive. Omitting them preserves
the existing built-in default. Existing Hindsight callers pass no Local override and its
review adapter ignores the optional Tidy field. The dedicated Hindsight change inventory
records these shared signatures. No connection, synchronization, recovery, Bank, fingerprint,
Authority or Hindsight-specific write logic was changed.

## Verification

- Initial final retention suite: seven files / 130 tests passed, including real in-memory
  SQLite Local mutations, prequeue automatic-ingestion capture and existing maintenance tests.
- Core typecheck passed after correcting the new fixture to use actual canonical
  `mood-gated` visibility and required explicit expiry (invalid fixture values were rejected
  by existing production validation; production validation was not weakened).
- Scoped ESLint passed for all owned implementation/tests, including added Tidy wiring.
- Extended Tidy verification: `tidy-reliability.test.ts`, `tidy-pass.test.ts` and
  `canonical-local-retention.test.ts` passed; final corrected `canonical-local-maintenance.test.ts`
  passed all 55 tests. The initial new preservation assertion reused a tool call ID for
  different inputs and was correctly refused; the fixture now uses a distinct ID.
- Final Core typecheck, scoped ESLint and `git diff --check` passed after Tidy integration.

Tests distinguish old/new/old Run retention, queued operation policy, explicit expiry,
reclassification, trusted observed writes, future Legacy sweeps, retained shared vector
ownership and unchanged omitted-override Hindsight defaults. No real profile, network model,
paid API, commit or push was used.
