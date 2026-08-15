# Live Governance Migration Map

> Read-only reconnaissance captured on 2026-08-12 from worktree
> `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`,
> HEAD `9e632055`. No production file was changed and no test or build command
> was run for this research.

## 1. Executive conclusion

The current runtime still has three independent authority stores and two
independent prompting paths:

1. Rust loads a Node-local global level from `permission-level.json` once at
   process construction.
2. Rust remembers Shell decisions in `gate-decisions.json` and performs the
   final classify/project/prompt/remember/execute sequence locally.
3. Core remembers MCP-only decisions in `mcp-approvals.json` and prompts through
   the AI SDK `toolApproval` seam.

Shared `permission.*` leaf schemas exist, and the host-control envelope already
carries `policyGeneration` and `approvalGeneration`, but Core has no production
governance repository, evaluator, operator handlers, or Home client methods.
`routeCapability` dispatches directly into `CapabilityBroker`, the broker uses
default generation value `1` when callers do not supply revisions, and the Rust
`HostSession` validates Host/connection/catalog identity but not the policy
ceiling.

Slice 3 must therefore establish Core as the sole global policy authority and
project that ceiling into all capability adapters. Hosts may still classify
arguments, tighten locally, audit, and enforce the final OS action, but they
must never widen Core, persist a second global allow, or show another prompt.

The productization boundary is equally important: this migration must preserve
the standard MCP protocol and the installed `@ai-sdk/mcp` list/convert/call/
close path, and must preserve portable open-standard `SKILL.md` packages. A
canonical governance adapter is a Taki internal control seam around those
standards, not a replacement transport/package format and not a third permission
system.

## 2. Live authority map

| Plane | Current live source | Current behavior | Slice 3 disposition |
| --- | --- | --- | --- |
| Global level | `apps/desktop/src-tauri/src/node.rs::build_node` -> `gate/level.rs::load_level` | Reads `<nodeData>/permission-level.json` once; missing or corrupt state becomes `standard` | Move the durable global level and `policyGeneration` to Core. Retain a stricter legacy Node level only as a local compatibility floor. |
| Shell decisions | `gate/decisions.rs::DecisionStore` | Persists capability/class `always` or `never` in `<nodeData>/gate-decisions.json`; corrupt state becomes empty | In Slice 3, consume legacy `never` only as a deny floor. Do not let legacy `always` widen Core. Do not create another temporary decision store. |
| Shell evaluation and prompt | `gate.rs::Gate`, `ws_client.rs::authorize_and_run` | Rust classifies exec/shell-open, projects the Node-local level, consults local decisions, opens a local approver, remembers, then executes | Preserve classification, stricter local floors, final enforcement, and audit. Remove Host-owned global widening. Until Slice 4 supplies the one Core Approval lifecycle, a Host-side `ask` that cannot be satisfied safely must fail closed rather than open a second prompt. |
| MCP decisions | `packages/core/src/approval/decision-store.ts` | `mcp-approvals.json`, keyed by mutable `serverName + toolName`; corrupt state becomes empty | Treat old `never` as deny-only compatibility. Do not silently import old `always`; Slice 4 reconfirms/migrates durable allows into canonical Approval records. |
| MCP prompt | `approval/approval-gate.ts` | Only model-facing keys recognized by `McpManager.describe` are governed; built-ins and Skills return `not-applicable` | Replace MCP-specific selection with the common capability evaluator/Approval seam. The MCP adapter maps stable MCP identity to the canonical capability identity before evaluation. |
| Host dispatch | `capabilities/route-capability.ts`, `capability-broker.ts` | Explicit Host routing is generation safe, but no Core governance decision occurs before dispatch; policy/approval generations default to `1` | Require a real Core policy projection and real `policyGeneration` before dispatch. `approvalGeneration` remains Slice 4-owned. |
| Host validation | `apps/desktop/src-tauri/src/host_session.rs::accepts` | Validates `targetHostId`, `connectionGeneration`, and `catalogGeneration` only | Add the minimum policy-ceiling/revision validation needed for Slice 3. Exact challenge/resume authorization remains Slice 4. |
| Operator protocol | `packages/shared/src/permission-level-schema.ts` | Defines `permission.levelGet`, `levelSet`, `cellsGet`, and `cellSet`; no handlers are registered | Extend these leaf shapes into a versioned governance contract, add operator-only Core handlers, and make writes atomically increment `policyGeneration`. |
| Home | `apps/desktop/src/lib/ws-client-methods.ts`, `windows/home/pages/settings/settings-page.tsx` | No permission methods; Settings renders only the config knob list | Add the smallest policy card and advanced cell view to the existing Settings route. Keep state local and refetch per authenticated client generation. |

## 3. Existing Rust behavior to preserve

The useful enforcement semantics already live in `gate.rs::Gate` and
`gate/governance.rs::GovernanceRegistry`:

1. Disabled capability denies first.
2. A deny-by-default/local floor denies before any stored decision.
3. An unknown cell is a wiring error and fails closed.
4. The active level projects the registered cell to `auto | ask | deny`.
5. A stored `never` tightens an `auto` projection.
6. A stored `always` never lifts a projected `deny`.
7. Never-persist cells neither read nor write decision memory.
8. Exec retains its specialized classifier and command-bearing audit path.

The current registry has 17 projected cells and four floor rows:

- `shell-open`: three cells plus `shell-open:blocked`.
- `exec`: four cells plus `exec:blocked`.
- `fs-write`: four cells plus `fs-write:sensitive` and
  `fs-write:self-escalation`.
- fixed risk: `screenshot`, `screenshot-ambient`, `process-list`,
  `clipboard-read`, `clipboard-write`, and `foreground-window`.

This behavior should become shared descriptor data plus a Core evaluator, with
Rust consuming the applicable projection and composing stricter Host-local or
managed floors. It should not be reimplemented as adapter-specific switches.

## 4. Canonical, extension-neutral governance contract

### 4.1 Evaluator input

The evaluator should consume a generic request such as:

```ts
type GovernanceEvaluationInput = {
  capabilityId: string;
  cellKey: string;
  descriptorRevision: number;
  context: {
    hostId?: string;
    execution: "read" | "effect";
    background: boolean;
  };
};
```

The exact schema may differ, but the evaluator must not branch on `MCP`,
`Skill`, `Shell`, a provider name, or a model-facing tool key. It resolves only
canonical capability identity, registered cell/classification, policy state,
and stricter context.

### 4.2 Adapter responsibilities

| Adapter | Stable authority identity | Adapter-only work | What it must not do |
| --- | --- | --- | --- |
| Core built-in tool | Registered `capabilityId` | Validate input, derive any Core-owned class, call the common evaluator | Invent a separate built-in permission table or bypass policy because execution is Core-local |
| MCP tool | Stable `hostId + mcpServerId + raw toolName`, mapped to a canonical `capabilityId` | Preserve the MCP server's raw name and SDK execute closure; attach governance metadata outside the MCP protocol | Use `${sanitizedServer}_${toolName}` as a durable authority key, rewrite MCP transport, or trust annotations as grants |
| Shell/Node capability | Stable Host-qualified `capabilityId` plus Host-derived argument class | Derive exec/shell-open/local resource class, apply stricter local/managed floor, final enforcement, and audit | Widen Core, persist an independent global allow, or prompt locally |
| Skill procedure | Stable `skillId` for package/catalog ownership; actions resolve to their underlying capabilities | Load standard instructions/resources under confinement; optional metadata may narrow discovery/requested authority | Treat loading a Skill as permission, convert the package to a private format, or create Skill-specific action grants |

### 4.3 Standard MCP and AI SDK preservation

The existing path is already the correct standards seam:

- `mcp/mcp-connect.ts` is the sanctioned `@ai-sdk/mcp` import and constructs
  stdio or HTTP transports with `createMCPClient`.
- `McpManager.discover` uses `client.listTools()`, the shipped compatibility
  preparation, and `client.toolsFromDefinitions()`.
- The model-facing namespace changes only the ToolSet record key; execution
  remains bound to the raw MCP tool name inside the SDK closure.

Governance must wrap the tool closure before execution and carry a sidecar
mapping from the model key to stable identity. It must not introduce a
Taki-specific MCP dialect, replace `tools/list` or `tools/call`, rebuild
transport, or replace the existing schema-compatibility boundary.

### 4.4 Open `SKILL.md` preservation

The current Skill runtime scans `<dataDir>/skills/<name>/SKILL.md`, validates
standard metadata, renders a bounded list, and lazy-loads instructions through
`load_skill`. Slice 3 should govern instruction loading only if the canonical
registry assigns it an explicit confined descriptor; it does not grant the
actions described by the instructions.

`allowed-tools`-style metadata may narrow discovery or express requested tools,
but it is untrusted package content and cannot widen effective policy. Every
effect requested while following a Skill is evaluated as its underlying Core,
MCP, or Host capability.

## 5. Core persistence and mutation contract

The live migration registry currently ends at `013-config.ts`; recheck it
immediately before implementation rather than reserving `014` in prose.

The minimum Slice 3 durable state should be:

- one singleton global level row;
- one durable, positive `policyGeneration` in the same policy state;
- per-cell/per-level operator overrides keyed by canonical cell identity and
  descriptor revision;
- optionally, a one-time legacy migration/import marker.

The canonical descriptor registry should remain code/shared-schema data, not a
second mutable set of database descriptor rows. Every accepted operator
mutation must update the policy state and increment `policyGeneration` in one
SQLite transaction. Reads return the resulting generation so Home and dispatch
can prove what took effect.

Fail-closed requirements:

- missing required singleton state after migration is a boot/read error, not an
  implicit relaxed state;
- corrupt policy rows, invalid postures, unknown descriptor identities, or an
  override targeting an incompatible descriptor revision must not widen policy;
- registry collisions or duplicate canonical identities reject publication;
- mutation validation and revision increment must be atomic.

An optimistic-concurrency field is strongly recommended on `levelSet` and
`cellSet`, for example `expectedPolicyGeneration`. A stale form must receive a
structured conflict and refetch instead of overwriting a newer operator change.
The exact field name is still an engineering contract to freeze before coding.

## 6. Core ceiling and Host composition

The target calculation is stricter-wins composition:

```text
Core registry default
  + Core global level
  + Core operator cell override
  + durable deny-only compatibility input
  = Core ceiling at policyGeneration N

Core ceiling
  + Host managed floor
  + Host local availability/classification/floor
  = executable Host posture
```

No Host contribution may turn `deny` into `ask` or `auto`, or `ask` into
`auto`. Availability and catalog presence are routing facts, not permission.

`routeCapability` must evaluate the Core ceiling before dispatch and pass the
real `policyGeneration` into `CapabilityBroker`. `CapabilityBroker` must not
silently manufacture generation `1` for production dispatch after Slice 3.
Rust must reject stale or unsupported policy projection rather than treating a
positive integer as sufficient.

## 7. Host classification attestation gap

The largest unresolved Slice 3 engineering seam is argument classification.
Current `CapabilityRequest` carries sealed control plus raw input, while Rust
alone derives `ExecClass` and `ShellOpenClass`. Core therefore cannot compute a
class-specific ceiling before dispatch without either duplicating security
classification or receiving an attested Host result.

Recommended direction:

1. Do not duplicate the Rust exec parser/blocklist classifier in TypeScript.
2. Add a versioned Host-derived classification attestation bound to the exact
   `hostId`, connection/catalog/policy generation, `capabilityId`, input digest,
   classifier/descriptor revision, and derived `cellKey`.
3. Core validates the attestation against the canonical registry and computes
   the global ceiling for that exact cell.
4. Host revalidates the exact sealed tuple and its current stricter floor before
   final execution.

Whether Slice 3 introduces a limited classify/challenge frame or denies every
Host-classified `ask` until Slice 4 owns challenge/resume is not yet frozen.
The safe temporary rule is fail-closed: do not retain the current Shell prompt
as a second operator dialog.

## 8. Slice 3 / Slice 4 seam

### Slice 3 owns

- canonical governance registry/descriptors and revisions;
- Core global level/cell persistence and `policyGeneration`;
- extension-neutral effective-policy evaluator;
- operator-only `permission.*` methods;
- Core ceiling projection before Core, MCP, and Host execution;
- Host-local/managed stricter composition and final enforcement;
- deny-only legacy compatibility;
- minimal Home global-level and advanced-cell controls.

### Slice 4 owns

- canonical Approval records and `approvalGeneration`;
- one operator dialog and all pending state;
- challenge/resume and exact short-lived authorization;
- once/session/always ownership, timeout, disconnect, list, and revoke;
- background-use disclosure;
- legacy durable-allow reconfirmation;
- retirement of Shell-local prompting and durable decision writes.

Slice 3 must not create temporary durable Approval records or a third decision
database. It may keep legacy stores readable solely to apply stricter denials.

## 9. Legacy migration rules

### 9.1 Node permission levels

Multiple Nodes may carry different `permission-level.json` values. Do not pick
the loosest or silently treat `relaxed` as the new global policy.

Safe initial rule:

- initialize Core at `standard` when no already-authoritative Core policy
  exists;
- retain a stricter legacy Node level as a local compatibility floor;
- do not let a legacy `relaxed` value widen Core;
- surface disagreement for operator review rather than merging by accident.

### 9.2 Shell decisions

- Legacy `never` remains a deny-only floor scoped to its Node and known
  canonical capability/class mapping.
- Legacy `always` is not imported as authority and cannot widen Core.
- Unknown or ambiguous legacy keys deny or require repair; never guess a new
  identity from a display string.
- Slice 4 may reconfirm a legacy allow into a canonical Approval record.

### 9.3 MCP decisions

- `mcp-approvals.json` currently keys mutable server names and raw tool names.
- A legacy `never` may narrow the stable MCP capability after an unambiguous
  mapping.
- A legacy `always` must be ignored for automatic execution and offered for
  explicit reconfirmation in Slice 4.
- Changing an MCP command, URL, owning Host, stable server id, or tool identity
  must not inherit a name-only allow.

## 10. Minimal Home surface

Use the existing Settings route:

- a Permission Level card above the current config knob list;
- a collapsible advanced capability-cell table/view;
- loading, reconnecting, read error, validation error, saved, stale-write
  conflict, and second-confirm states;
- refetch whenever the authenticated Home `WsClient` generation changes;
- local hook/form/request state only.

Integration seams are `apps/desktop/src/lib/ws-client.ts`,
`ws-client-methods.ts`, and `windows/home/pages/settings/`. Policy data must not
be written to `localStorage` or added to the persisted SWR allow-list; Core is
the authority and a reconnect should re-read it.

The separate Hindsight worktree currently has uncommitted overlap in
`apps/desktop/src/lib/ws-client.ts`, `ws-client.test.ts`, and Cargo/other work.
Coordinate before editing those hotspots.

## 11. PRD and specification wording gaps

### Current Slice 3 PRD weaknesses

The Slice 3 PRD is directionally correct but underspecified in ways that could
weaken the product boundary:

- Acceptance criterion 24 says one change must affect `Core, MCP, and Shell
  adapters`, but omits the Skill adapter. It should say all canonical
  capability adapters, explicitly including Skill-mediated actions.
- It does not state that MCP remains standard MCP over the existing AI SDK
  integration, so an implementation could mistakenly invent a governance-aware
  private MCP protocol.
- It does not state that `SKILL.md` remains the portable package format and that
  Skill metadata grants no authority.
- `MCP/Skill lifecycle` is correctly out of scope, but this can be misread as
  making their governance adapters out of scope. The PRD should distinguish
  lifecycle CRUD from the common authority contract those later slices consume.
- It does not explicitly prohibit a third temporary decision store in Slice 3.
- It does not freeze the deny-only legacy compatibility rule or the fail-closed
  handling of `ask` before Slice 4.

### Existing spec drift

`CONTEXT.md` and `.trellis/spec/backend/permission-authorization.md` still
describe the Shell/Permission Gate as the sole/global authority and the level as
Node-file-owned. `tool-design.md` similarly says Rust is the sole enforcement.
Those statements accurately describe the current runtime but contradict the
frozen target where Core owns the global ceiling and Hosts perform stricter
final enforcement. They require an explicit superseding spec/ADR update; do not
silently reinterpret them in code.

The parent PRD and engineering contract already contain the stronger boundary:
one registry/effective-policy path for MCP, Core tools, Skills, and Shell/exec;
standard `SKILL.md`; no Taki-only replacement; and preservation of the installed
AI SDK MCP path. Slice 3 should copy those invariants into its own PRD/context so
implementation agents cannot miss them.

## 12. Likely implementation ownership

### Shared

- extend `permission-level-schema.ts` with policy generation/concurrency and
  effective descriptor shapes;
- add canonical governance descriptor/evaluation schemas;
- extend `host-control-schema.ts` only for frames the Host actually handles;
- update exports, `index.md`, protocol fixtures, and Rust golden fixtures.

### Core

- new `governance/` registry, repository, evaluator, adapter, and service files;
- next live SQLite migration and migration indexes;
- operator `permission.*` methods and one registration seam;
- `route-capability.ts` / `capability-broker.ts` real generation wiring;
- MCP and built-in adapters into the same evaluator;
- deny-only legacy readers, without a new durable decision store.

### Rust

- shared protocol mirror for the minimum projection/attestation fields;
- `host_session.rs` policy revision/projection validation;
- migrate `gate/governance.rs` data to the shared contract while preserving
  local floor/classification/audit behavior;
- stop local global widening and, by Slice 4 completion, local prompts/writes.

### Home

- typed permission methods in `ws-client-methods.ts` and `WsClient`;
- a local state hook plus Permission Level/advanced-cell components;
- Settings composition and focused tests;
- no policy cache persistence.

## 13. Recommended verification

Focused tests first:

```powershell
pnpm --filter @taki/shared test -- src/permission-level-schema.test.ts src/host-control-schema.test.ts src/protocol-fixtures.test.ts
pnpm --filter @taki/core test -- src/governance src/server/methods/permission-methods.test.ts src/capabilities
pnpm --filter @taki/desktop test -- src/windows/home/pages/settings src/lib/ws-client.test.ts
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml governance
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml golden_fixtures_parse_reject_and_round_trip
```

Then run the full gates appropriate to the implementation volume:

```powershell
pnpm -r typecheck
pnpm lint
pnpm -r test
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml --bin taki-node
pnpm --filter @taki/e2e test:e2e -- src/governance-authority.e2e.test.ts
```

Required test matrices include:

- shared/Core/Rust projection parity for every registered cell and level;
- unknown identity/cell/revision fail-closed behavior;
- Core deny and Host stricter floor composition;
- stale `policyGeneration` rejection and mutation conflict handling;
- atomic policy mutation plus restart persistence;
- no adapter-specific policy divergence across built-in, MCP, Shell, and
  Skill-mediated actions;
- MCP raw-name execution remains intact through `@ai-sdk/mcp`;
- Skill loading grants no underlying action;
- legacy level/decision present, missing, corrupt, ambiguous, deny, and allow
  cases;
- no double prompt and fail-closed pre-Slice-4 `ask` behavior;
- Home reconnect/refetch, validation, second-confirm, and no-localStorage
  regression.

## 14. Status accounting

### Completed findings

- Live Git/worktree/task state was rechecked.
- All three current authority stores and both prompt paths were located.
- Rust registry/evaluator order and current cell/floor inventory were verified.
- Core route/broker generation gaps and Host validation gap were verified.
- Shared-only `permission.*` state and missing Core/Home methods were verified.
- Standard MCP/AI SDK and open `SKILL.md` boundaries were verified from current
  code and parent contracts.
- The extension-neutral adapter model, persistence minimum, Slice 3/4 seam,
  deny-only legacy boundary, Home minimum, and test plan are documented.

### Incomplete implementation

- No Slice 3 production implementation exists yet.
- No Core governance migration/repository/evaluator/service exists.
- No operator `permission.*` handlers or Home permission UI exists.
- No real `policyGeneration` wiring or Host policy-ceiling validation exists.
- Host challenge/resume remains reserved schema, not a working lifecycle.

### Unverified items

- No test, build, lint, typecheck, clippy, runtime, or migration command was run
  during this research.
- No live MCP provider/server interoperability was exercised.
- No simultaneous two-Host runtime harness was exercised.
- The exact next migration number must be rechecked at implementation start.
- The exact canonical dynamic MCP capability-id syntax, classification
  attestation frame, and optimistic concurrency field remain to be frozen.

### Extra work identified

- Tighten the Slice 3 PRD with the standards/Skill/adapter/no-third-store
  invariants above.
- Curate `implement.jsonl` and `check.jsonl`; both still contain only the seed
  example and therefore Phase 1.3 is incomplete.
- Supersede drifted authority wording in `CONTEXT.md`,
  `permission-authorization.md`, `tool-design.md`, and related ADR text.
- Coordinate `ws-client.ts` and Cargo hotspots with the active Hindsight
  worktree before implementation.

### Residual risks

- A poorly designed classification seam can either duplicate Rust security
  logic in Core or authorize a wider cell than the Host actually classified.
- Defaulting policy generations to `1` can make stale control metadata appear
  valid unless removed from production dispatch.
- Name-derived MCP authority can leak durable grants across server edits or
  Host replacement.
- Treating Skill metadata or MCP annotations as authority creates an extension
  escalation path.
- Keeping the Shell prompt during transition creates two dialogs and two
  durable authorities; removing it without a fail-closed rule can create a
  silent bypass.
- Automatically merging legacy `relaxed` or `always` state can widen the new
  Core policy on first boot.
- Persisting policy snapshots in Home/localStorage creates a second stale
  authority surface.
