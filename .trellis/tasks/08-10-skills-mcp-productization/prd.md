# Skills and MCP Productization

## Goal

Turn the existing developer-configured Skills loader and MCP client into one end-to-end operator-manageable extension
surface that later Heartbeat and Scheduled Agent work can safely depend on. Preserve open standards and the existing
working runtime instead of replacing it.

## What We Already Know

- The owner selected end-to-end productization: Core lifecycle, unified governance, secure credentials, Home UX, and
  verification ship as one initiative rather than leaving UI or secret handling for a later phase.
- Skills already support boot-time discovery, basic `SKILL.md` validation, enable/disable state, lazy instruction
  loading, and a `load_skill` meta-tool.
- MCP already supports operator-owned stdio/HTTP configuration, boot-time connection, namespaced tools, isolated
  server failure, structured invocation failure, approval integration, and provider-compatible schema normalization.
- The installed `@ai-sdk/mcp@2.0.10` supports the existing explicit list/convert/call/close path but does not expose
  tool-list-change notifications or automatically paginate `tools/list`. Product behavior must not claim either
  capability without an SDK upgrade or a separately proven adapter.
- A Skill provides procedure and suggested tools but grants no permission. Tool authorization is resolved at runtime
  through the common governance policy.
- The target permission model has one Core authority and one registry-driven governance path for MCP, effectful Core
  tools, and Shell/exec capabilities. A Node may tighten Core authorization but never widen it.
- The owner selected one Core-orchestrated Approval flow for Core/Node actions. Core owns the global policy and durable
  decisions, and an authenticated operator client renders the only prompt. A capability-owning Node keeps final local
  classification, availability, hard/managed floors, and execution enforcement, but does not run an independent
  prompt or durable user-decision store.
- The owner first selected an encrypted local credential catalog (`1A`), then amended its locality with the
  host-bound execution decision: the same catalog design is local to the host that owns the MCP client and its
  credentials. Core stores only non-secret registry metadata and opaque references. The catalog uses official
  libsodium secretstream; a Windows execution host stores its versioned master key in Credential Manager through a
  host-local helper, while a Linux/VPS execution host receives the versioned master key through
  `systemd LoadCredentialEncrypted=`. OpenBao is an optional later/provider profile, not an MVP runtime dependency.
- The owner selected multi-host execution (`4A`): a Run has one `primaryHostId` for its default Workspace and
  unqualified local operations, but may explicitly invoke capabilities published by other authenticated execution
  hosts. Core/VPS and desktop Nodes are both eligible execution hosts; a host owns its local Skills, MCP instances,
  credentials, Workspace, and OS capabilities. Host selection is explicit and no disconnected host is silently
  substituted.
- The owner selected one active Core Authority per user profile (`A`): local Core and VPS Core are mutually exclusive
  runtime bindings for that profile. Switching is an explicit rebind/profile operation; there is no concurrent dual
  Core, automatic Core fallback, or implicit merge of memory, tasks, permissions, Approval decisions, or other runtime
  state. A desktop/phone Node may remain an Execution Host for the selected Core.
- This task is the first implementation prerequisite for T4 proactivity. It must not implement Heartbeat, Scheduled
  Task execution, Autonomous Run History, or Run Receipts itself.
- `hindsight-compatibility-extensions` remains bound in the main worktree and its production patch lives in the
  separate `H:/hindsight` repository. On 2026-08-12 the owner approved a dedicated T4 worktree, so this planning task is
  bound only at `H:/TakiAgent-worktrees/t4` while Memory/Hindsight work continues independently. Implementation still
  must not start until the remaining host-control/reload contracts, child slices, and context files are frozen.

## Requirements (Evolving)

### Shared governance and discovery

- Use one declarative capability/tool registry and one effective-policy calculation rather than separate permission
  systems for MCP, Core tools, Skills, and Shell/exec.
- Preserve progressive discovery: the Agent sees a bounded cheap catalog, loads Skill detail only when relevant, and
  may discover currently permitted tools without receiving an unbounded tool surface on every run.
- A Skill never carries or expands permission. `allowed-tools`-style metadata, when present, may narrow or recommend
  but must not bypass the current effective policy.
- Operator changes are Core-authoritative. Agent tools cannot edit permission levels, deny floors, persisted Approval
  decisions, server credentials, or trust policy.
- Core builds a host-context block for every Run from authenticated connection and catalog snapshots. It explicitly
  states the `primaryHostId`, available hosts and statuses, each tool/Skill/MCP host, path/Workspace locality,
  cross-host transfer rules, and offline behavior. The model must not infer a host from a display name or path and
  must not silently reroute to another host.
- Host context is control metadata, not Skill/MCP/user content. Core emits it from validated schemas at Run assembly;
  imported Skills, MCP instructions, tool results, host display names, and remote files cannot modify the policy,
  host binding, approval scope, or transfer rules. The prompt must keep those payloads visibly separated and labeled
  as data or advisory procedure.
- A Node action uses one correlated request path. Core applies its ceiling; the Node either executes when no stricter
  local rule applies, denies immediately at a local floor, or returns a structured Approval challenge. Core then asks
  once and resumes that exact request. The Node must revalidate the same Node, capability/class, exact input identity,
  policy generation, and expiry before execution so the resumed authorization cannot be replayed or widened.
- Durable decisions for Node-owned capabilities are scoped to the stable Node identity plus canonical capability and
  argument class. A grant for one desktop does not silently authorize a replacement device or future phone.

### Host-control and prompt contract

The host context is a Core-generated control block assembled immediately before the model call from the authenticated
host catalog, connection generations, Workspace bindings, and effective capability policy. It is not copied from a
Skill, MCP server description, tool result, or user-editable display label. The block must carry, at minimum:

- the stable `primaryHostId` and the Run id;
- each known host's stable id, human-readable label, connection status, and catalog generation;
- the host owner of every exposed Skill, MCP instance/tool, Workspace, and OS capability;
- the default Workspace and path roots for the primary host; and
- the explicitly supported cross-host artifact-transfer capabilities and the behavior when a target host is offline.

The block's normative rules are deliberately short and repeated on every Run: an unqualified operation uses the primary
host; a remote operation must name its target host; a path or display name never selects a host; cross-host data movement
requires an explicit governed transfer capability; and a disconnected host is waited on or failed according to the
operation contract, never silently replaced by another host. Imported Skill/MCP text is advisory data and cannot change
host selection, permissions, approval scope, or transfer rules.

When a Desktop Node is configured to connect to a VPS Core, the Run prompt explicitly states that the desktop filesystem
and VPS Workspace are different hosts, labels each tool with its owner, and requires an explicit host-qualified call for
the other side. These labels must remain attached through discovery and tool results so the Agent cannot mistake a
successful remote call for a local filesystem effect.

### Offline Execution Host Semantics (Owner ruling 2026-08-10)

Host connectivity is an availability signal, not a permission source. Availability is evaluated per authenticated
Execution Host, rather than as one global "user online" flag:

- `connected` permits new calls only after the normal Core policy, Approval, and Host-local stricter floors pass.
- `reconnecting` and `disconnected` prohibit new side-effecting calls to that Host. A disconnected Host returns a
  structured `host_offline` outcome or waits only where the operation contract explicitly permits waiting.
- `revoked`/`unauthorized` is reported separately from network loss and fails closed.
- Last-known Skill/MCP/capability metadata may remain visible for orientation, but it is stale and cannot be invoked.
- Another connected Host is never a silent substitute. Cross-Host transfer or retry requires an explicit,
  separately governed action.

Core-only autonomous work may continue while every user Node is offline when the current policy and user configuration
permit it. This does not include capabilities owned by a disconnected Node, and it does not widen permission. A
Sampling-driven Heartbeat becomes ineligible when its sampling Node is unavailable; a pure Core-triggered run must mark
the lack of fresh user-environment signals in its context and must not infer current device state.

Disconnect handling is fail-closed and non-replaying:

1. New Node requests are rejected before execution and carry the target Host identity and availability reason.
2. In-flight requests are settled against their owning connection generation. Cancellable work is bounded/cancelled;
   work whose side-effect outcome cannot be known is recorded as `outcome_unknown` and is never replayed automatically.
3. MVP does not queue install/enable/disable/delete/test/reconnect mutations while a Host is offline. On reconnect the
   Host republishes its real catalog and Core reconciles desired configuration with observed state.
4. Offline presentation results are stored as Run evidence/Run Receipts. Home surfaces them on reconnect; stale speech,
   animation, or other presentation effects are not automatically backfilled.

The host-control contract must therefore carry at least Host id, availability state, last-seen time, catalog generation,
and a sanitized disconnect/revocation reason. Availability, authentication, capability catalog freshness, and policy
remain separate fields so "network reachable" cannot be mistaken for "authorized and executable".

All Host-bound operations must reuse the shared Host-Bound Operation Lifecycle contract
(`.trellis/spec/backend/host-operation-lifecycle.md`). Host Context gives the Agent enough authenticated availability
and ownership information to choose a Core-only path, split Core work from later Host delivery, or request a specific
Host operation. At operation time the Agent may select `fail` or a bounded `wait-for-user`; omission defaults to
`fail`, and waiting requires a valid expiry plus a user-expected Run. This is planning freedom, not authority: the shared
runner owns final preflight, sealed policy/connection generations, disconnect settlement, retry/replay policy, and the
generic Run Receipt projection. Home renders one state/reason/action mapping with bounded task detail. A new task type
must not add another offline state machine, retry queue, or one-off disconnected card.

### Skills product surface

- Support open-standard `SKILL.md` packages without introducing a Taki-only replacement format.
- Provide operator flows to import, inspect source/trust status, enable/disable, and remove Skills while keeping
  installed package contents separate from operator state.
- Validate package structure and security-relevant content before activation; malformed or rejected packages remain
  observable without destabilizing the Agent runtime.
- Preserve lazy loading and define how standard supporting files such as references, templates, scripts, and assets
  are exposed from the Skill's owning host through already-authorized capabilities. Relative paths and binaries stay
  on that host; a cross-host file handoff is an explicit capability, never an implicit path lookup.
- Define deterministic reload/reconciliation behavior so installing or changing a Skill does not require ambiguous
  process state.

### MCP product surface

- Provide operator flows to list, add, edit, enable/disable, remove, test, and reconnect host-bound MCP instances.
- Expose truthful per-server connection state, failure reason, transport, discovered compatible tools, and skipped
  incompatible tool definitions.
- Reuse the existing schema-compatibility boundary and failure isolation; one bad server or tool must not disable
  unrelated servers.
- Define safe generation replacement for reload so in-flight calls settle against their owning client while future
  runs receive the new tool generation.
- Store MCP secrets through the supported secure credential architecture and never return secret values through
  config, logs, ordinary WS payloads, or UI cache.
- Keep runtime-writeable application secrets in the encrypted catalog of the owning execution host. Core exposes only
  presence, provenance, and sanitized diagnostics; secret values never cross the ordinary host-control protocol.
  Ordinary secret set, rotate, clear, test, and reconnect operations must not require a Core or `systemd` restart.
- Treat the exact `libsodium-wrappers` package/version and the Windows host-local helper packaging as implementation
  spike gates. Adding the dependency still requires explicit owner approval after Node 24, TypeScript, packaging, and
  wrong-key/tamper/crash behavior are proven.

### Approval and Home UX

- Complete the operator Approval dialog and provide read/revoke surfaces for durable decisions.
- Render at most one Approval dialog for one action. Node-local challenges flow through the same Core request and
  operator-client dialog as Core/MCP actions; they never create a second Shell-owned prompt.
- Keep the ordinary user model small: one global `strict | standard | relaxed` control plus an advanced capability
  view. Do not create separate Heartbeat or Scheduled Task permission pages.
- Make `always` explicitly disclose that it includes future background runs; legacy grants without that disclosure
  cannot silently gain background scope.
- Home management surfaces must include loading, empty, partial-failure, reconnecting, success, and validation states.

## Draft Child Order

This order is evidence-driven but remains planning-only until the remaining package-resource and reload boundaries are
frozen:

1. Authority and credential design gate: freeze secret locality/backends, canonical capability identity, Core/Node
   stricter-wins choreography, and legacy decision migration without production code.
2. Common governance and catalog vertical: shared schemas, Core authority/effective-policy evaluator, Node ceiling and
   local floors, and the minimal Home global/advanced permission surface.
3. Approval vertical: common capability identity, versioned durable decisions, operator-session scope, Desktop dialog,
   list/revoke, background disclosure, and legacy reconfirmation.
4. Secure MCP lifecycle vertical: Core status/config/secret references, CRUD/test/reconnect, last-good candidate
   publication, generation leases/draining, per-tool selection, and Home MCP management.
5. Standard Skill lifecycle vertical: safe staged import, standard validation, provenance/hash/trust/quarantine,
   enable/remove/reconcile, confined support-resource access, and Home Skills management.
6. Converged discovery and integration vertical: bounded progressive discovery, collision rejection, Core/Home/Node
   convergence, restart/reconnect/upgrade evidence, full relevant gates, and owner manual acceptance.

The MCP and Skill lifecycle children may proceed in parallel only after the common governance and Approval contracts
they consume are frozen. Experience Review remains outside this task because it depends on later Autonomous Run
evidence.

## Acceptance Criteria (Evolving)

- [ ] An operator can complete the full Skill lifecycle from Home without editing files manually.
- [ ] An operator can complete the full MCP server lifecycle from Home without restarting for ordinary changes.
- [ ] Credentials are durably stored and used without entering repository files, ordinary config, logs, or UI cache.
- [ ] One disconnected or schema-incompatible MCP server leaves other servers and built-in tools usable.
- [ ] Reload during an in-flight MCP call neither redirects that call to a new client nor leaves an unowned transport.
- [ ] Skill enable/disable and MCP tool availability converge consistently across Core state, Agent discovery, and Home.
- [ ] A mixed-host Run can use an explicitly selected primary host plus secondary-host capabilities without ambiguous
  path resolution, secret transfer, or silent host fallback.
- [ ] A disconnected Host cannot receive a new side-effecting request, while Core-only autonomous work continues only
  when current policy and user configuration permit it.
- [ ] An Agent may complete Core-owned work before a bounded Host delivery step without replaying the completed Core
  work; omitted offline handling fails safely and an unbounded waiting request is rejected.
- [ ] Reconnection republishes and reconciles the Host catalog without silently replaying stale Node requests or
  substituting another Host.
- [ ] An in-flight request that loses its connection generation is bounded/cancelled or recorded as
  `outcome_unknown`; it is never automatically replayed.
- [ ] Offline presentation results remain traceable as Run evidence/Run Receipts and are surfaced after reconnect
  without stale speech or animation replay.
- [ ] Every Run receives a truthful host-context prompt block; prompt-injected Skill/MCP text cannot alter host choice,
  permission, or transfer rules.
- [ ] Interactive `ask`, unattended fail-closed behavior, durable Approval, revocation, and deny floors are covered at
  their public boundaries.
- [ ] Skills cannot grant permission or mutate governance state, including through imported metadata.
- [ ] Shared schemas remain additive and validated through `@taki/shared`; clients do not invent parallel payloads.
- [ ] Focused tests, full relevant typecheck/lint/build gates, and operator manual checks pass before task completion.

## Definition of Done

- Requirements and research are owner-confirmed and implementation/check context files are curated.
- Production implementation and migrations, if any, are backward-compatible or have an explicit rollback path.
- Automated verification covers Core, shared protocol, Desktop/Home, governance, failure, and reload paths.
- Operator-visible workflows receive documented manual acceptance criteria.
- Relevant specs, ADRs, deferred decisions, and handoff/task status are updated from verified final behavior.

## Out of Scope

- Heartbeat, Scheduled Task execution, Autonomous Run History, Run Receipt, and Experience Review.
- A new Skill format, a Taki-only Task Archetype, or Skill-carried permission bundles.
- Skill Hub marketplace protocol, automatic updates, or speculative full support for every optional metadata field.
- A specific QQ MCP server or other provider-specific MCP implementation.
- A Core-native web search wrapper or replacement search engine; D60 remains unchanged.
- Automatic application of Procedural Knowledge proposals.

## Open Questions

- The host-control protocol still needs concrete wire schemas for catalog publication, host-qualified Skill reads,
  MCP tool-call routing, disconnect/reconnect generations, and explicit cross-host artifact transfer. These are
  implementation contracts under the 4A decision, not a choice between single-host and multi-host execution.
- The runtime generation and persistence boundary for MCP reload must be proven against the current turn and approval
  lifecycle before implementation is split into batches.

## Research References

- [`research/current-gap-and-dependency-map.md`](research/current-gap-and-dependency-map.md) - live shipped inventory,
  cross-layer gaps, dependency DAG, migration/reload/Approval risks, and missing tests.
- [`research/standards-and-reference-prior-art.md`](research/standards-and-reference-prior-art.md) - current Agent
  Skills and MCP standards, installed AI SDK limits, Hermes/OpenClaw evidence, secure-authority direction, and the MVP
  boundary.
- [`research/vps-secret-backend-options.md`](research/vps-secret-backend-options.md) - focused backend evidence and the
  owner-selected Core-local encrypted-catalog design.

## Technical Notes

- Existing implementation: `packages/core/src/skills/`, `packages/core/src/mcp/`,
  `packages/core/src/approval/`, `packages/core/src/agents/chat-agent.ts`, and Core boot composition.
- Existing product-gap analysis: archived task `08-03-settings-panel/research/rs-mcp-and-llm-config.md`.
- Existing MCP schema compatibility: archived task `08-07-mcp-tool-schema-compatibility/`.
- Binding T4 decisions: `.trellis/workspace/pleia/t4-second-grill-prep.md`, especially G2-07, G2-07A, and G2-07B.
- Permission contracts: `.trellis/spec/backend/permission-authorization.md` and related shared/Rust protocol mirrors.
- Existing architectural constraints: ADR 0006, Core single-writer authority, disposable clients, and provider-neutral
  tool/runtime design.
