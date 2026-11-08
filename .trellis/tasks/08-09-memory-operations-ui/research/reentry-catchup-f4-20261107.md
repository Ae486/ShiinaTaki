# Re-entry catch-up deadline — diagnosis and F4 design — 2026-11-07

## 1. Outcome — done

Read-only diagnosis and design completed. The failure combines a real binding-throughput limit with a harness retry omission. **Global was configured as manual-only; deadline failures are already automatically retried for Banks with automatic synchronization enabled.** [run artifact G:/taki-first-use-Gx94Wj/core-data/taki.db] [source packages/core/src/db/hindsight-replica-schedule-state.ts:76]

The failed attempt preserved its completed work. Ten valid Memory heads remained unbound after failure. No implementation or runtime acceptance is claimed.

## 2. Changes

None. No workspace files, retained data, task records, configuration or services were changed. No Core, Native, PG or model process was started.

## 3. Evidence and checks run

Evidence sources:

- Run 5: `.trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-06T21-48-36.854Z/{result.json,core-2.log,native.log}`.
- Retained Core database: `G:/taki-first-use-Gx94Wj/core-data/taki.db`.
- Current Core, Shared, Native and spec files cited below.

Checks performed:

- `git branch --show-current`, `git worktree list`, and read-only status inspection: `H:/TakiAgent`, branch `main`; inherited changes preserved.
- `node --version`: **v24.18.0**.
- SQLite inspection exclusively through `new DatabaseSync(path, { readOnly: true })`; every connection closed.
- Reconstructed Global heads/artifacts from retained snapshot `2e06f0dc-de88-446a-8722-56d29582c0b0` and events **181–209**. Reconstructed final heads exactly matched the current stored heads.
- Matched **12 completed Native receipts at state cursors 198–209** to their exact local artifact revisions and hashes.
- Executed the existing pure scheduler functions against in-memory copies of the saved Global state.
- Compared recorded run hashes: binding runner, application sync runner and scheduler policy **match run 5**.
- Read existing tests; did not run Vitest or a service journey for this design-only assignment.

### Q1. What was Global doing, and why?

“Binding jobs” needs two distinctions: durable command-job rows are created lazily, and an awaiting Source association can also satisfy a Document’s missing binding.

| Boundary | Core / Native position | Bank | Awaiting Source | Block | Unbound Document | Unbound Memory | Distinct binding work |
|---|---|---:|---:|---:|---:|---:|---:|
| Re-entry snapshot published | `(173,180)` | 0 | 0 | 0 | 0 | 3 | 3 |
| Step 14 entry, **22:10:33.440Z** | Core `(173,183)` | 0 | 0 | 0 | 0 | 0 | 0 |
| Ingestion materialized; before binding | Native `(204,197)`; Core initially still at state 183 | 0 | 1 | 0 | 1 | 20 | **21** |
| After Source association, state 199 | `(204,199)` | 0 | 0 | 0 | 0 | 20 | 20 |
| After failed sync | Core `(204,209)` | 0 | 0 | 0 | 0 | **10** | **10** |

The Source and Document columns in the third row describe **one association command**, not two required commits. Event 199 bound the retained Source to its Document and made that Document bound. [run artifact G:/taki-first-use-Gx94Wj/core-data/taki.db]

At scheduler claim, **22:11:22.198Z**, the initial pull still started after state cursor 183. Therefore the 21-item workload was initially remote catch-up, not 21 already-visible Core candidates. The Native access log records that predecessor explicitly. [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-06T21-48-36.854Z/native.log:14023]

There were **zero prepared/dispatched Global `binding:*` command jobs** at step 14 entry and after failure. After failure, the ten outstanding items were unbound heads awaiting command preparation. [run artifact G:/taki-first-use-Gx94Wj/core-data/taki.db]

The volume has an attributable origin:

- Re-entry’s three missing bindings were new Native observations created at **22:04:26, 22:04:34 and 22:04:47**. All three received first bindings at states 181–183 before step 14.
- The subsequent ingestion span was `(from_seq=4, through_seq=52)`, created at **22:10:33.419Z**. Its textual entries were sequences **5, 8, 37, 40, 41, 44, 45, 48, 49, 52**.
- These included previously unconsumed witnesses from the earlier Hindsight interval, the Local interval, and the post-re-entry recall turn. Transition custody intentionally transfers unconsumed witnesses; it does not transfer completed ingestion occurrences as new work.
- That ingestion created **one Document, ten `world` units and ten observations**. The failed sync bound eight observations and two world units, leaving eight world units and two observations.

[run artifact G:/taki-first-use-Gx94Wj/core-data/taki.db] [source packages/core/src/db/memory-transition-custody.ts:33] [source packages/core/src/db/memory-transition-custody.ts:166] [source packages/core/src/db/hindsight-ingestion-source-repo.ts:106]

**Conclusion:** this is attributable first-binding work following ingestion and Native derivation. It is not evidence of redundant re-binding of the existing 65 bound Memories. Semantic duplication between explicit retain and later conversation ingestion was not assessed. J17 is not used as a volume baseline.

The label-evidence POSTs fetch trusted, exact-unit-version extraction labels for initial Taki policy. The request contains one unit’s ID, revision and payload hash; validation checks the selected label-group definition, Bank scope and canonical tag. It does not invoke another extraction model. [source packages/core/src/memory/hindsight/hindsight-template-label-evidence.ts:26]

The runner requests this evidence only for a new provider-derived Memory without prior/original policy, and only before preparing its first durable job. Thus run 5’s **ten POSTs correspond to ten first Memory bindings**. They are not an unconditional request on every pass; batching alone would still make one request per eligible new Memory using the current helper. [source packages/core/src/memory/hindsight/hindsight-application-binding-runner.ts:98] [source packages/core/src/memory/hindsight/hindsight-application-binding-runner.ts:155]

### Q2. Does deadline failure preserve completed passes?

**Yes.**

Native commits are atomic, with immutable receipts. Core then pulls complete events and publishes evidence, heads, projections, FTS/Blocks and the paired checkpoint in an individual SQLite transaction. A later failure does not roll back preceding event transactions. [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/commits.py:327] [source packages/core/src/memory/hindsight/hindsight-application-sync-runner.ts:206] [source packages/core/src/db/hindsight-application-replica-publication.ts:76]

The spec explicitly requires:

> “A later failed page/reset leaves earlier complete pages committed.”

[source .trellis/spec/backend/memory-replica-sync.md:145]

Run-specific verification:

- Global advanced from **`(173,183)` to `(204,209)`**.
- Final checkpoint verification time: **22:12:21.754Z**, before failure settlement at **22:12:22.324Z**.
- Receipts at states **198–209** were all completed and matched their exact locally stored artifact revisions/hashes.
- Those 12 commits comprised **one curator assessment, one Source association and ten Memory bindings**.
- No unfinished Global command row remained.

[run artifact G:/taki-first-use-Gx94Wj/core-data/taki.db]

Native access completions corroborate the commits and subsequent event reads, including the last commit and event 209. [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-06T21-48-36.854Z/native.log:14409]

With stable finite input, repeated incremental attempts can converge from that checkpoint. **Convergence was not rerun** against the retained services. Native PG tables were not independently reopened; Native evidence here consists of persisted receipts/events plus the access log.

### Q3. Scheduler handling and user-visible behavior

The scheduler already retries deadline failures in automatic mode.

The spec says:

> “Automatic retry delays are one minute, five minutes, fifteen minutes, one hour, then six hours repeatedly.”

> “Manual mode schedules no background due or retry wake.”

[source .trellis/spec/backend/memory-replica-sync.md:126] [source .trellis/spec/backend/memory-replica-sync.md:129]

`heldForOperator()` recognizes **only `HINDSIGHT_PROVIDER_ROLLBACK_DETECTED`**. `failedReplicaSchedule()` schedules retries for other errors when `state.automatic` is true. [source packages/core/src/db/hindsight-replica-schedule-state.ts:15] [source packages/core/src/db/hindsight-replica-schedule-state.ts:76]

The pure-function check produced:

| Input mode | Deadline result | Next wake |
|---|---|---|
| `automatic:false` | `explicit_retry_required` | None |
| `automatic:true` | `automatic_retry_scheduled` | 22:13:22.324Z; incremental retry |

Run 5’s earlier settings scenario saved Global as `automatic:false`, and the schedule scenario restored that same configuration. The final DB retains it. [run artifact .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-06T21-48-36.854Z/result.json] [run artifact G:/taki-first-use-Gx94Wj/core-data/taki.db]

The log at **06:12:22 local** is **the same manual attempt**, not an additional automatic run. Its run ID, `85e67ff1-ec18-4613-808f-e8788318b3ad`, matches the failed manual-request claim. The generic execution logger calls manual and automatic executions “scheduled synchronization.” [source packages/core/src/memory/hindsight/hindsight-replica-run-execution.ts:69] [run artifact G:/taki-first-use-Gx94Wj/core-data/taki.db]

Consequently:

- An automatic Bank can finish work requiring multiple deadlines through repeated progress-preserving retries, assuming input eventually stabilizes and attempts can progress.
- A manual-only Bank does not receive scheduler continuation. Further explicit syncs or separately initiated foreground work are needed.
- Admission’s “catches up in the background” message concerns the owned foreground sync continuing after the admission wait budget; it is not a promise of an automatic scheduler retry. [source .trellis/spec/backend/hindsight-application-runtime.md:205]

Home displays the error, last successful synchronization, latest attempt, “手动模式”, “需要显式重试”, and a Retry button defaulting to incremental. For this run, last success remains **21:56:51.979Z** despite checkpoint progress. The card does not display the ten outstanding binding heads. [source apps/desktop/src/windows/home/pages/operations/memory-authority-state.ts:85] [source apps/desktop/src/windows/home/pages/operations/memory-authority-card.tsx:53]

### Q4. Smallest F4 design

The protocol already supports multiple commands and verifies the complete affected-artifact set. Increasing `bindingWork.limit` alone would not batch commits because `bindHead()` still commits immediately. [source packages/shared/src/hindsight-application-artifact-schema.ts:71] [source packages/core/src/memory/hindsight/hindsight-application-command-receipt.ts:50]

**Recommended bound: eight commands per batch**, additionally packed within the existing **16 MiB complete direct-closure limit**, including the command envelope. End a batch before adding an item that exceeds that limit; preserve the existing failure for an oversized singleton. Eight is a conservative initial implementation bound, not a protocol limit or measured optimum. [inference] [source packages/core/src/db/hindsight-application-command-contract.ts:62]

Preserve the existing category order for the smallest change:

1. Bank binding alone, followed by a complete incremental pull.
2. Up to eight awaiting Source associations; pull.
3. Up to eight Block changes; pull.
4. Up to eight remaining Document/Source bindings; pull.
5. Up to eight Memory bindings; pull; repeat as necessary.

Keeping Source-association and Document phases separate avoids constructing an unnecessary second Source binding from a Document head that the pending association will already bind. Memory bodies must use **published exact Source artifact versions**. Native validates those references before applying the batch, so newly created Sources and dependent Memories must remain in separate publication stages. [source packages/core/src/memory/hindsight/hindsight-application-binding-runner.ts:55] [source packages/core/src/memory/hindsight/hindsight-application-binding-runner.ts:63] [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/commits.py:157]

Proposed file/function changes:

| File | Change |
|---|---|
| `hindsight-application-binding-runner.ts` | Refactor `bindHead`, `bindKind`, `bindAwaitingSources`, `preserveBlocks` into bounded work collection; make `commit` prepare one `commands[]`/`bodies[]` job. Continue pagination past skipped candidates. |
| `hindsight-application-command-repo.ts` | Add a narrowly scoped unfinished-binding-job lookup using the existing job table/index. |
| `hindsight-application-writer.ts` | Expose that lookup; retain existing preparation, execution and applied-receipt checks. |
| `hindsight-application-sync-runner.ts` | Retain the existing pull-after-batch and three-consecutive-conflict behavior; clarify the binding callback contract if needed. |
| Existing specs/indexes and affected tests | Replace the explicit one-command-pass statement and add multi-item recovery/order coverage. |

The unfinished-job lookup is needed for **lost ACK/restart recovery when candidate membership changes**. Resume an existing prepared/dispatched binding job before assembling another batch. Preserve its original membership, bodies, labels and Native operation ID. New batches can hash their ordered exact member intents; existing single-binding jobs remain readable and resumable. The existing repository currently exposes key lookup but no unfinished-binding enumeration. [inference] [source packages/core/src/db/hindsight-application-command-repo.ts:40] [source packages/core/src/memory/hindsight/hindsight-application-command-runner.ts:55]

Failure behavior:

- Evidence/preparation failure: no batch dispatch; propagate the actual failure.
- One Native CAS/validation failure: **the entire batch is refused**, with no subset published.
- Native/artifact conflict: retain the refused receipt, pull fresh state and rebuild under the existing limit of three consecutive conflicts.
- Timeout/lost ACK: preserve the original durable batch and recover its receipt; never reconstruct an uncertain dispatched batch with a new Native operation ID.
- Earlier completed batches remain committed.

[source H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/commits.py:327] [source packages/core/src/memory/hindsight/hindsight-application-sync-runner.ts:135]

Existing test implications:

- `hindsight-template-binding.test.ts:70` checks first policy publication only after refresh.
- `:107` checks durable job/label reuse; `:115` checks lost ACK recovery; `:143` checks preserved refusal.
- `hindsight-application-replica-repo.test.ts:319` explicitly exercises `limit:1` pagination and skipping/continuation. Keep it: it tests the query contract.
- **No multi-candidate test requiring exactly one binding per pass was found.** The explicit implementation restriction also appears in the spec at lines 101–102.

[source packages/core/src/memory/hindsight/hindsight-template-binding.test.ts:70] [source packages/core/src/db/hindsight-application-replica-repo.test.ts:319] [source .trellis/spec/backend/hindsight-application-runtime.md:101]

Necessary additional failure cases are multi-item Source-before-Memory ordering, one conflicting member causing whole-batch refusal, lost ACK with changed candidate membership, deadline between commit and pull, skipped leading candidates, and byte-boundary packing. Final acceptance should use the existing connected journey.

**Line 179 side issue:** the broad “false ends the loop early” finding is not established. `bindKind()` continues to later candidates when `bindHead()` returns false; awaiting Sources and Blocks also continue scanning. The Bank branch directly returns the result, but no reachable consistent-state reproducer was found where its already-applied receipt hides remaining work. This was not the run 5 failure. Do not blindly change line 179 to `true`; the collector should return false only after exhausting eligible work, and true when a successful batch needs pulling. [source packages/core/src/memory/hindsight/hindsight-application-binding-runner.ts:55] [source packages/core/src/memory/hindsight/hindsight-application-binding-runner.ts:79] [source packages/core/src/memory/hindsight/hindsight-application-writer.ts:43]

### Q5. Retry independently of F4

**Keep product scheduler semantics. Change the harness continuation policy.**

Automatic retry already exists. Automatically retrying a manual-only Bank would contradict the quoted spec and the deliberately tested configuration.

The smallest correction is in `native-smoke.mjs::syncPendingBanks()`:

- Add `HINDSIGHT_DEADLINE_EXCEEDED` to bounded explicit continuation.
- Use the existing before/after checkpoint capture to require actual cursor progress for this additional case.
- Keep the existing outer attempt-admission bound, lease wait and each attempt’s 60-second deadline.
- Retain every failed attempt in the report; require an eventual genuinely completed operation.
- Do not count a changed checkpoint hash alone as progress: timestamps/publication metadata can change without advancing either cursor.

[inference] [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:552]

A fresh scheduler request is a new explicit attempt; unresolved underlying Native commands must still recover their original identities. No Shared error-schema change or longer production deadline is needed.

### Q6. Estimate for run 5

The scheduler attempt ran approximately **60.1 seconds**. Step 14’s **109.3 seconds** includes approximately **48.8 seconds before scheduler claim**, covering ingestion/other-owner settlement and request admission. [run artifact G:/taki-first-use-Gx94Wj/core-data/taki.db] [run artifact .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/results/2026-11-06T21-48-36.854Z/result.json]

The ten consecutive Memory jobs started **3.105–3.301 seconds apart**, median **3.198 seconds**. Their command execution itself took approximately **0.82–0.89 seconds**; pull, publication and next-pass work account for much of the remainder. [run artifact G:/taki-first-use-Gx94Wj/core-data/taki.db]

| Measure | Current implementation | Proposed batches of eight |
|---|---:|---:|
| Required binding passes | 1 Source + 20 Memories = **21** | 1 Source + `8+8+4` Memories = **4** |
| Binding passes completed before failure | **11** | Not measured |
| Remaining work at failure | **10 Memory passes** | **2 Memory batches** |
| Estimated complete sync from original claim | **90–95 s** | **50–70 s**, planning midpoint around 60 s |
| Estimated additional current-code retry | **32–36 s**, stable input | Not measured |

[inference]

For single-part bodies, the twenty Memory bindings currently require approximately **280 requests** including per-unit labels. Three batches reduce that model to approximately **144 requests**: `6 × 20 + 8 × 3`. This retains per-unit labels and own-body downloads; it assumes one event page per small batch. [inference]

**F4 alone is not proven to fit this run under 60 seconds.** It removes substantial repeated overhead, while initial catch-up, Source proof, per-unit work and Native latency remain. Bounded progress-aware continuation remains useful independently.

## 4. Trade-offs

- **Batch size eight:** fewer envelopes, commits and pulls; one conflicting member delays up to seven otherwise-ready members.
- **Atomic batch publication:** preserves consistency but increases work awaiting publication when a deadline interrupts a batch.
- **Durable batch recovery:** needs a small existing-table lookup so lost ACKs cannot cause regrouping of uncertain commands.
- **Preserved category ordering:** minimizes behavioral changes; it leaves some independent Block/Source work uncombined.
- **Labels unchanged:** preserves selected-template evidence behavior, leaving one evidence request per eligible new Memory.
- **Harness retries:** increase total journey duration while retaining failed attempts and manual-only product behavior.
- **Unchanged deadlines:** batching remains subject to existing request, closure-size and sync limits; eight large bodies may still time out.

## 5. Open items / UNKNOWN

- **UNKNOWN:** measured batching performance and full journey completion after the proposed changes.
- **UNKNOWN:** an actual reachable early-exit defect from line 179; none demonstrated here.
- **UNKNOWN:** independently reopened Native PG contents. PG remained stopped.
- Implementation, regression execution and connected acceptance remain for the leader’s implementation assignment.
- No output file was written by this read-only investigation; this final message is the report for `-o` capture.

## 6. Anything outside scope noticed

- The additional state-198 commit belongs to policy work, not binding. Counting all twelve commits as binding passes overstates binding throughput.
- The current Home card exposes synchronization outcomes but not binding-backlog progress.
- The captured workload includes explicit-retain conversation material later consumed by automatic ingestion. Its semantic duplication/quality is separate from this binding-throughput diagnosis.
- No template, prompt, ingestion, UI or other out-of-scope behavior was changed.