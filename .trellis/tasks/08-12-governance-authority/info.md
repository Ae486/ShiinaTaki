# Governance Authority Technical Design

> Implemented design record. Slice 3 production behavior and formal checks landed in the shared worktree on
> 2026-08-13. Current code plus the executable specs remain authoritative if this earlier design wording differs.
> Slice 3 is not independently releasable because effective `ask` intentionally waits for the Slice 4 canonical
> Approval lifecycle.

## 1. Architectural result

Slice 3 migrates the global policy authority out of the Desktop-only Shell model without moving the last trusted OS
boundary into TypeScript:

```text
trusted adapter identity + canonical descriptor
                    |
                    v
Core Level + operator override + Core hard/compat deny
                    |
                    v
        Core posture at policyGeneration N
                    |
          +---------+---------+
          |                   |
          v                   v
 Core/MCP execution     Host projection
                              |
                              v
                 Host classifier + stricter floor
                              |
                              v
                  final Host enforcement + audit
```

This is one policy model with multiple last-mile adapters, not one physical gate process and not a new extension
protocol. MCP continues through `@ai-sdk/mcp`; Skills continue as portable `SKILL.md` packages.

## 2. Canonical identity and descriptor schemas

### 2.1 Capability identity

The shared authority identity is a structured tuple rather than a model-facing name:

```typescript
type CanonicalCapabilityIdentity = {
  capabilityId: string;
  ownerHostId: string;
  subject?: {
    subjectId: string;
    revision: string;
  };
};
```

- `capabilityId` is the stable action family registered in the common descriptor registry. Existing Host capabilities
  keep their stable ids (`exec`, `process-list`, and so on).
- `ownerHostId` is always explicit, including for Core-local capabilities. The stable Core Host identity created by
  Slice 2 is used for Core/MCP/Skill resources owned by that Core Host.
- `subjectId` is a stable opaque resource/action instance id when one is required. It is never a display label, path,
  sanitized ToolSet key, server command, or raw user-controlled name.
- `subject.revision` changes when security-relevant binding changes. For MCP it binds the stable server/tool subject to
  the owning Host and public configuration/trust revision; for a Skill it may bind the package subject to its content
  revision where the operation requires it.
- Raw MCP `{mcpServerId, toolName}`, Skill `{skillId, contentHash}`, and other execution metadata remain beside this
  identity in trusted adapter records. The evaluator never parses display strings to reconstruct authority.

Before the secure MCP lifecycle supplies persisted `mcpServerId`/`configRevision`, the legacy MCP adapter may derive a
non-authorizing subject binding from the exact Host, config key, sanitized public configuration fingerprint, and raw
tool name. No legacy allow may be imported through that transitional binding.

### 2.2 Capability descriptor

The shared registry is validated, collision-free, and versioned as a whole. Each capability row has this semantic
shape:

```typescript
type CapabilityGovernanceDescriptor = {
  capabilityId: string;
  descriptorRevision: number;
  classifier: {
    authority: "core" | "host";
    classifierId: string;
    classifierRevision: number;
  };
  cells: Array<{
    key: string;
    levels: { strict: "auto" | "ask" | "deny"; standard: "auto" | "ask" | "deny"; relaxed: "auto" | "ask" | "deny" };
    approvalMemory: "rememberable" | "once-only";
    overrideMode: "ordinary" | "second-confirm" | "immutable";
  }>;
};
```

- `registryRevision` is a positive global revision and advances whenever descriptor meaning changes.
- `descriptorRevision` and `classifierRevision` prevent a Core projection from being paired with different Host
  classification semantics.
- `approvalMemory` preserves the existing `persist` versus never-persist contract but does not implement Approval
  records in Slice 3.
- `overrideMode=second-confirm` replaces the ambiguous meaning of current `denyByDefault`: it is operator-editable but
  requires a prominent second confirmation when loosened.
- `overrideMode=immutable` is a Core hard floor and cannot be changed by an operator override. Host managed/hard
  constraints are separate local inputs and never appear as globally editable cells.
- Dynamic classifiers return a descriptor `cellKey` for policy plus a sensitive `decisionKey` for later exact Approval
  scope. A family such as `fs-write:dir-root` is the policy cell; the root-qualified key remains sensitive control data.

## 3. Core SQLite and generation contract

Implementation uses migration `014-governance-policy`, selected after rechecking that the live baseline ended at
`013-config`. The durable schema is semantically:

```sql
CREATE TABLE governance_policy (
  singleton_id       INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  level              TEXT NOT NULL CHECK (level IN ('strict', 'standard', 'relaxed')),
  policy_generation  INTEGER NOT NULL CHECK (policy_generation > 0),
  registry_revision  INTEGER NOT NULL CHECK (registry_revision > 0),
  updated_at         TEXT NOT NULL
) STRICT;

CREATE TABLE governance_cell_overrides (
  cell_key            TEXT NOT NULL,
  level               TEXT NOT NULL CHECK (level IN ('strict', 'standard', 'relaxed')),
  posture             TEXT NOT NULL CHECK (posture IN ('auto', 'ask', 'deny')),
  descriptor_revision INTEGER NOT NULL CHECK (descriptor_revision > 0),
  updated_at          TEXT NOT NULL,
  PRIMARY KEY (cell_key, level)
) STRICT;
```

Descriptor rows are not copied into SQLite. The registry is code/shared truth; SQLite stores operator choices against
validated descriptor identity.

Boot behavior:

1. The migration creates/initializes the singleton at `standard`, generation `1`, and the current registry revision.
2. Core validates all stored overrides before serving execution.
3. A newer code registry revision is reconciled in one transaction: incompatible overrides are retained only as
   diagnostics or removed according to explicit migration code, the registry revision advances, and
   `policyGeneration` increments exactly once.
4. A database registry revision newer than the running binary is a downgrade incompatibility and fails governance
   startup with a repairable diagnostic; it never silently uses an older, potentially wider descriptor.

Mutation behavior:

- `levelSet` and `cellSet` carry `expectedPolicyGeneration`.
- The repository performs compare, validation, material write, and generation increment in one synchronous SQLite
  transaction.
- A stale comparison returns `POLICY_CONFLICT` plus enough current generation metadata for the client to refetch.
- A no-op returns current state without an increment.
- `cellSet` accepts a nullable override posture: `null` clears a stored override and returns the factory value.
- A `second-confirm` cell requires `secondConfirm:true` only when the requested result loosens its factory protection.
  An immutable cell always refuses a material override.

## 4. Effective evaluator

Posture ordering is `auto < ask < deny`. The evaluator is pure and deterministic:

1. Validate canonical identity, owner Host, subject revision, registry revision, descriptor revision, classifier
   revision, and selected cell. Any miss returns `deny` with a closed reason.
2. Select the descriptor's factory posture for the active global Level.
3. Apply a validated Core operator override as the Core-authoritative replacement for that factory posture. This is the
   only layer allowed to loosen a factory default, subject to `overrideMode`.
4. Intersect immutable Core floors and deny-only legacy compatibility constraints.
5. Return `{identity, cellKey, descriptorRevision, policyGeneration, posture, reason}`.

Approval is not evaluated here in Slice 3. Callers handle the result as follows:

- `auto`: execute after normal availability, input, and generation checks;
- `deny`: return a structured denial;
- `ask`: return a structured approval-required denial until Slice 4 installs the canonical resolver.

This temporary fail-closed behavior is deliberate. It avoids adding a transitional store or retaining a Host prompt
that would be removed immediately in Slice 4. The T4 branch must not be released between Slice 3 and Slice 4.

## 5. Host projection without classifier duplication

### 5.1 Catalog compatibility

`HostCapabilityDescriptor` gains only governance compatibility metadata, not Host-defined policy:

```typescript
type HostCapabilityGovernanceSupport = {
  descriptorRevision: number;
  classifierId: string;
  classifierRevision: number;
};
```

Core routes a Host capability only when its published compatibility exactly matches the canonical registry. A Host
cannot publish `auto`, grant metadata, or a replacement cell table.

### 5.2 Sealed projection

`HostOperationControl` carries a projection bound by its existing exact equality/provenance checks:

```typescript
type HostGovernanceProjection = {
  registryRevision: number;
  descriptorRevision: number;
  classifierRevision: number;
  cells: Array<{ key: string; posture: "auto" | "ask" | "deny" }>;
};
```

The existing top-level `policyGeneration` identifies the durable Core state that produced it. The projection contains
every descriptor cell exactly once, sorted canonically. Missing, duplicate, unknown, or extra cells reject the request.

### 5.3 Host evaluation

Rust keeps the current exec/shell-open/path classifiers and command-bearing audit. For each request it:

1. validates Host/connection/catalog identity and monotonic policy generation;
2. validates descriptor/classifier revision and the complete projected cell set;
3. classifies the exact input to `{cellKey, decisionKey}` using the local trusted classifier;
4. selects the Core posture for `cellKey`;
5. applies local availability, legacy deny, operator-local, managed, and hard constraints using max/stricter ordering;
6. executes only `auto`; `ask` and `deny` do not execute in Slice 3; and
7. returns bounded evidence with the terminal frame.

The evidence shape is semantically:

```typescript
type HostGovernanceEvidence = {
  descriptorRevision: number;
  classifierRevision: number;
  cellKey: string;
  effectivePosture: "auto" | "ask" | "deny";
  constraint: "none" | "legacy-deny" | "local" | "managed" | "hard";
};
```

Core verifies that `effectivePosture` is not looser than the projected posture for the reported cell. `decisionKey` and
human detail remain non-logged sensitive control material for Slice 4 challenge/resume.

A live Host session remembers the highest accepted `policyGeneration` and the canonical projection digest for that
generation. A lower generation, or different projection under the same generation, is rejected. Reconnect starts a new
connection lineage, while connection/catalog binding prevents old projections from authorizing the new socket.

## 6. Adapter contracts

### Core tools

- Trusted tool construction attaches canonical identity and classifier output before the ToolSet reaches the Agent.
- Pure or confined operations use explicit `auto` descriptors; they do not remain an untracked bypass.
- Effectful Core mutations use normal governed cells. Operator-only configuration methods remain outside the Agent
  tool surface and are protected by connection role plus policy-domain validation.

### MCP

- `McpManager` keeps `@ai-sdk/mcp` client creation, `listTools`, compatibility preparation,
  `toolsFromDefinitions`, raw-name execution closure, failure isolation, and structured error wrapper.
- The model-facing key is presentation/discovery only. A sidecar maps it to canonical identity plus raw
  `{mcpServerId, toolName}` execution metadata.
- The governance wrapper evaluates immediately before calling the existing SDK closure. No MCP request/response or
  transport extension carries Taki policy.
- MCP annotations and descriptions are untrusted hints and cannot select a looser descriptor/posture.

### Skills

- `load_skill` maps to a confined explicit-auto descriptor and remains a lazy read of the standard package.
- The returned Markdown is untrusted procedure. It cannot alter the identity, Host, policy generation, cell, or
  Approval scope of later calls.
- Later Skill lifecycle operations and script/resource access register ordinary capabilities; no `allowed-tools`
  metadata becomes a grant.

### Host capabilities

- Existing stable action ids remain canonical `capabilityId` values and are qualified by `ownerHostId`.
- The Host catalog publishes compatibility only; Core supplies policy; Rust supplies classification, stricter local
  enforcement, and audit.

## 7. Legacy compatibility

### Node Level

- Replace `load_level -> Standard when missing` with a compatibility reader that distinguishes missing from an actual
  stored value.
- Missing contributes no Host constraint. Existing `strict`/`standard` can tighten Core; existing `relaxed` cannot
  widen it.
- The file is read-only in Slice 3 and remains available for rollback/inspection.

### Shell decisions

- Replace the writable decision path with a read-only legacy deny adapter.
- Persisted `never` tightens only the same Host and unambiguous canonical cell/decision mapping.
- Persisted `always` and session state are ignored for authority. No new writes occur.
- Unreadable/malformed state makes affected Host governance unavailable rather than silently discarding possible deny
  records.

### MCP decisions

- `mcp-approvals.json` is read-only compatibility input.
- An unambiguous exact legacy `never` is intersected as deny. `always` never creates canonical authority.
- Corrupt or ambiguous state keeps affected legacy MCP calls non-auto and surfaces a sanitized diagnostic.
- Slice 4 owns explicit reconfirmation and final retirement; Slice 6 supplies persisted stable MCP desired identities.

No legacy file is deleted in this child.

## 8. Home contract

The existing Settings route gains a policy section before generic config knobs:

- one `strict | standard | relaxed` card;
- one collapsed-by-default advanced cell list grouped by capability;
- factory, override, effective posture, override mode, and current generation;
- disabled immutable rows, a global truthful Host-stricter notice, and prominent second-confirm flow; per-row Host
  constraint state is not invented because the operator schema does not expose it;
- loading, reconnecting, failure, saved, and stale-conflict feedback.

The hook captures the current authenticated `WsClient` generation, requests fresh Core state, and discards late results
from retired clients. It stores only component/request state. No policy snapshot enters `localStorage`, Zustand
persistence, or the SWR page allow-list.

## 9. Implemented batches and ownership record

Slice 3 remained one Trellis child and landed in three reviewable internal batches under one implementer ownership to
avoid conflicting edits:

1. **Shared + Core policy foundation**
   - governance/permission schemas, registry, evaluator, SQLite migration/repository, operator methods, generation
     conflict tests, and explicit adapters for Core/Skill/MCP without changing MCP protocol behavior;
   - primary hotspots: `packages/shared/src/**`, `packages/core/src/governance/**`, DB migrations,
     `packages/core/src/server/methods/**`, `packages/core/src/main.ts`, and MCP/Skill tool construction.
2. **Host projection + migration compatibility**
   - Host catalog support metadata, sealed projection/evidence, real policy generation dispatch, Rust validation and
     stricter composition, read-only legacy Level/deny inputs, and cross-language fixtures;
   - primary hotspots: `packages/shared/src/host-control-*`, Core capability router/broker, and
     `apps/desktop/src-tauri/src/{host_control_protocol,host_session,gate,gate/**,node,ws_client,protocol}.rs`.
3. **Home + convergence docs/tests**
   - typed `WsClient` permission methods, Settings policy hook/components, reconnect/conflict tests, real Host smoke,
     then authority/spec/ADR/HANDOFF updates from verified behavior.

The main Leader owns cross-module documentation and final scope judgment. The high-effort implement agent owns all
production files for this child and must accommodate concurrent mainline changes rather than reverting them. The
xhigh-effort check agent reviews and fixes the complete slice after substantive implementation.

## 10. Verification plan

Focused matrix:

- Shared: descriptor/identity/projection schemas, registry collision, mutation shapes, strict unknown-field fixtures,
  and Rust golden parity.
- Core: every cell/Level factory projection, override modes, immutable floors, unknowns, atomic generation increment,
  no-op, conflict, restart, registry upgrade/downgrade, legacy deny, and adapter parity.
- Host: complete projection validation, same-generation digest mismatch, stale generation, classifier cell selection,
  stricter ordering, missing/corrupt legacy source, `ask` fail-closed, command audit preservation, and no execution on
  denial.
- MCP: existing standard SDK list/convert/raw call path remains intact; model key never becomes authority; config/Host
  revision change cannot inherit a legacy allow.
- Skill: loading instructions is explicit auto but cannot authorize a denied underlying Core/MCP/Host action.
- Home: level and cell mutation, null/reset, second confirm, immutable refusal, stale conflict/refetch, reconnect, late
  client suppression, and no persisted cache.
- Process smoke: real Core + Node boot, governance-compatible catalog publication, relaxed auto execution, Core deny,
  Host stricter deny, policy generation change, and stale projection rejection.

Full convergence gates after focused tests:

```powershell
pnpm -r typecheck
pnpm lint
pnpm -r test
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --bin taki-node
git diff --check
```

Run one formal xhigh-effort `trellis-check` only after the production slice has real volume. The final two-Node
same-capability process harness remains the mandatory Slice 8 convergence gate and is not falsely claimed here.

## 11. Documentation convergence

After behavior is verified, explicitly supersede stale current-runtime wording in:

- `CONTEXT.md` (`Capability`, `Permission Gate`, and `Permission Level` authority wording);
- `.trellis/spec/backend/permission-authorization.md`;
- `.trellis/spec/backend/tool-design.md`;
- affected ADRs, especially 0003, 0006, and 0007; and
- package `index.md` files plus `docs/HANDOFF.md`.

The replacement wording must say: Core owns the global ceiling and durable policy; an Execution Host classifies and
enforces its owned action at the final boundary and may only tighten; MCP and Skills remain their ecosystem standards.

## 12. Merge and release risks

- `packages/shared/src/index.ts`, `packages/core/src/main.ts`, DB migration numbering, Home `ws-client*`, Settings, Rust
  protocol/gate files, specs, and HANDOFF are shared hotspots. Recheck `main...HEAD` immediately before implementation.
- A concurrent mainline migration changes the expected migration number; resolve semantically and rerun migration tests.
- Slice 3 intentionally fails closed on `ask`; do not release or merge the parent initiative before Slice 4 restores
  the canonical interactive Approval path.
- A projection that omits a cell, accepts a Host-provided posture, or defaults generation to `1` is a security defect.
- A model key, display label, path, MCP annotation, Skill metadata, or legacy allow used as authority is a review blocker.
