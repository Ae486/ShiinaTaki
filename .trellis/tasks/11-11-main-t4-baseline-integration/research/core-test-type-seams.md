# Core test and fixture type seams

Recorded on 2026-11-12 in `G:/TakiAgent-integration`, branch `integration/main-t4-20261111`.

## Scope and changes

The baseline Core typecheck reported 13 errors in the 11 assigned test/fixture files. All 13 are resolved without changing production interfaces. Subsequent functional reconciliation uses the proven current contracts described below.

- Two empty extension contexts now carry the exact empty `toolDisclosure` snapshot required by `ExtensionRunContext`.
- The compaction retirement unit test explicitly selects no Legacy/Hindsight retirement port through `legacyFlush`. The real coordinator supplies the Local no-flush path; the fixture no longer manufactures a successful `not_required` flush response.
- The initiative ingestion fixture builds the Native memory and its bound application artifact through the existing typed factories. Native cursor `4`, Bank identity, provenance and exact Native binding are preserved together. The convenience `applicationTestBoundMemory` factory currently has no cursor argument.
- Three activation execution doubles expose `updateProducer` and throw on unexpected use. These real activation handlers use `checkpoint`; the existing checkpoint-failure assertions remain intact.
- Five composed memory runtimes now have explicit boot identities. Runtime/service identities match where those fixtures compose both owners.
- The operation RPC service double exposes `wait` and throws on unexpected use instead of fabricating completion.
- Canonical tidy and shutdown boot fixtures use `activateLocalRuntimeFixture`, which creates joined migration-run and activation-receipt rows plus the matching marker. Its existing synthetic defaults suffice; the helper itself was not changed. These identities do not establish real migration or owner acceptance.
- The Legacy retirement fixture explicitly selects `legacyMaintenanceBeforeCompact: () => true`. Its original maintenance-before-compaction and retirement assertions remain intact; canonical independence is tested separately.
- The older T4 cold-Hindsight throw assertion is replaced by main's intentional ordinary-outage contract: a current Hindsight identity with every memory capability unavailable, no memory or automatic-recall tools, unchanged authority and unchanged Native/application witnesses. Binding freshness is distinct from capability availability. Existing route-refusal and source-integrity/withdrawal assertions remain intact.

No new production files, unsafe casts, optional production fields, original-profile changes or Git reference mutations were introduced by this work. The durable Block-progress expectation was retained.

## Verification

Environment: Windows/PowerShell, Node `24.18.0`, pnpm `10.22.0`, TypeScript `6.0.3`, Vitest `4.1.10`.

| Check | Result |
| --- | --- |
| Core typecheck after the seam corrections | Pass, exit `0` |
| ESLint on all 11 assigned files | Pass, exit `0` |
| Whitespace check on all 11 assigned files | Pass; existing CRLF-to-LF notices only |
| Initial focused functional run | 4 files passed, 6 failed; 49 tests passed, 9 failed; 58 total; 32.06 seconds |
| Comparable run after joined receipts, Legacy ordering and root's configuration correction | 7 files passed, 3 failed; 55 tests passed, 3 failed; 58 total; 36.14 seconds |
| Follow-up Hindsight initiative run after correcting binding-freshness semantics | 1 file passed, 12 tests passed; 19.34 seconds |

Exact typecheck command:

```powershell
pnpm --filter @taki/core typecheck --pretty false
```

Exact focused test command:

```powershell
pnpm --filter @taki/core exec vitest run src/harness/run-snapshot-capture.test.ts src/memory/emergency-background-retirement.test.ts src/memory/hindsight/hindsight-initiative-memory.test.ts src/memory/operations/memory-operation-kind-hindsight.test.ts src/memory/operations/memory-operation-kind-local.test.ts src/memory/operations/memory-tidy-runtime.integration.test.ts src/memory/runtime-configuration-race.test.ts src/memory/runtime-configuration.test.ts src/memory/tidy-shutdown.test.ts src/server/methods/memory-operation-methods.test.ts --reporter=dot --maxWorkers=2
```

Exact scoped lint command:

```powershell
pnpm exec eslint packages/core/src/harness/run-snapshot-capture.test.ts packages/core/src/testing/memory-chat-turn-fixture.ts packages/core/src/memory/emergency-background-retirement.test.ts packages/core/src/memory/hindsight/hindsight-initiative-memory.test.ts packages/core/src/memory/operations/memory-operation-kind-hindsight.test.ts packages/core/src/memory/operations/memory-operation-kind-local.test.ts packages/core/src/memory/operations/memory-tidy-runtime.integration.test.ts packages/core/src/memory/runtime-configuration-race.test.ts packages/core/src/memory/runtime-configuration.test.ts packages/core/src/memory/tidy-shutdown.test.ts packages/core/src/server/methods/memory-operation-methods.test.ts
```

The functional tests use deterministic model and Hindsight fixtures, temporary databases and real composed Core/RPC paths. They are not live-provider or owner acceptance. Two test workers bound resource contention without changing assertions or timeouts.

## Functional reconciliation and remaining checks

The initial functional failures were sent to the root agent, which owns production modules. Configuration and proven fixture corrections resolve most failures. Two checks still require coordination; the typecheck alone does not establish that the functional gate passes.

| File | Failing behavior and evidence |
| --- | --- |
| `memory/emergency-background-retirement.test.ts` | Resolved by selecting the actual Legacy ordered-maintenance mode. The original queued utility, maintenance/compaction and usage assertions pass. |
| `memory/runtime-configuration-race.test.ts` | Resolved by root's production boot policy-construction correction. Invalid desired `TAKI_MEMORY_STOPLIST` no longer throws before active-policy observation; the original assertions pass. |
| `memory/runtime-configuration.test.ts` | Resolved by that production correction. Invalid tidy/Utility configuration no longer prevents basic/Main memory composition; original work-admission assertions remain. |
| `memory/tidy-shutdown.test.ts` | Joined receipts resolve the unavailable-runtime fixture. Remaining: canonical shutdown returns `review-stale`, while the retained T4 cancellation expectation is `unfinished`. Abort signal and zero edits/steps are correct. Root is challenging whether cleanup-retired authority overwrites the runner's explicit abort cause; the existing assertion is unchanged. |
| `memory/operations/memory-tidy-runtime.integration.test.ts` | Joined receipts resolve initial startup failures. Remaining: at the second SDK-call gate, the actual `user-model` Block revision is `1`, but the durable Tidy producer reports `progress.edits: 0`; the valid durable-recovery expectation remains `1`. |
| `memory/hindsight/hindsight-initiative-memory.test.ts` | Resolved through the ordinary unavailable-capture contract. All 12 tests pass, including disabled capabilities/tools, unchanged Hindsight authority and preserved witnesses, with existing route/integrity fences retained. |

The canonical fixtures previously changed only the marker, without joined run/activation receipts. The existing explicit activation fixture now supplies the required test-only join; production readiness was not relaxed.

Root requested this worker stop concurrent testing while an independent read-only advisor challenges the two production cancellation/progress seams. No shutdown reason or durable progress expectation was relaxed.

The temporary diagnostic artifacts are `G:/Temp/taki-core-test-type-seams-tests.log`, `G:/Temp/taki-core-test-type-seams-final.log` and `G:/Temp/taki-core-test-type-seams-baseline.log`. They may not survive later cleanup; material symptoms and counts are preserved above.
