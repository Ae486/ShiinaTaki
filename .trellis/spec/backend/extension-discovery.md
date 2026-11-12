# Extension Discovery and Integration

## Scope

This contract governs the final MCP/Skill/Execution Host convergence surface. It applies to Core run assembly,
host-qualified extension discovery, progressive search/describe/call, cross-Host transfer adapters, and the associated
Home/e2e convergence proof. It does not authorize Autonomous Runs, Scheduled Tasks, Heartbeat, Run Receipts, or any new
permission system.

## Identity and provenance

Every discovered extension carries a strict, host-qualified identity:

```ts
type ExtensionIdentity = {
  extensionId: string;
  kind: "skill" | "mcp-tool" | "capability";
  ownerHostId: string;
  subjectId: string;
  subjectRevision: string;
  connectionGeneration: number;
  catalogGeneration: number;
};
```

The identity is built from Core/Host validated state. Display labels, filesystem paths, URLs, tool descriptions, and
online status are never identity or routing inputs. Duplicate identities or presentation keys are rejected; map-spread
order cannot choose an owner.

## Run snapshot

Core creates one immutable extension/Host snapshot before the first model call. It contains `runId`, `primaryHostId`,
authenticated Host/generation facts, eligible Skill/MCP/capability descriptors, captured dynamic bindings, and a bounded
discovery budget. The snapshot and its runtime generations are process-local and are never persisted as executable truth.
An overflow retry reuses the same snapshot. A reload, reconnect, disable, policy change, or approval revocation affects
future Runs; a captured stale call fails closed and is never redirected or replayed.

## Progressive discovery

The Agent receives bounded cheap metadata and may use `extension_discover`, `extension_describe`, and
`extension_call`. `extension_call` accepts only an `extensionId` from the captured snapshot and dispatches through the
captured governed binding. It never performs path/name lookup, implicit Host selection, silent fallback, or a second
Approval flow. Existing `load_skill`, `read_skill_resource`, direct MCP tools, and direct capability tools remain
compatibility paths.

Direct MCP compatibility bindings remain captured for execution, while their model schemas are deferred. A successful
`extension_describe` of a current available captured MCP entry returns optional `toolName`; the next model step receives
that existing direct schema. Internal `toolDisclosure` metadata travels with Run execution context and retains the
existing 128-entry directory limit. See [tool disclosure](./tool-disclosure.md) for loading, overflow and validation.

When multiple Hosts advertise one capability, an unqualified direct route fails with `TARGET_HOST_REQUIRED`. A call
through the bridge must carry the explicit sealed `targetHostId`, and its result includes the actual owner and generation
provenance. Skills, `allowed-tools`, trust, provenance, MCP descriptions, and discovery visibility never grant authority.

## Host context and transfer

The Core-rendered Host context is control metadata. It contains sanitized Host status/label, generations, ownership,
Workspace and transfer descriptors, and fixed rules: unqualified work uses the primary Host; remote work names a Host;
paths and labels never select a Host; transfer uses an advertised separately governed capability; and offline Hosts are
failed or bounded-waited according to the common Host-operation lifecycle.

Cross-Host Skill/package movement is an explicit Host operation over an advertised transfer capability. Core-local
mutations continue to use the existing Skill/MCP services. Missing capability, stale generation, disconnect, and
unknown outcome fail closed. No implicit path copy, host substitution, or mutation queue is permitted.

## Home and verification

Home is a disposable projection of Core truth. It parses Shared schemas, suppresses old WebSocket generations, serializes
mutations, refetches after reconnect/conflict, and never persists snapshots, secrets, package bytes, or mutation queues.
Unknown mutation outcomes are displayed and refetched, never replayed.

The required process proof starts two isolated real Nodes that advertise the same capability and verifies explicit
Host routing, reconnect generation replacement, cross-Host disconnect isolation, stale/late response rejection, and
distinct `cancelled` versus `outcome_unknown` settlement. Compatible remote package-transfer execution and owner manual
acceptance remain explicit evidence items unless a suitable Host is available.

## Executable Contract Matrix

### 1. Scope / Trigger

- Trigger: any Core, Agent, Home, MCP, Skill, or Host change that exposes or consumes the unified extension surface.
- Scope: process-local discovery and Run binding only. Durable MCP desired state, Skill package state, Host identity,
  Governance, Approval, and secret storage remain owned by their existing services.

### 2. Signatures

```ts
createExtensionRunContext(input): {
  tools: ToolSet;
  instructions: string;
  snapshot: ExtensionRunSnapshot;
}

extension_discover({ query?, kind?, ownerHostId?, limit? }): ExtensionDiscoverResult;
extension_describe({ extensionId }): ExtensionDescribeResult;
extension_call({ extensionId, input }): ExtensionCallResult;
```

`extensionId` is the only call selector. Discovery filters are bounded metadata filters; `ownerHostId` is an
authenticated opaque id, never a display label or filesystem path.

### 3. Contracts

- Every descriptor carries `ExtensionIdentity` with `kind`, `ownerHostId`, `subjectId`, `subjectRevision`,
  `connectionGeneration`, and `catalogGeneration`.
- A successful call returns the captured owner identity and output. A failed call returns a closed error code and the
  same owner identity when the extension was found; cancellation and unknown outcome are explicit state values.
- The Run snapshot is frozen and captures direct MCP tools, Skill read leases, Host routing bindings, host generations,
  and a bounded discovery budget. Reload/reconnect affects later Runs only.
- Model-visible extension context states the eligible count and immutable-snapshot/routing/permission rules, but never
  renders the snapshot Run UUID. Snapshot/result schemas and private registry bindings retain the UUID internally.
- Transfer calls require both the sealed target Host id and an advertised transfer capability. Missing, stale,
  disconnected, or unknown-outcome transfers fail closed and are never queued or replayed.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unknown `extensionId` | `EXTENSION_NOT_FOUND`; no owner or fallback lookup |
| Duplicate canonical identity or model key | Both candidates excluded and collision diagnostic retained |
| Captured generation is no longer current | `EXTENSION_STALE_GENERATION` with captured owner provenance |
| Extension unavailable in the captured snapshot | `EXTENSION_UNAVAILABLE` |
| Invalid Skill/resource input | `INVALID_EXTENSION_INPUT` |
| Run call budget exhausted | `EXTENSION_CALL_LIMIT_EXCEEDED` |
| Two Hosts advertise one direct capability without a target | `TARGET_HOST_REQUIRED` |
| Transfer Host/capability unavailable | Adapter refuses with `TRANSFER_HOST_UNAVAILABLE`, `TRANSFER_NOT_ADVERTISED`, or `TRANSFER_CAPABILITY_MISSING`; the bridge returns `EXTENSION_CALL_FAILED` |
| Interrupted cooperative read | `CANCELLED` / `cancelled`; no replay |
| Interrupted effect | `OUTCOME_UNKNOWN` / `outcome_unknown`; no replay |

### 5. Good/Base/Bad Cases

- Good: discover a bounded descriptor, describe its captured identity, then call that exact id and observe owner and
  generation provenance in the result.
- Base: a reload or reconnect retires an old binding; the old call fails as stale while a new Run sees the replacement.
- Bad: select a Host from a label/path, merge tool maps with object-spread order, retry an unknown mutation, or let
  Skill metadata/trust/`allowed-tools` widen Governance authority.

### 6. Tests Required

- Shared schema tests: strict round-trips, bounded fields, collision diagnostics, and rejection of secrets/paths.
- Core registry/context tests: deterministic identity, Run-id-free byte-stable rendered context across different Runs,
  per-registry captured call binding, duplicate exclusion, immutable snapshot, stale generation, call budgets,
  explicit transfer refusal, and overflow retry reuse.
- Desktop tests: current-client suppression, reconnect refetch, owner/generation rendering, and no local cache/replay.
- Real-process E2E: two isolated Nodes, same-capability refusal, explicit A/B routing, reconnect generation replacement,
  catalog replacement, stale response rejection, Host B isolation, cooperative cancellation, effect unknown outcome,
  and no replay.

### 7. Wrong vs Correct

```ts
// Wrong: a presentation key or display label selects the authority.
const tool = toolsByName[hostLabel + "." + toolName];

// Correct: the Run snapshot seals owner and generation, and the bridge dispatches by opaque id.
const result = await extension_call({ extensionId: captured.identity.extensionId, input });
```
