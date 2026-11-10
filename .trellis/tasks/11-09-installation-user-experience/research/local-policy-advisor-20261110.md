# Local/Legacy search policy review and persistence

Date: 2026-11-10. Scope: `H:/TakiAgent-worktrees/t4`, selected Local/Legacy runtime only.
The parent assigned an independent read-only review before persistence changes, then
authorized the bounded implementation described below. Hindsight internals remain
excluded under the owner's correction and the dedicated Hindsight handoff.

## Verified startup gap

- `live-search-tokenizer.ts` originally treated its initial configured stoplist as
  already applied and skipped an equal reconfiguration. No durable fact proved that
  the existing FTS used that policy.
- `bootstrap.ts` calls Legacy `engine.reconcile()`, but `indexer.ts` only upserts
  new/changed content hashes. Unchanged Markdown does not heal a tokenizer change.
- Canonical `createCanonicalLocalRuntime()` does not perform a complete startup
  FTS rebuild. Its no-op `reconcile()` likewise cannot establish policy identity.
- Saving desired configuration before an interrupted rebuild therefore permits a
  new process to query an old index using a new tokenizer. Rebuilding every startup
  would avoid the mismatch but adds unnecessary work and hides the missing fact.

## Agreed minimal persistence contract

Migration 072 adds derived `search_projection_policy` rows keyed by physical index
and authority epoch. Legacy uses the empty stored epoch; Canonical Local uses its
actual epoch. The schema only admits `memory_fts` and `canonical_memory_fts`.
The table is not configuration, a second operation queue, or an authority marker.
No historical policy rows are invented by migration.

`createSearchProjectionPolicyRepo(db)` exposes `read`, `appliedStoplist`, and `write`.
`SEARCH_TOKENIZER_VERSION` combines the application implementation revision with
actual ICU/Unicode versions, since runtime dictionary changes affect segmentation.
A missing or unsupported version yields unknown applied policy, preserving the raw
record for diagnosis. Application tokenizer/stopword changes must bump its revision.

`rebuildSearchProjection(...).commitPolicy` writes metadata inside the same SQLite
transaction as FTS rename/drop. The existing `afterCommit` callback only publishes
the in-memory tokenizer pointer after commit. SQL or COMMIT failure rolls back both
policy and projection and never publishes the candidate facade.

`createLiveSearchTokenizer(appliedStoplist)` accepts `null` for unknown policy and
exposes `ready()` / `appliedStoplist()`. Unknown `tokenize()` refuses explicitly;
its first configuration forces a rebuild even when desired equals a default.
A known policy remains paired with the old index while a candidate prepares.
The producer still uses bounded batches and source-table dirty triggers; no second
maintenance owner is introduced.

The root owns runtime injection and admission gates. Production composition must
always inject the persisted policy into its low-level engine. Standalone factories
may retain explicit fixture tokenizer behavior when no persistence binding is used.
For unknown Legacy policy, skip its old synchronous reconcile; let the async staged
scan use the candidate tokenizer while the dependent feature remains unavailable.
An empty unknown database also follows the zero-row rebuild path. An empty FTS alone
does not prove that authoritative Markdown or Canonical rows are absent.

Boot calls `cleanAbandonedSearchProjections` once before admitting rebuild work. Its
cleanup is restricted to virtual tables with the generated 32-hex candidate/retired
name; it must not run while a live rebuild exists. Durable operation restart status
and current applied-policy truth remain separate: an unknown old operation outcome
does not prove the index was uncommitted. Read the policy before deciding recovery.

## Legacy concurrency correction

Two deterministic regressions reproduced before the adapter fix:

- An archive between the async scanner's file read and adapter consumption was
  overwritten as `active` by stale scanned metadata.
- A file restored by a Core writer during scanning was deleted from metadata by
  the stale orphan set even though the authoritative file existed again.

The adapter now synchronously re-reads each delivered path before metadata changes
and rechecks remaining paths before orphan removal. Malformed truth still aborts
publication; an error never becomes an empty successful result. External manual
filesystem edits do not emit SQLite triggers, so edits after a path's final read
retain the existing eventual file reconciliation limitation.

## Optional-memory configuration isolation recommendation

At the reviewed composition boundary, `captureMemoryConfig()` parsed every Memory
setting and both context windows before constructing the selected subsystem.
Legacy/Local constructors also start retention sweepers. Catching that exception
at the top and constructing a normal default subsystem could archive data under a
policy the owner never selected.

The smallest safe route is one Local/Legacy policy holder at the existing composition
boundary: validate a complete candidate before publication; retain the last usable
policy after a rejected edit; represent an invalid cold start as unavailable.
Construction defaults may create passive objects only. Gate new Memory-dependent
captures, writes, ingestion, tidy and retention before side effects until the policy
and search projection are usable. Keep raw saved inputs readable/editable through
the basic plane. Repair activates the same owner, without another Utility queue,
retention timer, subscription set, authority marker, or empty-data fallback.

Split ordinary assembly capture from Utility-only input-window clamping. An invalid
Utility window must disable its maintenance admission, not Main memory assembly or
basic services. Reads used only for history/config/resource management remain usable.
Actual database/authority corruption is a separate refusal, not invalid optional
configuration and not grounds to manufacture an empty profile.

## Validation and remaining integration

- Before the Legacy correction, its focused suite reproduced both metadata races
  (2 failures, 1 malformed-file preservation pass).
- After correction, the five focused policy/tokenizer/rebuild/Legacy/registry suites
  pass: 18 tests. They use real temporary or in-memory SQLite and real fixture files;
  no model, external service, real profile, or user data is involved.
- Coverage includes migration 071-to-072 and reopen, explicit unknown/unsupported
  policy, preserved known policy, metadata-write and actual deferred-FK COMMIT failure,
  restart after lost process publication, exact abandoned-candidate cleanup, concurrent
  Canonical insert/edit/hide, held Run tools, and the two Legacy metadata races.
- Scoped ESLint and tracked diff whitespace checks passed. A direct Node strip-only
  smoke imported the new migration/repository/facade/rebuild modules, committed a
  zero-row Legacy projection, and observed ready/applied-false without transpilation.
- The Core typecheck reported one concurrent root-owned integration error at
  `bootstrap.ts:131`: the new `number | (() => number)` retention argument was not
  yet accepted by the sweeper signature. No errors named this persistence layer.
- Runtime gating, operation-owner wiring, real Core boot, desired/applied UI projection,
  final integrated typecheck and owner acceptance remain integration responsibilities;
  this note does not claim those are complete. The root was also told that the shared
  streaming file scanner should skip a concurrent `ENOENT` while retaining all other
  parse/read failures; otherwise a concurrent Core deletion can safely abort a rebuild.
