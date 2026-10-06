# W6 independent review

Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.
Reviewer: `/root/w5_postpatch_review`. Date: 2026-10-06.

**Latest source addendum:** the original sealed recovery later reached proven but its final publication refused
with `MEMORY_TRANSITION_LEASE_LOST`, leaving candidate/proof durable and no authority COMMIT. The scoped synchronous
context repair and 64 newly passed regressions are recorded in [w6-context-checker-repair.md](w6-context-checker-repair.md).
Its new `w6-context-repair-source-ownership.json` supersedes affected paths for the next execution; the prior
22-file manifest is retained as history. Actual copied-Core wall-clock rehearsal, recovery/restart and D91 remain pending.

## Current verdict and ownership

The scoped source repairs and independent automated checks below are complete. **W6 product PASS remains pending
the parent-owned actual original-transition recovery, separate-process restart and D91 paired restore.** Synthetic
proof is not real-corpus acceptance. W5 remains accepted with its final audit corrections; W7/W8 and owner/manual
acceptance remain open. No original corpus was opened by this reviewer, no original authority was replaced, no
dependency was added, and no Git commit/push/reset/rebase/archive was performed.

Core: `H:/TakiAgent`, `main`, HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
Native: `H:/hindsight`, `main`, HEAD `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`.
The legacy empty `.current-task` did not cause task recreation; the existing parent session binding and explicit
task path were retained. Parent owns actual supervisors and execution. Reviewer owns the repairs/test files listed
in `w6-checker-source-ownership.json`; exact current hashes supersede earlier admission-only hashes.

Additional earlier admission documentation owned by this reviewer: `packages/core/src/memory/operations/index.md`,
SHA-256 `1e6d6a8488d108687900946a18acb1da2433014dfd25acdcb0f2ba48dd1cc9c9`, describes the operation-owner entry timestamp.
It was omitted from the combined 22-file manifest, but parent independently identified and verified this known
documentation delta before execution. The manifest is retained unchanged; no source change or new test is needed.

## Findings (fixed)

1. **Emergency confirmation expired during its own synchronous admission.** An actual preview was submitted 6 ms
   after creation but repeated local verification exceeded the 120-second window. The operation owner now records
   one fresh admission-entry time in its bounded independent evidence context; emergency plans use that time while
   rereading current identity/configuration/preview/recovery. Expired new submissions still refuse; exact request
   retries observe their original operation. Healthy final real-clock expiry is unchanged. See
   `w6-admission-checker-repair.md` for the original failure, code contract and independent 41-test result.
2. **Offline execution never renewed its five-minute lease.** `transition-execution-heartbeat.ts` now supplies the
   existing healthy serial renewal/boundary/cleanup mechanism to both drivers. Emergency renews only Core ownership,
   yields outside transactions between complete work stages, and aborts further work on stop/renewal failure or
   foreign/expired executor. A 360-second cumulative execution stays on generation 1; a single expired step refuses.
3. **Emergency publication could finish after its captured timestamp's lease expired.**
   `memory-transition-emergency-publication.ts` now checks configuration and the actual clock after complete
   publication/read-back, immediately before the outer COMMIT. It retains the captured executor identity and accepts
   only receipt insertion's one revision increment. Expiry rolls back target epoch/selection/installation/receipt/
   foreign branch together. Post-COMMIT bind failure retains the committed authority and recovery truth.
4. **An unchanged Native-created unit lost access to its already committed policy during emergency projection.**
   `memory-transition-surviving-policy.ts` independently verifies the predecessor publication/candidate/evidence and
   exact namespace/generation/full application head/full Native record/mapping/initial-policy/provenance joins.
   Only the original committed Canonical record/history may then be reused. `transition-local-projection.ts`
   preserves its logical document/source-memory references, Local revision/timestamps, policyVersion/updatedAt and
   provenance without performing Native-ID translation twice. Missing or changed correspondence refuses; no default
   policy, dropped record or old-proof-as-new-certificate shortcut was introduced.
5. **The one-shot Node driver could not express the required original sealed transition recovery.**
   `w6-owned-emergency-driver.mjs` accepts the additional `--recovery-transition-id <uuid>` only for its emergency
   phase. It uses the existing preview/submit recovery contract, requires an expired uncommitted original executor,
   and retains the original unknown operation hash, capture and incident across completion and distinct-process
   restart. It never creates a replacement emergency when this option is present. Parent-owned supervisor code
   was reviewed without modification.
6. **Stale module description.** `hindsight-backup-emergency.ts` now describes its actual emergency caller.

Emergency spec and touched folder indexes were synchronized. No new lint exemption was required: the cohesive
repairs pass existing configured limits.

## Findings (not fixed)

No additional confirmed source defect remains open in the reviewed scope. The following are acceptance work, not
waived checks or claims of success:

- Actual recovery must use transition `0faf660d-9d8c-4215-ae5f-954f9f574734`, original operation
  `0505474f-3dc3-4b04-8a03-409e8634d239`, capture `c0067448-2ea5-4548-aea3-97841eff2216`, and incident
  `05f6c765-b099-4894-a191-32c83969a481`. No fresh emergency or blind replay is permitted.
- Actual D91 requires a separate preserved-input copy, real route-b capture/admit, all 56 Native table row bytes,
  trigger modes and actual encrypted fixture Secret Catalog preflight. User-catalog/DPAPI portability and original
  production replacement remain unperformed manual boundaries.
- Trellis validation passes but reports its existing `memory-transitions.md` 33,379-byte context-injection warning.
  This review read the file directly; an injected truncated view alone would not satisfy future context loading.

## Review coverage

The reviewed paths include offline preview/admission/quarantine, committed-but-unbound reentry attribution,
nonwaiting old-producer retirement, create-only partial/seal/read-back and exact seal reuse, complete Bank inventory
and unknown remote loss, incident/candidate/receipt/custody/Pending joins, runtime/background lifetime guards and
foreign-branch refusal. The shared heartbeat retains healthy Core+Native renewal behavior.

D91 source review covered Core stage/seal/preflight, actual catalog access, complete backup table transfer,
required trigger modes and rollback, original partial-result continuation, owned child timeout handling and precise
PG identity/stop boundaries. `w6-owned-emergency-sealed-recovery.py` pins both prior failures, stopped Core, original
capture/incident and absent receipt; its reviewed command appends recovery only to emergency. The paired supervisor
requires completed emergency/restart, copies preserved inputs, runs stage -> Native restore -> stop PG -> seal ->
immutable preflight, and retains failed child evidence. Prior implementation/supervisor test counts are not counted
as newly executed reviewer checks.

## Verification

All Vitest invocations use `--maxWorkers=2`. Tests run on synthetic owned data only.

| Independent execution | Result |
| --- | --- |
| Admission/service/evidence-context/admission-verification, earlier repair | 4 files / 41 tests PASS, 69.55 s; root lint/types PASS at that release. |
| Emergency lease plus healthy scheduling, first heartbeat validation | 2 files / 12 tests PASS, 25.02 s. |
| Surviving-policy plus expanded emergency lease tests | 2 files / 9 tests PASS, 32.54 s. Exact Canonical/history retention; namespace/head/body/native drift, absent baseline, durable record/policy/history corruption refuse; stop/failure/foreign executor and terminal cleanup pass. |
| Actual Node driver protocol on synthetic stopped Core | 1 file / 2 tests PASS, 28.01 s. Fresh and original-sealed recovery each followed by distinct Node restart, same receipt/epoch, original operation/incident/capture hashes and zero new Native/transport/model dispatch. |
| Existing emergency service, recovery, publication, preview and seal cases | 5 files / 26 tests PASS, 63.49 s. |
| Native transition backup, partial append result recovery, application backup | 3 files / 4 tests PASS, 46.81 s. New owned PostgreSQL only, all complete rows/trigger modes and original partial receipts; runner exit 0, stopped true. |
| `pnpm lint` | PASS. |
| `pnpm -r typecheck` | PASS, all five projects. |
| `git diff --check`; Node driver syntax | PASS (Git emitted existing CRLF normalization notices). |
| `python .trellis/scripts/task.py validate .trellis/tasks/09-29-hindsight-transitions-emergency` | PASS: implement 43 and check 52 entries; existing size warning above. |

Native command:

```powershell
node .trellis/tasks/09-29-hindsight-transitions-emergency/research/native-tests.mjs tests/native_results/test_transition_backup.py tests/native_results/test_backup.py tests/native_results/test_application_backup.py
```

Native evidence: `.trellis/.runtime/stage4-native-tests/bbea91529fa55aee/result.json` and `pytest.log`.
Only newly owned `taki-drill-4a0464c4f8bc`, port 11149, ran; the supervisor confirms it stopped. No Native production
source was changed. Model/embedding fixtures are deterministic and external network is blocked by the runner.

Retained diagnostic failures: the first policy regression failed before the tested emergency path because its
synthetic Native head revision was 7 while payload revision was 1. Correcting that fixture made the complete journey
pass. A test-only `body_hash` field typo was caught by Core typecheck, corrected to `bytes_sha256`, then root types
passed. No production validator was relaxed for either failure.

## Retained actual execution evidence

These facts originate from parent reports, not this reviewer's access to real corpus databases:

- First actual session `13166`: `MEMORY_TRANSITION_STALE` during submit; no admission/incident/authority effect.
  See `w6-first-actual-refusal.md`. Original result and inputs remain preserved.
- Second actual session `81335`, history `abe6344ee4bb433dbef99fa25047bbf9`: admitted and sealed, then
  `MEMORY_TRANSITION_PROOF_INVALID` in fenced projection before lease expiry. One capture/incident, no receipt,
  original authority unchanged; all Native/model/transport counters zero. See `w6-second-actual-refusal.md`.
  Parent's readonly correspondence probe found 13 Character missing-policy heads exactly matching committed W5
  Native/application/mapping/Canonical/initial-policy evidence; Global had none.
- Actual original-transition recovery, independent restart and D91 results will be appended after the parent run.
  Neither retained failure is relabeled successful by the later synthetic passes.
- Parent's complete repaired readonly projection probe passed in 143.259 s: 2 Banks, 722 Sources, 1,275 records,
  4 derived rows, 2 Blocks, 741 history rows and 1,275 SourceSets; pending 0. All 13 original Canonical policies
  were reused under the strict correspondence checks, complete closure and Shared schema passed, and both original
  incident evidence/checkpoints matched. Working and sealed Core hashes were unchanged. See
  `w6-repaired-projection-result.json`; this is readonly projection evidence, not authority/restart acceptance.
