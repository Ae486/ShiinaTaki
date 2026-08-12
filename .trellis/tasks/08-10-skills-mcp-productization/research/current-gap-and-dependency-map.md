# Research: Current Skills/MCP Gap and Dependency Map

- Query: What has actually shipped for Skills, MCP, approval, and permission governance; what end-to-end productization contracts are still missing across Core, shared protocol, Desktop/Home, and Rust; and in what dependency order should implementation children land?
- Scope: mixed (live repository and installed dependency evidence, plus previously captured standards research)
- Date: 2026-08-10

## Current owner amendment (2026-08-10)

This delta audit originally treated the Core/VPS process as the fixed owner of MCP and credential state. The later 4A
decision changes the target locality without changing the authority model:

- Core is the global policy, durable Approval, and host-catalog authority.
- The actual MCP client, Skill package, Workspace, OS capability, and encrypted credential catalog belong to the
  authenticated Execution Host that performs the operation. Core/VPS and a Desktop/phone Node can each be that host.
- A Run records one `primaryHostId`; secondary-host tools and cross-host transfers require explicit host-qualified
  operations. No path or display name may imply a host, and no disconnected host may be silently substituted.
- Every Run receives a Core-generated host-context prompt block. Imported Skill/MCP text and tool results remain
  untrusted data and cannot mutate policy, host selection, approval scope, or transfer rules.

Any remaining Core-local wording in this document describes the pre-4A baseline or an implementation gap that must be
re-evaluated against the amendment before child-task contracts are frozen.

## Findings

### 1. Audit baseline and delta

This is a delta audit, not a replacement for the earlier research banks. The following sources were reused first and
then checked against current production code:

- `.trellis/tasks/archive/2026-07/07-10-mcp-and-skills/` establishes the original M2 loader/client, approval, and test
  contracts.
- `.trellis/tasks/archive/2026-08/08-03-settings-panel/research/rs-mcp-and-llm-config.md` records the 2026-08-04
  product-surface gaps.
- `.trellis/tasks/archive/2026-08/08-07-mcp-tool-schema-compatibility/` records the definition-stage compatibility
  change that subsequently shipped.
- `.trellis/workspace/pleia/t4-second-grill-prep.md:350-474` is the binding 2026-08-10 owner ruling for Skills,
  common governance, Approval, and unattended authority. Its sequencing ruling is at `:670-685`.
- The target remains planning-only (`.trellis/tasks/08-10-skills-mcp-productization/task.json:2-20`). Its context files
  are still seed-only (`implement.jsonl:1`, `check.jsonl:1`).

Important delta from the 2026-08-04 audit: MCP schema compatibility is no longer a gap. Current discovery is
`listTools()` -> `prepareMcpToolDefinitions()` -> `toolsFromDefinitions()` and skips unsafe definitions individually
(`packages/core/src/mcp/mcp-manager.ts:70-87`). The implementation has a durable contract in
`.trellis/spec/backend/mcp-tool-schema-compatibility.md:1-142` and focused tests in
`packages/core/src/mcp/mcp-schema-compat.test.ts:26-397`.

The following 2026-08-04 gaps remain true in current code: boot-only Skills discovery, boot-only MCP connection,
file-edited MCP configuration, no MCP/Skills operator protocol, no Desktop Approval route, and split Core/Rust
authorization. Exact evidence appears below.

### 2. Exact shipped capability inventory

#### 2.1 Skills

| Shipped capability | Current evidence | Exact boundary |
| --- | --- | --- |
| Read-only boot discovery | `packages/core/src/main.ts:161-169`; `packages/core/src/skills/skill-scanner.ts:27-36` | Scans only `<dataDir>/skills/<directory>/SKILL.md` once at Core boot. |
| Minimum package validation | `packages/core/src/skills/skill-scanner.ts:39-55`; `packages/core/src/memory/frontmatter.ts:14-35` | Requires matching kebab-case `name` and non-empty single-line `description`; flat scalar frontmatter only. Invalid folders are collected instead of crashing boot. |
| Separate operator state file | `packages/core/src/skills/skills-state.ts:11-36,39-69` | `skills-state.json` stores only `disabled: string[]`, atomically. Discovered Skills default enabled; malformed state warns and re-enables all because this legacy file is explicitly not auth state. |
| Progressive disclosure levels 1-2 | `packages/core/src/skills/skills-loader.ts:23-44`; `packages/core/src/skills/load-skill-tool.ts:10-18`; `packages/core/src/main.ts:298-304` | Enabled name/description metadata enters instructions; `load_skill(name)` reads only the Markdown body on demand and returns closed local errors. |
| Immediate effect of programmatic enable/disable | `skills-state.ts:24-36`; `skills-loader.ts:29-40` | If some trusted caller had the state object, toggles would affect later list/load calls without reboot. No production operator caller exists. |

Not shipped: package import/copy, inspection, provenance, trust, quarantine/scanning, content hash, removal, update,
rollback, source adapters, file watching/reconciliation, external-directory precedence, or on-demand access to
`references/`, `templates/`, `scripts/`, and `assets`. The entire production module is the four files listed in
`packages/core/src/skills/index.md:1-5`; searches within that module found no implementation of those contracts.
`SkillsLoader` also captures a fixed `Map` at construction (`skills-loader.ts:25-27`), so newly installed or removed
packages cannot enter the running catalog today.

Supporting files have no accidental fallback path: the generic `read_file`/`write_file` tools are confined to
`<dataDir>/workspace` (`packages/core/src/main.ts:240-242`), while current Skills live under `<dataDir>/skills`
(`main.ts:161-168`). Productization must define a confined, authorized resource contract and reconcile this runtime
location with `docs/PRODUCT.md:43`'s `workspace/skills` wording; it must not loosen Workspace confinement. Also note that
`scanSkills()` catches a missing root but rethrows other root-directory IO failures (`skill-scanner.ts:58-65`), so the
module header's broad “never throws” wording is not a complete runtime guarantee.

`allowed-tools` is parseable as a hyphenated frontmatter key (`frontmatter.ts:14`) but is neither interpreted nor
enforced: the scanner extracts only `name` and `description` (`skill-scanner.ts:46-55`). This is currently harmless and
must remain non-authoritative: the owner ruling makes Skill metadata at most a recommendation or narrowing ceiling,
never a permission grant (`t4-second-grill-prep.md:419-424`).

#### 2.2 MCP

| Shipped capability | Current evidence | Exact boundary |
| --- | --- | --- |
| Operator-file configuration | `packages/core/src/mcp/mcp-config.ts:12-35,46-70`; `packages/core/src/main.ts:171-177` | Reads a record of stdio `{command,args?,env?,cwd?}` or HTTP `{url,headers?}` from `<dataDir>/mcp-servers.json`; missing/malformed means zero servers. There is no `enabled`, secret reference, timeout, display metadata, or writer. |
| Real stdio and Streamable HTTP clients | `packages/core/src/mcp/mcp-connect.ts:19-31` | Uses the installed `@ai-sdk/mcp`; stdio spawn remains inside the SDK, and HTTP uses `{type:"http"}`. |
| Server failure isolation | `packages/core/src/mcp/mcp-manager.ts:36-56,70-88` | Connect/discovery runs with `Promise.allSettled`; a failed server is warned/skipped and its post-connect client is closed. Other servers remain live. |
| Per-tool schema isolation | `mcp-manager.ts:77-84`; `packages/core/src/mcp/mcp-schema-compat.ts:8-45,92-144` | Known safe optional-nullable forms are narrowed; unsafe recognized forms skip one tool with stable code/path rather than dropping the whole server. |
| Model-facing namespacing and raw execution identity | `mcp-manager.ts:99-108` | Model key is `${sanitizedServer}_${rawToolName}`; approval retains `{serverName,toolName}` and SDK execution keeps the raw name. MCP-to-MCP collisions are warned, last wins. |
| Structured call failures | `mcp-manager.ts:111-135` | A thrown MCP call becomes `{ok:false,code,message}`; `isError:true` SDK results remain normal results. |
| Clean shutdown | `mcp-manager.ts:58-67`; `packages/core/src/main.ts:381-386` | All retained clients close on Core shutdown; close is idempotent. |

The active runtime is still one immutable boot generation. `McpManager` exposes only `tools()`, `describe()`, and
`close()` (`mcp-manager.ts:18-25`); it retains no public per-server state, test/reconnect operation, config mutation, or
reload. The merged `ToolSet` is cached (`:40-60`) and copied once into the chat agent's `extraTools` during Core
composition (`packages/core/src/main.ts:265-293`). `ChatAgent` later spreads that same object per attempt
(`packages/core/src/agents/chat-agent.ts:165-182`). Replacing only `McpManager` would therefore not update future
turns.

Current config still embeds stdio `env` and HTTP `headers` as plaintext strings (`mcp-config.ts:12-24`). This directly
misses ADR 0006's credential-manager target (`docs/adr/0006-mcp-processes-vs-no-os-invariant.md:3-7`). The one shipped
OS credential seam is Rust-side `SecretStore`/Windows Credential Manager and is currently used for node identity/token
(`apps/desktop/src-tauri/src/secrets.rs:10-59`; `apps/desktop/src-tauri/src/node.rs:72-78,120-128`), not Core MCP.

#### 2.3 Approval and governance

| Shipped capability | Current evidence | Exact boundary |
| --- | --- | --- |
| MCP-only Core approval | `packages/core/src/approval/approval-gate.ts:23-57` | Only tool keys described by MCP are governed. Every Core, memory, Skill, Workspace, time, and avatar tool returns `not-applicable`. |
| Fail-closed ask correlation | `packages/core/src/approval/approval-broker.ts:25-36,42-87` | `approval.request` notification + `approval.respond` request, 60 s timeout deny, pending asks denied on connection close. Logs contain identity, not input. |
| Current decision memory | `packages/core/src/approval/decision-store.ts:12-52,55-91` | Key is only `[serverName,toolName]`; once is not stored, session is a Core-lifetime map, always/never persists to `mcp-approvals.json`. There is no list, revoke, decision version, server/config fingerprint, initiator, or background-consent marker. |
| CLI approval UI | `apps/cli/src/chat-client.ts:101-114`; `apps/cli/src/approval-prompt.ts:13-26` | CLI can answer once/session/always/deny/never. Its `always` legend does not disclose future background runs. |
| Rust Shell gate | `apps/desktop/src-tauri/src/gate.rs:99-129,162-190`; `gate/governance.rs:30-156` | Registry-driven strict/standard/relaxed projection, per-class persistence, stricter-wins, and floors exist for Shell capabilities. |
| Rust local persistence | `apps/desktop/src-tauri/src/node.rs:72-82`; `gate/level.rs:10-28`; `gate/decisions.rs:37-74` | Level is read once from `permission-level.json`; Shell grants live in `gate-decisions.json`; exec policy is another node-local file. |
| Shared permission shapes | `packages/shared/src/permission-level-schema.ts:11-62`; Rust mirror at `apps/desktop/src-tauri/src/protocol.rs:251-299` | Method names and payload schemas exist for level/cells, including `secondConfirm`, but they are types only. |

The common governance target has not shipped. Current Core tool assembly explicitly mixes ungated Core tools, Rust-gated
capabilities, and MCP-only approvals (`packages/core/src/main.ts:284-310`). Rust owns 17 projected cells plus four
floors, but its factory is Rust-only (`gate/governance.rs:41-126`). Shared `PermissionCellKey` is open and does not own
the registry data (`permission-level-schema.ts:27-44`).

The old planned `permission.*` surface is also not implemented: current Core method registration includes
`approval.respond`, capability response, config, memory, media, character, and perception methods but no permission,
MCP, or Skills handlers (`packages/core/src/main.ts:326-359`). Rust's WS loop handles only
`capability.request` -> `capability.respond` (`apps/desktop/src-tauri/src/ws_client.rs:137-165`). Comments naming
`permission.levelSet`/`cellsGet` in Rust are future-contract comments, not handlers
(`gate/level.rs:10-12`; `gate/governance.rs:151-156`).

The 2026-08-10 owner ruling supersedes the old authority placement: Core must become the global Permission Level,
common policy, and durable Approval authority; a Node may only tighten and enforce its own local/managed floors
(`t4-second-grill-prep.md:426-451`). Current `CONTEXT.md:107-120` and
`.trellis/spec/backend/permission-authorization.md:43-100` still describe the Shell gate/node files as the global
authority. This is documentation/spec drift to resolve before implementation, not permission to build a third system.

#### 2.4 Desktop/Home and shared protocol

Home currently has only chat, settings, operations, perception, and costume pages
(`apps/desktop/src/windows/home/pages.ts:28-34`). Its `WsClient` exposes chat/timeline/media/character/config/memory/
perception requests (`apps/desktop/src/lib/ws-client.ts:58-110`); request methods end at the same set
(`ws-client-methods.ts:74-120`). Inbound routes handle chat, avatar, timeline, and config notifications only
(`ws-client-routes.ts:76-121`). A source search found no Desktop references to `APPROVAL_METHODS`, `approval.request`,
MCP methods, Skills methods, or permission methods, and no corresponding Desktop tests.

Shared has schemas for current Approval and the unimplemented permission methods
(`packages/shared/src/index.md:14-15`) but no MCP lifecycle, Skill lifecycle, capability catalog/discovery, approval
list/revoke, trust/provenance, reload generation, or public diagnostic schemas. Any implementation must start in
`@taki/shared`; local UI/Core payload types would violate `.trellis/spec/frontend/type-safety.md:1-8` and the backend
pre-development contract (`.trellis/spec/backend/index.md:5-13`).

### 3. Missing end-to-end productization contracts by layer

| Layer | Required missing contracts | Dependency notes |
| --- | --- | --- |
| Shared | Canonical capability descriptor/catalog; policy/effective-decision shapes; versioned Approval record and list/revoke schemas; MCP list/add/edit/remove/enable/test/reconnect/status/tool-diagnostic schemas; Skill list/import/inspect/enable/remove/reconcile/trust/quarantine/resource schemas; additive notifications for state/catalog/generation changes. | Define identities and versioning before persistence/UI. Do not merely add handlers behind the old permission skeleton. |
| Core | One canonical registry/effective-policy evaluator for MCP, effectful Core tools, and the Core ceiling on Shell actions; durable global level/cell/decision authority; operator-only methods; catalog filtering/progressive discovery; MCP config writer + status model + reload generations + secret resolver; Skill staging/validation/trust/reconcile lifecycle; decision migration/revocation; sanitized diagnostics and audit. | Core is the single global authority, but domain validation and the Node's final local floor remain separate. |
| Desktop/Home | One Approval dialog fed by shared schemas; pending/timeout/disconnect states; durable decision list/revoke; one small global level control plus advanced cells; MCP and Skills lifecycle pages with loading/empty/validation/partial-failure/reconnecting/success states; secret write-only fields; no secret/approval-input caching. | Add routes and methods to the existing per-window `WsClient`; Home is disposable and never state of record (`.trellis/spec/frontend/state-management.md:5-25`). |
| Rust/Node | Stop treating `permission-level.json` and `gate-decisions.json` as independent global authority; consume/project the Core ceiling; keep local capability availability, argument classification, local/managed floors, final OS enforcement, and audit; add the minimum Core<->Node protocol needed to avoid double authorization; migrate or retain old data only in a stricter-safe way. | The current `CapabilityRequest` carries only `{requestId,capability,input}` (`packages/shared/src/capability-schema.ts:8-21`), so the policy-version/authorization choreography must be designed explicitly. |

Two boundary rules are critical:

1. **One policy model does not mean one physical gate.** Core can govern Core/MCP/global ceilings while Rust remains
   the last trusted OS boundary. They must share identity, posture, scope, precedence, decision version, and audit
   semantics; Node can tighten but never widen.
2. **A Skill is not an enforcement unit.** Import/install/remove and any tool or script it requests are governed
   actions, but loading instructions does not grant authority. Trust/quarantine is package-supply-chain state, separate
   from the action permission decision.

### 4. Dependency graph and proposed vertical child-task order

```text
[D0 credential + authority decisions]
              |
              v
[D1 shared catalog / Core policy authority / Node ceiling projection]
              |
              v
[D2 versioned Approval + Home dialog + revoke + legacy reconfirmation]
          /                               \
         v                                 v
[D3 secure MCP lifecycle]          [D4 standard Skill lifecycle]
         \                                 /
          v                               v
       [D5 unified discovery + Home convergence + integration check]
```

Proposed children, in implementation order:

1. **Authority and credential design gate (planning child, no production code):** resolve where secrets live for local
   Windows and VPS/Ubuntu Core; how an operator client writes without receiving values back; how Core and Nodes share
   policy without double prompts; canonical capability identity; legacy decision semantics. This closes the target
   PRD's explicit open questions before schemas are frozen (`prd.md`, “Open Questions”).
2. **Common governance/catalog vertical:** shared schemas -> Core registry/effective evaluator/persistence -> Core
   operator methods -> Rust Core-ceiling projection and local-floor enforcement -> a minimal Home global/advanced
   read/write surface. Include migration compatibility, role checks, and cross-language mirror tests. This is the
   prerequisite for every later action and discovery filter.
3. **Approval vertical:** generalize the MCP-shaped ask into the common capability identity; version durable records;
   bind session decisions to the approving operator connection; ship Desktop dialog, timeout/disconnect behavior,
   list/revoke, background-disclosure copy, and legacy reconfirmation. This must precede claiming MCP is usable from
   Home.
4. **Secure MCP lifecycle vertical:** shared protocol + Core config/status writer + credential references +
   add/edit/remove/enable/test/reconnect + generation leases/draining + Home MCP surface. Preserve the existing SDK
   transport, schema preparation, namespacing/raw-name closure, per-tool failure isolation, and execute wrapper.
5. **Standard Skill package lifecycle vertical:** shared protocol + staged safe import + inspection/provenance/hash/
   trust/quarantine + enable/remove/reconcile + atomic catalog replacement + standard support-resource access through
   already-authorized capabilities + Home Skills surface. Preserve `SKILL.md`; do not convert to a private format.
6. **Converged discovery/integration child:** bounded catalog/search/describe/call behavior when tool schemas become
   large, cross-surface collision rejection, Core/Home/Node convergence, reconnect/restart/upgrade migrations, full
   relevant gates, and operator manual acceptance. This child proves the earlier verticals compose; it does not absorb
   feature work that belongs in them.

Technical parallelism is possible after child 2: the Skill package work does not depend on MCP transport work, but both
depend on the same capability identity/policy catalog. Keep one integration child after both.

### 5. Migration, protocol, secret, reload, and Approval risks

#### 5.1 Authority and persistence migration

- The latest Core DB migration is 013 (`packages/core/src/db/migrations/index.md:2-15`); Skills, MCP config, Core MCP
  approvals, Shell level, and Shell decisions are all JSON files today. Choosing DB versus versioned Core files is an
  implementation decision, but there must be one authoritative writer and an explicit rollback/export path.
- Legacy stores are split across machines and roots: Core has `mcp-servers.json`, `skills-state.json`, and
  `mcp-approvals.json`; each Node has `permission-level.json` and `gate-decisions.json`
  (`packages/core/src/main.ts:163-184`; `apps/desktop/src-tauri/src/node.rs:31-35,72-82`). A VPS Core cannot discover a
  desktop Node's files by local migration. Migration requires an authenticated protocol or explicit operator import.
- Preserve stricter state safely: legacy `never`/floors may remain denials; legacy `always` must be marked
  reconfirmation-required because it predates disclosure that future background runs are included
  (`t4-second-grill-prep.md:453-459`). Do not silently relabel it as background-capable.
- Current MCP decisions key only on names (`decision-store.ts:55-57`). Editing a server command/URL and reusing the key
  can inherit an unrelated durable grant. A productized identity must define when server/tool/config/trust changes
  invalidate or reconfirm decisions.
- Do not promote legacy `skills-state.json` fail-open behavior into trust state. A malformed disabled-list may safely
  re-enable under the old non-auth contract (`skills-state.ts:39-60`); a malformed trust/quarantine record must keep an
  imported package inactive and observable.
- Resolve the package-root discrepancy explicitly: live code uses `<dataDir>/skills`, while the product table says
  `workspace/skills`. Moving content changes both import migration and which confined capabilities can see support
  files; silently scanning both roots would create precedence and duplicate-identity ambiguity.

#### 5.2 Protocol and compatibility

- Shared schemas must be additive and clients must parse every inbound frame at the boundary. Unknown older clients
  currently have no Approval route and will ignore the notification; Core must continue to fail closed rather than
  infer consent.
- The existing `ApprovalRequest` is MCP-specific (`serverName`, `toolName`, raw `input`) and has no initiator,
  capability cell/risk class, policy generation, persistence eligibility, or background-disclosure version
  (`packages/shared/src/approval-schema.ts:15-36`). Generalization needs an explicit compatibility plan, not local
  optional fields invented separately by CLI and Home.
- The current node capability channel has no Core authorization context (`capability-schema.ts:17-21`). If Core and
  Rust both run full independent ask/store flows, operators can see duplicate prompts and the two stores can diverge.
  If Rust trusts a bare Core request, local floors can be bypassed. The child-1 protocol must prove both “Core ceiling”
  and “Node may tighten” at the public boundary.
- Catalog changes need ordered version/generation identifiers. Home, Agent discovery, Approval identity, and execution
  must agree which generation they refer to; an unversioned “changed” push can race a list refresh.

#### 5.3 Secrets

- `mcp-servers.json` presently contains raw env/header values. A safe migration cannot rewrite the file until the
  credential write has succeeded and been read back by the runtime; partial failure must leave a disabled/error state,
  not lose the only credential or keep two silent authorities.
- The old shape does not identify which env/header values are secret. The new schema needs public values separated
  from secret references; migration policy for ambiguous legacy values must be conservative and owner-visible.
- Rust's current keyring seam is local to a Node and documented as Windows Credential Manager
  (`apps/desktop/src-tauri/src/secrets.rs:1-31`). Core is TypeScript and must also support Ubuntu/VPS. Routing all secrets
  through the desktop Node makes a headless Core unable to reconnect; adding a Core credential backend introduces a new
  dependency and deployment contract. This is the unresolved D0 choice, not an implementation detail.
- Secret methods must be write-only/clear/presence-only. Never return values in config/status/errors, logs, ordinary
  WS payloads, or UI caches. Existing Home cache persistence has a closed allow-list and strips secret config rows
  (`apps/desktop/src/lib/cache-persist.ts:16-60`); any new MCP/Skill cache key requires a privacy review and tests.

#### 5.4 Reload and execution ownership

- Closing the current SDK client aborts in-flight work; the archived installed-package probe records this in
  `07-10-mcp-and-skills/research/ai-sdk-mcp-client.md` under “Lifecycle + error surfaces.” Therefore reconnect cannot
  close generation N immediately after publishing N+1.
- Required contract: a call acquires the client/tool generation selected before execution; future turns discover the
  new generation; generation N drains existing leases and closes after settle or a named forced-drain deadline. A
  failed candidate generation leaves the last-good active generation untouched and reports the candidate error.
- Current `extraTools` is a boot snapshot (`main.ts:265-293`), so reload requires a per-turn registry snapshot or stable
  dispatch indirection, not only a mutable manager. Approval lookup must use the same captured generation as execute.
- `test connection` must use an ephemeral candidate client, a deadline, and guaranteed close. It must not replace the
  active generation or make unapproved tools available.
- Skill install/update requires the analogous atomic catalog rule: stage -> validate/scan/hash -> publish one new
  catalog generation. Do not mutate an active package directory in place while `load_skill` or an authorized resource
  operation is reading it.

#### 5.5 Approval and authorization

- Current Core `session` means Core-process lifetime, not approving operator-connection lifetime
  (`decision-store.ts:31-50`). The owner ruling requires session validity only while that approving operator session is
  live. Key decisions by authenticated connection/session and clear them on disconnect.
- Current CLI `always` copy is only `[a]lways` (`apps/cli/src/approval-prompt.ts:13-26`). Both CLI and Home must disclose
  future background use before emitting a durable allow, and durable records need a disclosure/version field.
- Pending Approval input is intentionally operator-visible but may contain secrets. It must live in memory only, never
  logs, SWR/localStorage, crash reports, or durable run history. Clear it on settle, timeout, route replacement, and
  disconnect.
- MCP server configuration is an operator-triggered code-execution surface for stdio. Agent tools must have no route to
  CRUD, credentials, trust, policy, or durable decisions; every method is operator-role and source-swept.
- Registry collision behavior must become fail-closed/reject-at-registration. Current MCP-to-MCP collisions are
  last-wins with a warning (`mcp-manager.ts:101-108`), and MCP tools are spread after built-ins (`main.ts:284-293`), so
  a cross-source key collision is not governed by one registry today.

### 6. Existing tests and highest-value missing tests

#### Existing focused coverage

- Skills: missing root, valid/invalid metadata, block-scalar rejection, mixed scan; enable/disable persistence; enabled
  list/body load and closed errors; `load_skill` delegation (`packages/core/src/skills/skill-scanner.test.ts:26-64`,
  `skills-state.test.ts:23-48`, `skills-loader.test.ts:34-63`, `load-skill-tool.test.ts:10-23`).
- MCP: config parsing/failure; stdio and HTTP real transport fixtures; namespacing/raw mapping; call error wrapping;
  server isolation; idempotent close; same-server bad-tool isolation; provider request-body/schema assertions; pure
  compatibility matrix (`packages/core/src/mcp/mcp-config.test.ts:21-50`, `mcp-http.test.ts:75-92`,
  `mcp-manager.test.ts:127-290`, `mcp-schema-compat.test.ts:26-397`).
- Core Approval: schemas, broker timeout/disconnect, decision scopes/persistence/key separation, MCP-only gate,
  operator-only respond, and ToolLoopAgent approve/deny/no-context behavior
  (`packages/shared/src/approval-schema.test.ts:9-48`; `packages/core/src/approval/*.test.ts`;
  `packages/core/src/agents/chat-agent-approval.test.ts:38-105`).
- Rust governance: level fail-safe, registry projection/floors, risk-class persistence, conversational-grant inertia,
  and single decision writer (`apps/desktop/src-tauri/src/gate/level.rs:31-65`,
  `gate/governance.rs:174-343`, `gate.rs:375-852`, `gate/decisions.rs:122-173`).
- Shared permission payload shapes and `secondConfirm` are covered, but only as schemas
  (`packages/shared/src/permission-level-schema.test.ts:11-60`).

#### Highest-value missing tests

1. Cross-language end-to-end policy matrix: same identity/posture/scope/floor in shared, Core, and Rust; Core ceiling
   plus stricter Node floor; no double prompt; unknown cell fails closed.
2. Legacy migration matrix: Core/Shell files present/missing/corrupt/partial; denials preserved; old allows marked ask/
   reconfirm; rollback/export; multi-node conflict handled without choosing the looser value.
3. Operator-role security sweeps: no Agent tool reaches MCP/Skill CRUD, credentials, trust, policy, decision grant, or
   revoke; only the human Approval arm creates an allow.
4. Session ownership: one operator's session allow is not visible to another, disappears on disconnect, and never
   authorizes unattended work.
5. Background disclosure: old durable records and old clients cannot create background-capable allows; explicit new
   copy/version can; revoke applies immediately to future work.
6. MCP generation races: long call on N + successful reload to N+1; failed candidate keeps N; remove/disable drains N;
   cancellation/forced deadline closes exactly once; Approval/execute use the same generation.
7. Secret lifecycle: legacy plaintext migration, write/read/use/clear, restart, backend unavailable, no value in JSON,
   logs, errors, WS list/status, DOM snapshots, localStorage, or diagnostic payloads.
8. MCP lifecycle failure matrix: invalid config, spawn failure, HTTP auth failure, discovery partial failure, schema
   skipped tools, test timeout, reconnect loop, remove while disconnected, and unrelated servers/tools stay usable.
9. Skill supply-chain matrix: archive traversal, absolute paths, symlinks/hardlinks, duplicate names, case collisions,
   oversized/decompression limits, malformed standard metadata, support-file confinement, quarantine on trust-store
   failure, atomic update/rollback, and last-good catalog retention.
10. Home flows: loading, empty, validation, partial failure, reconnecting, stale-status labeling, Approval timeout/
    disconnect, durable revoke, secret write-only controls, and zero persistence of pending input/secrets.
11. Catalog scale/collision: bounded progressive discovery, disabled/untrusted/unavailable tools absent, built-in/MCP
    duplicate rejected, and catalog/policy/execution generation convergence.
12. A final stack smoke: Desktop Home -> Core -> MCP and Desktop Home -> Core -> Node capability, including one real
    stdio fixture, one HTTP fixture, one disconnect/reconnect, and explicit shutdown leak checks. Use the existing E2E
    harness rules in `.trellis/spec/backend/e2e-harness.md:1-20` where applicable.

No tests were executed for this research-only audit; the inventory above is source inspection, not a fresh green run.

### 7. Explicit non-goals and duplicate-work warnings

Non-goals for this initiative:

- Heartbeat, Scheduled Task execution, Autonomous Run History, Run Receipts, Experience Review, or automatic Learning
  Proposal application.
- A private Taki Skill format, Task Archetype, marketplace protocol, automatic updates, or universal support for every
  optional metadata extension.
- A QQ/provider-specific MCP server, native web search/D60, provider routing, or a replacement search engine.
- Replacing the installed AI SDK MCP transport/execution path or the shipped schema-compatibility layer.
- Removing Node-local final enforcement/audit or allowing a Node to widen Core authority.

Duplicate-work warnings:

- Do not implement MCP, Core-tool, and Shell permission pages/stores independently. The whole task exists to converge
  them on one vocabulary and effective-policy calculation.
- Do not mistake `PERMISSION_METHODS` schemas for an implemented backend, and do not implement the old “Desktop file is
  global authority” plan without reconciling the later Core-authority ruling.
- Do not create local Desktop protocol types; extend `@taki/shared` and its Rust mirror where the Node participates.
- Do not rebuild MCP transport, raw-name execution, schema preparation, error wrapping, or failure isolation. Extend
  `McpManager` around those verified seams.
- Do not treat `allowed-tools`, MCP annotations, Skill trust, or provider metadata as authority. They are untrusted hints
  or supply-chain state and can only narrow/request, never grant.
- Do not store secrets in Core config, MCP public config, SQLite config rows, logs, UI cache, or ordinary status payloads.
- Do not add a second Home/settings window or extend legacy `main`; Home's page registry is the one settings-family
  surface (`.trellis/spec/frontend/home-window.md:1-33`).

## Files Found

- `packages/core/src/skills/{skill-scanner,skills-state,skills-loader,load-skill-tool}.ts` - complete current Skills
  runtime: boot scan, disabled sidecar, metadata/body disclosure, and meta-tool.
- `packages/core/src/mcp/{mcp-config,mcp-connect,mcp-schema-compat,mcp-manager}.ts` - complete current MCP runtime:
  file config, transports, schema preparation, cached tools, and shutdown.
- `packages/core/src/approval/{approval-broker,approval-gate,decision-store}.ts` - current MCP-only approval path.
- `packages/core/src/main.ts` and `packages/core/src/agents/chat-agent.ts` - boot composition and static ToolSet capture.
- `packages/shared/src/{approval-schema,permission-level-schema,capability-schema}.ts` - existing protocol and missing
  unification boundary.
- `apps/desktop/src/lib/{ws-client,ws-client-methods,ws-client-routes}.ts` and
  `apps/desktop/src/windows/home/pages.ts` - current Home transport/page surface; no extension/Approval routes.
- `apps/desktop/src-tauri/src/{gate.rs,node.rs,protocol.rs,secrets.rs,ws_client.rs}` and `gate/*.rs` - current Rust
  policy, local stores, keyring, protocol mirrors, and final enforcement.
- `.trellis/spec/backend/{config-store,permission-authorization,mcp-tool-schema-compatibility,tool-design,e2e-harness}.md`
  and `.trellis/spec/frontend/{home-window,state-management,type-safety}.md` - relevant executable contracts.

## Code Patterns

- Shared-first protocol with zod at client boundaries: `packages/shared/src/approval-schema.ts:8-36` -> Core method ->
  `apps/desktop/src/lib/ws-client-*.ts`; use the same pattern for every new surface.
- Core operator methods are role-declared method definitions registered once in `main.ts`, as shown by
  `packages/core/src/server/methods/approval-respond.ts:10-17` and config registration at `main.ts:356-359`.
- Failure isolation uses candidate construction plus last-good retention; current MCP uses per-server
  `Promise.allSettled` (`mcp-manager.ts:44-55`) and schema compatibility uses per-definition results
  (`mcp-schema-compat.ts:32-45`). Reload should preserve this granularity.
- Durable small-file writes currently use temp + rename (`skills-state.ts:65-69`,
  `approval/decision-store.ts:86-91`, `apps/desktop/src-tauri/src/gate/decisions.rs:113-119`). New multi-record
  authority still needs migration/version/transaction semantics; copying this pattern alone is insufficient.
- Home keeps authority in Core and only caches reviewed read payloads (`.trellis/spec/frontend/state-management.md:5-25,
  28-108`).

## External References

- Agent Skills open specification: `https://agentskills.io/specification` (required package shape/progressive
  disclosure; captured in archived `07-10.../research/skills-loader.md:8-35`).
- Claude Code Skills and Agent SDK Skills: `https://code.claude.com/docs/en/skills` and
  `https://code.claude.com/docs/en/agent-sdk/skills` (captured in the same archived research).
- MCP server tools specification, version 2025-11-25: `https://modelcontextprotocol.io/specification/2025-11-25/server/tools`
  (also cited by `.trellis/spec/backend/tool-design.md`).
- Installed dependency evidence, not memory: `packages/core/package.json:13-23` declares `@ai-sdk/mcp ^2.0.10`,
  `ai ^7.0.17`, and `zod ^4.4.0`; the archived SDK probe records stdio/HTTP lifecycle behavior.

These external pages were not refreshed live during this delta audit; standards facts were reused from the archived
research and checked against the current local implementation where applicable.

## Related Specs

- `.trellis/spec/backend/config-store.md` - Core-owned sparse settings authority and secret exclusion.
- `.trellis/spec/backend/permission-authorization.md` - current Rust authorization behavior; authority placement now
  needs reconciliation with the later owner ruling.
- `.trellis/spec/backend/mcp-tool-schema-compatibility.md` - shipped, preserved MCP definition boundary.
- `.trellis/spec/backend/tool-design.md` - tool identity, collision, progressive disclosure, annotations-as-hints, and
  never-throw conventions.
- `.trellis/spec/backend/e2e-harness.md` - L1/L2 stack verification requirements.
- `.trellis/spec/frontend/home-window.md` - one Home surface and page registry.
- `.trellis/spec/frontend/state-management.md` - Core authority, disposable clients, and cache privacy.
- `.trellis/spec/frontend/type-safety.md` - shared-schema boundary.
- `docs/adr/0006-mcp-processes-vs-no-os-invariant.md` - operator-only MCP configuration and credential target.

## Caveats / Not Found

- `.trellis/.current-task` points to `.trellis/tasks/08-09-hindsight-compatibility-extensions`, not this planning task.
  It was intentionally not changed. The target PRD also says implementation must wait for the leader's explicit
  transition.
- The host-bound secure credential authority is selected in principle, but the exact wire contract and implementation
  packaging for a Core host versus a Desktop/phone Node remain to be frozen. The existing Rust keyring must not be
  reused remotely; each host needs a local adapter for its own catalog.
- No current production implementation was found for MCP/Skills operator methods, Desktop Approval handling,
  permission method handlers, policy hot application, approval list/revoke, or MCP/Skill live reload.
- No fresh provider-live, MCP-server-live, Desktop runtime, Cargo, typecheck, lint, or test command was run. Existing
  tests and prior green claims were inspected only.
- No raw hosted Tavily payload is stored in the repository; the shipped compatibility fixture remains the minimal
  recorded failure shape. This does not block productization but should not be restated as universal provider proof.
- Exact storage tables/files, credential backend, cross-language registry generation mechanism, node authorization
  attestation/choreography, forced-drain timeout, import archive limits, and UI information architecture remain design
  decisions for the named child tasks. No values were invented in this audit.
