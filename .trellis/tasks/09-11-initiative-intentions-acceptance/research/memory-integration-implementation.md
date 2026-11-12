# C4 Memory integration implementation

## Scope and APIs

Work is in `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`. This report covers Memory-owned
source lifetime and selected recall. It does not establish root Harness/native/model or owner acceptance.

- `composeMemoryRuntime(...).sourceState(witness)` accepts the existing `IntentionSourceWitness`
  `{ characterId, userTimelineId, userTimelineSeq, sourceDigest }` and synchronously returns
  `current | unavailable | withdrawn`. `sourceDigest` is the C3 SQL-row digest, not `primaryEntryDigest`.
- `createInitiativeMemoryRecall(captured, { query, scopes })` returns `{ tools, isCurrent }`. Construction is pure;
  `tools.recall.execute({ scope })` calls the original captured canonical tool with the selected query, four records
  and 512 tokens. Scope is `global` or `character`; no `both`, arbitrary query, provider or Bank identifier is exposed.
  Root must reuse this object for the admitted Run's retries and held delivery, and combine `isCurrent` with its
  original Run/opportunity/deadline predicates. The original non-enumerable Effect metadata is preserved.
- `CapturedMemoryRun.captureRecallEvidence(record, query, requestId)` retrieves the original provider-selection
  evidence. Local selection and Hindsight fitted-result production capture the evidence before returning across
  subsequent awaits. The bounded registry retains at most 32 requests and 100 candidates per request. Missing or
  evicted evidence refuses injection. Held output retains its own checks independently of this registry.
- `captureTrackedInitiativeAssembly` freezes the original assembly and tracks only actual selected scopes.
  Their current same-provider Persona/Blocks/index text/source digests join `CapturedMemoryRun.isCurrent`.
  Existing Persona caching remains authoritative; filesystem edits do not simulate runtime reload.

## Source truth and bounds

The primary row is legitimate before ingestion. The read-only adapter then follows exact primary commit -> claimed
span -> validated Write Gate -> original batch -> immutable receipt. It validates exact entry identity/digest and
actual retained message membership, not only a numerical Timeline range. It never forces ingestion or creates IDs.

Local compares original receipt Source revision/content/provenance and historical unit/policy snapshots against
current data. Hindsight compares original Bank/namespace and confirmed Source/unit native heads plus exact policy.
Whole-write retain completion captures the original Hindsight lifetime evidence so recovery cannot silently adopt
a correction made before the first Intention lookup. Pending cancellation is withdrawn; unconfirmed or insufficient
evidence is unavailable and leaves the original plan deadline to the Intention owner.

Selected recall counts attempts before dispatch, including failure/cancellation. Each Bank independently allows at
most one query. Only confirmed direct records with exact supported source evidence enter the model projection.
Pending presence, partial results, vector degradation and unavailable status remain visible. The final JSON view
is escaped and passed through `fenceUntrusted`; the complete rendered text, including fence/labels, fits 512 tokens
using the project's existing `estimateTokens`. Whole records that do not fit are omitted. IDs, raw metadata,
full source bodies and policy control fields are kept out of the model projection.

## Changed files

- New: `db/primary-memory-source-read.ts`; `memory/primary-memory-source-state.ts`,
  `memory/memory-recall-evidence.ts`, `memory/initiative-memory-recall.ts`;
  `memory/hindsight/hindsight-recall-evidence.ts`, `hindsight-source-lifetime.ts`.
- Narrow integration: owning ingestion codecs/repositories; whole-write terminal codec/retain completion;
  canonical Run, Local runtime/provider, Hindsight runtime/provider/recall/subsystem and runtime composition;
  selected assembly and shared record eligibility export.
- Tests: Local ingestion regressions, selected recall tests, selected assembly lifetime tests,
  Hindsight selected/source integration tests, retain completion/recovery evidence tests and one explicit test-cursor fixture.
- Directory indexes and Local/Hindsight executable Memory specs updated. No migration or dependency was added.

## Validation

Completed commands and final totals are recorded below. Root owns the complete workspace,
real process, native and model gates; no external Hindsight endpoint or paid model was called in this work.

1. `pnpm --filter @taki/core typecheck` — passed after concurrent consumers converged.
2. Scoped ESLint over changed/new TypeScript implementation and test files — passed.
3. Seven-file regression run (Local ingestion, Local captured Run, canonical ingestion repo, selected recall/assembly,
   Hindsight ingestion and runtime composition): **128 tests passed**.
4. Hindsight selected recall + whole-write + parent-journal run: **34 tests passed** before final added regressions.
5. Four-file focused run after completion/recovery and selected assembly regressions: **52 tests passed**.
6. Ten-file concurrent run: **170 passed, one failed**. The existing 10,000-level metadata/reopen journal test took
   7,083 ms and exceeded its unchanged 5,000 ms timeout under concurrent load. No timeout was raised; the same
   ten files are rerun with `--maxWorkers=1` to verify the failure under controlled worker contention.
7. Final single-worker rerun: **10 files / 171 tests passed**, 97.27 seconds, exit 0. Both corrected temporary-path
   fixtures participated; the unchanged deep metadata/reopen test passed without increasing its timeout.
8. Scoped `git diff --check` passed. New source/test files were separately checked for UTF-8 BOM and trailing
   whitespace; none was found. This supplements the tracked-only Git whitespace check.

## Test workspace incident and correction

The command
`pnpm --filter @taki/core exec vitest run src/memory/hindsight/hindsight-initiative-memory.test.ts src/memory/hindsight/hindsight-memory-writes.test.ts src/memory/hindsight/hindsight-memory-write-retain.test.ts src/db/hindsight-memory-write-repo.test.ts`
matched three actual test files and passed 34 tests. The existing whole-write test's restart case used a historical
hardcoded parent directory `H:/TakiAgent/.trellis/.runtime/b6-continuation-20260911` for `write-gateway-*` temporary
directories. This was discovered after that run. The later ten-file concurrent command also included
`src/db/hindsight-memory-write-repo.test.ts`, which independently hardcoded the same parent for `write-repo-*`.
The ten-file command is the single-worker command below without `--maxWorkers=1`.
The existing `afterEach` hooks close fixtures and remove only directories created by each test after checking their
resolved parent and prefix; these runs reported no cleanup-hook failure. No main-worktree source/Git was edited and no
broad cleanup was attempted, but **this validation cannot be described as making no writes outside T4**.

Both T4 tests now use `const ownedRuntime = resolve(tmpdir())`, create only their respective `write-gateway-*` or
`write-repo-*` children, and keep `dirname(resolve(directory)) === ownedRuntime` plus the basename prefix check
before recursive cleanup. Exact search over the ten selected test files confirms no remaining main-worktree
hardcoded path in those files. Subsequent runs use these corrected isolated paths. The root was informed of both
discoveries and fixes. No claim is made about unrelated preexisting temporary directories.

Final command:

```powershell
pnpm --filter @taki/core exec vitest run --maxWorkers=1 src/memory/hindsight/hindsight-initiative-memory.test.ts src/memory/initiative-memory-recall.test.ts src/memory/initiative-memory-assembly.test.ts src/memory/canonical-local-ingestion.test.ts src/memory/hindsight/hindsight-ingestion.test.ts src/memory/hindsight/hindsight-memory-writes.test.ts src/memory/hindsight-runtime-composition.test.ts src/memory/canonical-memory-run.test.ts src/db/canonical-ingestion-repo.test.ts src/db/hindsight-memory-write-repo.test.ts
```

## Limits and follow-ups

- Unknown remote edits remain unknowable until verified synchronization. Degraded reads retain Hindsight authority;
  Local is never promoted during an outage.
- Historical Hindsight receipts without original policy/head evidence remain unavailable. No new source, speculative
  revision or implicit replay/backfill is created. A new supported real completion records evidence atomically.
- D81 remains unresolved provider-wide: a direct source or visible source subset cannot establish all inputs of every
  opaque derived body. This adapter excludes unsupported closures only from this selected initiative consumer.
- The 512-token contract uses the existing estimator, not an external model-specific tokenizer or fabricated measured usage.
- Native UI acceptance, actual external Hindsight behavior, model quality and the complete missed-interview Run scenario
  require the root's separately recorded integration/owner evidence.
