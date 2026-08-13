# Canonical Capability Governance and Permission Authorization

Core owns the profile-wide durable policy. An Execution Host owns trusted local classification, final Host-side
execution, stricter local or managed constraints, and audit. These are two parts of one governance path, not competing
permission systems.

Posture ordering is `auto < ask < deny`. A Host may preserve or increase that ordering; it may never reduce it.
Standard MCP and portable `SKILL.md` packages remain ecosystem formats. Their adapters resolve canonical identity but
do not create extension-specific authority.

## Scenario: Global policy, Host projection, and final enforcement

### 1. Scope / Trigger

Apply this contract when changing any of the following:

- capability identity, descriptor registry, factory posture, override mode, or classifier revision;
- `permission.levelGet`, `permission.levelSet`, `permission.cellsGet`, or `permission.cellSet`;
- governance SQLite migrations, registry reconciliation, or `policyGeneration`;
- Core/MCP/Skill/Host tool assembly or execution wrappers;
- Host catalog governance metadata, operation control, projection digest, classification, terminal evidence, or audit;
- legacy `permission-level.json`, `gate-decisions.json`, or `mcp-approvals.json` compatibility;
- the Home Permission Level or advanced-cell surface; or
- the later canonical Approval challenge/resume lifecycle.

Never add a built-in-only, MCP-only, Skill-only, or Shell-only policy store. Loading a Skill, listing an MCP tool, or
authenticating a Host does not authorize an action.

### 2. Signatures

#### Shared canonical identity and descriptor

```typescript
interface CanonicalCapabilityIdentity {
  capabilityId: string;
  ownerHostId: string; // UUID
  subject?: { subjectId: string; revision: string };
}

interface CapabilityGovernanceDescriptor {
  capabilityId: string;
  descriptorRevision: number;
  subjectRequired: boolean;
  classifier: {
    authority: "core" | "host";
    classifierId: string;
    classifierRevision: number;
  };
  cells: Array<{
    key: string;
    levels: { strict: Posture; standard: Posture; relaxed: Posture };
    approvalMemory: "rememberable" | "once-only";
    overrideMode: "ordinary" | "second-confirm" | "immutable";
  }>;
}

type Posture = "auto" | "ask" | "deny";
```

`CANONICAL_GOVERNANCE_REGISTRY` in `@taki/shared` is code-owned descriptor truth. SQLite stores operator choices, not
copies of descriptors. `capabilityId`, `ownerHostId`, and the optional stable subject binding are authority; display
names, paths, sanitized model keys, MCP annotations, and Skill metadata are not.

#### Operator API

```typescript
permission.levelGet({})
  -> { level, policyGeneration, registryRevision }

permission.levelSet({ level, expectedPolicyGeneration })
  -> { level, policyGeneration, registryRevision }

permission.cellsGet({})
  -> { level, policyGeneration, registryRevision, cells[] }

permission.cellSet({
  key,
  level,
  posture: "auto" | "ask" | "deny" | null,
  expectedPolicyGeneration,
  secondConfirm?: boolean,
}) -> { policyGeneration, registryRevision, cell }
```

All four methods are operator-only. `null` clears a sparse override. Reads are idempotent/read-only deadline calls;
writes are side-effecting calls whose timeout has an unknown outcome and must not be replayed automatically.

#### Core persistence

Migration `014-governance-policy` creates:

```sql
governance_policy(
  singleton_id = 1,
  level,
  policy_generation,
  registry_revision,
  updated_at
)

governance_cell_overrides(
  cell_key,
  level,
  posture,
  descriptor_revision,
  updated_at,
  PRIMARY KEY(cell_key, level)
)
```

The repository owns compare/validate/write/generation increment inside one synchronous SQLite transaction.

#### Host projection and evidence

```typescript
interface HostOperationControl {
  runId: string;
  operationId: string;
  attemptId: string;
  targetHostId: string;
  connectionGeneration: number;
  catalogGeneration: number;
  policyGeneration: number;
  governanceProjection: {
    registryRevision: number;
    descriptorRevision: number;
    classifierRevision: number;
    cells: Array<{ key: string; posture: Posture }>;
    digest: string; // lowercase SHA-256 of canonical JSON payload
  };
  approvalGeneration: number;
  capabilityId: string;
  inputDigest: string;
  idempotencyKey: string;
  dispatchedAt: string;
  deadlineAt: string;
  expiresAt?: string;
}

interface HostGovernanceEvidence {
  descriptorRevision: number;
  classifierRevision: number;
  cellKey: string;
  effectivePosture: Posture;
  constraint: "none" | "legacy-deny" | "local" | "managed" | "hard";
}
```

Canonical projection JSON contains exactly `registryRevision`, `descriptorRevision`, `classifierRevision`, and the
complete lexically sorted `cells` array. TypeScript and Rust both compute SHA-256 over the same UTF-8 bytes.

### 3. Contracts

#### Core policy authority

- The default durable level is `standard`; `policyGeneration` and `registryRevision` are positive integers.
- A material level or cell mutation increments `policyGeneration` exactly once in the same transaction. A validated
  no-op returns the current snapshot without incrementing.
- A registry revision upgrade reconciles stored overrides and increments generation before new execution is accepted.
  A database registry revision newer than the running binary fails startup rather than downgrading semantics.
- The pure evaluator validates canonical identity, subject binding, registry/descriptor/classifier revisions, cell,
  active level, override identity, and deny constraints. Unknown or mismatched input resolves fail-closed.
- Built-in Core tools have explicit bindings. An unregistered Core tool with an executable closure is wrapped as
  `GOVERNANCE_DENIED`, not left as an invisible bypass.

#### Classification and Host enforcement

- A descriptor declares who classifies. Core classifies fixed/Core-local families. Rust remains the trusted classifier
  for `exec`, `shell-open`, and other Host-owned argument-sensitive actions; do not duplicate those security parsers in
  TypeScript.
- Core sends every registered cell for the selected Host capability. The Host rejects missing, extra, duplicate,
  unsorted, unknown, or revision-incompatible projections.
- The Host binds acceptance to Host identity, connection generation, catalog generation, capability, policy
  generation, projection digest, and sealed input digest. It tracks `(policyGeneration, digest)` per capability in a
  live connection lineage. A lower generation or different same-generation content for that capability is rejected.
- Host effective posture is the stricter of the projected cell and current legacy/local/managed/hard constraints.
  Execution occurs only for effective `auto`. Effective `ask` returns structured `APPROVAL_REQUIRED`; effective
  `deny` returns a denial. Neither executes.
- Terminal evidence names a projected cell and matching descriptor/classifier revisions. Core rejects evidence that is
  looser than the projection, omits a claimed stricter constraint, or reports successful execution under non-`auto`.
- Arguments, commands, decision keys, full projections, and tool output are sensitive control data. Ordinary logs and
  bounded evidence must not contain them. Exec command audit remains the dedicated Shell audit exception.

#### Adapter convergence

- **Core tools:** trusted construction binds the model-facing tool key to one canonical identity and cell.
- **MCP:** `@ai-sdk/mcp` still owns standard transport, discovery, schema conversion, and the raw-name execution
  closure. A sidecar maps it to `mcp.tool.call` plus a stable Host-qualified subject. A sanitized-key collision removes
  the ambiguous tools fail-closed.
- **Skills:** `load_skill` is a confined explicit-auto capability for reading a validated standard package. The returned
  Markdown is untrusted procedure. It cannot transfer posture or grant an underlying Core, MCP, or Host action.
- **Host capabilities:** catalog descriptors publish classifier compatibility only. The Host never publishes an
  authoritative posture to Core.

#### Legacy compatibility

- Missing legacy state contributes no extra constraint.
- Existing Node `permission-level.json` is read-only compatibility input. `strict` or `standard` may tighten the Core
  level; `relaxed` never widens it. Malformed/unreadable input fails the affected Host closed.
- Existing Shell `never` decisions remain exact Host-scoped deny constraints. Shell `always`, session decisions, local
  prompts, and decision writes are not production authority.
- Existing MCP exact `never` may tighten only an unambiguous exact server/tool binding. MCP `always` is inert pending
  explicit reconfirmation by the later canonical Approval lifecycle.
- Do not delete legacy files until deny mapping, restart behavior, rollback evidence, and later retirement criteria are
  verified.

#### Home operator surface

- Settings renders the Core Permission Level before generic config knobs and a collapsed-by-default advanced cell list
  grouped by Core-returned `capabilityId`.
- Home parses every response through `@taki/shared`, refetches for every authenticated `WsClient` generation, and
  ignores late reads or mutation completions from retired clients.
- At most one permission mutation is in flight. Mutations are never replayed after timeout/reconnect. A conflict
  refetches Core truth.
- Permission snapshots stay in component/controller memory. They never enter `localStorage`, Zustand persistence,
  `useCachedFetch`, or the page-cache allow-list.
- Home renders factory, override, effective posture, override mode, generation, loading/reconnecting/read/validation
  failure, saved, conflict, second-confirm, reset, and immutable states. It may state globally that Hosts can tighten;
  it must not invent a per-row Host constraint that Core did not return.

#### Slice 3 / canonical Approval seam

- Slice 3 contains no durable canonical Approval decision and no second prompt/writer. `ask` is intentionally
  fail-closed.
- Slice 4 owns the one request/respond, once/session/always, durable decision, `approvalGeneration`, list/revoke,
  challenge/resume, and background disclosure lifecycle.
- Slice 3 and Slice 4 may be reviewed separately but are not separate release milestones.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Unknown capability, subject, revision, classifier, cell, or duplicate registry identity | Fail closed; never execute |
| Stale `expectedPolicyGeneration` | JSON-RPC `POLICY_CONFLICT` with current generation; Home refetches |
| Material immutable-cell override | JSON-RPC `GOVERNANCE_REFUSED` reason `immutable` |
| Relaxing a `second-confirm` cell without proof | `GOVERNANCE_REFUSED` reason `second-confirm-required` |
| Validated no-op or factory-equivalent override | Return current state; generation unchanged |
| Host catalog descriptor revision/classifier mismatch | Refuse route as incompatible; do not dispatch |
| Missing/extra/unsorted projection cell or invalid digest | Host rejects; no execution/audit growth |
| Policy generation lower than accepted lineage | Host rejects as stale; no replay |
| Same capability + generation + different valid digest | Host rejects lineage tampering; no execution |
| Host evidence revision/cell/posture invalid or wider than projection | Core converts terminal result to denial |
| Effective Host posture is `ask` | `APPROVAL_REQUIRED`, no local prompt, no execution |
| Effective Host posture is `deny` | Denied, audited where applicable, no execution |
| Legacy allow/session value | Ignore as authority |
| Exact legacy `never` | Tighten matching action only |
| Legacy file malformed/unreadable where a denial may exist | Affected adapter/Host fails closed with sanitized diagnostic |
| Permission read snapshot has inconsistent level/generation/revision | Home validation failure; do not render it as authority |
| Permission mutation timeout or client replacement | Release busy state truthfully; never replay; refetch only when safe/explicit |

### 5. Good / Base / Bad Cases

- Good: an operator changes `standard -> relaxed` with generation N; Core commits generation N+1 once, a later Host
  request carries the complete N+1 projection, Rust classifies locally, executes only `auto`, and returns evidence that
  Core verifies.
- Good: a Host legacy `never` tightens projected `auto` to `deny`; Core receives stricter evidence and the action never
  executes. Clearing a Core override at the next generation restores the factory posture without importing a legacy
  allow.
- Base: a second Home window writes from stale generation N after N+1 exists. Core returns `POLICY_CONFLICT`; the stale
  window refetches and does not replay its mutation.
- Base: an effective `ask` returns `APPROVAL_REQUIRED` and stops. This is secure but not independently releasable until
  Slice 4 installs canonical Approval.
- Bad: use `mcpServer_toolName`, a Skill path, a display label, or an annotation as the durable grant key.
- Bad: keep the old Shell prompt/decision writer while also adding Core policy; that is a third authorization system.
- Bad: accept a Host-provided posture, omit projection cells, default generation to `1`, cache policy in Home, or copy
  the Rust exec/shell-open classifier into TypeScript.

### 6. Tests Required

- Shared: strict identity/descriptor/operator/projection/evidence schemas; registry collisions; canonical sort/digest;
  structured `GOVERNANCE_DENIED` and `APPROVAL_REQUIRED`; TypeScript/Rust protocol fixture parity.
- Core repository/service: migration/restart, atomic single generation increment, no-op, conflict, reset, registry
  upgrade/downgrade, immutable/second-confirm, every factory cell/level, unknown identity/revision/cell, and stored
  override validation.
- Adapter tests: explicit Core bindings and unknown-tool denial; MCP raw-name closure preservation, sanitized-key
  collision, exact legacy deny, no legacy allow; Skill load confinement and no grant transfer.
- Host/Rust: complete projection validation, canonical digest, per-capability lineage, stale generation, same-generation
  tampering, input digest recomputation, trusted cell classification, stricter composition, exact legacy deny,
  malformed legacy state, `ask` fail-closed, no execution under non-`auto`, and bounded evidence.
- Home: typed WS schema boundaries, permission reads classified read-only, writes unknown-outcome, generation
  replacement/refetch, retired-result suppression, conflict refetch, second confirm, immutable, reset, one mutation at
  a time, validation/read/reconnect states, and a source/cache regression proving no permission persistence.
- Real process: Core + external `taki-node` catalog compatibility, `ask` fail-closed, relaxed auto, Core deny, Host
  legacy deny, override reset, higher generation replacement, stale N-1 projection rejection, and same-N projection
  tampering with a recomputed valid digest. Assert no execution/audit growth, one request, no replay, bounded caller
  settlement, relay/process/temp cleanup, and no sensitive frame logging.
- Full gates: `pnpm -r typecheck`, root `pnpm lint`, `pnpm -r test`, full E2E, Rust tests, Clippy `-D warnings`, locked
  `taki-node` build, and `git diff --check`.

### 7. Wrong vs Correct

```typescript
// Wrong: presentation identity becomes authority and the broker invents policy state.
const grantKey = `${sanitizedServer}_${toolName}`;
const control = { capabilityId, policyGeneration: 1 };

// Correct: a trusted adapter resolves canonical identity; Core supplies durable policy and complete projection.
const identity = {
  capabilityId: "mcp.tool.call",
  ownerHostId: coreHostId,
  subject: { subjectId: stableServerToolId, revision: configRevision },
};
const dispatch = governance.hostDispatchPolicy(capabilityId);
const control = {
  capabilityId,
  policyGeneration: dispatch.policyGeneration,
  governanceProjection: dispatch.projection,
};
```

```rust
// Wrong: Host-local prompt or stored allow widens the Core projection.
let execute = local_prompt(input).await == Allow;

// Correct: classify locally, compose stricter-only, and execute only auto.
let cell = classify_trusted(input)?;
let effective = stricter(projected(cell)?, local_constraints(input)?);
match effective {
    Auto => execute_and_audit(input),
    Ask => approval_required_without_execution(cell),
    Deny => denied_without_execution(cell),
}
```
