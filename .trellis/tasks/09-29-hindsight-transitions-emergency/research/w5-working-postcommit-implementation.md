# W5 exact post-COMMIT continuation

Delivered for parent review. No actual working-copy data, credentials, services, network or model were accessed by this implementation. No production source, lease, timeout, migration or sealed predecessor entry changed.

## Current factual boundary

Parent reported that session26459 completed the two Native proofs, both Core evidence documents, the candidate and final proof, and committed Hindsight authority. It subsequently failed with `MEMORY_TRANSITION_LEASE_LOST` at `native-finalization`. The stopped copy retains:

- Transition: `6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53`.
- Receipt: `c6dc908527eaec7b70c57151a5c08cef0dcde986d787fc69da9f50d00c4ab450`.
- Selected Hindsight epoch: `9a27367e-afb5-4a0a-ae55-2fbb7b07e8b4`.
- Exact stopped Core SHA256: `6c55c27eae7c11bc824ca71b263611092520c66a8b231164d049a88ed00e98dd`.
- Model submissions:551, with no new allowance in this delivery.

These runtime observations came from the parent, not this implementer's data access.

The receipt's `committedAt` is the publication call's captured `input.now`, not an independently measured SQLite COMMIT completion time. `memory-transition-publication-repo.ts:50-64` still performs representation publication and full read-back synchronously before `sqlite.ts:94` commits. `transition-healthy-execution.ts:173` is the first explicit event-loop boundary after publication. Thus the finalization lease failure does not prove that all elapsed time after `committedAt` was outside the publication transaction.

The existing driver is the shortest legal recovery path: `transition-healthy-execution.ts:134` skips drain/fence/candidate/proof/publication when the receipt exists, then enters normal finalization. `transition-native-session.ts:42-58` claims an expired Native executor under the same transition; `:72-78` records the original receipt-bound activation decision. Native executor TTL remains300seconds; expiry revokes execution, not durable fences or completed proof. No new performance or lease mechanism is needed to try this ordinary post-COMMIT recovery.

## Narrow entry and retained controls

`w5-working-postcommit-continuation.py` delegates to the unchanged network continuation and working recovery. It exposes only `--run-reviewed-working-copy`; default invocation is inert. Root, receipt, epoch, cap, approval path, stage and renewal cannot be overridden by CLI.

The callback replacing `entry.read_core` calls the original `read_core(after=True)`, preserving historical return, exact reentry, Local mutation, original preparation and unsettled-WAL checks. It adds positive receipt/publication/proof/candidate/baseline/selected-marker joins and compares immutable document bytes before and after recovery. This is a narrow stopped-copy admission check, not a second implementation of Core proof hashing; ordinary Core continues its full independent validation. The parent's exact stopped Core SHA pins every initial database byte.

**The pinned Core SHA permits this stopped snapshot only. If recovery fails again after changing the database, do not blindly repeat or edit the pin: inspect and review the newly durable state first.** Completed transitions, absent/foreign/conflicting joins, a wrong ROOT, missing/still-running ownership, unsettled WAL, changed initial Core bytes and a counter other than551 refuse.

`w5-working-postcommit-zero-allowance.json` fixes `banks=[]`, original transition/return receipt, and cumulative cap551. The wrapper additionally forces the actual existing socket guard to `model_access=False`; an empty approval file no longer enables model DNS/network permission. **Necessary owned-loopback PostgreSQL/HTTP traffic, including Native activation, remains allowed.** The unchanged per-Bank gate and cumulative budget remain in force. No model dispatch, reconversion, new RETURN, repeated Local edit, reentry renewal or migration execution is authorized. The pre-existing migration proof is required; the old authenticated verify-only path remains intact.

The old supervisor still owns exclusive locking, process/credential custody, original history read-backs, immutable submission history and cleanup. This wrapper restores its in-process callbacks on return or failure and writes a new `working-postcommit-history/<id>/result.json` during a parent-run invocation. The old recovery/network reports remain separate and unchanged.

## Verification and source identity

- 23 focused synthetic cases passed: exact initial/final joins, missing/conflicting/foreign receipts and dependencies, wrong marker/epoch, completed state, ownership and WAL refusal, changed Core bytes/counter, inert/restricted CLI, fixed zero allowance, actual guard argument forced false, and callback restoration.
- Ruff E/F/I, Ruff format and ty passed for the three new Python files. First lint found one unused test import and two long test schema strings; those were fixed. Both test runs and type checks passed. Raw commands/results are in `w5-working-postcommit-checks.json`.
- Original5107 manifest entries are copied unchanged.5077 non-runtime files were read and matched their original size/SHA.30 historical `.runtime` log/ownership/result entries were deliberately not read; their sealed metadata is unchanged, and this task wrote none of them. The parent's normal `verify_sources()` still checks every entry before and after actual execution.
- No production/full predecessor suite, benchmark or real-data run was performed.
- Parent subsequently executed actual `stopped()` plus `read_committed()` read-only preflight: **PASS in3.079seconds**, including actual receipt/publication/proof/candidate/baseline/marker joins and pinned Core SHA. Parent reports no state changes. This was parent-owned validation, not an actual-data call by the implementer.

New source manifest: `w5-working-postcommit-source-manifest.json`.

- Entries: **5113** =5107 original +6 new dependency/evidence entries.
- SHA256: **`3e2d20efba5911f4142d07d8115635ac7cbc805a3719d5cc1bd617071572e5cb`**.
- Predecessor SHA256: `36b8dd3c0da110d044f1b1a8c56e88c8fcace742059f0f0b2c7d880b1fe6b9e6`.
- New pinned files: entry, custody helper, synthetic tests, fixed zero-allowance JSON, check evidence and the predecessor manifest itself. This report is outside the executable inventory so it can name the final manifest hash without a circular self-hash.

## Parent commands

Working directory: `H:/TakiAgent`. A fresh Python process is required because existing audit hooks are intentionally permanent.

Default, inert:

```powershell
& H:/hindsight/.venv/Scripts/python.exe -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-working-postcommit-continuation.py
```

After parent review and complete source verification (the parent-owned actual read-only preflight has passed):

```powershell
& H:/hindsight/.venv/Scripts/python.exe -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-working-postcommit-continuation.py --run-reviewed-working-copy
```

Do not supply an underlying supervisor command, approval, cap, stage, root or renewal override. A refusal is a review boundary; it does not authorize weakening any exact receipt/source/ownership check.

## Continuation checkpoint

Implementation is complete, synthetic checks are green, and parent-owned actual read-only preflight has passed. Parent owns the next actions: verify the complete5113-entry manifest, including the30 untouched historical runtime entries, then run the reviewed existing copy. Confirm Native activation, runtime readiness, queue/resolution completion, fixed551 submissions and preserved source/document identities through the existing reports. Actual recovery completion is not claimed here.
