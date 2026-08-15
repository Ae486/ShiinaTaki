# Skills and MCP Productization Engineering Contracts

> Planning status: frozen for owner review on 2026-08-12. This document defines implementation contracts and child
> boundaries. It does not authorize production implementation or dependency installation.

## 1. Decision authority and compatibility note

The owner-ratified 2026-08-10 decisions in the parent PRD and T4 second Grill are the target authority. They supersede
older descriptions that place global permission or extension ownership exclusively in the Desktop Shell, Core data
directory, or VPS process. The implementation must preserve these still-valid invariants:

- Core is the single global policy, durable Approval, desired-registry, and Run authority.
- An authenticated Execution Host owns the Workspace, Skills, MCP clients, credentials, and OS capabilities that
  execute there. Core itself may be an Execution Host for Core-local resources.
- A Host may impose a stricter local or managed floor and performs final local enforcement, but cannot widen Core
  authorization or present a second Approval dialog.
- Protocol shapes start in `@taki/shared`; Rust mirrors only frames handled by the Node.
- Existing D59 browser connection generations remain window-local recovery guards. They are not the authoritative
  Core-to-Host connection generation defined below.

Before implementation convergence, add or supersede the ADRs/spec text whose older single-host authority statements
conflict with this target. Do not silently reinterpret the old wording in code.

## 2. Host-control shared wire contract

### 2.1 Stable identities

- `hostId` is a UUID identifying one Execution Host installation and its host-local resources. For a Node-backed Host,
  the existing stable `deviceId` is the `hostId`; do not mint an alias. Core persists one stable UUID for its own
  Core-host identity in an atomically replaced `<dataDir>/host-identity.json`. A missing file is created on first boot;
  an unreadable, malformed, or invalid existing file fails boot with a repairable diagnostic and is never silently
  replaced with a new identity. Rebinding a user profile to a different Core does not merge or reuse another Core
  installation's `hostId` implicitly.
- `runId` identifies the logical Run. `operationId` identifies one logical Host-bound operation within a Run.
  `attemptId` identifies one dispatch attempt. Retries keep `operationId` and allocate a fresh `attemptId`.
- `capabilityId` is the canonical registry identity. Host-qualified resource ids are stable opaque ids, not display
  labels or paths: `skillId`, `mcpServerId`, and raw MCP `toolName` remain separate fields.

### 2.2 Generations and revisions

- `connectionGeneration` is a Core-assigned monotonic positive integer for each authenticated Host connection. Core
  allocates it after successful authentication, never trusts a client-supplied generation, and retires the previous
  live generation for that `hostId` before the replacement becomes routable.
- `catalogGeneration` is a Host-owned monotonic positive integer for published Host catalog snapshots. Publication
  binds it to one `connectionGeneration`. A reconnect republishes a complete snapshot; deltas are not required for MVP.
- `policyGeneration` is the Core global governance revision captured at authorization/dispatch.
- `approvalGeneration` is the revision of the durable/session Approval state used by the decision. Revocation or a
  relevant decision change increments it, making a sealed authorization stale.
- Public desired configuration uses a per-resource `configRevision`. Observed runtime generation and desired revision
  are separate and must never be inferred from one another.

All generation counters are process-local monotonic numbers except durable `configRevision`/policy/approval revisions.
After Core restart, live connection/catalog generations begin a new process lineage and old in-flight requests do not
resume. Persisted desired state is reconciled into fresh runtime generations.

### 2.3 Protocol and catalog negotiation

The existing `connect` request is extended additively for Node Hosts with:

- a supported Host-control protocol range;
- the Host catalog schema version it can publish; and
- an explicit Execution Host declaration.

Core returns the selected protocol/catalog versions plus the Core-assigned `connectionGeneration`. No overlapping
protocol version means fail-closed authentication for Host execution. Legacy operator connections remain unaffected.

After authentication, a Node publishes one complete, Zod/serde-mirrored catalog snapshot containing:

- `hostId`, sanitized display label, `connectionGeneration`, `catalogGeneration`, publication time, and protocol/catalog
  versions;
- Host-local readiness plus a sanitized local reason. Core derives connected/authenticated/revoked state and last-seen
  metadata from `MethodContext.connection`, authentication, revocation, and publication observation; the Host cannot
  self-report those Core-owned facts;
- owned Workspace/root descriptors, Skills, MCP servers/tools, and OS capabilities;
- canonical capability/governance identity, availability, risk metadata that can only narrow, and compatibility data;
  and
- secret presence/reference metadata only. Secret values never enter this catalog.

Core validates the whole candidate and atomically replaces that Host's observed catalog. Invalid candidates leave the
last-known catalog display-only and the Host non-routable. Reconnect never revives a previous live catalog implicitly.

The shared Host-control method names are frozen as `host.catalogPublish`, `capability.request`, reserved
`capability.challenge`, reserved `capability.resume`, `capability.cancel`, and `capability.respond`. Every Node-to-Core
method validates the authenticated `MethodContext.connection` and cross-checks the payload against it; payload fields
can never establish or replace connection provenance.

### 2.4 Run Host Context

Every Run captures one immutable Host snapshot before the model call:

- `runId` and `primaryHostId`;
- known Hosts with authenticated availability and catalog generation;
- host-qualified Skill/MCP/capability ownership;
- primary Workspace roots and explicit transfer capabilities; and
- the short normative rules from the parent PRD.

The snapshot is rendered from validated control data. Skill text, MCP descriptions/results, paths, display labels, and
user content cannot supply or override sealed Host ids, generations, policy, Approval scope, or transfer rules.

### 2.5 Host-bound operation envelope

The shared envelope separates Agent-selected intent from Core-sealed control metadata:

```typescript
type HostOperationIntent = {
  targetHostId: string;
  capabilityId: string;
  input: unknown;
  whenHostOffline?: "fail" | "wait-for-user";
  expiresAt?: string;
};

type HostOperationControl = {
  runId: string;
  operationId: string;
  attemptId: string;
  targetHostId: string;
  connectionGeneration: number;
  catalogGeneration: number;
  policyGeneration: number;
  approvalGeneration: number;
  inputDigest: string;
  idempotencyKey: string;
  dispatchedAt: string;
  deadlineAt: string;
  expiresAt?: string;
};
```

`inputDigest` is computed by Core over one canonical serialization of the exact validated input and relevant capability
identity. It is compared, not reconstructed from operator-visible text. `idempotencyKey` deduplicates the same attempt
at the Host and is not permission to retry or replay a non-idempotent effect.

`capability.request`, reserved `capability.challenge`, reserved `capability.resume`, `capability.cancel`, and
`capability.respond` all carry the same sealed identity tuple. The Core handler also verifies that every Node-to-Core
frame arrived on the authenticated `hostId` and `connectionGeneration` that own the pending attempt. A matching
`requestId` or self-declared payload identity alone is insufficient.

### 2.6 Approval challenge and exact resume

For a Host-owned operation:

1. Core computes its global ceiling and either denies, authorizes, or issues one operator Approval.
2. Host reclassifies the exact input under its current local/managed floor. It may execute, deny, or return a structured
   challenge; it cannot open a prompt or persist a user decision.
3. Core renders the only Approval dialog. A positive answer creates a short-lived authorization bound to the exact
   Host, connection/catalog/policy/approval generations, capability/risk class, input digest, deadline, and expiry.
4. Host resumes the same `attemptId`, revalidates every bound field and local floor, then executes at most once.

If any bound field changes, the challenge expires and the operation must be re-authorized. Unattended behavior follows
the parent PRD: Heartbeat skips `ask`; Scheduled work pauses through a Run Receipt rather than raising a surprise dialog.

### 2.7 Disconnect, cancellation, and settlement

- Core tracks pending work per `(hostId, connectionGeneration)`. Disconnect retires only that generation's pending
  entries; it never calls a global `denyAll` for unrelated Hosts.
- A response from an old generation or the wrong Host returns `accepted: false`, is logged without content, and cannot
  settle a current attempt.
- Before dispatch, unavailable/reconnecting/revoked Hosts fail or enter bounded wait exactly as specified by
  `host-operation-lifecycle.md`. There is no disconnected mutation queue.
- After dispatch, Core sends best-effort cancellation when the caller aborts, the deadline expires, policy is revoked,
  or the generation is retired. Host cancellation is keyed to the exact attempt.
- Read-only/cancellable work may settle `cancelled` or `failed`. A dispatched side effect without a proven terminal
  response settles `outcome_unknown`, requires inspection or explicit retry, and is never automatically replayed.
- Host keeps a bounded in-memory completed-attempt cache per live generation so duplicate request/resume frames return
  the same terminal envelope rather than executing twice. No in-flight Host request is persisted for automatic restart
  replay in MVP.

## 3. MCP desired state, runtime generations, leases, and persistence

### 3.1 Three separate state planes

1. Core-authoritative desired metadata persisted in Core SQLite: stable server id, owning `hostId`, transport/public
   config, enabled state, selected raw tools, opaque secret field refs/presence, and `configRevision`.
2. Host-local secret authority: encrypted values and backend health; values never return through ordinary control,
   config, diagnostics, logs, UI cache, or run history.
3. Host-observed in-memory runtime: candidate/active/draining generations, connection state, last candidate outcome,
   compatible and skipped tool diagnostics, lease count, and close state. Runtime generations and leases are never
   persisted as truth.

Desired configuration changes persist before reconciliation. After crash/reconnect, the owning Host rebuilds from the
latest desired revision and secret catalog. A previously observed `connected` or generation id is never restored from
disk as executable truth.

Secret set/rotate/clear uses a dedicated authenticated operator-to-owning-Host sensitive command path orchestrated by
Core. Its request value is memory-only, excluded from generic request logging/history/caches, and never broadcast.
Core receives only success, presence, provenance, and sanitized diagnostic metadata. Host offline means the mutation
fails; it is never queued. Core-local Host secret operations use the same service contract without a network hop.

### 3.2 Candidate publication

For add/edit/enable/reconnect/rotation:

1. Capture `{serverId, hostId, configRevision}` and allocate a candidate runtime generation.
2. Resolve only declared secret fields on the owning Host.
3. Create the SDK client, negotiate, list every tools page under one bounded deadline, prepare compatible definitions,
   apply selected-tool filters, reject collisions, and build closures bound to that client.
4. If preparation fails, close the candidate exactly once, publish the candidate failure, and leave the last-good
   generation serving existing/future eligible Runs unless the desired state is disabled/removed or credentials were
   cleared.
5. Under one manager lock, atomically publish the successful generation for future Run snapshots. Mark the previous
   active generation draining and refuse new leases to it.

`test` is an ephemeral candidate with a deadline and guaranteed close. It never becomes active and never exposes tools.
Automatic `tools/list_changed` handling remains deferred until the installed SDK or a proven adapter supports it.

### 3.3 Immutable Run snapshot and dispatch lease

Run assembly captures an immutable extension snapshot mapping model-facing key to stable registry identity,
`hostId`, `serverId`, raw `toolName`, `configRevision`, and runtime generation. Approval lookup and execution use that
same captured identity. Future Runs see a later published generation; an existing Run does not silently rebind after
reload.

The model-facing tool closure acquires a generation lease immediately before SDK execution, revalidates current policy,
Approval, Host availability, and generation eligibility, and releases in `finally`. A published snapshot is therefore
not permission to execute after revocation. If its generation already retired before lease acquisition, the call fails
closed with a structured stale-generation result; it is not redirected to the replacement.

### 3.4 Drain and close ownership

- A draining generation accepts no new leases. It closes when its lease count reaches zero.
- Normal replacement uses a configurable bounded drain deadline. At the deadline the manager aborts/closes remaining
  work and settles calls according to idempotency/side-effect evidence; unknown remote effects become
  `outcome_unknown`.
- Disable/remove/secret-clear block new leases immediately. Ordinary disable/remove may drain; security-emergency
  revocation uses an explicit forced-close path and separately tells the operator that upstream credential revocation
  is still required.
- The manager owns every candidate, active, and draining client until close completes exactly once. Process shutdown
  stops publication, cancels candidates, drains under one global shutdown budget, then force-closes remaining clients.
- A crash leaves no persisted lease/runtime generation. Restart reconciles desired state into new generations and never
  claims the fate of interrupted remote side effects; in-progress Run evidence remains unresolved where applicable.

## 4. Child dependency graph

```text
authority-credential-design (planning-only; no production code)
                    |
                    v
host-control-foundation
                    |
                    v
governance-authority
                    |
                    v
approval-productization
          |                     |
          v                     v
host-secret-catalog       standard-skill-lifecycle
          |
          v
secure-mcp-lifecycle
          \                     /
           v                   v
         extension-discovery-integration
```

The Skill child may begin after common governance and Approval are stable; it need not wait for MCP transport work.
The MCP child requires the secret-catalog child. The final integration child owns cross-surface convergence and manual
acceptance, not unfinished feature work from earlier children.

## 5. First implementation batch

The first production child is `08-12-host-control-foundation`. It deliberately excludes policy persistence, Approval
UI, secret storage, MCP CRUD/reload, Skills import, and Home management. Its job is to make multi-Host claims truthful:

- shared protocol/version/catalog/operation/cancel/response schemas and golden fixtures;
- stable Core Host identity plus Node `deviceId == hostId` mapping;
- authenticated per-Host connection generation and full catalog publication;
- explicit Host-qualified capability routing;
- per-Host/per-generation pending request ownership, deadline/cancel/stale response handling, and unknown-outcome
  settlement;
- Rust serde mirror and Node execution response binding/dedup for the shared frames; and
- a narrow Core Host Context snapshot/renderer seam, without wiring autonomous Runs or extension content yet.

The child must preserve the existing single-node tool behavior as a compatibility path while changing the internal
routing contract to require an explicit resolved Host. It must not install `libsodium-wrappers` or implement MCP
generation management.

## 6. Verification strategy

- Shared: schema/golden fixture round trips, invalid version/generation/id combinations, exact status/reason unions.
- Core: two Hosts advertising the same capability route only by explicit `hostId`; one disconnect settles only its
  generation; wrong-Host/stale-generation responses are rejected; deadlines/cancel/unknown-outcome never auto-replay;
  catalog replacement is atomic and invalid candidates are non-routable.
- Rust: serde parity, request binding, duplicate-attempt dedup, stale cancellation rejection, and final response fields.
- Integration: two Node harnesses, reconnect with the same `hostId` and a new generation, catalog change across reconnect,
  one long read and one side-effecting fixture interrupted mid-flight, plus Core-local Host snapshot coverage.
- Gates: focused shared/Core/Rust tests first, then workspace typecheck/lint and `cargo clippy` for the substantial child.
  A formal `trellis-check` runs only after the child has real implementation volume.

## 7. Merge and sequencing risks

- Shared exports/indexes, `packages/core/src/main.ts`, and Rust protocol/WS files are expected merge hotspots. Check
  `main...HEAD` before the child and again before editing them; merge `main` into T4 if it advanced.
- Memory/Hindsight may add shared schemas, Core composition, Home pages, and config/migration work. Preserve both
  contracts during semantic conflict resolution and rerun focused tests for every conflicted seam.
- Adding Core Host identity or governance persistence may consume the next SQLite migration number. Re-evaluate the
  live migration list immediately before implementation; never reserve a number only in planning prose.
- ADR 0007, TECH-STACK, and `permission-authorization.md` contain older locality/authority wording. Update them through
  an explicit superseding design/spec slice rather than opportunistic partial edits spread across children.
- T4 has no `node_modules` or `.env.local`. Install the locked workspace dependencies inside this worktree only when an
  approved implementation batch needs builds. Add no new dependency without owner approval.
