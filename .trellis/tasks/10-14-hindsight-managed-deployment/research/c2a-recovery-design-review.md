# C2a isolated Docker recovery design review

Date: 2026-10-15. Reviewer: /root/c2_design_check.

**PASS for the proposed bounded recovery slice, with the executable clarifications below.**
The [plan](c2a-recovery-plan.md) can proceed to its task-local implementation under the existing
authorization. No production or shared relay change is required. This is design acceptance only.

## Deterministic fault and canonical outcome

The existing relay supports the proposed fault. In e2e/src/fixture/ws-relay.ts:175-184, the response
mutator executes before forwardToCore checks the upstream state. closeRelay at :159-167 calls
closeRelayPair at :153-157 synchronously before awaiting server closure; that removes the pair and
terminates both sockets. Calling close() inside the exact matching response callback therefore
prevents forwarding/queueing that response. Await the captured close promise outside the callback.
The callback slots are cleared before invocation, so rearming for an unmatched request/response is
supported. Match the full inject request/control/resource tuple, not a response ordinal.

This loses one successful Shell-to-Core inject completion after Native consumption and the Host's
observed fence. It does not exercise loss of the private Native ACK. Keep that distinction in every
runtime result. Require the exact drop, closed relay, observed Host injection, and actual surviving
child before accepting the fault; a timeout by itself is insufficient.

Core capability-broker.ts:99-108 retires the disconnected generation through interruptedOutcome;
capability-broker-state.ts:156-165 returns OUTCOME_UNKNOWN for effects. The C2 owner's routeFailure
and settle paths at hindsight-deployment-owner.ts:194-212,233-237 preserve the canonical uncertainty.
Use the actual wire spellings: public DeploymentStatus.state is "outcome-unknown"; persisted Run
and Attempt outcome is "outcome_unknown". Read both from the existing run.status result and wait for
this settlement before terminating Core. Do not require the unseen success payload to appear in
Core's accepted history. recovery-coordinator.ts:46 skips an already terminal unknown
Run, so reopening must preserve that history even when Host observation now reports running.

## Reopen is feasible without re-enrollment

The debug Shell loads node-data/secrets.json in bin/taki-node.rs:72-74,123-137. node.rs:159-170
reuses device-id, while ws_client.rs:113-138 loads node-token and persists issued tokens. Core's
connect.ts:81-86 verifies that token against its retained device registry. The same intact data
directories support an ordinary authenticated reconnect; no keyring or fixture state rewrite is needed.

The second Shell must receive the new Core's reachable URL directly; the first relay is permanently
closed. A second passive relay is unnecessary for this slice. Keep the accepted node data/config and
wait for connected/catalog publication, rather than copying the first-case boot helper's unconditional
Node pairing-code wait or permission reset. A fresh operator may pair separately as planned. Missing
or rejected retained Node credentials fail the reopen proof; do not silently re-pair the Node.

Reap the captured Shell/helper before replacement. hindsight_windows/deployment.rs:23-28 retains
the state lock through resident teardown; :82-89 opens the resident on demand. Core start's durable
lookup precedes new admission (:39-45), and Host observe only inspects/control-reads (:53-64).
Require identical original attempt/step facts through reopen; registry revision may advance on reads.
No new C2 Run or effect is justified by same-key start or observation.

## New-startup identity assertions

One explicit restart of the exact owned container preserves the container/image/volume. The new
Native startup must remain waiting and unbound, with no child, through read-only observation and
the repeated initial start key. The fixed volume/tmpfs markers distinguish original-volume retention
from fresh tmpfs; they establish filesystem persistence only.

The actual owner permits resume from the original terminal unknown Run, after observing a new waiting
startup without an attempt (hindsight-deployment-owner.ts:77-94). Its stable per-startup key prevents
the repeated resume from reinjecting. Use these exact identity expectations:

| Must be fresh for the new admitted startup | Remains stable / must not be forced to differ |
| --- | --- |
| Native startup, C2 startup Run and Core attempt, Host request/attempt, Effect, checkpoint, startup authorization | Original deployment/operation/parent Run, Host/Core installation identities, image, container, volume and configuration |
| C1 snapshotId and preparation's original operation/attempt/request mapping | Catalog store/key version, sealed-envelope digest and fixed selection/update times when no Catalog mutation occurred |
| Current live C1 handle; coreBootId differs from the terminated Core | Private publication revision is not exported evidence and need not numerically increase across boots |
| Current authenticated session/control binding | Connection/catalog counters can restart with a new Core; policy generation may remain unchanged |

catalog-custody.ts:44-65 mints snapshotId per capture and coreBootId per owner construction, while
retaining current Catalog bytes/version/selection. No new Catalog mutation is needed to manufacture
"fresh custody". Record actual fresh values and their links; retain the old inject entry unchanged.

## Evidence and owned bounds

Keep the plan's fresh token/roots, single serial Core/Shell generation, exact resource cleanup and
finite budgets. The eight-minute sequence budget never extends a child's 300-second lifetime or a
90-second grant. Pin child identity with startup plus PID/process-start facts before and after reopen.

Require one container creation, one owned volume creation, the initial start plus the one explicit
maintenance restart, and two submissions total. Use the correct resource's bounded events for each
count, including the named volume's events when claiming its creation count. Cross-check registry
and exec identities; control/probe exec counts are not grant counts. Preserve decisive nonsecret
event/exec/Run facts and scan evidence, without private frames or authentication credentials.

## Findings (fixed)

No source defect required a fix. This review resolves the plan's persisted-authentication open item,
the second-generation URL/boot behavior, exact unknown-outcome fields and fresh-versus-stable identity
assertions. Implement these in the new task launcher; keep the frozen first-case helper unchanged.

## Findings (not fixed)

No design blocker remains for this slice. Private Native ACK loss, inner create/start/submit fault
boundaries, custody rotation/unavailability, controlled daemon restart, database, C1 service AC2/6,
C2b and real-model/business-data/manual acceptance remain open. deploymentReady remains false.

## Verification

- Lint / TypeCheck / Tests: not run; this is source/design inspection, not an implementation check.
- Accepted source tests and the first actual Docker case were neither rehashed nor rerun.
- Only this report was written for the recovery review. No runtime, Docker/WSL, build/install,
  production/shared-fixture edit or Git lifecycle action occurred.

Ownership of this report is released to Root.
