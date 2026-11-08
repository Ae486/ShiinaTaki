**1. Outcome — partial**

Read-only review completed. Three findings are confirmed from code; none was reproduced with running services. The report is returned here for capture. The `-o` destination was not supplied, and this session cannot write files.

Paths below are relative to `H:/TakiAgent`; Native paths are absolute.

**R1 — blocker for phase 1: emergency admission accepts `rebind_required` Memories that reconstruction rejects**

Location: [source packages/core/src/db/memory-transition-surviving-policy.ts:27] [source packages/core/src/memory/transitions/transition-current-identity.ts:86]

Concrete sequence:

1. A previously bound Memory receives a Native update. Native publishes its new head as `rebind_required`, retaining the previous artifact.
2. Core pulls that event, then loses Native connectivity before completing rebinding.
3. Emergency preview and admission validate the closure, but the new policy check examines only `binding_missing` heads.
4. Emergency admission retires the source and seals the incident. Candidate reconstruction then rejects the same Memory.

This state is valid replica evidence: `validateApplicationHead` explicitly accepts a matching previous-version artifact for `rebind_required`. Runtime projection withholds it, and emergency `projectMemory` rejects its non-null `bound_artifact`. [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/publication.py:166] [source packages/core/src/db/hindsight-application-replica-heads.ts:119] [source packages/core/src/memory/hindsight/hindsight-application-projection.ts:48] [source packages/core/src/memory/transitions/transition-local-projection.ts:253]

**Consequence:** another newly admitted, sealed `outcome_unknown` incident with the source withdrawn. Recovery reuses the unusable incident. D98’s assertion that “new incidents cannot reach this state” is incorrect. [source packages/core/src/memory/transitions/transition-emergency-service.ts:140] [source packages/core/src/memory/transitions/transition-emergency-service.ts:178] [source docs/deferred-decisions.md:17]

**Smallest fix direction:** make pre-admission validation cover the binding states that actual emergency reconstruction can consume. At minimum, reject unreconstructible `rebind_required` Memories before retirement. Any decision to reconstruct them offline must preserve their existing policy through an explicitly defined correspondence rule.

**Provenance:** P1-J’s new eligibility check is incomplete; the rejecting reconstruction path is inherited.

**R2 — should fix: an active successful sync can erase a newer foreground Pending retry**

Location: [source packages/core/src/db/hindsight-replica-scheduler-repo.ts:172]

Concrete sequence:

1. Scheduled recovery finishes its native-Pending summary with no unresolved children.
2. It enters parent-write advancement and awaits an older retain’s result-page download.
3. A new foreground retain durably creates its parent/native child, then waits behind that Bank operation.
4. Its bounded wait expires while the scheduled operation remains active. It returns Pending and calls `requestRetry`.
5. The older download finishes. Parent advancement encounters the new, incomplete child and leaves it pending, but returns successfully.
6. Scheduler success unconditionally clears `retryDueAt` and `retryAttempt`. The requested extra drain sees no due work.

A result-page request lasting longer than the foreground recovery allowance but less than the scheduled allowance provides this interleaving. The final Pending summary occurs **before** asynchronous parent advancement; there is no equivalent final check afterward. [source packages/core/src/memory/hindsight/hindsight-pending-recovery-runner.ts:76] [source packages/core/src/memory/hindsight/hindsight-runtime-bank-service.ts:159] [source packages/core/src/memory/hindsight/hindsight-memory-write-retain.ts:19] [source packages/core/src/memory/hindsight/hindsight-memory-write-admission.ts:38] [source packages/core/src/memory/hindsight/hindsight-memory-writes.ts:46]

**Consequence:** the original write remains durable, but its requested retry is lost. Without another trigger, recovery can wait for the ordinary six-hour interval. [source packages/core/src/db/hindsight-replica-schedule-state.ts:43] [source packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:209]

**Smallest fix direction:** successful settlement must not consume retry work admitted after that run’s recovery coverage. Preserve the newer retry or recheck unresolved work at the actual settlement boundary, using the existing scheduler.

**Provenance:** interaction between P1-H’s new in-flight retry requests and inherited unconditional success clearing. The inherited behavior is visible in the packet baseline. [run artifact G:/taki-codex-work/tmp-h/p1-h/baseline/packages/core/src/db/hindsight-replica-scheduler-repo.ts]

**R3 — should fix: retention reset during the post-binding pull bypasses recovery**

Location: [source packages/core/src/memory/hindsight/hindsight-application-sync-runner.ts:151]

Concrete sequence:

1. A full snapshot captures checkpoint `c` containing binding work.
2. Another publication advances to `d`; an operator prunes application changes through `d`.
3. P1-R permits the older coherent snapshot to finish.
4. Core installs it and commits a binding batch against unchanged candidate versions.
5. The subsequent incremental pull from `c` receives `state_reset_required`.

Core handles that refusal only around the initial incremental pull. `bindPasses` calls `incremental` outside that handler. The outer reset classifier does not recognize `HINDSIGHT_APPLICATION_STATE_RESET_REQUIRED`. [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/snapshot.py:287] [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/snapshot.py:364] [source packages/core/src/memory/hindsight/hindsight-application-sync-runner.ts:121] [source packages/core/src/memory/hindsight/hindsight-replica-errors.ts:20]

**Consequence:** a legitimate retention event becomes a failed scheduled run with backoff, or `MEMORY_INTEGRITY_ERROR` for a provider operation. A later attempt can recover; this is not permanent data loss. [source packages/core/src/memory/hindsight/hindsight-memory-provider-context.ts:142]

**Smallest fix direction:** apply the existing rollback-versus-retention-reset handling to post-binding pulls too, retaining the same deadline, authority and lease.

**Provenance:** the handler placement is inherited, confirmed in the F2 baseline. P1-R’s accepted retention interleaving exposes its interaction with binding. Application pruning is a registered Native endpoint. [run artifact G:/taki-codex-work/tmp-f2/baseline/hindsight-application-sync-runner.ts] [source H:/hindsight/hindsight-api-slim/hindsight_api/api/taki_application_state.py:354]

**Answers to questions 1–8**

**Q1. Automatic work and fence ownership**

No additional reachable ownership defect confirmed.

- Scheduler wakes and automatic lifecycle submission bind to construction context. The lifecycle trigger is constructed before memory composition; the scheduler receives newly constructed fences. [source packages/core/src/main.ts:198] [source packages/core/src/memory/hindsight/hindsight-memory-subsystem.ts:50]
- Curator work is awaited within admitted maintenance. Post-turn maintenance starts from the chat completion path through `setImmediate`; it does not originate inside a provider call’s fence owner. Native consolidation runs separately and reaches Core through later pulls. [source packages/core/src/agents/chat-agent.ts:370] [source packages/core/src/memory/auto-memory.ts:105] [source packages/core/src/memory/hindsight/hindsight-writer-fence.ts:32]
- Remaining inspected timers cancel, expire or renew their owning operation; they should retain that operation’s lifetime.
- `AsyncResource.bind` captures execution context generally. The only project-defined `AsyncLocalStorage` found is fence ownership. Runtime, epoch and admission use explicit closures/repositories with current-state guards. No foreground operation was found routed through the detached wake. [source node_modules/.pnpm/@types+node@24.13.3/node_modules/@types/node/async_hooks.d.ts:275] [source packages/core/src/memory/canonical-local-write-fence.ts:28]

**Q2. F1/F2 evidence staleness**

No supported upgrade/restore sequence was found where F2 reuse alone admits something fresh admission would reject.

| Scenario | Observed handling |
|---|---|
| Native upgrade/restart | New engine cache; live manifest checks API/build/capabilities. Changed supported manifests require full admission. |
| Schema migration | Changed Alembic revision set causes inspection; unreadable revision metadata falls back to inspection. |
| Restore, same schema | Schema support may remain reusable; lineage, Bank generation and checkpoint rollback are checked separately. |
| Compatibility change | Descriptors and manifest remain live; changed/unsupported capability is re-admitted or refused. |
| Core restart only | Persisted evidence is reused only after the same live-manifest comparison. |

[source H:/hindsight/hindsight-api-slim/hindsight_api/engine/taki_compatibility.py:434] [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/taki_compatibility.py:459] [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/memory_engine.py:4511] [source packages/core/src/memory/hindsight/hindsight-application-capability.ts:61] [source packages/core/src/memory/hindsight/hindsight-application-sync-runner.ts:157]

**Limit:** same-revision out-of-band schema damage can leave F1’s positive result stale until Native restart. Core restart alone does not clear it. This is the packet’s explicit limitation, not an additional demonstrated supported workflow. A “full” Core admission also uses the cached Native manifest.

**Q3. Batch failures and body reuse**

No additional identity/evidence defect confirmed.

- Labels are obtained **before** command preparation and commit. There is no commit-then-label interval in this implementation. Selection drift or transport failure prevents preparation. Missing/invalid individual proofs produce the explicitly permitted neutral policy. [source packages/core/src/memory/hindsight/hindsight-application-binding-runner.ts:93]
- Native command mutations use a savepoint inside the outer transaction. Deterministic refusal rolls back the batch; unexpected storage/publication failure rolls back the transaction. [source H:/hindsight/hindsight-api-slim/hindsight_api/engine/application_state/commits.py:327]
- Lost ACK and interrupted upload recover the original job, operation ID and bodies before collecting new candidates. CAS refusal permits a new intent only after pulling changed versions. [source packages/core/src/memory/hindsight/hindsight-application-binding-runner.ts:31] [source packages/core/src/memory/hindsight/hindsight-application-command-runner.ts:61]
- A cache miss in both body tables downloads normally. A missing body required to reconstruct a durable command is an integrity failure, not successful completion; there is no automatic repair demonstrated.
- The command fallback checks lineage, Bank, generation, body ID, complete ref and decoded bytes. It cannot substitute an older revision merely because its logical object matches. [source packages/core/src/db/hindsight-application-replica-cache.ts:13] [source packages/core/src/db/hindsight-application-command-storage.ts:65]
- Command completion and local application remain distinct; `applied` requires checkpoint coverage and the exact affected artifact versions. [source packages/core/src/memory/hindsight/hindsight-application-writer.ts:44]

**Q4. Retry arming**

R2 is the lost-wakeup defect.

Otherwise, inspected success—including manual scheduler success—clears retry state; failures advance the bounded backoff; a retry suppresses interval scheduling. One active drain and Bank leases prevent duplicate simultaneous claims. Pause clears wakes and joins accepted work; retirement clears wakes and cancels execution, with authority/lease guards rejecting late publication. [source packages/core/src/db/hindsight-replica-schedule-state.ts:43] [source packages/core/src/memory/hindsight/hindsight-replica-scheduler.ts:98] [source packages/core/src/memory/hindsight/hindsight-replica-run-execution.ts:35]

**Q5. Lock change**

No loss of writer exclusion or incoherent bundle was found in the inspected holder paths. The changed lock permits transport FK locks while application writers still exclude one another.

The holder report correctly allows retention to overtake an older bundle. Its client-handling conclusion is incomplete: Core’s initial incremental consumer rebuilds, but its post-binding consumer fails as R3 describes. The existing reset test injects the refusal at the initial pull. [source packages/core/src/memory/hindsight/hindsight-application-sync-runner.test.ts:210]

**Q6. Emergency eligibility**

R1 permits a takeover that cannot finish.

No new over-refusal against the current strict policy contract was confirmed. However, loss of Native while a newly observed Memory lacks usable policy can leave the operator refused indefinitely: preview has `expected:null`, confirmation is disabled, and Home says “本地副本或策略证据不完整，无法接管。” Missing backup alone is not a blocker; a usable verified pair is a separate recovery route, not guaranteed to exist. [source .trellis/spec/backend/memory-transition-emergency.md:47] [source apps/desktop/src/windows/home/pages/operations/memory-transition-confirmation.tsx:17] [source apps/desktop/src/windows/home/pages/operations/memory-transition-confirmation.tsx:44]

P1-J prevents that particular admission failure; it does not make unavailable policy reconstructible.

**Q7. Cross-packet coverage**

No controlled coverage was located for these sequences in the reviewed packet suites/journeys:

| Sequence | Failure or unresolved risk |
|---|---|
| New retain during scheduled parent-result recovery | R2: retry erased by older success. |
| Native update pulled, rebinding interrupted, then emergency | R1: admitted incident cannot reconstruct. |
| Older snapshot + publication/pruning + binding batch | R3: reset bypasses handler. |
| F4/P1-O batch active while P1-P provisions another Bank | Exact overlap and shared-scheduler settlement remain UNKNOWN. |
| Curator publication during Pending recovery with P1-R installed | Native lock tests cover the lower-level race; complete Core recovery under this overlap remains unverified. |
| Actual Pending retry during transition retirement | Scheduler pause tests exist, but the complete Native/Pending/transition overlap was not established. |

Run 6 predates P1-O/P1-P/P1-R. Runs 9/10 did not complete the later recovery path. This establishes missing evidence, not that every untested combination is defective. [source .trellis/tasks/08-09-memory-operations-ui/research/phase-plan-20261107.md:80] [source .trellis/tasks/08-09-memory-operations-ui/research/phase-plan-20261107.md:92]

**Q8. Evidence honesty**

- The pre-admission guarantee in `memory-transition-emergency.md:43` and D98’s “new incidents cannot reach this state” claim are contradicted by R1.
- The convergence contract saying unresolved Pending prevents overall convergence is contradicted by R2’s settlement sequence. [source .trellis/spec/backend/memory-replica-sync.md:298]
- P1-J tests cover `binding_missing`, not `rebind_required`; retry tests arm an idle scheduler; the reset test covers the initial pull. These are coverage gaps, not proof those tests are dishonest. [source packages/core/src/memory/transitions/transition-emergency-service.test.ts:155] [source packages/core/src/memory/hindsight/hindsight-replica-scheduler.test.ts:106]
- No additional behavior-freezing test defect was confirmed. Request-count assertions prove request reduction, not end-to-end correctness.
- The current step-5 harness requires persisted retain call/result identity, the original parent/child and actual replica effects before explicit synchronization. I found no recurrence of the earlier “retain never executed” false pass. [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:145] [source .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs:168]

**2. Changes**

None. No source, tests, specifications, task records or inherited changes were edited. No report file was written.

**3. Evidence and checks run**

- Read the phase plan, specified packet reports, project law, task context and relevant backend contracts.
- Traced production callers, repository guards, Native transactions and colocated tests.
- Used read-only `git diff HEAD -- …`, `git -C H:/hindsight diff HEAD -- …`, `rg`, file reads and two `jbcontext search` queries.
- Compared relevant inherited behavior against retained packet baselines.
- Verified `AsyncResource.bind` against installed Node types.
- Checkout: `H:/TakiAgent`, `main`; 439 changed entries at both status checks.
- **No tests, services, PostgreSQL instances or model calls started.** Packet-reported passing tests are historical evidence, not checks rerun here.

**4. Trade-offs**

No implementation decisions were taken.

- Completing emergency refusal coverage prevents additional stranded incidents but does not provide offline reconstruction for those states.
- Preserving newer retry work may require an additional recovery pass; clearing it risks six-hour delay.
- Handling retention reset after binding adds snapshot I/O within the existing deadline.
- F1 retains its documented same-revision schema-change limitation; F2 retains historical capability evidence through availability failures.

**5. Open items / UNKNOWN**

- Runtime reproduction of R1–R3 remains unperformed. The smallest regressions are the three concrete sequences above.
- The complete first-use/recovery journey with all listed packets remains unverified by the reviewed evidence.
- The exact simultaneous provisioning/batch and retry/transition interleavings remain UNKNOWN.
- Whether any operator’s existing backup can recover a stranded incident is UNKNOWN; no user data was inspected.
- The `-o` destination and successful external capture of this report are UNKNOWN.

**6. Anything outside scope noticed**

The binding collector deliberately skips never-bound invalidated units, while emergency policy validation still requires correspondence for their `binding_missing` heads. Consequently, exhausted binding work does not necessarily imply emergency eligibility. This skip is inherited and explicitly exercised by the F4 test; no change was made. [source packages/core/src/memory/hindsight/hindsight-application-binding-collector.ts:70] [source packages/core/src/memory/hindsight/hindsight-template-binding.test.ts:386]

D97 and D99–D101 were not reopened. D98 was examined only because R1 contradicts its logged prevention claim.