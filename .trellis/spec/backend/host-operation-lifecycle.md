# Host-Bound Operation Lifecycle

This contract is the shared implementation pattern for any Core-tracked operation whose effect or required resource
belongs to a specific Execution Host. It applies to Scheduled Tasks, MCP calls, Skill support-resource reads, Shell
Capabilities, and future long-running host work. A task-specific module supplies intent and payload; it does not create
its own offline state machine or one-off Home card.

## 1. Scope / Trigger

Use this contract when an operation:

- names a `targetHostId` or resolves to a Host-owned capability, Workspace, Skill, or MCP instance;
- can be delayed by Host availability;
- can lose its connection generation while executing; or
- needs an operator-visible pending, failure, unknown-outcome, expiry, or explicit-resume result.

Core-owned operations that do not use a Node may skip the Host preflight, but still use the same Run/attempt evidence
and generic result projection when they are user-expected background work.

## 2. Signatures

The exact Zod/serde schemas belong in `@taki/shared` when implementation begins. Keep Agent-selected intent separate
from Core-owned execution identity:

```typescript
type HostOperationState =
  | "ready"
  | "waiting_for_host"
  | "running"
  | "completed"
  | "failed"
  | "outcome_unknown"
  | "expired"
  | "cancelled";

interface HostOperationIntentBase {
  targetHostId: string;
  capabilityId: string;
  input: unknown;
}

type HostOperationIntent = HostOperationIntentBase &
  (
    | { whenHostOffline?: "fail" }
    | { whenHostOffline: "wait-for-user"; expiresAt: string }
  );

interface HostOperationRuntime {
  runId: string;
  attemptId: string;
  policyGeneration: number;
  connectionGeneration: number;
}

interface HostOperationEnvelope {
  intent: HostOperationIntent;
  runtime: HostOperationRuntime;
}

interface HostOperationReceipt {
  runId: string;
  attemptId: string;
  targetHostId: string;
  state: HostOperationState;
  reasonCode?:
    | "host_offline"
    | "host_reconnecting"
    | "host_revoked"
    | "deadline_exceeded"
    | "outcome_unknown"
    | "policy_changed"
    | "capability_missing";
  retryAction?: "resume" | "retry-after-inspection" | "none";
}
```

`runId`, `attemptId`, policy generation, and connection generation are sealed Core control data, never model input.
`runId` identifies the logical operation and `attemptId` identifies one execution attempt. A reconnect never creates a
new attempt implicitly and never changes the target Host implicitly. Omitting `whenHostOffline` means `fail`.

## 3. Contracts

### Core orchestration

1. Before the model call, provide a Core-generated Host Context containing authenticated Host availability and
   ownership. The Agent may choose a Core-only path, split Core work from later Host delivery, or request one explicit
   Host-bound operation. A user-bound target Host cannot be changed silently.
2. Resolve and freeze `targetHostId`, capability identity, policy generation, connection generation, and any expiry
   immediately before dispatch. Agent-visible metadata cannot supply these sealed control fields.
3. Run the common Host preflight. `connected` is necessary but never sufficient; policy, Approval, capability
   catalog, and Host-local stricter floors still apply.
4. If the operation is side-effecting and the Host is `reconnecting` or `disconnected`, transition to
   `waiting_for_host` only when the Agent selected `whenHostOffline: "wait-for-user"` with a valid `expiresAt` and the
   current Run is eligible for a user-visible receipt. Omitted or `fail` handling fails with `host_offline`.
5. Bind the request to one connection generation. A generation loss settles the owning attempt; it does not redirect
   the request to another Host or a newer generation.
6. Publish one generic receipt projection. Task-specific code supplies labels and bounded summary data, not a custom
   offline card or duplicate status mapper.

`whenHostOffline` is an execution-time planning choice, not a persisted permission mode or a rigid field on every
Scheduled Task. The safe default is `fail`. `wait-for-user` is bounded, does not grant authority, and is available only
to user-expected interactive/Class A work. A Heartbeat may choose a Core-only path or skip stale Host work, but it does
not create a waiting-for-Host backlog.

### Reconnection and recovery

- A reconnect republishes the Host catalog and current availability before any resume is offered.
- Resume is an explicit operator action. It revalidates Host identity, capability availability, policy generation,
  exact input identity, and expiry before starting a new attempt or continuing a resumable one.
- A mutation whose remote outcome is unknown is recorded as `outcome_unknown` and requires inspection or explicit retry;
  it is never automatically replayed.
- Last-known catalog data may orient the operator but cannot authorize or execute an operation.

### Home projection

The Home surface renders the generic receipt using state, reason, target Host, time, and the allowed recovery action.
The UI must not contain one card component per task type. Task-specific detail is a bounded summary slot inside the same
receipt shape. A stale or unavailable operator client does not stop Core execution or make Home authoritative.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Target Host is `connected`, capability is present, policy allows | Dispatch the exact request; state becomes `running`. |
| Host is offline and handling is omitted or `fail` | `failed` + `host_offline`; no queue is created. |
| Host is offline and `wait-for-user` has a valid expiry on an eligible Run | `waiting_for_host` + `host_offline`; no dispatch. |
| `wait-for-user` omits/invalidates expiry or the Run is ineligible | Reject the intent; do not create an unbounded waiting row. |
| Host is revoked or unauthorized | `failed` + `host_revoked`; do not retry as a network failure. |
| Catalog generation no longer contains the capability | `failed` + `capability_missing`; require fresh discovery or operator repair. |
| Connection generation is lost during a cancellable call | Cancel/bound the call and settle `failed` or `cancelled`. |
| Connection generation is lost and side-effect outcome cannot be known | `outcome_unknown` + `retry-after-inspection`; never replay automatically. |
| Expiry is reached before explicit resume | `expired` + `none`; do not execute late. |
| Policy or Approval generation changed before resume | Re-evaluate; stale authorization cannot be reused. |

## 5. Good / Base / Bad Cases

- Good: a 09:00 task uses the VPS to prepare a report, then its desktop-write operation records `waiting_for_host`,
  shows one generic Home receipt, and resumes only that delivery step after operator confirmation.
- Good: a VPS-owned MCP search continues while the desktop Node is offline because its target Host remains available.
- Good: a time-sensitive Heartbeat read omits the policy, fails safely as `host_offline`, and creates no stale backlog.
- Base: a command loses its socket after dispatch; the receipt says `outcome_unknown` and asks the operator to inspect
  before retrying.
- Bad: silently route a desktop file request to the VPS Workspace because the VPS is online.
- Bad: replay every queued offline request on reconnect, or implement separate offline-card/status logic for each task.

## 6. Tests Required

- Shared schema tests: state/reason combinations, required Host/run/attempt identity, and rejection of unknown states.
- Core orchestration tests: omitted-policy fail default, bounded wait transition, ineligible/unbounded wait rejection,
  Core-first/Host-later continuation, policy-generation revalidation, and no silent fallback.
- Connection-generation tests: cancellation, unknown-outcome settlement, stale response suppression, and no automatic
  replay after reconnect.
- Receipt projection tests: one generic card for Scheduled Task, MCP, Skill-resource, and Shell examples; bounded task
  detail does not change the common action/reason mapping.
- Integration/manual checks: disconnect before dispatch, disconnect during a side effect, reconnect with changed
  catalog/policy, and a Core-only run while all user Nodes are offline.

## 7. Wrong vs Correct

```typescript
// Wrong: each task invents a disconnected branch and a custom card.
if (!desktopOnline) {
  showDesktopTaskCard();
  queueForReplay(task);
}

// Correct: the shared runner owns Host availability, identity, and receipt projection.
return hostOperationRunner.start({
  intent: {
    targetHostId: "desktop-01",
    capabilityId: "workspace.file.write",
    input,
    whenHostOffline: "wait-for-user",
    expiresAt,
  },
  runtime: { runId, attemptId, policyGeneration, connectionGeneration },
});
```

The Agent may select one of the bounded offline outcomes after reading Host Context. Task-specific code may provide a
label and bounded summary, but it must not duplicate Host state transitions, retry/replay rules, or Home status-to-copy
mappings. Runtime validation remains authoritative even when the Agent planned against an apparently connected Host.
