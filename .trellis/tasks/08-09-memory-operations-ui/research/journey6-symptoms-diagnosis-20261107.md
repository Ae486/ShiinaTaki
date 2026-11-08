## 1. Outcome — done: read-only diagnosis

**F4 delivered batching, but did not eliminate the re-entry timeout defect.** Global committed all twenty new Memory bindings; its first attempt expired while publishing the final change event locally. Taki then used its own 60-second execution budget, confirmed its Native Pending child, and timed out before completing the parent write. The five-minute retry policy amplified that small remaining workload into the 296-second Pending wait. [run artifact `G:/taki-first-use-0E2IXk/core-data/taki.db`] [source `packages/core/src/db/hindsight-replica-schedule-state.ts:76`]

Steps 12 and 13 are predominantly complete transition-evidence work, outside F4’s binding loop. The policy review’s invalid result is attributable to the controlled provider; its deferred publication also encountered real catch-up contention. Passing all seventeen steps therefore demonstrates eventual recovery, not absence of the reported defects. [run artifact `.trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-06T23-23-56.469Z/result.json`]

## 2. Changes

None. No files, databases, configuration, task records or services were modified. No services were started.

The report is returned here. File output was unavailable because this session permits only reads and no `-o` destination was supplied.

## 3. Evidence and checks run

Evidence abbreviations below:

- **R6:** `.trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-06T23-23-56.469Z/`
- **DB6:** `G:/taki-first-use-0E2IXk/core-data/taki.db`
- Native log timestamps are UTC+8; the timelines below use UTC.

Checks performed:

- `git branch --show-current`: `main`. Read-only status inspection found **426** inherited changed paths; preserved.
- `jbcontext search` located the synchronization owners; subsequent investigation used direct reads and focused `rg`.
- Python parsed the four supplied result sets, Native/Core logs, provider records and retained Home RPC timings.
- SQLite connections used exclusively `sqlite3.connect('file:G:/taki-first-use-0E2IXk/core-data/taki.db?mode=ro', uri=True)` and were closed.
- Compared available run-6 recorded hashes for the binding runner/collector, scheduler, schedule policy, Pending recovery, Bank service and Native label-evidence/storage files: all matched current files.
- No Vitest, service replay or model calls were run.

**Q1. Why Global still exceeded 60 seconds**

The actual workload was **one Source association followed by Memory batches of `8 + 8 + 4`**. All four binding commits completed remotely. There was also one concurrent curator assessment commit; it must not be counted as an F4 binding batch. [run artifact DB6, `hindsight_application_command_jobs`]

Approximate wall-time budget, using the durable job timestamps and timestamped Native GET boundaries:

| Phase | Preparation, including labels | Upload through locally recorded receipt | Following pull/publication | Total |
|---|---:|---:|---:|---:|
| Initial catch-up and Source-proof preparation | — | — | — | **22.73 s** |
| Source association and following pull | — | **0.79 s** | Included in total | **4.66 s** |
| First eight Memories | **5.31 s** | **1.56 s** | **6.65 s** | **13.51 s** |
| Next eight Memories | **4.91 s** | **1.60 s** | **4.99 s** | **11.50 s** |
| Last four Memories; interrupted publication | **3.65 s** | **0.80 s** | **3.19 s** | **7.64 s** |
| **First attempt** | | | | **60.04 s** |

The boundaries between preparation and the previous body read are approximate: Native access completions lack timestamps, while the adjacent warning lines carry request-entry timestamps. These are wall-time partitions, not CPU measurements. [run artifact DB6] [source R6/native.log:13164] [source R6/native.log:13357] [source R6/native.log:13403] [source R6/native.log:13480] [source R6/native.log:13541]

Actual request counts:

| Request class | Eight-Memory batch | Four-Memory batch | All twenty Memories |
|---|---:|---:|---:|
| Label-evidence POSTs | 8 | 4 | **20** |
| Body creates: artifacts plus command envelope | 9 | 5 | **23** |
| Part PUTs | 9 | 5 | **23** |
| Body seals | 9 | 5 | **23** |
| Commits | 1 | 1 | **3** |
| Body descriptor GETs | 9 | 5 | **23** |
| Body part GETs | 9 | 5 | **23** |
| Changes-list pulls | 1 | 1 | **3** |
| Change-page pulls | 1 | 1 | **3** |
| **Total** | **56** | **32** | **144** |

Each receipt contributes one descriptor/part pair; the remaining pairs download the just-uploaded Memory bodies. All these bodies were single-part. The initial catch-up additionally read fourteen change pages and thirty-three body/part pairs, excluding the concurrent curator receipt. The Source phase also pulled the curator’s newly committed event. [source R6/native.log:13165] [source R6/native.log:13336] [source R6/native.log:13362] [source R6/native.log:13439] [source R6/native.log:13515]

What can be separated between Core and Native:

- Core still collects labels individually, uploads bodies sequentially, then requires complete pull/publication after each batch. Those orchestration choices are directly established. [source `packages/core/src/memory/hindsight/hindsight-application-binding-runner.ts:101`] [source `packages/core/src/memory/hindsight/hindsight-application-command-runner.ts:70`]
- The three Memory commits reached Native’s `completed_at` approximately **120, 124 and 119 ms after Core’s dispatch markers**. Their complete upload/receipt phases took only **1.56, 1.60 and 0.80 seconds**. Commit execution was not the dominant delay. [run artifact DB6]
- **UNKNOWN:** exact aggregate Native HTTP time versus Core CPU. Neither the access log nor the command journal records complete request-duration spans. Preparation and pull remainders include Core verification/publication, transport and Native processing; assigning all of them to either side would overstate the evidence.
- Native consolidation was already complete before this attempt. It does not explain the sixty-second binding window. [source R6/native.log:13023] [source R6/native.log:13157]

At **23:47:21.001**, Native had completed the last batch at state cursor **148**. Core fetched event 148 and its bodies, but retained checkpoint **147** when the deadline fired. Its next attempt pulled event 148 without another binding commit or body download. [run artifact DB6] [source R6/native.log:13541] [source R6/native.log:13948]

**F4’s batching effect succeeded:** the measured 144 requests match the earlier estimate, versus approximately 280 for twenty individual Memory passes. **Its deadline outcome failed:** initial catch-up, individual labels and local publication still consumed the budget. The earlier F4 report itself estimated **50–70 seconds**, explicitly without proving a sub-60-second result. [source `.trellis/tasks/08-09-memory-operations-ui/research/reentry-catchup-f4-20261107.md:227`]

**Q2. Why Taki failed almost exactly sixty seconds later**

This is **scheduler serialization followed by a separate execution deadline**, not one request hanging for sixty seconds.

| Event | UTC |
|---|---|
| Global first attempt claimed | 23:46:24.396 |
| Global failure logged | 23:47:24.439 |
| Taki’s execution window begins | Approximately 23:47:24.464 |
| Taki last binding receipt recorded | 23:48:18.478 |
| Taki Native Pending child completed | 23:48:24.135 |
| Taki timeout logged | 23:48:24.464 |

[source R6/core-2.log:31] [source R6/core-2.log:32] [run artifact DB6]

The scheduler awaits each Bank sequentially. Its execution wrapper starts a fresh timer after claim; that timer emits `HINDSIGHT_TIMEOUT`. Global instead reached an internal deadline guard first, producing `HINDSIGHT_DEADLINE_EXCEEDED`. These are two reporting paths for exhaustion of the same execution budget. [source `packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:209`] [source `packages/core/src/memory/hindsight/hindsight-replica-run-execution.ts:29`] [source `packages/core/src/memory/hindsight/hindsight-application-sync-runner.ts:86`]

During Taki’s minute it performed:

- Fourteen initial change-page reads and thirty-three body/part pairs.
- One Source association.
- Twenty Memory bindings in `8 + 8 + 4` batches.
- Native-result status/page retrieval, another pull, and factual child confirmation.

[source R6/native.log:13561] [source R6/native.log:13723] [source R6/native.log:13743] [source R6/native.log:13941]

**UNKNOWN:** the exact stack frame interrupted after child confirmation. The evidence establishes that the parent was unfinished; it does not distinguish the final recovery checks from the beginning of parent completion.

Global’s second explicit request was queued at **23:47:28.242**, claimed at **23:48:24.509**, and succeeded at **23:48:30.958**. Thus roughly **56 seconds** of its retry were queue waiting; actual retry execution was **6.45 seconds**. [run artifact DB6, `hindsight_replica_manual_requests`]

“Scheduled synchronization failed” is a generic logger used for every scheduler claim, including manual requests. Global’s run ID matches its explicit request. Taki has no matching manual request; it was automatic work. Its exact historical trigger field is **UNKNOWN**, because its latest schedule row subsequently changed. [source `packages/core/src/memory/hindsight/hindsight-replica-run-execution.ts:69`] [run artifact DB6]

**Q3. What caused the 296-second Pending wait**

The wait was for **parent-write settlement**, not unfinished Native extraction.

- Taki’s child became `completed` at **23:48:24.135**.
- Its parent remained unfinished until **23:53:26.952**.
- The next automatic Bank attempt started at **23:53:24.559** and succeeded at **23:53:27.046**.
- That retry needed only a changes read and the original Native-result reference page; it performed no additional binding commits.

[run artifact DB6, `pending_memory`, `hindsight_memory_write_intents`, `hindsight_replica_sync_schedule`] [source R6/native.log:13973]

The retry decision is:

1. A foreground Pending result hands recovery to `requestRetry()`, using the child’s due time or the first sixty-second delay.
2. `requestReplicaRetry()` sets `retryAttempt` to at least **1**.
3. The subsequent failed scheduled attempt increments it to **2**.
4. Delay index 2 is **five minutes**.
5. The future retry suppresses ordinary interval wakes.

[source `packages/core/src/memory/hindsight/hindsight-memory-writes.ts:46`] [source `packages/core/src/db/hindsight-replica-schedule-state.ts:68`] [source `packages/core/src/db/hindsight-replica-schedule-state.ts:76`] [source `packages/shared/src/memory-replica-schedule-schema.ts:17`]

That predicts **23:53:24.464**, matching the observed claim within approximately 95 ms. Waiting began after Global’s completion around 23:48:31, so the remaining backoff plus short recovery produces the recorded **296.162 seconds**. [run artifact R6/result.json] [run artifact DB6]

**Judgment:** the five-minute delay follows the existing contract; it is not a separate incorrect timer. However, ordinary catch-up exhausting its budget and leaving a nearly finished write visibly pending is a **phase-1 defect** under the supplied acceptance rule. Shortening backoff alone would conceal its cause. Native-child completion also cannot simply be treated as parent success: original result references and required application effects still need verification. [source `.trellis/spec/backend/memory-replica-sync.md:126`] [source `.trellis/spec/backend/hindsight-application-runtime.md:183`]

Home would show, by code projection:

- Taki’s `HINDSIGHT_TIMEOUT`, previous successful-sync time, and automatic retry due time.
- **`0 待写 / 0 失败 / 0 未知 / 1 父写`** for this remaining parent.
- “Automatic retry scheduled” and an available Sync-now action when otherwise unlocked.
- Global’s error cleared after its successful retry.

This is a source-derived reconstruction; no screenshot captured that precise interval. [source `apps/desktop/src/windows/home/pages/operations/memory-authority-state.ts:75`] [source `apps/desktop/src/windows/home/pages/operations/memory-authority-card.tsx:59`]

**Q4. Why steps 12 and 13 barely changed**

The following partitions avoid counting harness waiting and operation execution twice:

| Wall-time component | Step 12 | Step 13 |
|---|---:|---:|
| Durable transition operation | **323.033 s — 98.56%** | **386.591 s — 80.46%** |
| Subsequent chat work | **0.481 s — 0.15%** | **83.120 s — 17.30%** |
| Remaining setup, status, rendering and observation | **4.228 s — 1.29%** | **10.751 s — 2.24%** |
| **Total** | **327.742 s** | **480.462 s** |

[run artifact R6/result.json] [run artifact DB6, `memory_operations`]

Inside the transition operations:

| Measured window | Step 12 | Step 13 |
|---|---:|---:|
| Application-body request windows, all Banks | **≈218.31 s — 66.61% of step** | **≈255.23 s — 53.12%** |
| Verification dispatch → received Native proof, all Banks | **42.93 s — 13.10%** | **41.23 s — 8.58%** |
| Remaining transition work | **≈61.80 s** | **≈90.13 s** |

Body windows include intervening Core verification and executor-renewal work, not exclusively socket waiting. Verification windows include consolidation, Reflect and proof construction; their exact internal split is **UNKNOWN**. [run artifact DB6, `memory_transition_native_verifications`, `memory_transition_native_observations`] [source R6/native.log:8618] [source R6/native.log:9225] [source R6/native.log:10368] [source R6/native.log:11099]

The body-read volume explains the dominant windows:

- Step 12: **324 bodies / 648 GETs**. Global’s body window alone spans approximately **159.37 seconds**; Mika’s spans **55.16 seconds**.
- Step 13 transition: **375 bodies / 750 GETs**. Global spans approximately **188.64 seconds**; Mika **62.81 seconds**.
- Step 13 overall: **503 bodies / 1,006 GETs**, including later recall/binding reads.
- Native snapshots use **one record per page**, producing another **98 / 103 snapshot-page GETs** in steps 12 / 13.

[source R6/native.log:8618] [source R6/native.log:10184] [source R6/native.log:10368] [source R6/native.log:12217] [run artifact R6/result.json] [run artifact DB6, retained transition proofs]

The transition loader downloads complete retained proof closure without a body-cache callback. It does not invoke the F4 binding collector. [source `packages/core/src/memory/transitions/transition-native-loader.ts:17`]

Step 13’s **83.12-second chat** includes admission catch-up, context recall before the first main-model request, and the model-requested recall. Native records four recall calls and two hydration bundles. Hydration also omits the available body-cache callback. F4 appears only in the small post-transition binding tail: **one two-Memory batch**, rather than three individual commits in run 5. [source R6/native.log:12261] [source R6/native.log:12325] [source R6/native.log:12714] [source `packages/core/src/memory/hindsight/hindsight-memory-recall.ts:64`] [run artifact R6/provider-requests.json]

Model attribution:

- Native Reflect logged approximately **0.392 seconds** of LLM time in step 12 and **0.373 seconds** in step 13.
- The external smoke provider has request timestamps but no completion spans. Its exact time fraction is **UNKNOWN**; the long gaps between requests include actual memory work and must not be labelled model inference.
- Native consolidation runs within the verification windows. No separate ingestion-extraction window comparable to step 14 is established for these steps.

[source R6/native.log:8587] [source R6/native.log:9148] [source R6/native.log:10337] [source R6/native.log:11020] [run artifact R6/provider-requests.json]

Harness attribution:

- `wait_operation()` observes the operation subscription every 250 ms; it does not deliberately sleep for hundreds of seconds or repeatedly invoke full authority RPCs.
- Home recorded **145 / 192 RPCs**, all with `rpcError:null`. Their overlapping in-flight unions were **26.262 / 40.376 seconds**; these overlap transition execution and are not additive harness overhead.
- Exact causal slowdown from Home reads is **UNKNOWN** without a comparison run.

[source `.trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/home-check.py:58`] [run artifact `G:/taki-first-use-0E2IXk/home-return-local-uKcuiB/rpc-timings.json`] [run artifact `G:/taki-first-use-0E2IXk/home-reenter-hindsight-bIVUR9/rpc-timings.json`]

**Top two sinks:** step 12—complete transition body closure, then Native verification/maintenance; step 13—complete transition body closure, then post-transition recall. F4 does not address the dominant transition work.

**Q5. Is policy review failure a smoke artifact?**

**The invalid model result is a smoke-provider artifact. The deferred publication is real contention.**

Provider request **42**, at **23:46:20.457**, received the policy tools but returned only `"Hello from the smoke model."` It supplied no assessment or Block result. The curator correctly saves `invalid_result` for policy targets without results and defers the unfinished Block. [run artifact R6/provider-requests.json] [source `packages/core/src/memory/hindsight/hindsight-policy-curator-execution.ts:38`]

DB6 contains exactly:

- **Ten** saved `assessment-failure` results with `failure: invalid_result`, subsequently marked `publication_pending`.
- **One** deferred Block with `last_failure: invalid_result`.

This accounts for the logged **eleven pending**. They are curator work items, distinct from the Native Pending child and parent write discussed above. [run artifact DB6, `hindsight_policy_work`]

One assessment command committed at state 144, but curator completion also awaits refresh and local application. That refresh shares the Bank service with catch-up; failures retain saved proposals and increment the pending outcome. [source `packages/core/src/memory/hindsight/hindsight-policy-curator-publication.ts:31`] [source `packages/core/src/memory/hindsight/hindsight-policy-curator-publication.ts:73`]

Do not change the product to accept plain text as successful policy review. Correct the controlled provider’s policy-tool responses for that acceptance path, while retaining malformed-output failure coverage separately. [inference]

**Q6. Smallest corrections, ranked**

| Rank | Correction | Classification | Benefit / change size | Phase |
|---|---|---|---|---|
| 1 | Fetch label evidence for each existing binding batch in one request; preserve exact per-unit checks and selected-group consistency. | **Taki patch** | Small, focused change; reduces **20 evidence requests to 3** and repeated preparation overhead. Native already accepts multiple units. Exact time saving remains unmeasured. | **First phase-1 correction to validate** |
| 2 | Reuse exact immutable bodies already held by the command outbox when the following event needs them. Preserve complete event validation/publication. | **Taki patch** | Removes **40 own-body GETs** for these twenty Memories. Modest implementation scope; addresses remaining pull cost. | Phase 1 if needed to obtain reliable completion within the current budget |
| 3 | Make the controlled provider produce valid policy assessment/finish tool results. | **Taki harness patch** | Small; removes this fixture-induced policy failure without weakening product semantics. | Phase-1 evidence correction |
| 4 | Reuse verified immutable bodies in transition and recall loaders; reduce one-record snapshot paging where supported. | **Taki patch / upstream Hindsight design respectively** | Targets the hundreds of seconds in steps 12–13; broader validation and paging work. | Phase 2, where behavior remains successful |
| 5 | Parallelize independent Bank processing only after reviewing the existing all-Bank single-worker contract. | **Taki design change** | Can remove queue latency, including Global’s 56-second retry wait; does not independently fix a Bank exceeding its own deadline. | Phase 2 |

[source `packages/core/src/memory/hindsight/hindsight-template-label-evidence.ts:36`] [source `H:/hindsight/hindsight-api-slim/hindsight_api/engine/template_label_evidence.py:66`] [source `packages/core/src/memory/hindsight/hindsight-application-bundle-loader.ts:124`] [source `.trellis/spec/backend/memory-replica-sync.md:130`]

**Recommended sequence:** implement rank 1, then rerun the existing connected journey with unchanged deadlines and explicit assertions against these errors. Add rank 2 if the first correction leaves insufficient margin. The evidence supports these as the smallest candidates; it does **not** establish an unmeasured performance guarantee. [inference]

Before phase 1 closes, Global and Taki must complete this ordinary re-entry drain without the timeout failures and prolonged unfinished parent. The smoke fixture’s invalid policy result must also be separated from successful policy acceptance. Pure transition speed work can remain phase 2 if it produces no failure or unstable UI result.

I do **not** recommend raising deadlines or shortening backoff as the first correction. Neither removes the repeated work. If the bounded catch-up still cannot finish after those reductions, progress-preserving continuation within the existing scheduler deserves a separate design decision; it must retain truthful in-progress status and original command identities, rather than reclassifying a timeout as success. [inference]

## 4. Trade-offs

- **Batch labels:** fewer requests, but one failed request affects the whole batch’s preparation. Exact-unit evidence and selection checks remain necessary.
- **Reuse uploaded bodies:** reduces HTTP work but requires exact namespace/descriptor matching; locally held bytes cannot substitute for the remote commit receipt or complete event proof.
- **Keep current backoff:** preserves established recovery semantics, but an execution timeout can still amplify a small remaining workload into minutes.
- **Parallel Banks:** reduces queue latency but increases simultaneous Native/Core load and changes the documented scheduler contract.
- **Compliant smoke provider:** improves successful-path evidence; it does not prove real-model policy quality.

## 5. Open items / UNKNOWN

- No correction was implemented or runtime-validated.
- Exact Core CPU versus Native HTTP duration is unavailable from these artifacts.
- Exact consolidation/extraction versus proof-construction time inside transition verification is unavailable.
- The exact instruction interrupted after Taki child confirmation and its historical scheduler trigger are unavailable.
- Home’s precise timeout-window appearance is reconstructed from persisted state and rendering code, not a screenshot of that interval.
- Native PG was not reopened; retained Native receipts/proofs, SQLite and logs were used.
- No report file was written under this read-only permission profile.

## 6. Anything outside scope noticed

- Step 12/13 Home RPCs reached **9.25 / 19.797 seconds**, although all recorded RPC errors were null. This is responsiveness evidence to retain for phase-2 work, not proof of an additional failed operation. [run artifact `G:/taki-first-use-0E2IXk/home-return-local-uKcuiB/rpc-timings.json`] [run artifact `G:/taki-first-use-0E2IXk/home-reenter-hindsight-bIVUR9/rpc-timings.json`]
- Native watchdog stacks identify synchronous temporal/date parsing during transition maintenance. These stalls are real, but do not account for the much larger complete-body-read windows by themselves. [source R6/native.log:8499]
- Run 6 also records an initially failed automatic Mika provisioning operation followed by successful operator recovery. It was not investigated under P1-N. [run artifact R6/result.json, step 6]