# Converged Extension Discovery and Integration - Technical Design

## 1. Boundary and objective

This child is the final MCP/Skill convergence slice. It makes the already implemented Host-control, Governance,
Approval, Secret Catalog, Secure MCP, and Standard Skill lifecycles compose into one truthful extension surface. It does
not implement Autonomous Runs, Run Receipts, Scheduled Tasks, Heartbeat, Experience Review, or Learning Proposal
activation.

The existing Core-local MCP and Skill implementations remain the compatibility path. The new code adds a registry and
snapshot seam around them; it does not replace the Agent Skills package format, the MCP SDK, the Governance evaluator,
or the Host-control wire.

## 2. Existing live seams

- `packages/core/src/hosts/host-catalog.ts` already atomically stores authenticated Host catalog generations and
  exposes explicit capability ownership.
- `packages/core/src/hosts/host-context.ts` is an intentionally small, not-yet-wired Run assembly seam.
- `packages/core/src/mcp/mcp-manager.ts` owns process-local candidate/active/draining generations and exposes a fresh
  per-turn `ToolSet`; `mcp-turn-tools.ts` already binds leases and Governance.
- `packages/core/src/skills/skill-catalog-manager.ts` owns immutable Skill catalog generations and read leases;
  `skills-loader.ts` exposes metadata and lazy body/resource reads.
- `packages/core/src/agents/chat-agent.ts` currently constructs MCP tools and instructions on every attempt. Slice 8
  must capture the extension/Host snapshot once before the first model attempt so an overflow retry cannot silently
  see a different catalog.
- `apps/desktop/src/windows/home/pages/mcp` and `pages/skills` already implement disposable current-client state,
  serialized mutations, conflict refetch, and no mutation replay. Slice 8 extends the same pattern for convergence
  diagnostics; it does not add a browser cache.
- `e2e/src/fixture/with-stack.ts` currently boots one real Node. Slice 8 extends the test fixture to boot two isolated
  Node data roots against one Core for explicit same-capability routing and generation replacement evidence.

## 3. Unified extension identity

The registry uses one extension-neutral identity. It is metadata, not permission:

```ts
type ExtensionKind = "skill" | "mcp-tool" | "capability";

type ExtensionIdentity = {
  extensionId: string;       // opaque, stable, host-qualified registry id
  kind: ExtensionKind;
  ownerHostId: string;       // authenticated UUID, never a label/path
  subjectId: string;         // package id, server/tool subject, or capability id
  subjectRevision: string;   // content hash, config/runtime tuple, or descriptor revision
  connectionGeneration: number;
  catalogGeneration: number;
};
```

Identity construction is deterministic and strict:

- Skill entries use `packageId`/content hash from the Skill catalog.
- MCP entries use `serverId`, raw `toolName`, `configRevision`, and the active runtime generation. The raw name remains
  the SDK authority key; a model-facing key is only a presentation alias.
- Host capabilities use the canonical `capabilityId` and the authenticated Host generations.
- No identity is derived from a display label, filesystem path, URL text, or connection status.
- Duplicate `(kind, ownerHostId, subjectId, subjectRevision)` or duplicate presentation keys are rejected from the
  candidate snapshot and surfaced as bounded collision diagnostics. A later candidate never wins by map-spread order.

The registry assigns a deterministic, bounded model key to dynamic MCP/capability entries. The key contains an opaque
host token and the stable subject token; it never embeds a human Host label. Existing Core-local MCP keys remain
accepted as a compatibility alias only when they are unique in the snapshot. The sidecar always carries the full
`ExtensionIdentity`, so presentation names never become authority.

## 4. Whole-Run snapshot

`createExtensionRunSnapshot` runs immediately before the first model call and returns one frozen value:

- `runId`, `primaryHostId`, and a frozen `HostContextSnapshot`;
- the authenticated Host vector `(hostId, connectionGeneration, catalogGeneration, availability)`;
- eligible Skill, MCP, and Host-capability entries after bounded Governance filtering;
- the selected dynamic tool bindings and their host-qualified identities; and
- one discovery budget `{ maxEntries, maxDescriptionChars, maxSearchResults, maxCalls }`.

Snapshot construction is read-only and never resolves secrets, performs MCP I/O, or reads Skill bytes. It uses the
current active MCP generation and Skill catalog generation. Every tool closure captures this snapshot and the existing
MCP/Skill read or generation lease. A replacement/reconnect affects future Runs only. A closure whose captured
generation is no longer eligible returns a structured stale-generation result; it is never redirected.

The generic Agent loop receives the snapshot through an additive `TurnContext`/dependency seam. `runTurn` creates it
once and passes it to every retry attempt. Existing focused Agent tests that omit the seam retain their current
behavior.

## 5. Progressive discovery and call bridge

The Agent receives the small, bounded control section rendered from the snapshot plus three informational/dynamic tools:

1. `extension_discover` searches the captured cheap metadata by query, kind, and optional explicit `ownerHostId`.
2. `extension_describe` returns one bounded descriptor and provenance from the same snapshot.
3. `extension_call` accepts an `extensionId` from that snapshot and input. It dispatches only through the captured
   binding:
   - Skill load/resource calls delegate to the existing governed Skill loader;
   - Core-local MCP calls delegate to the captured governed MCP closure; and
   - Host capability calls use `routeCapability` with the sealed `targetHostId` from the identity.

The bridge rejects unknown/stale ids, missing explicit Host ownership, disabled or disconnected Hosts, and any input
that no longer passes the existing Governance/Approval/lease checks. It does not offer a path-based lookup, a
display-name fallback, a silent retry, or a second approval mechanism. Results include the sealed owner and generation
provenance (with content values governed by the underlying tool's existing redaction contract).

Direct built-in capability tools and the existing `load_skill`/`read_skill_resource` tools remain available for
compatibility. When more than one Host advertises the same capability, the unqualified direct route continues to fail
with `TARGET_HOST_REQUIRED`; `extension_call` is the explicit host-qualified path.

## 6. Host context and transfer boundary

The Host context renderer is extended to include sanitized label/readiness/status, last-seen and generation facts,
host-qualified extension descriptors, primary Workspace ids, and the explicit transfer capability ids advertised by the
Host. It appends a short fixed normative block:

- unqualified work uses `primaryHostId`;
- remote work names the target Host by sealed id;
- a path or display label never selects a Host;
- cross-Host movement uses an advertised, separately governed transfer capability; and
- offline/reconnecting Hosts are failed or bounded-waited according to the common Host-operation contract, never
  silently substituted.

Host labels and extension text are rendered as data. Control rules are emitted by Core constants and cannot be replaced
  by content from a Skill, MCP description, tool result, or user input.

Cross-Host Skill/package movement is therefore an explicit Host operation, not a new Skill authority. The integration
adapter accepts a sealed `targetHostId` and an advertised `transferCapabilityId`; it delegates to the existing
generation-safe broker and Governance/Approval path. Core-local Skill/MCP mutations continue to use their existing
operator services. If the target Host does not advertise the transfer capability, the operation fails closed. No
filesystem path, Host label, or online Host is used as a fallback. The current Rust Node advertises OS capabilities,
so package-transfer execution remains a bounded adapter/manual evidence item until a compatible Host implementation is
available; the Core contract and rejection behavior are automated in this slice.

## 7. Home and cross-surface convergence

Home remains a disposable projection. The MCP and Skill controllers retain their current-client epoch guard and
serialized writes. Slice 8 adds a convergence status/diagnostic projection sourced from one Core method, with the
following rules:

- every read is parsed by Shared schemas and refetched after a mutation or reconnect;
- late results from an old WebSocket generation are ignored;
- an unknown mutation outcome is shown as `outcome_unknown` and is never replayed;
- Home never stores extension snapshots, secrets, package bytes, or a mutation queue in local storage; and
- Core, Host, Agent, and Home all expose the same owner/generation tuple for one extension.

## 8. Real two-Node proof

The e2e fixture gains a second isolated Node process. Both Nodes advertise the same read capability. The proof covers:

- unqualified routing refusal when two eligible Hosts exist;
- explicit Host A and Host B calls and owner provenance;
- reconnect of Host A with the same stable id and a new Core-assigned generation;
- a catalog replacement on Host A not changing Host B's routability;
- stale response/old-generation rejection; and
- one cancellable read settling `cancelled` versus one interrupted effect settling `outcome_unknown`.

The existing Rust cooperative cancellation limitation remains explicit: the protocol settlement is generation-safe, but
arbitrary blocking OS work cannot be forcibly interrupted.

## 9. Persistence and reload contract

The snapshot and registry are runtime projections only. Durable MCP desired rows, Skill package rows/content, secret
catalog values, and Core Host identity remain the existing authorities. Runtime generation ids, discovery leases,
snapshot vectors, and transfer attempts are never persisted or restored as executable truth. Core restart reconstructs
fresh Host/MCP/Skill generations from durable state; interrupted side effects remain unresolved and are not replayed.

## 10. Security and compatibility invariants

- There is one Governance/Approval authority. Extension metadata, `allowed-tools`, trust, provenance, and discovery
  results can narrow visibility but never grant authority.
- All dynamic calls retain the existing input digest, policy/approval generation, Host connection generation,
  catalog/runtime generation, deadline, and idempotency semantics.
- Secrets remain in the owning Host catalog and never enter discovery, snapshots, Home, logs, or model-facing
  descriptions.
- Shared schemas are the only wire definitions. Rust changes are limited to the real two-Node fixture/protocol parity
  needed by the existing Host-control frames.
- New production files carry module headers; every touched source directory updates `index.md`; specs, `docs/HANDOFF.md`,
  and the developer journal record verified behavior and residual manual gates.
