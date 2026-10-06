# W5 healthy finalization scheduling repair

## Verdict

The approved two-production-file scheduling repair passes the decisive complete Core driver replay over a NEW copy
of the committed real corpus. The actual operation reaches terminal `completed`, runtime `ready`, queue `settled`
and all-Bank `source-retired` release. Its pending actual-client heartbeat resolves in 29.507s under the unchanged
60s deadline. No validator, queue path, lease, Native TTL, poll interval or deadline was weakened.

This is Core scheduling/validation acceptance with synthetic Native transport over genuine retained evidence.
It does not certify real Native retirement or overall W5. Parent independent combined review must precede real
startup. This worker made zero real HTTP/PG/model calls; the parent-owned working pair and 301/329 budget are intact.

## Exact source changes

| Path | Change |
| --- | --- |
| `packages/core/src/memory/transitions/transition-healthy-execution.ts` | Extract the existing single serialized heartbeat lifetime and add real `setImmediate` boundaries before Native finalization, after each persisted Native outcome, full bind, full readiness, full intent validation and native release. Join its current tail and recheck signal/live lease/CAS/configuration. Stop new ticks and join before successful terminal resolution. |
| `packages/core/src/memory/transitions/transition-native-session.ts` | Validate renewal against its exact dispatched Bank/transition/acquisition/executor, non-regressing revision and sealed proof before comparing with the current active entry. Preserve newer/terminal state and newer generation; reject same-revision divergence and incompatible responses. Never regress lease expiry. |
| `packages/core/src/memory/transitions/transition-native-renewal.test.ts` | Ten focused cases for actual session resolution/claim versus delayed renewal, incompatible response identity/proof/revision, and liveness preservation. |
| `packages/core/src/memory/transitions/transition-healthy-scheduling.test.ts` | Seven actual-driver cases: return/reentry with real event-loop response delays and total elapsed work over five minutes, full validation/order, signal/configuration/expired/replaced lease refusal, heartbeat failure and driver timer cleanup. |
| `packages/core/src/memory/transitions/index.md` | Update the two module responsibilities. |
| `.trellis/spec/backend/memory-transition-healthy-drivers.md` | Document safe independent boundaries, current-heartbeat join, terminal ordering and renewal-response regression contracts. |

The heartbeat remains the existing 30s interval and serialized promise chain, using the original 300s live lease
renewal. Boundary checks reject an expired or replaced lease rather than reviving it. No transaction contains a new
async gap. Native final outcomes still precede Hindsight binding/effects; binding and full readiness still precede
the complete ordered queue; native release still precedes the original synchronous terminal resolution.

Renewal first checks the returned status against its dispatched request even if another observation has advanced
the active state. A transport-valid response from an old executor cannot resurrect it. Same-revision divergent
identity/phase/proof/outcome refuses; liveness/counters are the only fields excluded from semantic equality. A
currently accepted terminal/newer status wins over an older valid response. No command, receipt or proof is edited.

## Verification

All heavy checks ran sequentially and all Vitest commands used at most two workers.

| Check | Actual result | Evidence |
| --- | --- | --- |
| Core typecheck, initial and final-v2 | exit 0 | `w5-finalization-scheduling-types-initial.log`, `w5-finalization-scheduling-types-final-v2.log` |
| New scheduling/renewal plus service/reconstruction/queue/maintenance/boundary regression | 7 files / 46 tests PASS, 32.54s | `w5-finalization-scheduling-regression-tests.log` |
| Final changed scheduling/renewal tests | 2 files / 17 tests PASS, 14.14s; overlap with the 46, not additive | `w5-finalization-scheduling-final-tests.log` |
| Scoped ESLint | exit 1: only inherited `createTransitionNativeSession` 63/50, no warnings | `w5-finalization-scheduling-lint-final.log` |
| Actual default-config complete Core corpus driver | exit 0, terminal completed; zero network/model calls | `w5-finalization-scheduling-driver-result.json`, `w5-finalization-scheduling-driver.log` |
| Exact source/preimages/old diagnostic/UTF-8/header/index audit | exit 0; six paths, four supplemental preimages, prior observer evidence unchanged | `w5-finalization-scheduling-audit.log`, new source manifest |

The initial new-test run passed 16/17; its one failure incorrectly counted the newly bound Local runtime's normal
maintenance timer as a leaked driver heartbeat. The final assertion identifies and verifies clearing the actual
driver interval handle. The first final typecheck found unsupported `Promise.withResolvers` in test declarations
and one unknown logger-object property; ordinary Promise helpers and typed assertions fixed them. The first lint
found unused destructuring names, fixed by an explicit semantic status projection. Original failed logs remain.
No dependency/library target, warning suppression, timer, deadline or test budget was changed to pass these checks.

The native-session function-length exception is unchanged from its 63-line preimage. Scoped lint is not green;
workspace/native lint/type baselines are not relabeled. Observer delivery's separate 17-file/134-test, Core type and
real strip-only boot gates remain recorded in `w5-verified-observation-implementation.md` and its immutable manifest.
No additional process smoke is claimed for scheduling beyond the actual native-strip-mode corpus driver itself.

## Decisive replay

Retained failed reference: `w5-verified-observation-driver.mjs` and its result show 419.430s with
`MEMORY_TRANSITION_LEASE_LOST` at settling, followed by pending heartbeat `HINDSIGHT_CANCELLED` after 349.467s.
Neither artifact was overwritten and this historical failure remains a failure.

New replay: `w5-finalization-scheduling-driver.mjs`; new copy
`.trellis/.runtime/w5-scheduled-driver-605da83c-5ff9-44b8-87ec-e9ba7779c497`.
Source files are hashed at launch and rehashed after runtime/DB closure. The default boot, actual operation owner,
actual service/runtime, original recovery identity and every independent full validator remain active. The first
Native resolve waits for the production 30s heartbeat; its response uses the actual Hindsight client and three
real event-loop turns. Request deadline is 60s; actual observer polling remains 10s.

One explicit fixture-only correction models real Native `transition_service.py:360`: terminal resolve increments
the status revision by one. The older Core synthetic `transitionOutcomeFixture` omitted that revision update.
Only the new diagnostic and focused tests model the real increment; neither shared fixture nor Native production
was modified. The parent explicitly approved this correction. Same-revision divergence rejection was preserved.

| Measurement | Actual result |
| --- | --- |
| Cold composition | 81.657s |
| Complete driver | 434.325s |
| Pending heartbeat | resolved in 29.507s; no diagnostics |
| Native outcome validation | 26.109s + 7.707s |
| Complete bind | 80.853s |
| Full independent readiness | 39.953s |
| Complete `executeIntents`, empty queue included | 118.166s |
| Complete native release | 34.025s |
| Warm observer reads | 3.316-3.658s |
| First observer read after binding replacement | cold 39.343s; subsequent reads warm |
| Terminal result | completed / ready / settled / source-retired / 2 Banks |
| New operation | `6e275153-2dbf-4010-9f4d-640bfd7e39e9` |
| Original transition | `df47f32c-48a8-47bc-9792-2e24e8642084` |
| Source and checked-code hashes | unchanged at end |

The repair lets due work execute between independently completed validators; it does not make full corpus validation
fast. The 39.343s cold observer after binding replacement is explicit and must not be reported as below the 10s warm
poll target. By then every Native Bank is terminal and no Native renewal remains pending. Long individual validators
still block the event loop; a single validator exceeding the finite live lease would truthfully fail. This replay
proves the current corpus and exact sequence, not an unlimited-corpus latency guarantee.

## Preservation and handoff

The new `w5-finalization-scheduling-source-manifest.json` records only this supplemental scope and references the
unchanged observer and older narrow deliveries. Supplemental preimage manifest SHA256:
`dce8468bf0da30688b7a32dc4519c4182895316626be65afb711257fb02c5ba2`.
Observer delivery manifest remains `9cb5ecbcf8c13c4e77504da52fd1c2b5fab60f72e60890defa30d40186883a66`.

Original parent-owned SQLite SHA256 remains
`a81a1e3ec6e85f3faa287b8b77c704742be7bbf0f05ec594e1a4bc8381c00923`. No real Native process, PG server, model request,
budget/credential change, Git action or task lifecycle action occurred. New copied DB/result/logs are retained.

Parent next step: independent combined narrow + observer + scheduling review, then decide the authorized real-service
continuation gate. Actual Native finalization, same-Bank delta reentry and remaining W5 preservation/acceptance are
separate from the completed Core scheduling gate. Do not reconstruct old corpus extraction or repeat completed
Native maintenance. Owner/manual acceptance is not inferred.
