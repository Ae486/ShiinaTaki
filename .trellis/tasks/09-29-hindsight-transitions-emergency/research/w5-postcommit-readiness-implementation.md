# W5 post-COMMIT readiness responsiveness repair

## Scope and evidence boundary

Owner-authorized repair, delegated by `/root` to `/root/w5_snapshot_repair`. The parent approved exactly three
production files, focused tests, touched indexes and the healthy-driver spec. No real runtime, PostgreSQL, HTTP
service or model was started by this work. All live-working data is read-only; every experiment uses a new copy.
Native source, bindings' implementations, legacy authority/receipt checks, publication/reconstruction validation,
leases, timeouts, budget, credentials and prior immutable manifests remain unchanged.

The stopped real RETURN has a committed Core receipt and an unresolved native finalization. The historical log
contains `MEMORY_TRANSITION_UNCLASSIFIED`; this repair does not recover its original exception or stack. It fixes an
independently reproduced responsiveness defect and improves future sanitized failure classification. It does not
yet establish that the actual default-config continuation is safe to resume.

## Original observations and controlled reproduction

The original primary failure was at 2026-10-03T17:56:35.762Z (`native-finalization`), while the Core lease still ended
at 17:59:36.140Z. Heartbeat reported the same unclassified error at 17:57:14.749Z. Native audits retained both proven
Banks, zero native decision rows, 92 completed maintenance steps and 769 actions. The Character Bank renewal at
17:55:16.584654Z succeeded natively even though Core never persisted its returned observation. The Global Bank's
lease remained at 17:56:38.446254Z. These facts are compatible with blocked response handling but do not identify
the lost historical exception exactly.

The actual driver polls `transitions.status` every 10 seconds. The actual boot readiness callback used a binding
snapshot that called `readMemoryAuthoritySelection`, which reconstructed the complete 115 MB committed native
evidence even when no Local subsystem existed. Each synchronous read held the event loop for about 40 seconds.

| Retained experiment | Two status polls | Pending injected client response |
| --- | --- | --- |
| `w5-postcommit-progress-diagnostic-result.json` (two event-loop turns) | 40,641 / 40,094 ms | Resolved after 80,750 ms; demonstrates response/timer ordering, not a timeout |
| `w5-postcommit-progress-diagnostic-result-v2.json` (three event-loop turns) | 40,875 / 39,860 ms | Rejected after 80,746 ms with `HINDSIGHT_TIMEOUT` |
| `w5-postcommit-readiness-replay-result.json` (repaired, same three turns) | 24 / 27 ms | Resolved after 33 ms |
| `w5-postcommit-readiness-default-result.json` (default-config published binding) | 39,799 / 42,636 ms | Rejected after 82,449 ms with `HINDSIGHT_TIMEOUT` |

All use the actual Hindsight client, a buffered valid retained native status, a 60,000 ms timeout and a 10,000 ms
poll interval. Transport injection models scheduling only: no socket, remote service or model call. The successful
old two-turn experiment remains preserved alongside the failing three-turn experiment.

The repaired replay additionally calls the actual `composeMemoryRuntime` and `composeMemoryTransitions` status
path. Only that disposable composition input has invalid `TAKI_MEMORY_STOPLIST`, causing a real Local draft
refusal before construction. This demonstrates absent-binding behavior; it must not be used to claim default boot
readiness. Full authority validation still runs during its 39,595 ms composition.

The separately requested default-config experiment uses another new committed-data copy, no forced draft failure,
and the actual production `composeMemoryRuntime` plus boot status. Composition took 41,017 ms and published a Local
binding. Each subsequent positive status still rebuilt all committed evidence. The identical scheduling scenario
timed out after 82,449 ms; the runner exited 1 on its explicit expected-resolution assertion. This is a remaining
continuation blocker, not an absent-path regression or a recovered historical exception. Real RETURN must stay
stopped until a separately scoped repair retains current integrity checks without this synchronous repeated work.

## Implementation

- `runtime-composition.ts`: cohesive `createBindingQueries` extraction exposes `hasPublishedBinding(provider)` by
  the existing binding `current()` accessor. It is presence only, never an authority/read/write admission token.
  Moving the two existing snapshot queries into the same helper reduces the previously overlength composition.
- `memory-transition-boot.ts`: return false immediately for absent bindings. Positive presence retains the original
  complete snapshot, authority/receipt validation, lifetime and epoch test.
- `transition-healthy-execution.ts`: exact Shared `HindsightErrorCodeSchema` values join the existing closed internal
  diagnostic codes. Prefixes and arbitrary message/name/stack/body fields remain excluded. Catch/abort/unknown
  handling is unchanged; throwing getters and sinks cannot interfere with it.
- Colocated production boot tests exercise genuine return/reentry publication and actual Local/Hindsight lifetime
  withdrawal, including unavailable draft, retirement, replacement failure, stop, old epoch and corrupted evidence.
  Diagnostic tests cover every Shared Hindsight code and hostile getters/sinks.

## Preservation

New exact preimages are under `w5-postcommit-readiness-preimages/`, with the separate
`w5-postcommit-readiness-preimage-manifest.json`. They never replace prior preimages or manifests. The new boot test
did not exist before this repair. The unchanged source SQLite hash before/after every completed diagnostic is:

`a81a1e3ec6e85f3faa287b8b77c704742be7bbf0f05ec594e1a4bc8381c00923`.

The repaired absent-binding copy is
`.trellis/.runtime/w5-postcommit-readiness-51844ac6-0bd8-4e94-9e3c-21700ee2366c`.
The default-config copy is `.trellis/.runtime/w5-postcommit-readiness-a51a25ea-bd64-4403-8288-908020c6f105`.

## Verification checkpoint

- Focused tests: 2 files / 7 tests passed, 16.04 seconds (`w5-postcommit-readiness-focused-v2.log`). The first test
  attempt had a fixture query using nonexistent `operation_id` instead of `attempt_json.operationId`; its failed
  log is preserved, and the helper was repaired before the passing run.
- Core typecheck passed (`w5-postcommit-readiness-typecheck.log`).
- Scoped five-file ESLint passed (`w5-postcommit-readiness-lint-v2.log`). The first lint run found only the new test
  helper's four arguments; its log is preserved. The helper now groups transition identity/provider in one input.
- Absent-binding replay exited 0, zero network/model calls and unchanged source hash.
- Final regression including the marker-corruption assertion: 10 files / 72 tests passed, 36.96 seconds
  (`w5-postcommit-readiness-regression.log`, maxWorkers=2).
- Final Core typecheck and scoped five-file ESLint passed (`w5-postcommit-readiness-typecheck-final.log`,
  `w5-postcommit-readiness-lint-final.log`). No new lint exception or suppression was introduced; the prior
  `composeMemoryRuntime` length exception is no longer needed. The full repository lint was not rerun or claimed green.
- Actual Node strip-only Core startup, authenticated WS, graceful stop and reopen passed for Legacy and genuine B2
  Local, twice each, with zero model calls. New owned root:
  `.trellis/.runtime/w5-boot/c59ddec6-a67a-4e7f-aa98-b96dd4ed925f`; `w5-postcommit-readiness-boot.log` records exit 0.
- Default-config committed-copy replay intentionally failed the expected-resolution assertion after the actual
  `HINDSIGHT_TIMEOUT`. The original scheduling defect remains for published bindings. Both corpus-copy processes
  exited; no real service was started. The remaining design is parent-assigned research only, separate from this
  narrow patch. This is not overall W5 acceptance or authorization to resume real services.
