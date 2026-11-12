# Canonical Capability Governance and Permission Authorization

Core owns the profile-wide durable policy. An Execution Host owns trusted local classification, final Host-side
execution, stricter local or managed constraints, and audit. These are two parts of one governance path, not competing
permission systems.

Posture ordering is `auto < ask < deny`. A Host may preserve or increase that ordering; it may never reduce it.
Standard MCP and portable `SKILL.md` packages remain ecosystem formats. Their adapters resolve canonical identity but
do not create extension-specific authority.

Readable names and approval copy follow [Operation Presentation](./operation-presentation.md).
Approval construction and final revalidation read classifier identity/revision from the active service
registry; non-MCP does not imply `fixed-risk` (`write_file` uses `workspace-path`). Labels never become
binding keys or change decision usability.

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
- A model-facing rename or capability-gated tool family must update the Core binding table in the same activation
  change. Legacy and canonical Memory names intentionally share stable policy identities: search-like `memory_search`,
  `recall`, and `reflect` use `core.memory.search` / `memory-search`; write-like `memory_write`, `retain`,
  `update_memory`, and `restore_memory` use `core.memory.write` / `memory-write`; invalidation names
  `memory_archive` and `invalidate_memory` use `core.memory.archive` / `memory-archive`. These cells remain the policy
  authority; a display/tool rename never creates a new grant and never bypasses Governance.
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
- Home renders factory, override, effective posture, override mode, loading/reconnecting/read/validation
  failure, saved, conflict, second-confirm, reset, and immutable states. It may state globally that Hosts can tighten;
  it must not invent a per-row Host constraint that Core did not return. Generation/revision values remain internal
  inputs for CAS and freshness checks; G4 excludes their primary, expanded, copy and accessible presentation.

#### Slice 3 / canonical Approval seam

- Slice 3 contains no durable canonical Approval decision and no second prompt/writer. `ask` is intentionally
  fail-closed.
- Slice 4 owns the one request/respond, once/session/always, durable decision, `approvalGeneration`, list/revoke,
  challenge/resume, and background disclosure lifecycle.
- Slice 3 and Slice 4 may be reviewed separately but are not separate release milestones.

#### Implemented Slice 4 challenge/resume contract (commits cd67ad0, 2c1c4e5, ffa9fff; final check passed)

- Host `ask` emits a strict `capability.challenge` (Node → Core) bound to the sealed control tuple. Core recomputes
  the control/challenge/decision-scope digests from its own sealed state and the registry descriptor, and validates
  ask-only stricter-only governance evidence, before any approval work; it never echoes frame fields as authority.
- Core bridges to the single `ApprovalInteractionService` against the initiating operator's physical `Connection`
  and mints a one-use `CapabilityAuthorization` (digest-bound, `approvalGeneration`-bound, deadline-bounded),
  delivered as `capability.resume` (Core → Node) only on the same current connection after full-lineage revalidation.
- Rust holds the pending challenge and raw input memory-only inside the per-generation `HostSession`, consumes the
  authorization exactly once, executes at most once, and settles with authorization lineage; reconnect discards the
  pending slot.
- Immediately before an approved resume executes, Rust recomputes trusted classification and the latest
  legacy/local/managed/hard floor. The still-`ask` request records exactly one `AllowedOnce` audit row and executes;
  a newly tightened `deny` records exactly one denial row and never reaches the effect handler.
- `DecisionStore::remember` remains parent-module-visible only. Tests may seed legacy state only through a
  `#[cfg(test)]` seam; testing convenience must not widen production decision-write authority.
- `completed ⟺ ask ⟺ authorization lineage` is enforced cross-language (Zod `superRefine` plus Rust
  `validate_lineage`) and pinned by golden fixtures; a completed ask-class frame without valid lineage converts to a
  denial.
- Unattended turns construct tools without an operator connection and raise no ambient prompt. Core/MCP `ask`
  can consume an exact current durable grant through the read-only authority check below; otherwise it returns
  `APPROVAL_REQUIRED`. Host `ask` retains its existing challenge/authorization behavior.
- Pending raw input never reaches logs, audit, timeline, caches, error payloads, or the wire. Migration
  `016-timeline-input-scrub` idempotently removes historical tool-call `input` from timeline parts with
  `secure_delete` zeroing; timeline writes strip input and reads re-sanitize.

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
| Approved resume remains `ask` at final Host enforcement | Execute once; one `AllowedOnce` audit row; retain authorization lineage |
| Host floor tightens before approved resume | Deny once; one denial audit row; no effect execution |
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
- Good: an operator approves an `ask`, the Host rechecks the same sealed input immediately before execution, emits one
  allowed audit row, and returns the single-use authorization lineage.
- Base: a second Home window writes from stale generation N after N+1 exists. Core returns `POLICY_CONFLICT`; the stale
  window refetches and does not replay its mutation.
- Base: an effective `ask` returns `APPROVAL_REQUIRED` and stops. This is secure but not independently releasable until
  Slice 4 installs canonical Approval.
- Bad: use `mcpServer_toolName`, a Skill path, a display label, or an annotation as the durable grant key.
- Bad: keep the old Shell prompt/decision writer while also adding Core policy; that is a third authorization system.
- Bad: execute an approved resume from cached challenge evidence, or make legacy decision writers crate-visible so a
  sibling production module can silently grant or deny.
- Bad: accept a Host-provided posture, omit projection cells, default generation to `1`, cache policy in Home, or copy
  the Rust exec/shell-open classifier into TypeScript.

### 6. Tests Required

- Shared: strict identity/descriptor/operator/projection/evidence schemas; registry collisions; canonical sort/digest;
  structured `GOVERNANCE_DENIED` and `APPROVAL_REQUIRED`; TypeScript/Rust protocol fixture parity.
- Core repository/service: migration/restart, atomic single generation increment, no-op, conflict, reset, registry
  upgrade/downgrade, immutable/second-confirm, every factory cell/level, unknown identity/revision/cell, and stored
  override validation.
- Adapter tests: execute every current Core binding, including every capability-gated canonical Memory key, assert its
  exact stable identity/cell, and retain unknown-tool denial; MCP raw-name closure preservation, sanitized-key collision,
  exact legacy deny, no legacy allow; Skill load confinement and no grant transfer.
- Host/Rust: complete projection validation, canonical digest, per-capability lineage, stale generation, same-generation
  tampering, input digest recomputation, trusted cell classification, stricter composition, exact legacy deny,
  malformed legacy state, `ask` fail-closed, approved-resume final-floor recheck, exactly-one allowed/denied audit,
  single production decision writer, no execution under non-`auto`, and bounded evidence.
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

## Captured unattended tool execution (2026-10-18)

### 1. Scope / Trigger

Use when an existing admitted Run executes captured Core/MCP/Host closures without an operator socket,
including deterministic evidence preparation before the Agent. No media-specific permission path is introduced.

### 2. Signatures

`ApprovalInteractionService.hasDurableAuthority(binding: ApprovalDecisionBinding): boolean` delegates to the
existing usable durable-decision matcher. `bindCapturedToolExecution(tools, execution)` accepts a
`GovernedEffectContext` containing exact Run/Attempt/Effect owner, optional observer and cancellation signal.
`governedExecutionContext(options)` reads its process-private options metadata. No protocol or database schema changes.

### 3. Contracts

- Core/MCP wrappers first evaluate current governance. Explicit deny never reaches approval lookup. An unattended
  ask can execute only with an exact usable durable grant; once/session decisions cannot authorize background work.
  Host/subject/config revision/classifier/binding mismatches and revoked grants remain denied without a prompt.
- Bind execution metadata to the original captured closures, preserving descriptor sidecars and the admitted
  context. The binder creates no Effect, registry, connection, permission or native retry. The existing governed
  wrapper/broker owns exactly one Effect at dispatch and its terminal outcome.
- The execution failure bracket surrounds the actual closure invocation as well as its awaited result. A synchronous
  throw and an asynchronous rejection both settle that Effect once with the existing failure/cancellation semantics,
  then propagate the original error. `Promise.resolve(execute(...)).catch(...)` is insufficient because argument
  evaluation can throw before the handler exists. Keep intent hooks, observer binding and settlement outside that
  catch: their authority/persistence failures must not be disguised as ordinary tool failures or retried settlement.
  `governed-tool.test.ts` covers both execution forms, cancellation and those separate failure boundaries.
- ChatAgent binds the captured bag for each actual Attempt before merging/disclosure/captured Skill loading.
  InitiativeRuntime binds a derived bag for `prepareInput`, which runs before ChatAgent. Source/authority checks
  retain the original context; admission snapshots are not recaptured.
- Host extension routes forward the bound Run/Attempt and signal. Root wiring must preserve those fields instead
  of overwriting them with absent interactive fields. Existing broker ownership and Host generation fences remain.
- Combine caller and Run cancellation. Pre-dispatch abort creates no side effect; cooperative pending reads cancel
  their wait. An uncooperative side effect cancelled after dispatch retains `OUTCOME_UNKNOWN`.
- Installed `@ai-sdk/mcp` cancellation stops its local request wait, not remote computation. `CANCELLED` therefore
  never means BiliNote's task was cancelled. Native request identity and reconciliation rules remain authoritative.

### 4. Validation & Error Matrix

| Condition | Required outcome |
| --- | --- |
| Current exact durable Core/MCP grant | Original closure executes, no operator prompt |
| Missing/session/once/revoked/wrong-binding grant | `APPROVAL_REQUIRED`, no native dispatch |
| Current governance deny | `GOVERNANCE_DENIED`, even with a stored grant |
| Captured SDK/direct/extension call | Exactly one Effect for the executing Run/Attempt |
| Pre-aborted Run or caller | Cancelled, no dispatch |
| Host preflight abort | No execute message; pending broker state settles |
| Uncooperative dispatched Host side effect | Unknown outcome; never silently replay |

### 5. Good / Base / Bad Cases

- Good: a previously authorized probe executes inside an admitted initiative Run using its captured MCP generation.
- Base: an unapproved background action refuses quietly.
- Bad: fabricate an operator connection, widen MCP policy for the feature, or replace old closures with a fresh catalog.

### 6. Tests Required

Cover exact/absent/once/session/revoked/wrong-Host/tool/revision/deny authority, immutable tool metadata, caller and
Run abort, real in-memory MCP/Host one-Effect attribution, preflight cancellation and post-dispatch unknown outcome.
Exercise both actual SDK invocation and InitiativeRuntime pre-Agent preparation; assertions on a mocked tool bag alone
do not establish production execution binding.

### 7. Wrong vs Correct

```ts
// Wrong: an unattended call loses Run identity when the interactive owner is absent.
routeCapability(deps, { ...request, runId: interactive?.runId });
// Correct: preserve the trusted execution binding supplied through captured tool options.
routeCapability(deps, { ...request, runId: request.runId ?? interactive?.runId });
```
