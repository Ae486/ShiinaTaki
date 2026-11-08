# Existing-instance usable delivery — updated 2026-11-06

## Scope and current result

**Latest continuation:** [real-model result and exact next step](real-model-delivery-20261106.md). Actual Local
retain/recall integration and official-endpoint compatibility passed. The preceding real runs exposed incomplete
post-activation Bank preparation, a harness error-decoding defect and remaining source-attribution imprecision.
The linked report owns the current correction and acceptance status. Earlier relay TLS failures and every failed
attempt remain historical evidence; connectivity and controlled-model results do not imply full acceptance.

Continuation verified that journey 17 completed after the prior session's final progress message:
`first-use-runtime/results/2026-11-05T18-51-25.420Z/result.json` reports all 20 scenario entries passed.
This includes healthy Local return/re-entry, post-re-entry recall, verified backup, offline emergency takeover,
Local restart/recall and the 61-table offline paired restore with authenticated pre-writer verification.
All Core/Native lifetimes stopped normally and owned PG/process/port resources were cleared. Current-source
readback matches 204 extant Taki files, three expected deletions and 97 Native files from that run.

These are actual Core/Native/PG/Home results with **controlled models** (40 fixture requests), not real-model
quality or owner acceptance. Prior failed journeys remain failure evidence. The owner has now requested
bounded real-model and real-conversation validation in the main checkout, using only the model configuration
from `H:/TakiAgent-worktrees/t4/.env.local` and read-only conversation samples in isolated test data.

Connectivity on 2026-11-06 with the installed AI SDK: `deepseek-v4.1-flash` returned `OK` in 3.42 seconds
(response model `deepseek-flash`, 47 total tokens). `gemini-2.5-pro-1m` returned HTTP 503 `model_not_found`:
the account group has no available channel. A preliminary Python transport received HTTP 403 / 1010 for
the main model; the actual SDK succeeded, so that preliminary refusal is not an application connectivity failure.
The main model is available for memory verification; vision availability and full tool/recall behavior remain separate.
The subsequent SDK tool roundtrip passed with one tool execution and two model steps (22.51s, 820 tokens),
after one TLS failure before tool execution. Complete streaming also returned `OK` (17.69s, 43 tokens).
See [the content-free connectivity record](model-connectivity-20261106.json). These few requests do not establish
provider reliability or actual Core memory behavior.
The actual Native `OpenAICompatibleLLM` adapter subsequently validated a Pydantic JSON response through the
same selected model without retry (30.17s; 149 reported total tokens). This closes minimal Native adapter/JSON
connectivity only; real memory extraction, consolidation and retrieval remain separate live gates.

The first bounded real-service run, `G:/taki-real-memory-OckQlQ/result.json`, passed Local retain and recall.
Their wall times were 59.066s and 34.306s; unions of observed upstream intervals occupied 52.772s and 34.194s
respectively. The remainder includes any client retry gaps and is not pure memory CPU. Hindsight setup then
failed because the test launcher omitted the approved-host proxy bypass: Native attempted the Windows proxy,
which the isolated network guard refused before reaching the model. `setup.apply` reported `HINDSIGHT_TIMEOUT`
after 120.242s. This failed attempt is preserved; all owned services stopped without force and PG/listeners
were cleared. A corrected launch is required before claiming real Hindsight memory acceptance.

The owner authorized completing the existing-instance first-use path, then the existing isolated backup,
healthy transition and emergency journeys in the main worktree, while reducing unnecessary implementation.
Authentication, single authority, complete supported interchange, Taki policy, durable writes and truthful
failure reporting remain required. Managed installation and upgrades remain later requirements under D94-D96.
The existing `08-09-memory-operations-ui` task remains in progress; no commit, push or archive is implied.

Latest owner direction (2026-11-06): resume planning, implementation and verification after the review of
overdesigned validation, cascading failures and usable recovery across Local/Hindsight. Follow
[the boundary correction plan](validation-recovery-plan-2026-11-06.md). Further cache extensions and per-consumer
patches are not the default remedy. Previous fixes and evidence remain preserved; current correction evidence is summarized below. The revised design is checked against the original usable/degraded/recovery requirements,
not only accumulated code-spec restrictions or tests that assert refusal.

The 11-06 correction is implemented and independently reviewed across current Local/Hindsight identity, execution
ownership, full-proof failure handling and control-plane diagnosis. Obsolete cross-read history caches and their
entrypoints were removed. Ordinary guards retain current identity/data/fence checks; construction, publication and
recovery retain complete proof. Current Core typecheck and affected 81-file ESLint pass. Shared/Desktop typechecks
pass, and final Shared/UI tests pass (4 and 32 cases respectively). Deterministic recovery, Local, queue and status
regressions are recorded in the boundary plan; overlapping counts are not summed.

Two fresh generated-data copies now pass actual Core acceptance:

- `G:/taki-post-reentry-BDMtS8/diagnostic-result.json`: a valid-shaped corrupt historical candidate leaves current
  authority and operator diagnosis readable; chat returns exact `MEMORY_AUTHORITY_INVALID`, with zero model calls.
- `G:/taki-post-reentry-s6SfCS/replay-result.json`: actual Core/Native/PG/WS ordinary recall completes, reports
  `partial:false`, and returns the retained copper-compass fact exactly once in the correct Hindsight epoch.
  Admission took 8,773ms and the complete request took 64,246ms. Native recorded four successful recall HTTP requests
  among 219 total calls. This is functionally successful but still a long first recall; it is not a low-latency claim.

The replay profile attributes 62% of samples to current template selection/evidence reconstruction
(`readTemplateSelectionIdentity`). This increment retains that data validation contract; it removes the independent
authority-history reconstruction from ordinary paths. Current template validation is the measured remaining
performance cost, not an unresolved empty-result success or a claim that every redundant check has been removed.

Both copies exited normally with no forced Core/Native termination or remaining owned processes/listeners, and
all 1,690 source fixture hashes remain unchanged. Core and Native model providers are controlled fixtures; this is
real service and persisted-data execution, not original-owner-data or real-model quality acceptance.
Connected journey 16 completed steps 1-13, including Home v2 backup, healthy RETURN (235.1s including Local use),
REENTRY and actual Hindsight recall (363.6s including the complete step). Step 14's second backup refused while
quiescing with `HINDSIGHT_BACKUP_QUIESCENCE_TIMEOUT`, before copying Core or invoking the Native backup route.
Steps 15-17 did not run. Evidence: `first-use-runtime/results/2026-11-05T18-05-58.505Z/result.json`, retained root
`G:/taki-first-use-va6sFR`. Both Core instances and Native exited normally; no owned processes/listeners remained,
and the owner data listing was unchanged. The stopped owned PG registry/data were intentionally retained.

A combined real-owner regression proves that detached post-turn maintenance can outlive chat completion and occupy
this write fence. The existing timeout reopens the fence without creating an artifact; settling that same maintenance
then retrying public capture produces one verified backup without repeating maintenance. 21 backup service tests pass
in `G:/taki-backup-quiescence-checks/backup-quiescence-combined-final.log`.

The real probe `G:/taki-post-reentry-591jC1/replay-result.json` confirms the outstanding owner is
`auto-memory.runMaintenanceChain -> hindsight-writer-fence.maintenance.run`. It drains 77,676ms after the first
capture enters quiescence. That capture truthfully fails before creating an artifact; public retry after observed
drain completes in 11,499ms and verification in 2,199ms. Normal process cleanup and all 1,690 source hashes pass.
The Home message now explains that this attempt created no backup and directs the operator to retry later.
Production timeouts and automatic retry behavior are unchanged. The subsequent successful journey 17 used the
Home harness that records exact quiescence refusals and button retries within the original capture observation
budget; its final verified-pair assertions passed. No failure or unknown outcome is converted into success.

The preceding journey 15 and failed replays remain historical evidence below. The current successful replay
supersedes their ordinary-recall/shutdown failure status, while the complete parent task and D94-D96 remain open.

Build: `H:/TakiAgent`, `main`, Taki HEAD `e260ff4b0bf663b5faa0187bc6ec701fd2f007cd`;
Native `H:/hindsight` HEAD `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`. This measures the current
uncommitted integration, including migration 060 and inherited work. Every completed journey's `result.json`
records both HEADs and changed-source hashes. Do not substitute a historical HEAD for those source identities.
Node 24.18, pnpm 10.22, actual Native/isolated PG, actual Core main/WS and Chromium Home are used.
The Native interpreter was verified as Python 3.11.5 during the 11-06 continuation;
For the connected-journey evidence above, Core model calls are scripted and Native uses controlled providers;
those runs used no original data, real credentials or paid model calls. The subsequent 11-06 connectivity probe
used the specified real credentials, as authorized. Temporary data, profiles and large builds are on G:,
with one heavy runner at a time.

## Reproduced blockers and bounded corrections

The observer-cache row below records an intermediate measured correction. The 11-06 boundary change supersedes
that implementation with current-identity status and removes its reusable publication observer.

| Actual failure | Change and preserved boundary | Evidence and tradeoff |
| --- | --- | --- |
| A coalesced Home WS burst occupied the event loop while a Native response deadline expired after RETURN COMMIT. | Use installed ws 8.21 `allowSynchronousEvents: false`, yielding between message frames. No custom queue or deadline change. | Real-socket regression fails before/passes after; 17 related tests pass. Peak burst throughput can decrease; one long handler is still synchronous. |
| A renewal raced with its own successful terminal Native decision and reported `executor_lost` while the lease was still valid. | Join only the existing in-flight decision on that typed refusal, then require the same acquire/executor/proof/stored decision and a newer terminal revision. | Both response orders fail before/pass after; 28 renewal/healthy-driver tests pass. No new HTTP request, retry, lease extension or generic recovery layer. |
| Repeated current-state guards spent substantial CPU allocating UTF-8 key buffers. | Compare validated Unicode scalar values and validate surrogate pairing without temporary character arrays; preserve the exact encoding. | All 2,264 retained documents / 63 tables / 6,822,607 encoded bytes equal the old encoder. Shared 679 tests pass. Individual full guard work remains. |
| Home's six status requests repeatedly decoded the same immutable publication artifacts and exceeded the actual 15-second deadline after RETURN. | One operator-only observer reuses the existing byte-validated immutable-artifact computation; all current SQL relations and runtime binding/hold state are reread. Explicit authority/onboarding/activation/template RPC facades receive fresh selections. | Same actual-main fixture: cold/warm burst timeouts before, 1.642s/0.919s after. No Native/model calls, source hashes unchanged and clean shutdown. COMMIT, binding, boot, settlement and data admission retain independent full verification. Hindsight's deeper connection/recovery guards are unchanged. |

At that intermediate stage, the publication observer itself was not changed. The template boot wrapper strips the optional status callback
before creating the producer and returns the original service to operation owners. On observation errors,
binding revision changes or shutdown, its existing immutable-evidence state is invalidated. New tests cover
warm reuse, corrupt current marker/native evidence, replacement, durable template hold, stop and independent
producer readers. The first corruption test used an invalid digest shape and hit SQLite's CHECK before the
reader; the corrected test uses a valid-shaped false digest and proves both readers reject it.

No new scheduler, relay, dependency auditor or recovery framework was introduced. Fixture corrections are
limited to actual operator sequencing, existing-resource template review, isolated Vite caches and complete
tool-result assertions. Existing migrations, policy checks, product budgets and failure semantics are retained.

## Connected evidence and retained failures

Paths below are relative to `research/first-use-runtime/results/`. Original failed evidence remains intact.

| Run | Result and disposition |
| --- | --- |
| 2026-10-30 baseline | First use passed until a template fixture skipped required existing-resource review. All 93 Taki / 97 Native source hashes matched when reused on 11-04; this was reuse, not a new run. |
| Journey 1, `2026-11-04T14-15-40.108Z` | Pending recovery's second attempt met the real Bank lease. Fixture now observes the lease before each bounded explicit continuation. |
| Journey 2, `2026-11-04T14-31-26.085Z` | Recovery advanced its application cursor but timed out before all bindings. Bounded operator continuations retain each failed attempt and checkpoint; no product retry added. |
| Journey 3, `2026-11-04T15-29-58.152Z` | Browser waiter accepted an unresolved Promise. Fixture now polls resolved page evaluations; delayed-success and failure checks passed. |
| Journey 4, `2026-11-04T15-35-33.879Z` | Complete first use, actual Home incremental/full sync, pending recovery, restart and all-Bank v2 handoff passed. Backup fixture read before page mount; fixed by waiting for Operations heading. |
| Journey 5, `2026-11-04T15-44-46.928Z` | First use and Home backup/verify passed. Fixture's extra status poll timed out after COMMIT and teardown interrupted finalization; not classified as completed RETURN. |
| Journey 6, `2026-11-04T16-16-03.393Z` | Reproduced product timeout after COMMIT without extra fixture polling. Profile showed the WS burst starvation above. Owned stopped Core/PG retained at `G:/taki-first-use-h4drsP`. |
| Journey 7, `2026-11-04T16-47-37.979Z` | Native terminal-decision/renewal race reproduced independently of lease expiry. Owned stopped evidence retained at `G:/taki-first-use-tbMkJl`. |
| Journey 8, `2026-11-04T17-30-34.760Z` | Three Banks retired, Local ready, queue settled, RETURN completed. Recall succeeded with the exact preserved fact; fixture compared fenced observed text to raw text. Corrected expected representation, retaining missing/duplicate checks. Root `G:/taki-first-use-OhE2nF`. |
| Journey 9, `2026-11-05T06-10-15.964Z` | Profiled run timed out during candidate loading before COMMIT; repeated full template guards and encoding dominated CPU. Codec correction above. Root `G:/taki-first-use-qe9yIq`. |
| Journey 10, `2026-11-05T06-38-19.663Z` | Normal non-profiled RETURN completed in 585.752s, but Home retained timeout/obsolete binding state. Authority max 25.657s, overview 24.031s. Root `G:/taki-first-use-yFkmbG`; exact stopped-copy RPC reproduction isolates the status correction. |
| Journey 11, `2026-11-05T08-05-19.678Z` | First use and RETURN including Home/Local recall/retain passed (step 12: 251.069s). REENTRY durable result completed/ready/settled, but Home authority reached 28.156s and retained errors/old progress; step 13 failed. Root `G:/taki-first-use-mb4lNm`; all owned services exited cleanly, stopped PG retained. |

Journey 12 (`2026-11-05T10-53-57.083Z`, root `G:/taki-first-use-RQ9I7G`) passed through backup and
completed backend RETURN (admitted 11:05:44.819Z, terminal 11:14:01.308Z), with completed transition and
available Local runtime rendered. The new immediate error-text assertion failed while another card was still
refreshing after an earlier 15s timeout. The failure screenshot shows activation refreshing; its subsequently
captured body has already cleared that error. A transition-time authority request did reach 16.797s, so this is
not recorded as a clean no-timeout run. Three final state reads were still outstanding when teardown began.
Core/Native exited 0 without force, no owned listeners/processes remain, stopped PG is retained.

The fixture now waits within the existing 15s read deadline for each card to clear timeout/refreshing text,
rather than asserting absence synchronously after another card completes. It also records all status families
and send timestamps. Product deadlines, requests and error behavior are unchanged.

Journey 13 (`2026-11-05T11-31-53.962Z`, root `G:/taki-first-use-PMTzch`) passed steps 1-12,
including RETURN, Local recall and a new retained memory. Step 13 failed after the Home observer's existing
600-second operation wait. All three Native Banks subsequently have recorded activation outcomes; teardown
sent SIGINT at 12:00:35.404Z, then Core recorded `outcome_unknown` during binding at 12:00:38.688Z. Its durable
result reports runtime ready and queue settled, but this is not a completed resolution: an empty queue alone
does not prove the final settlement path ran. The original failed outcome remains. Core/Native exited 0 without
force, PG stopped, no owned listeners/processes remained, and the generated data was retained.

Continuation session `01a1abc7-4bec-78c2-b97a-1b5699143b96` is bound to this existing task. Both repository HEADs
and all 131 Taki / 97 Native recorded source hashes match journey 13. Diagnosis must separate evidence download,
current template validation, publication/binding and Home request contention before changing production code.
The retained DB was backed up read-only to G: with its source/WAL hashes unchanged. Existing full candidate,
publication and authority readers all passed on that snapshot (2.055s, 1.807s and 1.745s respectively).
Separate current-configuration guard probes took 0.322s/0.199s/0.177s; their profiles attribute almost all guard
cost to complete template components. These microprobes overlapped journey 14's early nontransition work and
are diagnostic evidence, not uncontended performance acceptance. Journey 13 made 727 Native requests during
re-entry, including 259 body descriptor and 259 part requests; each body invokes multiple full guards.

Journey 14 (`2026-11-05T13-07-31.679Z`, root `G:/taki-first-use-VKNKog`) is an unchanged-production controlled
reproduction with the existing Core CPU profiler enabled. Steps 1-12 passed; step 12 took 599.824s including
the Local assertions. Step 13 again exceeded the existing 600-second Home operation wait. Teardown sent SIGINT
at 13:35:15.972Z; the first execution error was `HINDSIGHT_CANCELLED` in candidate preparation immediately
afterward. It is not evidence of an earlier independent state-machine failure. Core/Native exited 0 without
force, PG stopped, refused egress was zero, and the generated fixture remains intact.

The second Core process profile covers restart/reopen/template/backup and both transitions, not re-entry alone.
Of 1278.668s sampled elapsed time, about 838.3s was inside `readHindsightTemplateComponents`; complete history reads
accounted for about 570.9s within that value. Idle samples totalled 251.875s. These are inclusive CPU-stack times,
not additive endpoint durations. Summary: `G:/taki-hindsight-first-use-20261104-checks/journey-14-profile-summary.json`.
The profile supports consolidating repeated history reads within one components invocation. Independent review
requires one synchronous database snapshot and a private reader keyed by the complete Bank identity, reused by
initial history, execution/publication and defaults validation. Requested Bank targets must remain separate from
additional historical dependencies. Every subsequent invocation, network guard, lease and cancellation check stays
independent. No page-size, timeout or cross-await cache change is part of this correction. The original 22,838-byte
complete template state is retained for exact before/after equality.

The four-file correction is implemented and independently reviewed. Original-source regression: 10 cases,
5 passed / 5 failed (duplicate history loads and the absent components read transaction). Corrected regression
plus existing backup consumers and transition scope: 3 files / 20 cases passed. Core typecheck, affected ESLint,
root lint, scoped whitespace and BOM checks passed; the reviewer made no additional source edits. Logs use the
`template-history-reuse-review-*` prefix under the existing G: check directory. This is a focused gate, not a new
full-workspace test claim.

Sequential microdiagnostics, with no other task-owned heavy runner, load the old four HEAD sources with a
task-only Node source hook, then current source without reverting the checkout. Both use the same sealed
journey-13 SQLite snapshot. Old guard
times: 330.348 / 196.193 / 167.524ms; new: 185.439 / 117.016 / 102.161ms. The original saved result, old-source
replay and current output are byte-identical (22,838 bytes, SHA-256
`1a400319e96231551da67677fd616273fed7357c71abd32eac5f01431968e96a`). Files:
`reentry-guard-clean-{before,after}.json` and matching `-components.json`. This establishes equivalent output and
lower per-guard cost on that fixture, not a general latency guarantee.

Journey 15 (`2026-11-05T13-51-32.888Z`, root `G:/taki-first-use-9LeODa`) ran without profiling and retained
the original operator waits/product budgets. RETURN completed from 14:03:24.538Z to 14:08:39.088Z; REENTRY
completed from 14:09:05.536Z to 14:17:08.025Z, both with actual Home completion. Banks/generations and selected
v2 templates/defaults were preserved. These close the original 600-second operation-wait failure on this sample.
They do not close the connected journey: the subsequent copper-compass recall failed with `RPC deadline: run.status`.
Foreground Bank sync remained incomplete at admission, the Run was admitted without memory, and the controlled
model received no memory tools. Its generic reply is not a recall result. Source tracing finds no memory reader
inside `run.status`; ordinary Hindsight request guards repeatedly reconstruct the full transition publication,
and the detached catch-up work remains owned after the admission budget. The copied-instance profile below
attributes the ordinary guard cost without changing admission or shutdown ownership.

RETURN status samples include 3 requests over 15 seconds (maximum 16.719s); REENTRY includes 23 (maximum 43.266s).
All sampled requests eventually returned, and Home's completion assertions passed, but this is not clean latency
acceptance. Original `run.status` failure and forced Core cleanup remain recorded: Core did not answer the existing
stop probe/deadline and was terminated; Native exited 0 without force, PG stopped, and no explicitly owned PIDs or
listeners remained. Four other newly observed Node processes were not established as owned and were not touched.

The first fresh copied-instance replay (`G:/taki-post-reentry-mb5At6/replay-result.json`) reproduced `product-failed`.
Admission took 57,273ms; `chat.complete` arrived at 81,586ms with generic text and no memory tools. The subsequent
original 60-second `run.status` deadline expired (141,589ms total). Zero memory tool results is a failed recall, not
an empty memory search. A separately saved 60.522-second profile contains 35,420 samples: selection reads appear in
94.5%, candidate verification in 92.3%, runtime `checkConnection` in 90.2% and `loadVerified` in 71.7% of inclusive
stacks. These overlapping percentages are not additive. Native received only four health/version requests.

The replay used a stopped PG copy and a SQLite backup of copied DB/WAL files opened read-only. All 1,690 original
fixture Core/credential/PG file hashes remained unchanged. Core required SIGTERM after the existing shutdown probe
failed; Native exited 0, clone PG stopped and remained retained, and all 13 owned PIDs/five listeners were gone.
The task-only diagnostic and optional loopback inspector port introduce no production debug configuration.

The independently challenged correction generalizes the existing publication artifact verifier for one private
instance per runtime connection. Every call still reruns full publication/current-state joins in a synchronous
SQLite read snapshot and compares actual native evidence identity/bytes. Only immutable verification and pure
projection computation survive reads; no selection, readiness or permission verdict is retained. Status owns a
separate instance. Direct COMMIT/bind/boot and emergency reconstruction remain independent. This intentionally
replaces the old status-only code-spec restriction, at the cost of retaining one current artifact set per active
connection until reset/stop. The implementation and independent source review passed. Two original duplicate-work
assertions failed before the change. Current passing evidence covers 10 files / 78 tests: eight unchanged passing
files (64 cases) from `related-tests.log`, the corrected runtime's seven strict cases in
`final-corrected-tests.log`, and seven template cases in `template-final.log`. Final Core typecheck and affected
ESLint passed (`typecheck-final.log`, `lint-final.log`), under `G:/taki-runtime-verifier-checks/`.

Review corrected the new corruption fixtures before accepting their evidence: a raw SAVEPOINT bypassed the Database
wrapper's transaction depth and could let broad exception assertions pass for an unrelated nesting error; deleting
referenced template rows also failed on the FK before reaching the target guard. The final cases use wrapper-owned
transactions, preserve references and require the original precise integrity errors. Some inherited observation/status
negative tests still have this construction limitation and are not used as evidence for the newly exercised guards.
No production transaction change was required.

The corrected-source fresh-copy replay (`G:/taki-post-reentry-scKZrI/replay-result.json`) still failed. Admission took
155,351ms and the Run completed at 299,506ms. A real Hindsight memory tool was present with the correct epoch, but
returned no hits and `partial: true`: Global reported `MEMORY_INTERNAL_ERROR`, Character reported
`MEMORY_PROVIDER_UNAVAILABLE`. This is a failed recall. Unlike the earlier sample, it entered memory assembly and
tool execution, so the two wall times do not measure equivalent work. `run.status` returned, but Core still required
SIGTERM; Native exited 0, PG stopped, all 13 owned PIDs/five ports cleared, and the original 1,690 file hashes were
unchanged. The replay records all current modified/untracked production source hashes, including newly changed files.

The saved 60.435-second profile (35,273 samples) no longer has `loadVerified` among its top memory frames, but
`checkConnection` remains in 95.1% of inclusive stacks. Synchronous `captureHindsightRuntimeRows` / assembly accounts
for 70.9%; native evidence reads account for 25.2%, `transitionLocalHash` 19.6% and template identity reads 9.9%.
The per-record replica reads repeatedly resolve Bank scope through the full connection guard. Existing guarded
scope callbacks also protect asynchronous synchronization/publication and cannot be globally replaced by pure routing.
The next narrowly challenged change is a coherent, synchronous runtime-row snapshot with locally captured Bank
routing; the shared runtime replica and every independent/await boundary remain guarded. A task-only error-adapter
trace will capture closed failure codes and stack frames on the next copied replay to identify any surviving branch
failure without changing its public category. The complete connected journey waits for an actual recall/cleanup pass.

The runtime-row regression reproduces multiplicative current validation through the real `selected` reader:
one record causes 11 calls and 16 records cause 86 calls (`G:/taki-runtime-row-checks/red.log`). The policy case
passes before the change. The narrow correction uses a function-local instance of the existing replica factory
inside the same read transaction as the complete route guard; no shared reader, sync guard or writer is replaced.
Green checks confirm one real complete `selected` call per capture for both sizes and for completed REENTRY, a
fresh call on the next capture, and all SQL reads inside the enclosing transaction. Related passing evidence now
covers five files / 66 tests: four existing files / 62 cases from `related-tests.log` and the final four strict
runtime-row cases from `final-regression.log`. A body-corruption setup initially failed the SQLite byte-length
CHECK before reaching its target; the final fixture preserves byte length and checks the actual body integrity error.
Core typecheck and affected ESLint pass (`typecheck.log`, `lint.log`), and independent source review found no
production defect in the final local-reader change. The task-only provider failure trace also passed its isolated
adapter self-check without changing the existing public error category.

The next fresh-copy replay (`G:/taki-post-reentry-KJ9FvO/replay-result.json`) still failed: admission improved to
19,266ms, chat completion arrived at 171,356ms, and Run status completed at 172,019ms. Its real memory tool again
returned no hits and `partial: true`. Exact task-only tracing identifies `HINDSIGHT_REPLICA_LEASE_LOST` at the first
binding `input.request()` after `await writer.run()`, before inspecting that command's result. This can cover an
earlier command timeout/pending result. Other traces show `HINDSIGHT_TIMEOUT` in body-transfer/write context.
The error alone does not distinguish an expired, released or replaced lease; the failure-time row was not captured.
Core still required SIGTERM; Native exited 0, PG stopped, all 13 owned PIDs/five ports cleared, and the original
1,690 source file hashes remained unchanged. Native recall was never called, so this is not evidence of a Native
recall-engine defect. Current automated/source passes have not yet delivered the complete usable path.

The 60.510-second profile (36,100 samples; `full-frame-summary.json`) confirms row capture is down to 3.4% of
inclusive samples, while `checkConnection` remains at 93.4%. `requestContext` accounts for 48.1%, split between
`publicationGuard` (24.1%) and the foreground owner's second connection check (24.0%). Immutable document reads
account for 29.0%, Local capture validation 20.2%, candidate validation 15.6%, and native evidence reads 25.5%.
These overlapping stack shares are not additive. The next correction must address common validation cost and
responsibility, retaining current guards and original deadlines rather than adding more per-consumer snapshots.

Git provenance was checked after the owner asked whether this was a Native defect or an integration regression.
Commit `fe0e5f6881d1617c1637f452d4af65ca951881e2` (2026-10-18) added the full
`readMemoryAuthoritySelection(input.db)` call to each connection guard. The request's two guards and foreground
lease design already existed in `588e13ed` (2026-09-19); the sync runner, binding runner and Bank service are still
unchanged from HEAD. Thus an expensive full-history reader was attached to an already repeated guard path.
This locates the integration-side wiring, not the unique first-bad commit: no historical bisect on a last-known-good
build has been completed. Before the current performance corrections, the same retained fixture already failed.

Journey 8's verified v2 pair `d68c0d70-c8dc-4eda-9762-b0718a5d4f49` was independently restored on 11-05:
`G:/taki-first-use-OhE2nF/paired-restore-knrZbV/result.json`. All 61 Native backup tables and trigger modes
match the archive; current authenticated Core preflight verifies three Banks at head 060, with all five candidate
tables empty. The current source had legitimately advanced after capture; equality is against the archived
point in time, and the source is separately proved unchanged. Core writers never started. Preserved pair/catalog
hashes match; temporary restore DB dropped, Native exit 0 without force, PG stopped, refused egress 0.
This establishes the isolated D91 procedure, not restoration or activation of the owner's actual database.

## Current Hindsight status diagnosis (2026-11-05)

Production changes are frozen while tracing the complete page, as the owner requested. The existing six-RPC
probe was useful but did not include configuration status or the actual initial ordering of Home requests.
Passing that probe alone does not establish Home usability.

| Actual caller | Current synchronous chain | Observed implication |
| --- | --- | --- |
| Main authority card | useMemoryOperations -> authority.status -> driftReason, explicit assertConnection, banks, scheduler.status -> runtime.banks | Four full current publication checks per response before the provisional scoped-context correction. |
| Template card | TemplatesController.read -> Promise.all(template.status, authority.status) | A second authority request is intentional in the current separate controller; it is not a spontaneous retry. |
| Template status | readTemplateStatus -> boundSelectionIdentity -> runtime.assertConnection | Full independent publication verification remains. An existing current-epoch plan can additionally run recovery admission; this re-entry fixture has no current plan. |
| Configuration status | configuration service status -> capture -> readHindsightConfigurationContext -> readMemoryAuthoritySelection | Full independent publication verification, without a Native request. |
| Transition/onboarding/activation | Existing observer / freshly observed selection; current projection reads | Much less CPU in this captured page; delayed replies alone do not identify these as expensive handlers. |

Stopped-copy actual-main reproduction (`home-hindsight-status-before.json`) uses no Native/model/network calls,
preserves source hashes and exits cleanly. Both six-request bursts exceeded 15s. CPU samples locate repeated
native evidence decoding, schema/hash verification and Bank projection below the publication reader.
A provisional four-file correction shares one existing independent TransitionEvidenceContext only within one
authority status invocation. It preserves each current guard and byte reread, defaults and expiry; it reduced
the warm six-request burst to 9.35s. The cold 13.33s run briefly overlapped an interrupted tsc, so it is not a
clean timing comparison. That provisional delta was superseded by the final projection below; its four-guard implementation and test requirements were removed.

The full Home probe still failed (`home-hindsight-page-after.json`, root `G:/taki-first-use-status-AF3dGD`):
configuration response 3.156s, template 9.344s, authority 14.937s and 20.453s, activation 21s, overview 22.172s.
These are cumulative response latencies, not each handler's CPU cost. A subsequent full-page CPU profile
(`home-hindsight-page-profile.json`, root `G:/taki-first-use-status-45e2HA`) attributes aggregate handler samples
(initial load plus partial reconnect) to authority 10.735s, template 6.550s, configuration 4.395s, overview 0.808s,
onboarding 0.373s and activation 0.300s. No Native/model or socket egress occurred. Its diagnostic reported PASS
prematurely because reconnect reused a visible old button and did not await all pending responses; it is explicitly
not acceptance. The diagnostic now waits for all six status families and checks the resulting DOM for errors.

The operation read facade is not uniformly pure: operations.list/status/latest can refresh an open producer and
persist/publish its settlement. Do not inject an observation context around the entire RPC or allow it into that
path. In the current onboarding/activation families only observeBoot exists, but the general owner must retain
its independent verification. Configuration capture can invalidate its in-memory observation; it does not mutate
authority. The corrected complete-page diagnostic (`home-hindsight-page-settled.json`, root
`G:/taki-first-use-status-sqYMLb`) reproduced the timeout after all responses settled: first/second authority
15.062s/20.687s, activation 21.234s, overview 22.390s. This was a normal unprofiled run with no competing check
started by this session. Source hashes unchanged, no external calls and clean exit.

Per-handler CPU attribution narrows the optimization point: configuration 4.395s total / 4.384s in independent
publication reads; template 6.550s / 4.050s independent plus 2.424s observed selection, with only 0.064s in template
identity checks; authority 10.735s / 9.101s independent publication reads and 1.074s observed selection, with
0.432s in template identity checks. Times aggregate the captured initial load and partial reconnect; they are not
individual RPC timings or wall-clock performance guarantees. The frontend duplicate authority request amplifies
this common backend cost. No backend optimization should silently discard template/configuration, settlement or
current integrity behavior to meet a page deadline.

The final implementation replaces the provisional independent-context plumbing with a dedicated read-only
runtime projection through the existing observer. Connection checks share their original guard helper;
scheduler status reuses its existing Bank validation/order/checkpoint projection. The read transaction ends
before operation settlement. Configuration status supplies a captured view to the same original service/cache;
network observation still captures independently before/after awaits. Template status supplies only its observed
selection and bound identity to shared recovery/local-plan checks; actual recovery and producer defaults remain
independent. No new store, global context, deadline change or frontend request consolidation was added.

The complete Home check now passes (`home-hindsight-page-projection.json`, root
`G:/taki-first-use-status-gCfHgc`): all status requests settle on initial open and reconnection, the page renders
available runtime/completed re-entry/no active operation without errors. Cold max RPC 7.093s; warm max 4.031s.
The transition fixture now explicitly waits up to the existing 15s status RPC deadline for rendered completion,
instead of Playwright's unrelated implicit 5s. Product deadlines and timeout/error-DOM failures remain unchanged.
Overall page readiness including first Vite load is 10.515s; reconnect check including its 1.5s observation pause
is 5.625s. Source hashes unchanged, no Native/model/network calls, Core exits 0 without force. This validates the
stopped-copy UI/status seam; a fresh connected transition/emergency journey is still required.

Review identified one status-semantic regression before delivery: a corrupt scheduler/Pending projection must
make authority unavailable without erasing a successful template binding identity. The connection observation
is now preserved separately from subsequent evidence-read failure; actual recovery admission always kept its
independent guard. The concrete malformed scheduler-row regression is included in the integrated checks. Final independent source review found no remaining blocker; Core typecheck and affected ESLint pass.

## Checks and reproducible commands

Check logs are under `G:/taki-hindsight-first-use-20261104-checks/`.

| Gate | Actual result |
| --- | --- |
| Workspace types / root lint | Passed after WS/renewal corrections. After the codec/status changes, Shared checks, final Core typecheck and affected ESLint pass (`status-projection-typecheck-corrected.log`, `status-projection-final-eslint.log`). |
| Shared | Latest full result: 72 files, 679 tests passed after codec changes. |
| Core | 533 original files have passing evidence composed from 521 initially passing, 11 corrected files (88 tests) and the interrupted 26-case template-transition file completed alone in 2,759.81s. Later affected codec/WS/renewal checks pass. Latest integrated status projection regression: 16 files / 158 tests passed in 115.55s (`status-projection-tests.log`), including configuration, template status/rollout/recovery/provision, runtime/scheduler, observation/boot and onboarding/activation. This is not a fresh full-suite PASS. |
| Desktop / CLI | Desktop's initial 749 passes plus corrected isolated-cache browser rerun establish all 750 cases; CLI 47 passed. Frontend build passed to G: (existing chunk-size warning). Actual Tauri owner acceptance is open. |
| Hindsight Host | All 87 runnable cases have passing results across full run + unchanged isolated rerun; one platform case skipped. No clean full-suite rerun is claimed. Rust adapter built on G:; test registry fixtures use the current revision and fixture stdin closes on top-level failure. D94 retains the resident-startup cleanup question. |
| Actual main status burst | `home-status-before.json` and `home-status-after.json`: real registered six-RPC cold/warm bursts on a stopped Local copy, source unchanged, no provider calls or refused egress, clean exit. |
| Independent current pair restore | `retained-pair-result.json`: passed as described above. The task-only adapter is not a new operator restore feature. |

The original Core worker interruption was an investigation mistake: sustained CPU alone did not prove a hang.
The existing multi-minute template-transition file was rerun to completion under unchanged budgets; original
failure logs remain. Test-baseline corrections update omitted additive migration 060, initialized governance
revision and semantic import prohibitions; they preserve history, generation/conflict and corruption assertions.

```powershell
$env:TEMP = 'G:/taki-hindsight-first-use-20261104-checks'
$env:TMP = $env:TEMP
node .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs --with-transitions --retain-on-failure
pnpm --filter @taki/core exec vitest run src/memory/operations/memory-status-observer.test.ts src/db/memory-transition-observation.test.ts src/boot/memory-transition-boot.test.ts --maxWorkers=1
pnpm --filter @taki/core typecheck
```

The final independent Astra integrated source review found no new blocking defect in the production
corrections. It checked the actual call boundaries, SQL snapshot, binding/hold/stop projection, exact renewal
proof and installed ws implementation. It ran no tests or services. Earlier first-use and per-fix reviews
also found no blockers within their stated scope; none substitutes for the connected Home results.

## Existing-instance operating guide

These are the actual Home controls exercised by this journey. Original-data activation still requires its own
paired backup and explicit owner authorization; a generated fixture pair cannot protect the owner's database.

1. Open Home's Settings page. Save the instance key in **Hindsight API Key**; the input clears after saving and
   only presence is shown. Set `TAKI_HINDSIGHT_ENDPOINT` and enable `TAKI_HINDSIGHT_ENABLED` in the existing settings.
2. In Operations, use **Validate connection** (`校验连接`), then **Apply configuration** (`应用配置`). Inspect the
   compatible build and Bank identities before **Enable Hindsight** (`启用 Hindsight`). An existing-instance
   connection does not install the server or apply its model configuration; model observation may remain unknown.
3. Initial setup uses the supported v1 initialization. For the explicit v2 handoff, open the template card,
   preview the change, inspect each existing Bank resource and choose its actual existing directive when requested.
   Preview again, review the before-values and identities, confirm enrollment, then apply. Do not change the legacy
   setup revision field to bypass this path. Selected template state and future Bank defaults are distinct.
4. Use ordinary chat retain/recall. In each Bank's synchronization controls, choose automatic or manual mode and
   save its intervals. **Sync now** (`立即同步`) and **Full reconciliation** (`完整对账`) create observed operations;
   wait for their actual result. Manual mode needs an explicit continuation for remaining writes; an operation
   timeout is a failed attempt, not proof of lost writes or a completed synchronization.
5. Use **Create backup** and **Verify backup** before a real transition. Keep both the sealed Core copy/manifest
   and the matching Native ZIP with credential custody. Route c requires the Native administrator to enable its
   backup endpoint/directory. The existing operator-artifact route remains available when it is disabled.
6. Preview **Return Local** or **Re-enter Hindsight**, review the expected identity and confirm once. Emergency
   takeover has a separate preview/confirmation and can omit unreplicated remote changes; its incident snapshot is
   explicitly not a full backup. Offline restore follows the existing D91 procedure with writers stopped and a new
   isolated target. The task's fixture adapter is not an operator restore feature.

## Remaining owner/environment observations

No owner-only item is marked accepted. Once the machine journey passes, present the existing four D89 observations
together: actual Tauri appearance/click-through; real key entry and Windows catalog-master-key ownership; the exact
real-instance activation after its own paired backup; and subjective recall quality with the identified real model.
Controlled providers, browser screenshots and read-only secret presence cannot supply these judgments. Managed
installation, complete configuration/model application, candidate upgrades and the remaining platform/fault matrix
stay open under D94-D96; this report does not close the parent task.
