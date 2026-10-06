# W5 Core validation and W4 installed-order repair

Status: implementation and scoped checks complete; awaiting the parent's independent check. The real pair remains
stopped at 301/329 requests. This work made no model calls and does not establish completion of the real RETURN,
re-entry, full roundtrip or manual acceptance.

## Confirmed defects and repair

The retained Character/Global W2 evidence is complete. On an isolated copy, the original production builder took
288,501 ms and its elapsed-clock `requireTransitionLease` failed at 287,275 ms against 255,482 ms remaining. The
historical driver had a bare catch, so this is a reproduced failure mechanism, not a recovered historical stack.

`TransitionEvidenceContext` now owns one synchronous boundary. Its first stored read executes all existing document,
schema, proof, native/application/maintenance/auxiliary, body and hash checks. Internal uses require the same database,
active context and verified object identity, compare actual stored identity and complete bytes, freeze JSON and copy
mutable Map/byte views. Contexts close on return/throw and reject asynchronous callbacks. Independent candidate,
proof, COMMIT and reconstruction entrypoints start fresh. No process-global/cross-stage cache, lease/TTL extension,
configuration cache, executor shortcut or asynchronous SQLite transaction was added.

This context is threaded through Local/Hindsight candidate reconstruction and W4 proof, local installation,
representation, transition-only D77 snapshot publication and receipt read-back. Ordinary D77 snapshot/event checks
retain their prior behavior. The exported `validateTransitionFinalMapping` interface remains unchanged; internal
baseline and publication-Bank helpers now group context with their typed input rather than adding a fourth parameter.

The first full W4 corpus-copy replay then exposed a distinct pre-existing publication problem. Four derived objects
had exactly the same contents/counts but a different SQL inventory sequence from candidate JSON order. Every other
state component matched exactly. The old and repaired builders produced the same candidate ID/state hash/mapping
hash/target epoch, and the old `verifyInstalledLocal` comparator was byte-identical before this correction. Applying
the existing `sortState` ordering to the freshly discovered outer arrays fixes the comparison without dropping any
record, duplicate, field or nested ordering. A mixed model/directive fixture failed at the old comparator and passes
after the fix; changed derived content still refuses and rolls back publication.

Healthy execution now records only closed internal error codes and stage labels. Primary, heartbeat, abort and
service fallback paths retain their abort/unknown semantics. Error metadata and logger failures are contained;
arbitrary error names/messages, bodies, credentials and stacks never enter ordinary logs.

## Exact source scope

`w5-core-validation-source-manifest.json` lists all 24 changed/new source, test, index and spec files (18 TypeScript
files). Its SHA256 is `bcf06e76032d77fce66b3d26c34b60dd1be2deba821a35e6a10e60b51beaa6f4`.

- Transition modules: new evidence context; Local candidate/projection/Pending; final mapping; healthy execution and
  service; two new context/diagnostic tests; transition index.
- Database modules: candidate repository, publication proof/reader/repository, Local staging, representation,
  transition-only D77 publication; new publication-order test; database index.
- Fixture: optional derived objects in the publication fixture, with its testing index.
- Guidance: `memory-transitions.md`, `memory-transition-publication.md`, `memory-transition-healthy-drivers.md`.

No Native, credentials, counter/budget, migration, task lifecycle or real-pair data file was changed. Original
preimages and supplemental manifests remain intact. The initial preimage manifest remains
`7e8a25a47be1253c4e5205862e958d8fa1967f697b1e3e885c3172916cb4f4fe`.

## Executed checks

| Check | Actual result |
| --- | --- |
| `pnpm --filter @taki/core typecheck` | Exit 0 on final production/test types |
| `pnpm exec eslint <18 changed TypeScript files>` | Exit 0, no warnings/errors |
| `pnpm --filter @taki/core exec vitest run src/memory/transitions src/db/memory-transition-publication src/db/memory-transition-custody.test.ts src/db/memory-transition-native-outcome.test.ts src/db/hindsight-application-replica-repo.test.ts --maxWorkers=2` | Exit 0; 27 files, 178 tests; 97.93 s |
| New focused regressions | 13 pass, included in the 178 above |
| Final manifest read-back | All 24 current hashes and all original/supplemental preimage hashes match |
| Final no-network corpus-copy builder/proof/COMMIT/reconstruction | Exit 0, exact final implementation manifest checked before execution |

The new regressions include finite processing cost with no heartbeat, genuine lease exhaustion and rollback,
row/body/slot/identity deletion or corruption, cross-database/object misuse, context expiry, defensive mutable views,
fresh COMMIT/boot validation, closed diagnostic data/sink failure and exact derived-content preservation.
Existing tests additionally cover complete repeated journeys, stale configuration/native proof/executor history,
reconstruction, source/Pending closure, custody and transaction rollback. No test used more than two workers; heavy
tests and real-evidence replays ran sequentially.

Initial test authoring exposed stale post-COMMIT fixture revision and captured-log shape assertions, which were
corrected. Type checks caught optional SQL values and an unparsed generic fixture payload; both were fixed with
explicit test narrowing/schema parsing. Lint required separating existing service-failure handling and baseline
validation into focused helpers. These intermediate failures are not reported as final passes.

## Final corpus-copy result

`w5-core-publication-clock-final-result.json` is bound to the exact manifest above. It reads the original database
through a readonly connection and creates a fresh random copy. Only the diagnostic facade views the exact historical
recovery operation as running; it does not rewrite that original operation or fabricate historical outcomes.
Every actual data/configuration/proof/COMMIT join executes in the copy. Frozen historical time permits diagnosis;
separate elapsed-clock production ownership guards are recorded, and all pass.

| Stage | Final elapsed time |
| --- | ---: |
| Candidate builder | 41,018 ms |
| Independent final proof | 38,337 ms |
| Atomic publication, including read-back | 60,324 ms |
| Independent receipt reconstruction | 38,548 ms |
| Whole sequence | 178,251 ms |

The final copy contains exactly 1 candidate, 1 receipt and 1 publication, with the expected selected target epoch,
2 Banks, 1,262 records, 722 Sources and 1,262 SourceSets. No elapsed guard exceeds the 255,482 ms available lease.
The actual original SQLite SHA256 is unchanged before and after all replays:
`6d9c381b11045722f1b6086d04e886d6c6bfcde8ab8cddf84091f519e1e7891c`.

Preserved evidence includes the original builder failure, first repaired builder timing, first W4 logical failure,
corrected installed-state diagnosis, old/new candidate/comparator comparison, first successful complete W4 replay
and final manifest-bound replay. The first installed-state diagnostic used an incorrect diagnostic-only SQL column
and stopped before installation; its retained v2 result is the actual successful comparison.

## Remaining gates

The parent must independently review/check this source before starting the real pair. All timing/publication above
belongs to disposable isolated copies; there is still no real-pair candidate or receipt. The restored account does
not change the remaining 28-request ceiling. Reuse native proof and completed maintenance only under the existing
request/executor protocol; do not rerun the original corpus conversion.

The large-corpus re-entry and full operation/runtime/native-release journey remain separate real-data gates.
Prior-publication reads through `readMemoryAuthoritySelection`/`verifyCanonicalLocalReceipt` were inspected but not
changed: the measured repaired W4 RETURN boundaries fit the current lease, and there is no measured basis here for
expanding into those modules. The corpus may grow and synchronous validation remains finite CPU work; this repair
does not promise an arbitrary-size corpus or change global runtime budgets. Full-repository/native/Rust checks were
not rerun because this scoped repair changed only the listed Core files and guidance.
