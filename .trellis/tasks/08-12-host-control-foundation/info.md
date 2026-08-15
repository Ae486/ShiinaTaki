# Host-Control Foundation Technical Design

> This child remains planning-only until the owner approves implementation. It is self-contained because Trellis
> implement/check agents load the active child task, not its parent technical design automatically.

## 1. Identity and authority

- `hostId` is a UUID for one Execution Host installation. A Node reuses its stable `deviceId` as `hostId`; Core stores
  one stable UUID for its own Core-host identity in an atomically replaced `<dataDir>/host-identity.json`. Core creates
  the file when absent. An unreadable, malformed, or invalid existing file fails boot with a repairable diagnostic;
  Core never silently mints a replacement identity.
- Core owns global policy, durable Approval, desired registry state, Run identity, and every sealed dispatch field.
- A Host owns its local catalog/resources and may enforce a stricter local/managed floor. It cannot widen Core policy,
  invent a durable user decision, or show a second Approval dialog.
- Existing Desktop browser generation counters remain window-local D59 guards and are not placed on the Host wire.

## 2. Generations and versions

- Core assigns `connectionGeneration` after an authenticated Node handshake. It is a monotonic positive integer per
  stable `hostId` within the current Core process lineage. A replacement generation retires the prior live one; it is
  not client-supplied and is not persisted across a Core restart.
- Host publishes a monotonic `catalogGeneration` bound to exactly one connection generation. Reconnect publishes a
  complete catalog; no catalog delta protocol is required in this child.
- `policyGeneration` and `approvalGeneration` are Core revisions captured for later authorization integration. This
  child carries and validates them but does not implement their durable stores.
- `protocolVersion` and `catalogSchemaVersion` are negotiated from an additive range in the Node `connect` handshake.
  No overlap fails closed for Host execution. Operator handshake behavior remains compatible.

## 3. Catalog contract

After authentication, a Node publishes a complete candidate snapshot containing:

- stable `hostId`, sanitized label, negotiated versions, `connectionGeneration`, `catalogGeneration`, and publication
  time;
- Host-local readiness and a sanitized local reason. Core derives connected/authenticated/revoked state and last-seen
  metadata from its authenticated connection and publication lifecycle;
- Host-owned capability descriptors plus reserved collections for Workspace, Skill, and MCP ownership; and
- only non-secret metadata. Secret values are prohibited.

Core validates the complete candidate and atomically publishes it. An invalid candidate makes that connection
non-routable and retains at most sanitized last-known display data. A reconnect cannot reuse the old live snapshot.

## 4. Operation identity and wire binding

One logical operation has `runId`, `operationId`, and an `attemptId`. Core also allocates a request correlation id. The
shared sealed control tuple includes:

```typescript
type HostOperationControl = {
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
};
```

Core computes `inputDigest` over one canonical serialization of the exact validated input plus relevant identity. The
model, operator-visible text, Host label, Skill content, and MCP metadata cannot supply or change sealed fields.

The shared method names are `host.catalogPublish`, `capability.request`, reserved `capability.challenge`, reserved
`capability.resume`, `capability.cancel`, and `capability.respond`. Request, challenge/resume, cancel, and response carry
the same tuple. Every Node-to-Core method validates `MethodContext.connection` and cross-checks its authenticated
`hostId` and `connectionGeneration`; `requestId` or payload identity alone never proves origin or settles work.

## 5. Router and broker behavior

- Replace first-advertising-Node selection with explicit resolution by `targetHostId` and current catalog.
- Preserve existing single-node tool behavior at the caller seam only when exactly one currently routable Host advertises
  the capability. Zero routable Hosts returns unavailable; more than one returns an explicit target-required/ambiguous
  result. The router never selects by insertion order or first match.
- Pending entries are indexed and retired by `(hostId, connectionGeneration)`. One Node disconnect cannot settle another
  Host's requests.
- A wrong-Host, wrong-generation, duplicate, unknown, or late response returns `accepted: false` and logs metadata only.
- Each request captures one absolute deadline. Expiry issues best-effort cancellation and settles without automatic
  replay. A cancellable read may fail/cancel; an already-dispatched side effect without a trusted terminal response
  settles `outcome_unknown`.
- Node keeps a bounded in-memory terminal-attempt cache for the live generation so duplicate request/resume delivery
  returns the previous terminal envelope instead of executing twice. The MVP bound is 256 terminal entries with
  insertion-order eviction; retirement/reconnect discards the cache. This cache is not restart replay state.

For this child, `host.catalogPublish` and `capability.respond` are Node-to-Core RPC methods returning structured
`{accepted, reason?}` metadata. `capability.request` and `capability.cancel` are Core-to-Host delivery frames. Challenge
and resume remain schema reservations only. Core computes lowercase SHA-256 `inputDigest` over deterministic canonical
JSON of the validated capability identity and exact input; Core mints opaque UUID `attemptId` and `idempotencyKey`.

## 6. Host Context seam

Add one narrow Core snapshot/renderer seam that can later feed Run assembly. It captures `primaryHostId`, Host
availability, connection/catalog generations, capability/resource ownership, Workspace roots, and explicit transfer
capabilities from validated control state. This child does not wire autonomous Runs, Skills, or MCP content into the
Agent, but its output must keep control metadata separate from untrusted content.

## 7. Expected implementation seams

- `packages/shared/src/host-control-schema.ts`: canonical Host-control schemas, with capability/connect integration,
  named exports, TypeScript fixtures, and Rust golden fixtures in their existing shared seams.
- `packages/core/src/hosts/{host-identity,host-catalog,host-context}.ts`: strict Core-host identity persistence,
  connection/catalog ownership, and immutable Host Context rendering.
- `packages/core/src/server/methods/host-catalog-publish.ts`: authenticated `host.catalogPublish` handling; existing
  connect/capability method seams also receive generation and `MethodContext.connection` binding.
- `packages/core/src/capabilities/`: explicit router and per-generation broker/cancel/settlement.
- `packages/core/src/main.ts`: minimal composition wiring only.
- `apps/desktop/src-tauri/src/`: serde protocol mirrors, Node handshake/catalog publication, request/cancel binding,
  duplicate-attempt cache, and terminal response fields.

Every touched production directory updates its `index.md`. New files carry the required module-contract header.

## 8. Tests and gates

- Shared schema and TypeScript/Rust golden fixture accept/reject/round-trip matrix.
- Two Hosts advertise the same capability; explicit Host A never routes to Host B.
- Same `hostId` reconnects with a new generation; old response/cancel/catalog frames are rejected.
- Host A disconnect settles only Host A generation entries.
- Deadline before dispatch, cancellation during a read, and side-effect disconnect produce distinct terminal results
  and no replay.
- Duplicate attempt on one live generation executes at most once.
- Host Context snapshot contains authenticated ownership/generation facts and no content-derived control fields.
- Run focused tests first, then relevant workspace typecheck/lint, Rust tests/clippy, and one formal `trellis-check` after
  the implementation has substantive volume.

## 9. Explicit non-goals

- Core governance/Approval persistence or Home permission UI.
- Credential encryption, secret values, `libsodium-wrappers`, or any new dependency.
- MCP client generations/leases, Skills import, or Home extension management.
- Autonomous Run, Run Receipt, Scheduled Task, Heartbeat, or transport-liveness implementation.
