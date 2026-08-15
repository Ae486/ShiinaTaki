# Host-Bound Operation Lifecycle

This contract is the shared implementation pattern for any Core-tracked operation whose effect or required resource
belongs to a specific Execution Host. It applies to Scheduled Tasks, MCP calls, Skill support-resource reads, Shell
Capabilities, and future long-running host work. A task-specific module supplies intent and payload; it does not create
its own offline state machine or one-off Home card.

## Scenario: Implemented Host-control foundation

### 1. Scope / Trigger

Use this foundation whenever a Node-backed capability crosses the Core/Shell boundary. It covers Node connection
negotiation, complete catalog publication, explicit Host routing, generation-owned request settlement, cancellation,
and exact TypeScript/Rust wire parity. Run persistence, Approval challenge/resume handling, MCP runtime generations,
and generic Run Receipts build on this foundation but are not implemented by it.

### 2. Signatures

The canonical wire schemas live in `packages/shared/src/host-control-schema.ts`. Rust imports the strict serde mirror
through `crate::protocol`; the implementation may split definitions into sibling modules, but callers do not declare
parallel local shapes.

```typescript
const HOST_CONTROL_METHODS = {
  catalogPublish: "host.catalogPublish", // Node -> Core RPC
  request: "capability.request",         // Core -> Node notification
  challenge: "capability.challenge",     // reserved schema only
  resume: "capability.resume",           // reserved schema only
  cancel: "capability.cancel",           // Core -> Node notification
  respond: "capability.respond",         // Node -> Core RPC
} as const;

type HostFrameAck =
  | { accepted: true }
  | {
      accepted: false;
      reason:
        | "wrong_host"
        | "stale_generation"
        | "unsupported_version"
        | "invalid_catalog"
        | "unknown_request"
        | "duplicate"
        | "late";
    };

interface HostOperationControl {
  runId: string;
  operationId: string;
  attemptId: string;
  targetHostId: string;
  connectionGeneration: number;
  catalogGeneration: number;
  policyGeneration: number;
  approvalGeneration: number;
  capabilityId: string;
  inputDigest: string;
  idempotencyKey: string;
  dispatchedAt: string;
  deadlineAt: string;
  expiresAt?: string;
}
```

A Node `connect` request includes `host.protocol.{min,max}` and `host.catalogSchemaVersions`. A successful Node connect
returns the Core-selected `hostId`, protocol version, catalog schema version, and positive `connectionGeneration`.
`host.catalogPublish` sends one complete snapshot for that connection plus a positive `catalogGeneration`.
`capability.request`, `capability.cancel`, and `capability.respond` carry the same exact `requestId` and sealed control
tuple. The response state union is `completed | failed | cancelled | outcome_unknown`.

### 3. Contracts

- Node identity is not aliased: authenticated `deviceId == hostId`. Core's own stable UUID is stored at
  `<dataDir>/host-identity.json`. First creation fully writes and fsyncs a sibling staging file, then publishes it with
  create-only same-directory linking. A concurrent winner is read without overwrite. Malformed, invalid, or unreadable
  existing identity data fails boot; persistence failure never returns a minted identity.
- Core assigns a monotonically increasing positive `connectionGeneration` per Host for the current Core process.
  Replacing a socket retires the prior socket synchronously; frames from it are stale even if their payload is valid.
- Catalog publication is complete and atomic. Only the current authenticated Node socket may publish for its own Host
  and generation. A current-generation invalid, unsupported, or non-monotonic candidate makes that generation
  non-routable. A wrong-Host, wrong-generation, operator, or stale-socket candidate cannot retire another live catalog.
- Legacy callers without `targetHostId` resolve only when exactly one live catalog advertises the capability. Zero
  matches is unavailable; multiple matches require an explicit target. Never replace this rule with first-match order.
- Core owns the sealed control tuple and computes lowercase SHA-256 over deterministic canonical JSON of the validated
  capability identity and exact input. Model text, operator-facing labels, Host labels, Skills, and MCP metadata cannot
  provide or alter these fields.
- The broker owns terminal settlement. Pending work is keyed by request identity and authenticated Host generation.
  Its bounded 256-entry insertion-order terminal cache records only control/provenance and whether a repeat is
  `duplicate` or `late`; eviction degrades to `unknown_request`. Per-request logs omit stable `hostId`.
- A read with cooperative cancellation sends `capability.cancel`; a deadline or generation retirement suppresses late
  settlement. A side effect whose result is unknowable settles `outcome_unknown` and is never replayed automatically.
- The Rust `HostSession` owns one live generation and has its own 256-entry insertion-order terminal response cache.
  An exact duplicate may reuse the cached response; a conflicting attempt/control tuple is rejected. Reconnect creates
  a new session and discards the old cache. Cooperative cancellation cannot forcibly stop arbitrary blocking OS work;
  it stops accepted settlement and suppresses the late response.
- Rust serde mirrors must reject unknown object fields wherever the Zod source uses `strictObject`, including nested
  response error objects and each discriminated response arm. Shared golden fixtures are the cross-language truth;
  serde derive success alone does not prove Zod refinement parity.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Node declaration has no compatible protocol/catalog version | Refuse connection negotiation; no Host generation becomes routable. |
| Current socket publishes a valid newer complete catalog | `{accepted:true}`; atomically replace that Host's live snapshot. |
| Current socket publishes unsupported or non-monotonic catalog data | `{accepted:false, reason}` and retire that generation's live catalog. |
| Structurally invalid catalog matches the current authenticated Host/generation | Return JSON-RPC `INVALID_PARAMS` after retiring that generation; cleanup failure becomes `INTERNAL_ERROR`. |
| Invalid candidate claims another Host/generation, comes from an operator, or arrives on a stale socket | Reject without retiring the current live catalog. |
| Legacy route has two Hosts advertising the capability | `TARGET_HOST_REQUIRED`; do not dispatch. |
| Response has a valid request ID but wrong authenticated Host | `{accepted:false, reason:"wrong_host"}`; pending work remains. |
| Response has stale connection/control generation | `{accepted:false, reason:"stale_generation"}`; pending work remains. |
| Exact response repeats after successful settlement | `{accepted:false, reason:"duplicate"}`. |
| Exact response arrives after deadline/cancel/disconnect settlement | `{accepted:false, reason:"late"}`. |
| Response ID was never issued or its terminal record was evicted | `{accepted:false, reason:"unknown_request"}`. |
| Host generation disconnects during a cooperative read | Settle only that generation's reads as disconnected/cancelled; Host B work remains pending. |
| Host generation disconnects during a side effect | Settle `outcome_unknown`; never auto-dispatch to the replacement generation. |
| Existing Core or Node identity file is corrupt/unreadable | Fail startup with a repairable diagnostic; never mint a replacement silently. |

### 5. Good / Base / Bad Cases

- Good: two catalogs advertise `process-list`; the caller supplies one `targetHostId`, Core dispatches only through that
  Host's current socket, and a response from the other Host is refused without settling the request.
- Good: a Host reconnects with the same stable ID and a new connection generation, republishes a complete catalog, and
  the prior socket/cache can no longer settle or route work.
- Base: one currently routable Host advertises a legacy capability, so an existing caller without a target continues
  to work through the single-Host compatibility seam.
- Bad: keep the prior catalog routable after the current generation publishes an invalid or unsupported replacement.
- Bad: treat matching `requestId` or payload `hostId` as provenance without checking `MethodContext.connection`.
- Bad: deserialize a Rust response with extra fields that the canonical Zod `strictObject` rejects.

### 6. Tests Required

- Shared: `host-control-schema.test.ts`, connect/capability schema tests, and `protocol-fixtures.test.ts` assert exact
  unions, invalid generations/IDs, and valid/invalid golden fixture classification.
- Core identity/catalog: restart stability, corrupt/unreadable failure, create-only race/no-overwrite, failed publication
  cleanup, current/stale socket publication, fail-closed invalid/unsupported/non-monotonic replacement, and immutable
  Host Context snapshots.
- Core routing/broker: explicit two-Host selection, single-Host compatibility, per-generation disconnect isolation,
  wrong provenance, duplicate/late/unknown classification, 256-entry eviction, deadline/cancel/unknown-outcome, and
  stable-Host-ID log exclusion.
- Rust: shared fixture parity, exact unknown-field rejection, request/control binding, duplicate-in-flight suppression,
  terminal response reuse, cancellation, late-output suppression, reconnect cache discard, and 256-entry eviction.
- Process smoke: the existing `withStack` reconnect scenario must prove real Core boot, identity creation, negotiation,
  catalog publication, and same-Host reconnect. At least one L1 capability scenario must prove real dispatch/response.
  A dedicated two-Node process scenario remains required before claiming process-level multi-Host coverage.

### 7. Wrong vs Correct

```typescript
// Wrong: payload identity and collection order decide authority and routing.
const node = connections.find((item) => item.capabilities.includes(capabilityId));
broker.resolve(params); // requestId alone settles work

// Correct: the current authenticated socket and complete live catalog are authoritative.
const target = resolveExplicitOrOnlyLiveHost(catalogs, capabilityId, targetHostId);
broker.resolve(params, {
  hostId: ctx.connection.state.host.hostId,
  connectionGeneration: ctx.connection.state.host.connectionGeneration,
});
```

The foundation is intentionally fail-closed. Later governance, Approval, MCP, Skill, and Run slices may add stricter
checks or durable evidence, but they must not weaken provenance, generation ownership, exact input identity,
non-replay, or complete-catalog publication.

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
