# W5 snapshot recovery repair and staged real continuation

## Current authorization

On 2026-10-03 the owner approved repairing the W4/W5 check findings and optimization, then resuming real-model tests after independent verification. The owner explicitly confirmed that the existing account balance is restored. Continue this existing task; no new task, commit, push, archive or W6-W8 work.

The prior read-only review found one P1: an unused Bank's application snapshot uses the immutable `unused-inventory` request with a600second TTL. A crash after Native snapshot creation but before Core preparation leaves recovery reusing an expired request; an earlier Bank preparation prevents abort. This remains a source-confirmed finding until the new full-driver regression demonstrates it.

## Ownership and gates

- Exact Core workspace: `H:/TakiAgent`, `main`, HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
- Native: `H:/hindsight`, `main`, HEAD `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`; no Native production repair is planned.
- Original `/root/w5_implement` is unavailable in this thread. `/root/w5_snapshot_repair` owns the scoped Core repair, regression and relevant specs/indexes. One child at a time.
- Parent owns the staged real-test helpers and this continuation record. Independent review follows repair before any real-model dispatch.
- Preserve all prior source manifests. The read-only check matched139combined W4/W5 Core/spec/test paths and6Native paths; focused12files/61tests and workspace types passed. Lint had exactly7previously approved cohesive length diagnostics, exit1.
- Repair must preserve original requests and renew only on factual expiry, reuse renewed identity across lost replies/restart, keep the current fence/namespace, and avoid repeating prior delta effects. Add full-driver physical-reopen evidence and bounded failure cases.

## Real-data boundary and staged budget

Use the original exclusive working pair recorded in `w5-real-resume-handoff.md`, transition `df47f32c-48a8-47bc-9792-2e24e8642084`. Never start/mutate its preserved original sibling or repeat full corpus conversion/extraction. The original operation remains immutable `outcome_unknown`; explicit recovery has its own operation identity.

Live preflight confirmed the working copy is stopped, both18495/18496listeners are absent, SQLite SHA256 is `cdef425b17e120fa4f8e7ae111e5af36353ea48cdd1cf5a961d06b6e0902c670`, and the cumulative submission count is209. No `model-http402-latch.json` currently exists; no latch was cleared. The nine completed steps and original candidate/required-set hashes remain governed by the prior handoff.

After the repair passes independent checking, the first continuation is **return only**, with at most120additional submissions: cumulative ceiling329. This is a new bounded execution allowance chosen within the owner's real-test resumption authorization, based on the recorded minimum83remaining submissions plus37retry/dedup headroom. It is not an account-balance or monetary-cost estimate. Keep all209prior submissions. The first factual402stops further HTTP across restart. Other failures and cap exhaustion retain actual partial state.

The helper stops after the real return receipt, before Local edits/reentry. Inspect that result and the actual next native maintenance plan before choosing the separate reentry bound;329does not authorize an automatic unbounded complete journey. Preserve original request/step history and apply tested migration056additively to the owned SQLite copy.

## Helper changes and evidence

- `w5-model-budget.py` accepts an explicit finite cumulative cap while preserving the default240and durable counter/latch.
- `w5-reused-native.py` accepts a reviewed stage and cumulative submission cap.
- `w5-reused-driver.mjs` can stop at return, and requires a completed return before a reentry stage.
- Four helper preimages are retained in `w5-resume-helper-prior-2026-10-03.json`, SHA256 `3c6ee1127318e7cced75389b6adff04e38a68091a45e7b449e4c2df5cb817748`.
- Four offline budget tests passed, including cumulative ceiling across restart and a cap increase never clearing a billing latch. Node and Python helper syntax checks passed. No real model/PG startup has occurred in this continuation yet.

W5 remains incomplete until actual return, controlled Local policy/Block changes, same-Bank reentry, mapping/body reuse, preservation and independent real-gate checks finish. No manual acceptance is inferred.

## Verified progress before independent repair check

- The full-driver regression reproduced both the expired unused-inventory request and an adjacent immutable-evidence conflict after a proven Bank's executor expires. Two tests failed against the prior implementation; the two minimal repairs subsequently passed those same cases. Broader boundary tests are still in progress.
- PG-only remaining-plan inspection `remaining-plan-9250630c62cf41a48f39731ccb2aaca3.json` confirmed the same9completed steps,60completed requirements,16prepared entries, candidate/required-set hashes, and minimum83remaining submissions. It made0model requests and stopped its owned PG process.
- The modified supervisor's zero-model `inspect --stage return --submission-cap329` passed, attempt `49db9448fb3b4b73b17a1224fd06d861`. Before/after fingerprints preserve all9completed steps and59actions; original source hashes remain equal. Both owned services are stopped, cumulative counter209unchanged.
- The supervisor now checks that every previous completed-step/action row hash remains present after each attempt, and retains its before/after evidence with the existing attempt history. This adds preservation evidence without using payloads in public output.
- The Source multipart roundtrip exceeded its30second envelope with both the exact checker-baseline candidate and the repair. A diagnostic-only longer envelope completed every original assertion in30.573seconds. Reducing the fixture to the exact two-part boundary did not reliably remove the timeout. Parent therefore explicitly approved restoring the original100000-character fixture and retaining all original assertions, with a60second budget for this one integration case only. This evidence-based adjustment was disclosed to the owner; do not relabel the earlier failed commands as passes or change global timeouts. Independent review must assess the final case and this disposition.

## Independent gate and live RETURN attempt

Independent repair/helper check passed, with23focusedCoretests,4budgettests, workspace types/scoped lint and source checks. Root lint remains the same7approvedlength diagnostics(exit1). The checker changed no production/helper source. Report `w5-snapshot-renewal-independent-check.md`, SHA256 `07602ff73649cdd0824c4378ad4fef68b8e7e8a1d7cf31f494842b5a9c539593`; independent inventory SHA256 `61f332f46c0941c6b6c84d568b5a19c5299bb1e7b285698a3bb77f9a97927ff6`.

Parent re-read the full report and verified all10current code/helper hashes, original stopped SQLite anchor, counter209and absent latch before startup. Real RETURN-only supervisor is now running as attempt `95e0b7fb478d4eafab9471d5f3a0a33d`, exec session76262, command `H:/hindsight/.venv/Scripts/python.exe .../research/w5-reused-native.py run --stage return --submission-cap329`. First observation saw cumulative211; no success or completion is inferred from submission count. Do not duplicate the supervisor, clear state, or enter reentry before reviewing the actual return result.

## RETURN attempt stopped; final-proof/renew contention under investigation

Attempt `95e0b7fb478d4eafab9471d5f3a0a33d` has finished with exit1. Its67new model submissions all returned200;
the durable count is276/329, with53submissions left and no new402latch. Recovery operation
`40df4fc4-7b5c-49bf-900f-06428fed9c1a` is outcome_unknown, with no Core COMMIT, Local modification or abort command.
The completed Character work is preserved:71steps/545requirements, zero remaining model requirements. Global
still needs20batches+1model. Candidate and required-set hashes are unchanged.

PG-only audit `return-audit-22b9f753060f408e90a190f926f43fc7.json` verified all original9step and59action hashes;
the current totals are71steps/600actions. SQLite migration056is applied, integrity is ok, receipts0, acquire2,
claim2, abort0, SHA256 `984aa4eeacb288db1c6465c25012a2ce999040a3210bcb97c77d17b6b207b51a`.
Original data hashes remain equal and services were stopped after the audit.

Native renew timed out waiting for the Bank lock while the final proof transaction held its fences. The repair
agent is reproducing this with a separately owned synthetic PG fixture and zero real-model calls. No production
root-cause repair or further paid dispatch is accepted until evidence and independent checks are complete.

The supervisor separately timed out during Uvicorn shutdown and skipped its normal post-audit/engine close.
Parent preserved its exact preimage in `w5-supervisor-prior-2026-10-03.json`, introduced bounded Uvicorn graceful
shutdown and sequential best-effort cleanup in `w5-supervisor-shutdown.py`, and retained failures by stage without
masking an existing driver exception. Three zero-model regressions pass, including an actual loopback Uvicorn
request that stalls and is cancelled before post-audit. Independent review is still required.

## Native repair delivered to independent check

The synthetic final snapshot reproduced the actual Bank lock wait. Parent conditionally approved the scoped Native
repair after all mutable final inputs were traced to canonical Bank/maintenance/fence locks. Five production files
now allow exact request-row renewal, serialize claim/fence/resolve owner decisions, select read_committed only for
transition final snapshots, and require a final exact-executor/live-lease CAS. Ordinary and D78 snapshots retain RR.
Read `w5-native-renewal-implementation.md` for the full lock audit, preimages and executed checks.

Twelve new concurrency/refusal/recovery cases passed. A related combined run had26passes and10generic snapshot
setup failures in local ML dependencies; the unchanged ordinary RR concurrent-writer test subsequently passed via
the existing offline Native fixture. Ruff/format/diff passed; two existing optional-value type diagnostics remain.
All synthetic fixtures are stopped/removed. Native inventory SHA256:
`c7e76b48faabea8836e1fbbeeb9f532de11c4d64a7f8b85c4fa35da41b1552a5`.

`/root/w45_readonly_review` is independently checking this Native overlay and the parent's supervisor cleanup.
No real-model dispatch has occurred since cumulative276. Resume the same RETURN only after that check, keeping
cap329and the completed71steps/600actions. W5 and the reentry gate remain incomplete.

## Independent gate passed; same RETURN resumed

Independent report `w5-native-renewal-independent-check.md` is PASS for the scoped Native/supervisor gate,
SHA256 `556d70eeec0a328a3a352a256d2a3e9b641e586d7a51ae93276257eac92165c7`.
Fresh checks:33PostgreSQLtests,3supervisor tests,4budget tests, scoped Ruff/format/syntax; old root-cwd ty2diagnostics
remain disclosed. Parent read the full report and verified all24sourcefiles in independent manifest SHA256
`d6dedae46c42186d8744fd0bfacb043824f72714f562e982b71e9feda66e9296`.

The same original RETURN-only supervisor is running as attempt `4607814624c74487b28d4d52ca04174a`, exec53471,
cap329with prior276preserved. Fresh startup shows both Banks fenced, no final proof yet, counter276unchanged.
Preflight confirmed no billing latch, stopped ownership, no listeners, and unchanged SQLite hash984aa4ee…b51a.
No reentry or Local policy/Block change is authorized by this stage result; review actual RETURN before the next stage.

## External interruption recovery and subsequent Core candidate failure

The user requested recovery after an external process interruption. Exec53471and its service processes were gone;
PostgreSQL had a stale PID file and SQLite retained WAL. The24checked source files still matched. Parent preserved
the logs and SQLite/WAL/SHM, let PostgreSQL perform normal crash recovery, then stopped it after a zero-model audit.
Audit `interruption-recovery-f9be63e641254415a3ab0de022a90781.json` preserves71steps/600actions, Characterproofproven,
Globalfenced, SQLiteintegrityok/migration56/receipts0/abort0, originalsourceunchanged, count276.

Same RETURN ran via hidden background launch `26c7625e5c6b415ebd9875e87e2ec475`, PID44796, supervisor attempt
`e4be7129cc0d49588dcf7bf8a0584173`. It has now FINISHED/STOPPED, nodeExit1. Character maintenance and proof were
reused. Global added25HTTP200modelcalls, cumulative301/329, and both Native final proofs completed.

Core recovery operation `5d32bbc5-1acb-4039-82cb-3f26e351d644` ended outcome_unknown. The supervisor completed
post-audit and engine shutdown successfully; this is a new Core candidate failure, not the repaired renewal issue.
PG-only audit `return-audit-e855ed9527964adda8df411a9bf0465c.json`: current92completedsteps/769actions, prior71/600
unchanged; SQLiteintegrityok, migration56, receipts0, acquire2, claim6, abort0; source unchanged; modelRequests0,
started/stoppedtrue. SQLiteSHA256 `6d9c381b11045722f1b6086d04e886d6c6bfcde8ab8cddf84091f519e1e7891c`.

The repair agent found both complete Core Native-evidence documents persisted (Character90,035,503characters,
Global25,025,325characters), zero candidates, one candidate reservation and zero scope IDs. Failure occurred inside
the local candidate transaction, which rolled back. It is replaying the saved evidence/projection offline without
PG/model calls or writes to the real SQLite copy. Preserve those documents to avoid another full HTTP export.
The exact exception was swallowed by the execution boundary, so no root cause is claimed yet. No further real
model dispatch, reentry, W5PASS or W6-W8 until diagnosis/fix/independent checking.

Read-only performance note `w5-evidence-read-progress-2026-10-03.md` records bounded page/body fanout, no repeated
body URLs within an invocation, and repeated full-candidate validation per Native evidence page. No performance
source change was made during the real run.
