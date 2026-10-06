# W6 final isolated emergency and paired recovery acceptance

Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.

**W6 PASS for the approved isolated automated scope.** The original committed emergency recovery, independent
process restart and actual D91 paired restore all completed. Their supervisors exited0 and preserved their
inventoried sources and original inputs. No corpus conversion or new model request occurred. W7/W8 and
owner/manual/original-environment acceptance remain open.

## Original committed recovery and independent restart

Actual root:`.trellis/.runtime/stage4-w6/db280d150f6340618b340a70439b43f7`.
History:`b389441a92e74f2988071642a3ef832e`. Supervisor exec70621 and both Node processes36860/38428 exited0 normally.

- Original transition:`0faf660d-9d8c-4215-ae5f-954f9f574734`.
- Original receipt:`5da1b2448bcc7ccaf0a41d5cbfa50fc9ea5e6f77e3610082300c7ea9477eed31`.
- Selected Local epoch:`c4f53993-517e-4d97-96cd-7e916620ce29`.
- New recovery operation:`bfdb9a3d-8ee7-4e51-9cba-9b26712b0c1a`, completed/ready/settled.
- Original capture/incident/candidate and all three older unknown operation row hashes remain unchanged. All four
  previous failed executions remain retained; their results were not rewritten or relabeled successful.
- Exact historical installation and current producer-backed retention agree on2Banks/722Sources/1275records,
  including89invalidated, with0new retention changes. Independent restart retained the same selection and data.
- Additional Native/transport/model and in-flight calls were0. Old foreign-authority reentry refused.

Both extra full audits yielded to the existing heartbeat and passed same-executor checks. Production bind took
178.172s and queue settlement256.554s. This was the unchanged production lease/heartbeat mechanism. The only
post-rehearsal adjustment was the task supervisor's1800→3600s limit, with11Python regressions and Ruff passing.

Final actual Core SHA:`90eeaaa1482bfea5b7c5cfbb998064ee9305f463c58f0c7f8530d972c8828c15`.
Supervisor SHA:`82c1ec833d94d59859119c98bd3f9ced8ebead47be50b8ad49c07f349d68cd69`.
Parent's final immutable readonly selection/outcome audit left Core bytes unchanged and no sidecars.
Details:[actual result](w6-actual-committed-recovery-result.json), [prior full rehearsal](w6-committed-rehearsal.md).

## Actual D91 paired restore

Owned root:`.trellis/.runtime/stage4-w6-restore/06f1a45b700f447aa313d355ee94f35e`.
Supervisor exec27235 exited0. This separate drill restores the preserved W5 Hindsight pair, not the emergency
Local working database. Original W5 and prepared W6 PGDATA were never started or modified.

1. Real `backup.capture` created backup`b4157111-fe4c-4acb-a3fb-a853d73925f6` and its original Native request.
2. The shipped Native backup/restore CLI restored into`w6_restore_dfb3b25982d04f558f481a65988a5649` on the new PGDATA.
   Complete sorted rows of all56tables and trigger modes matched; the source schema remained unchanged.
3. Owned PostgreSQL stopped normally before a separate Core process admitted/sealed the same backup. Parent
   verified no postmaster PID file and no listener on its recorded port4686 after the supervisor finished.
4. Actual Core pre-writer validation passed the exact Native/Core pair, receipt, Bank checkpoints, retained
   Source/artifact/body closure and real encrypted fixture catalog. It did not start Core writers or a model.

The restored pair preserves Hindsight epoch`9a27367e-afb5-4a0a-ae55-2fbb7b07e8b4` and receipt
`c6dc908527eaec7b70c57151a5c08cef0dcde986d787fc69da9f50d00c4ab450`.
Core artifact SHA:`bddfa927585ad629100d62efaa08baec1e512244ee174cf8a7edc9021f002e66`.
Native ZIP SHA:`241d0ea12c1c83d636f034e8306f7e209ab0c6b33897ca4385c96d7ac20fb42b`,134826043bytes.
Native records include1186active plus89invalidated units and722documents across2Banks.

Credential custody uses only the existing public test HTTP credential in a new owned encrypted catalog and key
directory. No external/user credentials were read. This proves the fixture recovery procedure, not host/DPAPI
portability or original-user replacement. Original partial-effect continuation remains covered by the unchanged
Native/Core deterministic tests; the real corpus was not modified to manufacture an unfinished effect.

## Evidence reuse and remaining work

Machine-readable final evidence:[w6-final-result-2026-10-06.json](w6-final-result-2026-10-06.json), including exact
phase/report/source-manifest hashes. The source freeze held through both actual supervisors. Existing independent
W6 policy, custody, seal/ACK/COMMIT/reopen, process, heartbeat, Native restore and tamper/refusal checks remain
applicable; this run did not duplicate their counts. The latest112Taki/5Native overlay is supplemented by each
supervisor's full source inventory.

W7 may now implement the prepared Core/operator/Desktop interface. Its changes and the whole task are checked
together in W8 according to the approved cadence. Large-data startup/preview/status latency remains a documented
follow-up unless it blocks usable request/observation behavior. No commit, push, reset, rebase or archive occurred.
