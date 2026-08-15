# Core Governance Authority and Permission Projection

## Goal

Make Core the sole global Permission Level and common policy authority while preserving stricter Host-local or managed
constraints, Host-side argument classification, final enforcement, and audit. All executable surfaces consume one
canonical capability-governance model instead of retaining MCP-only, Shell-only, Skill-only, or built-in-only policy
systems.

## Dependencies

- `08-12-host-control-foundation` is implemented, formally checked, and retained in `review` pending the final
  two-Node convergence gate.
- `08-12-approval-productization` follows this child and owns the final prompt, decision, challenge/resume, and revoke
  lifecycle.

## Productization Boundary

- MCP remains standard MCP over the existing `@ai-sdk/mcp` integration. Governance wraps trusted local execution
  closures and identity sidecars; it does not replace `tools/list`, `tools/call`, transport, or the existing schema
  compatibility boundary with a Taki-specific MCP dialect.
- Skills remain portable open-standard `SKILL.md` packages. A Skill provides procedure and suggested tools but grants
  no permission. Loading instructions, package lifecycle operations, resources, scripts, and every action requested by
  a Skill are governed through ordinary canonical capabilities.
- Core, MCP, Shell/Node, and Skill-mediated actions are adapters over the same identity, descriptor, posture,
  precedence, and evaluator contracts. This child must not create a third permission system or a temporary Approval
  store.
- Taki-specific logic is limited to Core Authority, Execution Host ownership, multi-Host routing, policy projection,
  lifecycle safety, and operator surfaces around the standard extension formats.

## Requirements

### Canonical shared governance contract

- Define an extension-neutral capability identity containing the canonical action `capabilityId`, owning `hostId`, and
  an optional stable opaque subject identity/revision. MCP raw server/tool identity and Skill package identity remain
  adapter metadata mapped to this identity; display names, paths, and model-facing tool keys are never authority keys.
- Define a versioned registry of capability descriptors. A descriptor declares its trusted classifier authority and
  revision, its allowed governance cells, per-Level factory postures, whether Approval may later be remembered, and
  whether an operator override is ordinary, requires a second confirmation, or is immutable.
- Keep operator-configurable deny-by-default rows distinct from immutable Core hard floors and Host-local/managed hard
  constraints. A second-confirm row may be changed by an authenticated operator; an immutable or managed floor may
  only tighten and cannot be lifted by the global Home surface.
- Unknown capability, subject binding, descriptor revision, classifier revision, cell, or duplicate registry identity
  fails closed across Shared, Core, and Rust.

### Core policy authority and persistence

- Persist one Core-owned global level, registry revision, positive `policyGeneration`, and sparse per-cell/per-Level
  operator overrides in Core SQLite. Descriptor definitions remain validated code/shared data, not mutable database
  rows.
- `permission.levelGet`, `levelSet`, `cellsGet`, and `cellSet` are operator-only Core methods. Mutation params carry
  `expectedPolicyGeneration`; a stale writer receives a structured conflict and must refetch.
- A material policy mutation increments `policyGeneration` exactly once in the same SQLite transaction. A validated
  no-op returns the current state without incrementing. A registry revision change also advances the generation before
  new execution is accepted.
- Core evaluates factory Level posture, validated operator override, immutable Core floor, and deny-only compatibility
  constraints in one deterministic evaluator. Approval decisions are deliberately absent from this child.
- Production dispatch must carry the real persisted `policyGeneration`; the capability broker may no longer invent a
  default generation for a production call.

### Host projection and final enforcement

- Core sends a complete versioned policy projection for the target Host capability, bound inside the existing sealed
  operation control tuple. It contains every registered cell posture for that capability at the captured
  `policyGeneration`.
- Rust remains the trusted classifier for exec, shell-open, and other Host-owned argument-sensitive actions. It selects
  the matching descriptor cell locally and never requires a duplicate TypeScript security parser or a second broad
  classification RPC.
- Host accepts only a projection whose capability, registry/descriptor/classifier revisions, cell set, Host identity,
  connection/catalog generations, and policy generation match the current request/session contract. Reuse of one
  generation with different projection data fails closed.
- Host effective posture is the stricter of the selected Core posture and current Host-local/managed constraints.
  Host cannot turn `deny` into `ask`/`auto` or `ask` into `auto` without the future canonical Approval authorization.
- Host reports bounded classification/enforcement evidence with the terminal result so Core can verify the selected
  cell and stricter-only posture ordering. Sensitive argument scope is control data and must not enter ordinary logs.
- Until Slice 4 installs the single Core-mediated Approval lifecycle, an effective `ask` fails closed with a structured
  approval-required outcome. Slice 3 removes no security floor and does not preserve a second Shell prompt or create a
  transitional decision writer. Slice 3 and Slice 4 are independently checked children but are not separate release
  milestones.

### Adapter convergence

- Core built-in tools, standard MCP tools, Host capabilities, and Skill instruction/action seams resolve a canonical
  identity and descriptor before execution. The evaluator itself does not branch on MCP, Skill, provider, Shell, or a
  model-facing key.
- The MCP adapter preserves raw server/tool identity and the SDK closure while mapping it to a stable subject binding.
  MCP annotations, server descriptions, or trust labels may narrow presentation or discovery but never grant authority.
- `load_skill` remains a confined explicit-auto capability. Loaded instructions never transfer their posture to a
  referenced tool; Skill install/update/enable/remove and script/resource actions remain later ordinary capabilities.
- Existing built-in tools that are pure or domain-confined receive explicit registered `auto` descriptors rather than
  remaining invisible bypasses. Effectful Core mutations receive normal governed descriptors.

### Legacy compatibility and migration

- A missing legacy file contributes no local constraint. An existing Node `permission-level.json` can only tighten the
  Core level; `relaxed` never widens Core. Conflicting Host values remain Host-scoped and visible for repair.
- Legacy Shell `never` decisions remain Host-scoped deny-only constraints. Legacy Shell `always` and session decisions
  do not authorize the canonical system. The legacy file becomes read-only compatibility input and is not deleted.
- Legacy MCP `never` may narrow only an unambiguously mapped exact Host/server/tool binding. Legacy MCP `always` is not
  imported as authority and is left for explicit reconfirmation in Slice 4.
- An unreadable, malformed, or ambiguously mapped legacy source cannot be treated as empty if doing so might discard a
  denial. The affected adapter remains non-auto/fail-closed and surfaces a repairable diagnostic.
- No legacy source is removed before its deny behavior, mapping, restart behavior, and rollback evidence are verified.

### Minimal Home surface

- Add one Permission Level card and a collapsible advanced cell view to the existing Settings page.
- Render loading, reconnecting, read failure, validation failure, saved, stale-write conflict, second-confirm, and
  immutable/Host-constrained states truthfully.
- Home refetches from Core for every authenticated client generation. Policy state is not persisted in `localStorage`
  or the page-cache allow-list, and Home never becomes an authority.

## Acceptance Criteria

- [x] Core is the only global Level/common-policy writer and every material mutation atomically advances one durable
      `policyGeneration`.
- [x] Shared/Core/Rust projection fixtures produce the same factory cells and postures for every registered descriptor.
- [x] Unknown identity, revision, cell, subject binding, or stale policy generation fails closed.
- [x] Host classification consumes a Core projection and can only preserve or tighten its selected posture; no
      TypeScript copy of the Rust exec/shell-open security classifier exists.
- [x] One global policy change has one predictable effect for Core built-ins, standard MCP tools, Shell/Node
      capabilities, and Skill-mediated actions.
- [x] Standard MCP execution still reaches the raw SDK tool name and transport, and open `SKILL.md` packages remain
      usable without conversion to a private format.
- [x] A loaded Skill cannot grant or widen permission for any underlying action.
- [x] Legacy denials remain effective, while legacy levels/allows cannot widen a Host, identity, configuration revision,
      or future background execution scope.
- [x] An effective `ask` is fail-closed in this child and no Shell-local or temporary third Approval writer remains in
      the Slice 3 execution path.
- [x] Home handles optimistic-concurrency conflict, second-confirm, immutable cells, reconnect/refetch, and no-cache
      behavior.
- [x] Focused Shared/Core/Rust/Desktop tests, migration/restart tests, workspace gates, and a real Host process smoke
      pass before formal check completion.

## Definition of Done

- Shared schemas, Core repository/evaluator/operator methods, Host projection/enforcement, canonical adapters, legacy
  deny compatibility, and minimal Home controls are implemented and checked.
- The live baseline was rechecked immediately before implementation at `013-config`; this child lands
  `014-governance-policy` and its migration/restart coverage.
- Current-runtime authority wording in `CONTEXT.md`, executable backend specs, and affected ADRs is explicitly
  superseded only after verified behavior lands.
- A high-effort `trellis-implement` report and an xhigh-effort `trellis-check` report distinguish completed,
  incomplete, unverified, extra work, and residual risks.

## Out of Scope

- Final Approval request/respond schema, dialog, once/session/always ownership, durable canonical decisions,
  `approvalGeneration`, list/revoke, challenge/resume, and background disclosure (Slice 4).
- MCP/Skill CRUD, secrets, reload generations, package staging, trust/quarantine, and lifecycle Home pages.
- Replacing MCP, `@ai-sdk/mcp`, `SKILL.md`, or existing extension standards with a Taki-only protocol/package format.
- Autonomous Runs, Run Receipts, Scheduled Tasks, Heartbeat, or Experience Review.

## Research References

- [`research/live-governance-migration-map.md`](research/live-governance-migration-map.md) - verified live authority,
  migration, adapter, persistence, Home, and Slice 3/4 seams.
- [`../08-10-skills-mcp-productization/research/current-gap-and-dependency-map.md`](../08-10-skills-mcp-productization/research/current-gap-and-dependency-map.md)
  - existing cross-layer gaps and implementation anchors.
- [`../08-10-skills-mcp-productization/research/standards-and-reference-prior-art.md`](../08-10-skills-mcp-productization/research/standards-and-reference-prior-art.md)
  - standard MCP/Skill preservation, governance identity, and prior-art constraints.
