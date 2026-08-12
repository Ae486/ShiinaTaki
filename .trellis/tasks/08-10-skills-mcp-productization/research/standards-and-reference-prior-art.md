# Research: Standards and reference prior art for Skills and MCP productization

- Query: What current Agent Skills and MCP contracts, AI SDK capabilities, and OpenClaw/Hermes precedents should constrain a standards-compatible TakiAgent Skills/MCP product surface, including trust, reload, approvals, credentials, and the MVP boundary?
- Scope: mixed (live standards/framework documentation, installed dependencies, archived project research, local reference source, and binding project decisions)
- Date: 2026-08-10

## Current owner amendment (2026-08-10)

The initial research below was written while MCP and credential locality were described as Core-local. The owner later
selected mixed-host execution (`4A`), which supersedes that locality assumption for the target design:

- Core remains the single global governance and durable Approval authority.
- Every authenticated Core or Desktop/phone Node may be an `Execution Host`. The host that owns an MCP client owns its
  MCP credentials, Skills, support files, Workspace, and OS capabilities.
- An encrypted credential catalog is local to that owning host. Core stores only non-secret registry metadata, opaque
  references, presence, and sanitized diagnostics; secret values never cross the ordinary host-control protocol.
- A Run has one `primaryHostId`. Unqualified operations use that host; secondary-host calls and cross-host artifact
  transfer are explicit and host-qualified. A disconnected host is not silently substituted.
- Core emits a structured host-context control block at Run assembly. Skill/MCP instructions and tool results are
  untrusted advisory data and cannot modify host binding, policy, approval scope, or transfer rules.

Sections that retain Core-local wording are historical evidence for the pre-4A baseline. They must be read together with
this amendment and are not implementation authority.

## Findings

### 1. Evidence classification and bottom line

This document uses three labels deliberately:

- **Standard/framework fact** means a statement verified against the live Agent Skills specification, MCP specification revision `2025-11-25`, or the installed `@ai-sdk/mcp@2.0.10` source/types.
- **Reference behavior** means behavior found in the vendored Hermes `0.18.2` snapshot or in the pinned OpenClaw `v2026.4.9` research bank. It is prior art, not an interoperability requirement.
- **Recommendation** means a TakiAgent design conclusion derived from those facts plus the owner-ratified T4 and repository architecture constraints.

The recommended boundary is:

1. Import an Agent Skills-compatible directory without rewriting it into a Taki-only format. Preserve all package files, validate the standard core, and keep provenance/trust/enable/hash/scan state in Core-owned sidecars.
2. Expose metadata, `SKILL.md`, and support resources progressively. Reading a file never implies permission to run it. Scripts execute only through an already-authorized capability on the correct Node.
3. Make MCP server configuration and runtime generations Core-governed and host-published. Operator changes go through
   Core, while the owning Execution Host builds a candidate generation, publishes it atomically for future turns, and
   drains the old owned generation so in-flight calls stay bound to the client that created them.
4. Keep one registry-driven authority calculation. Skill metadata, MCP annotations, source trust labels, and tool filters can narrow or inform; none may grant authority.
5. Put MCP/provider credential authority beside the MCP client on its owning Execution Host. Desktop/mobile Nodes retain
   only the credentials for integrations and capabilities they actually own. A split deployment must not depend on an
   online peer host to unlock another host's credential catalog.
6. Ship import/inspect/enable/remove and MCP CRUD/status/test/reconnect/tool-selection first. Defer Hub aggregation, marketplace adapters, automatic Skill updates, agent editing, and automatic Learning Proposal application.

### 2. Files found

| File | Why it matters |
| --- | --- |
| `.trellis/tasks/08-10-skills-mcp-productization/prd.md` | Current planning scope, acceptance criteria, and explicit deferrals. |
| `.trellis/tasks/archive/2026-07/07-10-mcp-and-skills/research/skills-loader.md` | July loader design and earlier interpretation of Agent Skills; partly superseded by the live specification below. |
| `.trellis/tasks/archive/2026-07/07-10-mcp-and-skills/research/ai-sdk-mcp-client.md` | Empirical `@ai-sdk/mcp@2.0.10` transport, lifecycle, failure, and notification findings. |
| `.trellis/tasks/archive/2026-07/07-10-mcp-and-skills/research/v7-tool-approval.md` | Existing approval wrapper behavior and failure-shape conventions. |
| `.trellis/tasks/archive/2026-08/08-03-settings-panel/research/rs-mcp-and-llm-config.md` | Product gaps: boot-only MCP, missing Home approval sink, absent Core secret backend, and current Skills state. |
| `.trellis/tasks/archive/2026-08/08-07-mcp-tool-schema-compatibility/research/repo-mcp-integration-map.md` | Current MCP discovery/namespacing/approval call chain and per-tool compatibility boundary. |
| `.trellis/tasks/archive/2026-08/08-07-mcp-tool-schema-compatibility/research/ai-sdk-mcp-schema-api.md` | Public AI SDK `listTools()` / `toolsFromDefinitions()` seam and limitations. |
| `.trellis/spec/backend/mcp-tool-schema-compatibility.md` | Binding per-definition isolation and safe-normalization contract. |
| `.trellis/spec/backend/permission-authorization.md` | Binding stricter-wins, deny-floor, operator-authority, and decision-scope rules. |
| `.trellis/spec/backend/config-store.md` | Config is Core-owned but explicitly not a secret store; secret values are masked. |
| `.trellis/spec/frontend/state-management.md` | Secret rows must not enter Desktop persistent cache. |
| `.trellis/workspace/pleia/t4-second-grill-prep.md` | Owner-ratified G2-07/G2-07A/G2-07B Skill, governance, Core-authority, and learning rules. |
| `docs/adr/0006-mcp-processes-vs-no-os-invariant.md` | MCP is operator-configured Core integration; model calls remain approval-governed. |
| `docs/adr/0007-capability-data-locality-split-machine.md` | Core/Node placement and the rule that Core decides while the capability-owning Node acts. |
| `docs/TECH-STACK.md` | All-local and VPS-hosted Core topologies, Node behavior, and current per-OS secret-backend intent. |
| `apps/desktop/src-tauri/src/secrets.rs` | Existing Windows Credential Manager abstraction, currently Node-side and used for identity credentials. |
| `references/hermes-agent-main/tools/skills_tool.py` | Hermes progressive Skill discovery, resource reads, and path containment. |
| `references/hermes-agent-main/tools/skills_hub.py` | Hermes quarantine, provenance lock, content hash, source adapters, and install hardening. |
| `references/hermes-agent-main/tools/skills_guard.py` | Hermes trust labels and regex-based pre-install scan policy. |
| `references/hermes-agent-main/tools/mcp_tool.py` | Hermes MCP status, filtering, isolation, reconnect, dynamic refresh, and tool-snapshot publication. |
| `references/hermes-agent-main/agent/secret_sources/base.py` | Hermes secret-source backend contract and orchestrator-owned precedence/provenance. |
| `.trellis/tasks/archive/2026-08/08-07-web-search-decision-review/research/openclaw-web-research.md` | Pinned OpenClaw `v2026.4.9` SecretRef and credential hardening evidence. |

### 3. Agent Skills compatibility

#### 3.1 Verified standard facts

The live Agent Skills specification retrieved on 2026-08-10 defines a Skill as a directory with a required root `SKILL.md`. The file is YAML frontmatter followed by unrestricted Markdown instructions. The required fields and exact compatibility floor are:

| Field | Current standard contract |
| --- | --- |
| `name` | Required, 1-64 characters, lowercase ASCII letters/digits/hyphens, no leading/trailing/consecutive hyphen, and must match the parent directory. |
| `description` | Required, 1-1024 characters, and should describe both what the Skill does and when to use it. |
| `license` | Optional; license name or reference to a bundled license file. |
| `compatibility` | Optional, 1-500 characters; environment/product/package/network requirements. |
| `metadata` | Optional string-to-string map for client-specific metadata. Clients should use distinctive keys. |
| `allowed-tools` | Optional **experimental space-separated string**. Runtime support varies. |

Source: <https://agentskills.io/specification> (live specification, retrieved 2026-08-10).

This corrects two details in the July bank: `description` now has an explicit 1024-character ceiling, and the current `allowed-tools` representation is a space-separated string, not a CSV/YAML-list contract. Taki should accept the current form, preserve unknown standard-compatible metadata, and treat `allowed-tools` only as a requested ceiling/recommendation. G2-07 already binds that it can never grant permission (`.trellis/workspace/pleia/t4-second-grill-prep.md:419-424`).

The standard names three conventional support directories:

- `scripts/` for executable code;
- `references/` for on-demand documentation;
- `assets/` for templates, images, data, and other static resources.

It permits **any additional files and directories**. Therefore `templates/` is portable and should be preserved, but it is a Hermes/community convention rather than a separately named Agent Skills standard directory. Treating `templates/` as a recognized UI category is compatible; rejecting an otherwise valid package because it has a different support directory is not.

Progressive disclosure is part of the standard design guidance:

1. `name` and `description` metadata are loaded for all Skills (about 100 tokens per Skill is the stated target);
2. the full `SKILL.md` is loaded on activation (under 5,000 tokens recommended);
3. support files are read only as needed.

The spec recommends keeping `SKILL.md` under 500 lines, using root-relative file references, keeping direct references shallow, and validating with the `skills-ref validate` reference implementation. These are authoring/validation recommendations, not permission semantics.

The specification does **not** define a package manifest, package versioning protocol, source registry, signature, content hash, trust tier, quarantine state, update protocol, or uninstall semantics. Those concerns must be sidecars if the base directory is to remain portable.

#### 3.2 Recommended import and resource contract

The smallest standards-compatible import contract is:

1. Accept a local directory or safely unpacked archive whose selected root contains exactly one root `SKILL.md` package.
2. Parse full safe YAML, validate the current required/optional fields, require the directory/name match, and keep unknown additional files. Reject YAML object types that violate known field shapes; ignore unknown metadata keys rather than inventing meaning.
3. Canonicalize and validate every archive path before extraction; reject absolute paths, `..`, device paths, duplicate/case-colliding paths, symlinks/junctions/hardlinks, and any resolved escape. Apply file-count, individual-size, and total-unpacked-size bounds.
4. Stage into quarantine, validate/scan, compute a deterministic content hash over relative path plus bytes, then atomically publish the package directory. Malformed or rejected packages remain visible with their reason but are not discoverable by the Agent.
5. Store operator state separately: stable installed id, enabled state, import source/locator, imported timestamp, content hash, validation/scan version and verdict, trust/provenance label, and last failure. Never mutate upstream `SKILL.md` merely to record Taki state.
6. List only bounded metadata at turn construction. `load_skill` returns the main instructions plus a bounded list of support paths. A subsequent constrained read accepts a package-relative path, resolves it under the immutable package root, applies size/type policy, and returns content or a structured refusal.
7. `scripts/` and executable-looking assets are data until an already-authorized capability runs them. A loaded Skill may suggest the action, but execution still crosses common policy and, in split mode, runs on the capability-owning Node.

Hermes provides useful evidence for the shape: it explicitly separates support directories from active discovery (`references/hermes-agent-main/agent/skill_utils.py:46-81`), uses metadata-only listing followed by `skill_view` (`references/hermes-agent-main/tools/skills_tool.py:669-790`), constrains reads to the Skill root (`:1292-1319`), and reports linked `references/templates/assets/scripts` paths (`:1404-1473`). Its cache signature includes directory mtimes and disabled state with a short TTL (`:680-709`), but Taki's product flow should prefer an explicit Core reconciliation/generation after every operator mutation; filesystem watching can remain a later convenience.

#### 3.3 Provenance and trust

**Recommendation:** trust is provenance and activation policy, never execution authority.

A minimal trust display should distinguish at least:

- bundled/repository-reviewed;
- operator-local import;
- external/community import;
- invalid/blocked.

The label should be backed by stored source locator and content hash. A trusted source can reduce install friction or scan requirements, but must not bypass path validation, package validation, current common policy, or action approval. Static scanning can detect obvious dangerous text/code and support an operator decision; it cannot prove a prompt procedure or script safe.

Hermes `0.18.2` is worth borrowing selectively. It defines `builtin | trusted | community`, scans external downloads before install, stages them in quarantine, stores source/trust/verdict/hash/files/timestamps in a lock file, rejects path escapes and symlinks, and appends an audit record (`references/hermes-agent-main/tools/skills_guard.py:3-20,35-65`; `references/hermes-agent-main/tools/skills_hub.py:3392-3443,3549-3656`). Its regex scanner and hard-coded trusted repositories are not a security boundary. Taki should reject the implication that a `safe` scan or a source label authorizes actions.

### 4. MCP lifecycle, discovery, and governance

#### 4.1 Verified MCP specification facts

The current MCP specification revision used by the installed SDK is `2025-11-25`.

- A connection has initialization, operation, and shutdown phases. `initialize` must be first, negotiates protocol version/capabilities/implementation metadata, and is completed by the client's `notifications/initialized` notification.
- Both parties must use only negotiated capabilities. A client should disconnect if the server selects an unsupported protocol version.
- No protocol shutdown message exists. Stdio shutdown is transport-level: close stdin, wait, then TERM/KILL if necessary. HTTP shutdown closes the associated connection(s).
- Requests should have timeouts; after timeout the sender should issue cancellation and stop waiting, while retaining an overall maximum even if progress arrives.
- A server offering tools must advertise the `tools` capability. `tools/list` is paginated. If it advertises `tools.listChanged`, it should emit `notifications/tools/list_changed`, after which the client re-lists.
- Tool annotations are untrusted unless the server is trusted. The spec recommends a human-in-the-loop ability to deny, visible exposure/invocation indicators, confirmation for sensitive operations, input/result validation, timeouts, and audit logging.
- MCP HTTP authorization is optional but, when implemented, follows the MCP OAuth profile. Stdio should obtain credentials from the environment rather than using the HTTP authorization flow.

Sources: <https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle>, <https://modelcontextprotocol.io/specification/2025-11-25/server/tools>, and <https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization> (retrieved 2026-08-10).

The specification does **not** define product UI states, server CRUD, host-side per-tool enablement, reconnect policy, configuration reload, client-generation draining, approval persistence, or secret storage. Those are host responsibilities.

#### 4.2 Installed AI SDK support and limits

TakiAgent currently installs exact `@ai-sdk/mcp@2.0.10` (`packages/core/node_modules/@ai-sdk/mcp/package.json:2-3`) and declares `ai ^7.0.17` (`packages/core/package.json:14-17`). Verified public support includes:

- `createMCPClient`, stdio and Streamable HTTP transport configuration, `serverInfo`, `initializeResult`, `instructions`, `listTools`, `callTool`, `toolsFromDefinitions`, resources/prompts, `onElicitationRequest`, and `close` (`packages/core/node_modules/@ai-sdk/mcp/dist/index.d.ts:599-705`);
- `authProvider` for HTTP transport (`dist/index.d.ts:269`);
- abort-signal forwarding from generated tools to `tools/call` (`src/tool/mcp-client.ts:850-859`);
- cleanup after failed initialization and idempotent close (`src/tool/mcp-client.ts:430-483`).

The important limitations are:

- `tools()` performs one `tools/list` and conversion; it does not paginate automatically (`.trellis/tasks/archive/2026-08/08-07-mcp-tool-schema-compatibility/research/ai-sdk-mcp-schema-api.md:24-28,119`).
- This SDK version does not expose a tool-list-changed callback. Its generic message handler treats a server notification (a method without an id) as `Unsupported message type` (`packages/core/node_modules/@ai-sdk/mcp/src/tool/mcp-client.ts:380-397`). Automatic `notifications/tools/list_changed` support therefore requires an SDK upgrade/custom transport work or remains deferred; it must not be claimed from the protocol capability alone.
- Closing a client with calls in flight rejects those calls. Existing probes observed `Connection closed` for stdio death/close (`.trellis/tasks/archive/2026-07/07-10-mcp-and-skills/research/ai-sdk-mcp-client.md:58-70`).
- `listTools()` plus `toolsFromDefinitions()` is the correct existing schema-compatibility seam. It preserves the same client and raw MCP call name while allowing incompatible definitions to be isolated before conversion (`.trellis/spec/backend/mcp-tool-schema-compatibility.md:7-18,42-61`).

#### 4.3 Recommended runtime state and operations

Use separate desired configuration, observed runtime, and published tool-generation state. A truthful per-server record should be able to represent:

| State | Meaning |
| --- | --- |
| `disabled` | Desired config is off; no connection attempt exists. |
| `configured` | Enabled config exists but has not yet been reconciled. |
| `connecting` | Candidate generation is negotiating/discovering. |
| `connected` | A published generation is usable; include compatible/excluded/skipped counts. |
| `reconnecting` | The current generation may still serve owned calls while a replacement is prepared. |
| `failed` | The latest candidate/test failed; retain sanitized code/message and last-good truth separately. |
| `draining` | No new calls may bind to the retired generation; owned in-flight calls are settling. |

These names are a Taki recommendation, not MCP-standard states. Hermes independently validates the value of distinguishing disabled/connecting/failed/configured/connected and exposing transport/tool count/error (`references/hermes-agent-main/tools/mcp_tool.py:5349-5426`).

Required operator operations for the MVP are list, add/edit, enable/disable, remove, test, reconnect/reconcile, and per-tool include/exclude. Tool filtering is a host projection over discovered raw names. It does not alter the remote server and does not grant authority. Hermes's include-wins/exclude-otherwise filter is understandable prior art (`references/hermes-agent-main/tools/mcp_tool.py:5021-5058`); a single canonical representation would be simpler for Taki persistence, with the API accepting toggles and Core deriving the stored set.

Every operation must be operator-role only. An Agent tool may discover currently eligible capabilities but cannot add a server, change headers/env, enable a tool, revoke a denial, or invoke reload as a policy mutation. This matches ADR 0006's operator-configured integration boundary (`docs/adr/0006-mcp-processes-vs-no-os-invariant.md:3-7`) and G2-07's one-authority rule (`.trellis/workspace/pleia/t4-second-grill-prep.md:410-439`).

#### 4.4 Safe reload and generation ownership

Reload is not specified by MCP and is not safely implemented by simply replacing one mutable client field.

**Recommended algorithm:**

1. Snapshot desired config revision and allocate a candidate generation id.
2. Resolve secrets only inside Core, construct the candidate client, initialize, list all pages, apply schema compatibility per definition, apply host tool filters, and build closures bound to that candidate client.
3. If candidate preparation fails, close it and leave the last-good published generation unchanged. Publish the failure separately.
4. Under one manager lock, atomically publish `{generation, client, tools, diagnostics}` for future turn snapshots. Mark the prior generation draining and reject new leases to it.
5. Every tool closure acquires/releases a generation lease around execution. Retired clients remain manager-owned until the lease count reaches zero, then `close()` is awaited and the generation record is removed.
6. Server disable/remove follows the same retirement path. Process shutdown owns every active/draining client and closes or cancels them under one bounded shutdown policy.

This preserves the acceptance requirement that an in-flight call is never redirected to a new client or orphaned. It also fits the installed SDK: generated `execute` closures already close over their creating client/raw name (`packages/core/node_modules/@ai-sdk/mcp/src/tool/mcp-client.ts:850-859`).

Hermes's hot-reload is useful negative evidence: its CLI disconnects all servers first, reconnects, and then refreshes the Agent tool list (`references/hermes-agent-main/cli.py:10879-10945`). That is simple, but it can interrupt owned calls and temporarily remove the last-good generation. Borrow its atomic tool-snapshot publication/generation guard (`references/hermes-agent-main/tools/mcp_tool.py:5495-5635`), not its shutdown-all replacement strategy.

Automatic handling of `notifications/tools/list_changed` can be deferred until the SDK exposes it or a bounded notification adapter is justified. Explicit operator reconciliation is standards-compatible because `listChanged` is optional. Do not advertise live dynamic discovery until exercised end to end.

#### 4.5 Approval convention

MCP's human-in-the-loop language is a safety recommendation, while Taki's common policy is the binding enforcement model. The effective call posture should be calculated at execution time from:

```text
currently published and enabled tool
INTERSECT Core global level, governance cell, durable decision, and hard floors
INTERSECT target Node availability and any stricter local/managed floor
```

For MCP this normally keys stable identity as installed server id plus raw tool name, with an argument classifier only where risk materially changes by target. Namespaced model-facing display names are not durable authority keys. `always` must include the explicit future-background disclosure required by the PRD; legacy grants without that scope cannot be silently reinterpreted.

Interactive `ask` uses the operator Approval dialog. An unattended `ask` fails closed and records a structured skip/waiting outcome per G2-07; it must not wake a desktop/mobile dialog at 03:00 (`.trellis/workspace/pleia/t4-second-grill-prep.md:441-449`). A Skill, MCP annotation, server-reported metadata, or source trust label cannot change this result.

### 5. Credential authority in all-local and VPS topologies

#### 5.1 Verified project facts

- MCP clients and network tools remain usable when the desktop is off in VPS mode; Core, DB, Workspace, and MCP live on the VPS (`docs/TECH-STACK.md:77-81`).
- Core decides; a Node performs only the OS/data capabilities it declares (`docs/adr/0007-capability-data-locality-split-machine.md:3-14`).
- The Core is the single global policy and durable Approval authority; Nodes may tighten but not widen it (`.trellis/workspace/pleia/t4-second-grill-prep.md:426-439`).
- The existing Rust `SecretStore` is Node-side Windows Credential Manager storage for node identity (`apps/desktop/src-tauri/src/secrets.rs:1-20,41-58`; `apps/desktop/src-tauri/src/ws_client.rs:23-36`). There is no Core secret backend today (`.trellis/tasks/archive/2026-08/08-03-settings-panel/research/rs-mcp-and-llm-config.md:431-468`).
- The Core config store intentionally refuses secret values and reports only masked presence (`.trellis/spec/backend/config-store.md:1-5,73-86`). Desktop persistent cache strips even masked secret rows (`.trellis/spec/frontend/state-management.md:66-87`).

#### 5.2 Recommended authority and API

The credential owner must be the process that owns the integration:

| Credential class | Authority and storage locality |
| --- | --- |
| MCP stdio env, MCP HTTP static headers/tokens, provider API keys | `SecretStore` on the Execution Host that owns the MCP client; Core sees only references and presence. |
| MCP OAuth access/refresh/client credentials | OAuth/token store on the owning Execution Host, bound to stable server id; the authorization flow is Core-governed with an operator-mediated browser handoff. |
| Node pairing/device token | That Node's platform credential store; never reused as an MCP/provider credential. |
| Node-local capability credential | Capability-owning Node, only if the capability genuinely executes there. |
| Mobile frontend session token | Mobile secure storage; no replication of Core integration secrets. |

Operator clients should receive write-only `secret.set` / idempotent `secret.clear` operations scoped to a stable registry field id, plus read-only presence/provenance/error metadata. No method returns a secret value. Values must not appear in config records, ordinary WS responses/notifications, logs, audit details, exceptions, analytics, crash reports, or UI caches. Editing non-secret MCP config should preserve existing secret references unless the operator explicitly clears them.

Config stores opaque stable secret references/field presence, not plaintext or user-provided secret-store paths. Core resolves the needed values just in time for candidate connection creation and passes only the declared stdio variables/HTTP headers. It should not expose the full Core environment to a child. Rotation is `set -> candidate reconnect -> success/failure`; on candidate failure, the stored new secret remains authoritative but diagnostics must distinguish `configured credential rejected` from `no credential`, without echoing the value.

For a Windows Execution Host, the existing Credential Manager pattern is reusable at the interface level, but the Rust
Node store cannot be used remotely by another host. For a VPS Execution Host, the backend must be headless-safe and
local to that host. The repository currently names a restricted-permission file/env backend as the future Linux option
(`docs/TECH-STACK.md:80-81`), but this research did not verify a final encrypted Linux backend. A plaintext `0600`
file/env is a deployment compatibility mechanism, not equivalent to Windows Credential Manager. Schema/API design should
therefore depend on a host-local `SecretStore` contract, not on Windows keyring handles or a desktop broker; backend
selection for each supported host packaging must be resolved before claiming secure persistence.

Hermes's secret-source contract is valuable structural prior art: backends fetch, while a central orchestrator owns ordering, conflict handling, protected bootstrap variables, timeouts, application, and provenance; startup fetch never prompts (`references/hermes-agent-main/agent/secret_sources/base.py:1-28`). Taki additionally needs write/clear and live reconnect semantics. Hermes's own setup persists some bootstrap tokens in `~/.hermes/.env` (`references/hermes-agent-main/hermes_cli/secrets_cli.py:156-178`), so it is not a drop-in security answer.

OpenClaw `v2026.4.9` similarly demonstrates structured SecretRefs, lazy resolution of only selected credentials, guarded file/exec providers, migration/audit/reload, and restricted exec environments. The pinned audit found no general OS keychain backend and permits plaintext config/dotenv, so borrow the resolver/provenance/guard pattern but reject it as sufficient storage for Taki (`.trellis/tasks/archive/2026-08/08-07-web-search-decision-review/research/openclaw-web-research.md:193-207,247-257`).

### 6. Reference code patterns: OpenClaw and Hermes

| Prior art | Borrow | Reject or defer |
| --- | --- | --- |
| Agent Skills ecosystem | Portable directory, standard frontmatter, lazy instructions/resources. | Private conversion format; interpreting `allowed-tools` as a grant. |
| Hermes Skills `0.18.2` | Metadata-first discovery, support-file path containment, quarantine, provenance/hash/audit, atomic publication. | Regex scan as proof of safety; hard-coded trusted repo as authority; Agent self-editing/curation in MVP. |
| Hermes Skills Hub | Source-adapter separation and sidecar lock model inform future extension. | Multi-source Hub search, install/update-all, optimistic marketplace UI, and auto-update in MVP. |
| Hermes MCP | Truthful state categories, per-server isolation, include/exclude filters, collision defense, lock-protected registry publication. | Shutdown-all reload; plaintext secret examples; global complexity such as automatic reconnect/circuit-breaker breadth before measured need. |
| OpenClaw policy | Stricter-wins composition, tool groups/profiles as views, deny floors, operator-owned configuration. | Full/yolo semantics that erase Taki's hard floor; per-agent policy breadth for a single companion. |
| OpenClaw SecretRefs | Lazy provider resolution, guarded file/exec sources, audit/reload, inactive refs left unresolved. | Plaintext config/dotenv as the product-managed durable store; treating an exec resolver as automatically trustworthy. |
| OpenClaw/ClawHub | Evidence that open packages can be distributed independently from Core. | Hub dependency, remote discovery, ratings/popularity, and automatic updates before local import is trustworthy and operable. |

OpenClaw skill-install/lazy-load evidence in the older proactivity survey is broad and secondary (`.trellis/workspace/pleia/m5-proactivity-survey.md:159-165`); it is not used here for field-level compatibility. The live Agent Skills specification is the authority for package shape.

### 7. Standards-compatible MVP boundary

| Ship in this productization task | Defer |
| --- | --- |
| Full current Agent Skills core-field validation and lossless package preservation. | Hub/marketplace aggregation, remote source adapters, ratings/search, publishing. |
| Safe local directory/archive import, quarantine, path/link/size checks, content hash, source/trust/scan sidecar. | Cryptographic package signing ecosystem until a real registry/signature contract is selected. |
| Inspect metadata/body/support file list; enable/disable/remove; explicit reconcile without Core restart. | Automatic filesystem watching, auto-update, update-all, background remote checks. |
| On-demand support-resource read within package root; scripts remain ordinary governed execution inputs. | Agent-authored Skill editing/curation and auto-applied Learning Proposals (G2-07B defers this). |
| MCP list/add/edit/enable/disable/remove/test/reconnect, compatible/skipped tool diagnostics, per-tool selection. | MCP marketplace/catalog, broad OAuth provider UX, prompts/resources/Apps product surfaces unless separately accepted. |
| Atomic new-generation publication and old-generation draining; last-good preservation on candidate failure. | Automatic `tools/list_changed` handling until SDK support/custom transport is proven. |
| Common Approval dialog, durable decision read/revoke, unattended fail-closed, hard floors, background-scope migration. | LLM smart approval, per-task permission profiles, separate Heartbeat/Scheduled permission pages. |
| Core-governed write-only secret API, host-local Windows/VPS backend, masked presence, no logs/cache/config values; backend-neutral ids across hosts. | Secret sharing between hosts; plaintext config as product storage. Each host backend still requires its implementation spike and verification. |

The MVP remains an end-to-end operator product, not a read-only Settings card. The archived settings analysis already showed that MCP CRUD without reconnect, a Desktop Approval sink, and secure credentials would be a misleading half-feature (`.trellis/tasks/archive/2026-08/08-03-settings-panel/research/rs-mcp-and-llm-config.md:388-392,493-557`).

### 8. External references and versions

| Reference | Version/date used | Use in this research |
| --- | --- | --- |
| <https://agentskills.io/specification> | Live page retrieved 2026-08-10; page exposes no specification version/date | Required/optional frontmatter, directory conventions, progressive disclosure, relative references, and validation guidance. |
| <https://github.com/agentskills/agentskills/tree/main/skills-ref> | Linked by the live specification on 2026-08-10 | Reference validator named by the standard; not executed in this planning-only research. |
| <https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle> | MCP revision `2025-11-25` | Initialization, capability negotiation, shutdown, timeout, and cancellation expectations. |
| <https://modelcontextprotocol.io/specification/2025-11-25/server/tools> | MCP revision `2025-11-25` | `tools/list`, pagination, `listChanged`, tool trust/safety, and result/error behavior. |
| <https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization> | MCP revision `2025-11-25` | Optional HTTP OAuth profile and stdio environment-credential boundary. |
| `packages/core/node_modules/@ai-sdk/mcp/` | Installed `2.0.10` | Actual client API, connection lifecycle, conversion, close behavior, and notification limitation. |
| `references/hermes-agent-main/` | Vendored Hermes `0.18.2`, MIT; exact snapshot date not asserted | Local reference implementation for Skills, MCP, approvals, and secret-source orchestration. |
| OpenClaw source/docs referenced by the archived audit | Pinned `v2026.4.9`; audit dated 2026-08-07 | SecretRef behavior and security controls; no unpinned latest behavior is asserted. |

### 9. Related specs and decisions

- `.trellis/spec/backend/permission-authorization.md` - common registry, stricter-wins policy, hard floors, operator-only policy state.
- `.trellis/spec/backend/mcp-tool-schema-compatibility.md` - same-client definition preparation, per-tool skip, safe diagnostics, raw-name preservation.
- `.trellis/spec/backend/config-store.md` - Core-owned settings overlay, explicit non-secret boundary, masked presence.
- `.trellis/spec/frontend/state-management.md` - persistent-cache privacy boundary.
- `docs/adr/0006-mcp-processes-vs-no-os-invariant.md` - operator-configured MCP process carve-out and tool Approval.
- `docs/adr/0007-capability-data-locality-split-machine.md` - Core versus Node execution locality.
- `.trellis/workspace/pleia/t4-second-grill-prep.md` G2-07/G2-07A/G2-07B - open Skill packages, no Skill-granted permission, one Core authority, progressive procedural knowledge, and owner approval before live learning changes.

## Caveats / Not Found

- The live Agent Skills page has no visible version number/date. Facts above are from the page retrieved on 2026-08-10; pin a conformance fixture in tests rather than relying on memory.
- `templates/` is not a separately named directory in the current Agent Skills specification. It remains compatible because arbitrary additional directories are permitted; `assets/` is the standard location explicitly described as containing templates.
- No Agent Skills standard provenance, trust, signature, quarantine, package lock, update, or removal protocol was found.
- No MCP-standard server status enum, CRUD API, reload protocol, generation-drain rule, host tool-enable format, approval persistence, or secret-storage mechanism was found.
- Installed `@ai-sdk/mcp@2.0.10` does not handle server list-change notifications and does not auto-paginate `tools/list`. Re-check on any dependency upgrade.
- The exact secure Linux/VPS writable backend was not selected or verified here. Core authority and API direction are resolved; claiming secure VPS persistence remains blocked until the packaging task chooses and tests a backend. Plaintext restricted files/env are not represented as equivalent to an OS credential store.
- Hermes is a fast-moving, broad reference. Version facts refer to the vendored `0.18.2` snapshot (`references/hermes-agent-main/pyproject.toml:8-22`), not latest upstream. OpenClaw facts refer to the pinned `v2026.4.9` audit, not an unpinned latest branch.
- No live MCP server, OAuth provider, external Skill archive, or secret manager was invoked. Findings cover documented/installed behavior and source structure, not provider-specific interoperability or operational latency.
- `.trellis/.current-task` pointed to `.trellis/tasks/08-09-hindsight-compatibility-extensions` during this research. Per the parent task instruction, binding was not changed; this artifact was written only to the explicitly assigned planning task path.
