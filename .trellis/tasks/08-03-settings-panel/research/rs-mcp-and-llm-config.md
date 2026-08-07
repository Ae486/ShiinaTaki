# Research: MCP state, tool inventory, governance surfaces, and what an "LLM & tools" panel page can do

- **Query**: (1) how complete is MCP today? (2) can external MCP servers be connected now, and how does an operator do it? (3) can MCP management live in the settings panel? (4) what would an "LLM & tools" page (models / tools / permissions / `TAKI_MAX_STEPS`) require?
- **Scope**: internal (code facts only; no web lookups were needed)
- **Date**: 2026-08-04
- **Baseline**: repo `H:\TakiAgent`, clean tree at 599a9e7

---

## A. MCP — current state

### A.1 What exists

Four production files, all under `packages/core/src/mcp/` (this directory is the ONLY sanctioned
`@ai-sdk/mcp` import site — stated as a grep-verifiable invariant in `packages/core/src/mcp/index.md:6`):

| File | Role |
|---|---|
| `packages/core/src/mcp/mcp-config.ts` | loads + zod-validates `mcp-servers.json` |
| `packages/core/src/mcp/mcp-connect.ts` | builds the transport and connects one server |
| `packages/core/src/mcp/mcp-manager.ts` | connect-at-boot, namespace + error-wrap tools, `describe()`, `close()` |
| `packages/core/src/mcp/index.md` | folder index + the import invariant |

Tests: `mcp-config.test.ts`, `mcp-manager.test.ts` (5 cases: namespacing/describe, JSON-RPC error
wrapping, failing-server skip, idempotent close, and a REAL stdio child end-to-end), `mcp-http.test.ts`
(a real `node:http` Streamable-HTTP fixture: initialize → tools/list → tools/call).

### A.2 Transports — both stdio and HTTP are real

`packages/core/src/mcp/mcp-connect.ts:19-32`:

```ts
export const defaultConnect: McpConnect = (entry) => {
  const { config } = entry;
  if (isStdioConfig(config)) {
    return createMCPClient({
      transport: new Experimental_StdioMCPTransport({
        command: config.command, args: config.args, env: config.env, cwd: config.cwd,
      }),
    });
  }
  return createMCPClient({ transport: { type: "http", url: config.url, headers: config.headers } });
};
```

- **stdio**: spawn happens inside `@ai-sdk/mcp` (shell:false). Windows note carried in
  `mcp-config.ts:11` — `command` must be a real exe (`node`) or `cmd /c npx ...`.
- **http**: Streamable HTTP (`{ type: "http", url, headers }`). Proven against a live local server in
  `mcp-http.test.ts:76-91`.
- **No SSE-only transport**, no OAuth, no auth negotiation. Headers are the only HTTP auth mechanism.

### A.3 How servers are configured today

**File**: `<TAKI_DATA_DIR>/mcp-servers.json`, wired at `packages/core/src/main.ts:174-177`:

```ts
const mcpManager = await createMcpManager({
  entries: loadMcpConfig(join(serverConfig.dataDir, "mcp-servers.json"), mcpLog),
  logger,
});
```

`TAKI_DATA_DIR` defaults to `join(homedir(), ".takiagent")` (`knob-registry.ts:91-97`), so the default
concrete path is `%USERPROFILE%\.takiagent\mcp-servers.json`.

**Shape** (`mcp-config.ts:12-30`) — a flat JSON object, key = server name, value = stdio OR http:

```jsonc
{
  "filesystem": { "command": "cmd", "args": ["/c", "npx", "-y", "@modelcontextprotocol/server-filesystem", "C:\\notes"] },
  "remote":     { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ..." } }
}
```

stdio accepts `command` (required), `args?`, `env?`, `cwd?`. http accepts `url` (required, must parse
as a URL), `headers?`. There is **no `enabled` flag, no `description`, no timeout, no per-server tool
filter** in the schema — the only way to turn a server off is to delete/rename its key.

**Failure behaviour is deliberately soft** (`mcp-config.ts:41-70`): missing file → `[]` (silent, the
normal boot); unreadable / not-JSON / schema-invalid → one `log.warn` + `[]`. The file is never fatal.

### A.4 Lifecycle

- **Connect at boot only.** `createMcpManager` runs `Promise.allSettled` over all entries at process
  start (`mcp-manager.ts:43-55`), caches the merged `ToolSet` in a closure, and `tools()` returns that
  same object forever (`mcp-manager.ts:59`). There is **no reconnect, no re-discovery, no hot reload,
  no health check, and no per-turn refresh.**
- A server that fails to connect or fails `tools()` is logged and skipped; the others stay live
  (`mcp-manager.ts:47-50`). A discovery failure closes its client so no zombie transport is left
  (`mcp-manager.ts:75-78`).
- **Shutdown**: `mcpManager.close()` runs before the DB closes on SIGINT/SIGTERM (`main.ts:384`),
  killing stdio children / aborting HTTP clients. `close()` is idempotent.
- Consequence: **any MCP change requires a Core restart.** There is no code path that re-reads
  `mcp-servers.json` or reconnects a server while the process runs.

### A.5 How MCP tools reach the agent

`main.ts:286-293` — MCP tools are spread into `extraTools` alongside the built-ins:

```ts
extraTools: {
  ...createLoadSkillTool(skillsLoader),
  ...createCurrentTimeTool(),
  ...capabilityTools,
  ...readFileTool,
  ...writeFileTool,
  ...mcpManager.tools(),
},
```

and `chat-agent.ts:177` merges memory tools + extraTools + per-character avatar tools into the
`ToolLoopAgent`'s `tools`.

- **Naming**: each tool is namespaced `${sanitize(serverKey)}_${toolName}`; `sanitize` replaces every
  char outside `[a-zA-Z0-9_-]` with `_` (`mcp-manager.ts:91-98, 128-130`).
- **Collisions**: last server wins, with a warn (`mcp-manager.ts:95`). Note the ordering hazard is
  wider than MCP-vs-MCP: because `mcpManager.tools()` is spread LAST in `extraTools`, an MCP tool
  whose namespaced key equals a built-in (e.g. a server literally named `read` exposing `file`)
  would silently shadow the built-in with no warn — the warn only fires for MCP-vs-MCP.
- **Descriptions/schemas** come straight from the server; `wrapExecute` spreads the original tool and
  replaces only `execute`, so schema/description/`toModelOutput` are preserved (`mcp-manager.ts:103-116`).
- **Errors**: a throwing MCP call becomes `{ ok: false, code, message }` for the model — `code` is the
  numeric JSON-RPC code when present, else `"MCP_CALL_FAILED"` (`mcp-manager.ts:108-126`).
- `describe(toolKey)` maps a namespaced key back to `{ serverName, toolName }`; this is what scopes
  approval (`mcp-manager.ts:60`).

### A.6 The approval path (MCP-only, separate from the Rust Permission Gate)

This is a **completely different mechanism** from the Rust Permission Gate. Two independent systems:

| | MCP tools | Shell capabilities |
|---|---|---|
| Decision engine | `packages/core/src/approval/approval-gate.ts` (TS, in Core) | `apps/desktop/src-tauri/src/gate.rs` (Rust, on the node) |
| Asked over | WS `approval.request` notification → `approval.respond` | native Tauri dialog on the node machine |
| Memory file | `<TAKI_DATA_DIR>/mcp-approvals.json` | `<app_data_dir>/gate-decisions.json` |
| Permission Level projection | **none** — MCP is not in the governance registry | yes (strict/standard/relaxed cells) |

Flow: `chat-agent.ts:182` installs `toolApproval: ({toolCall}) => approval.decide(toolCall, turn?.notify)`.
`approval-gate.ts:38-53`:

1. `mcp.describe(toolName)` returns undefined for any non-MCP tool → `"not-applicable"`, i.e. **every
   built-in tool bypasses this gate entirely** (memory, capabilities, workspace files, avatar, skills).
2. A remembered `always` → approved; remembered `never` → denied.
3. No `notify` sink (no operator socket on this turn) → **denied**, fail-closed.
4. Otherwise `broker.ask(...)` pushes `approval.request` and awaits `approval.respond`; the outcome is
   remembered per scope.

Scopes and persistence (`approval/decision-store.ts:41-51`): `once` → nothing stored; `session` →
in-memory map; `always` → persisted (`approve→always`, `deny→never`). Keyed by a JSON-tuple of
`[serverName, toolName]` so a server-controlled tool name can never collide across servers
(`decision-store.ts:55-58`). Malformed file → warn + empty (approvals are re-askable, not auth state).

Method names live once in `packages/shared/src/approval-schema.ts:8-12`
(`APPROVAL_METHODS.request = "approval.request"`, `.respond = "approval.respond"`); the responder is
operator-role (`packages/core/src/server/methods/approval-respond.ts`).

**Who renders it today:** ONLY the CLI. `apps/cli/src/chat-client.ts:103-114` registers the
`approval.request` route and answers with `approval.respond`; with no handler it fail-closed
deny-once so the turn never hangs. **`apps/desktop/src` contains zero references to
`approval.request` / `APPROVAL_METHODS`** (grepped) — the Pet UI and the home window do not implement
the approval route at all.

### A.7 Verdict: is MCP production-usable today?

**Mechanically yes, operationally no.**

Working: both transports, real end-to-end tests, namespacing, error envelopes, graceful degradation,
approval + persisted decisions, clean shutdown.

Blocking for a real user:

1. **The approval dialog exists only in the CLI.** If the operator drives the agent from the home
   window / pet bubble (the product path), an unremembered MCP tool call hits
   `approval-gate.ts:49`... no — it hits the broker, which pushes `approval.request` to the asking
   socket; the home window has no handler for that method, so nothing answers and the ask resolves by
   the broker's timeout as a **deny**. In practice: from the desktop UI, MCP tools that are not already
   remembered `always` cannot be approved. There is no UI surface to grant them.
2. **No operator surface for configuration at all** — no WS method, no panel, no CLI subcommand. The
   only way in is hand-editing JSON.
3. **Restart-only lifecycle** — no reconnect, no status, no "test connection".
4. **Secrets contradiction with ADR 0006.** ADR 0006 line 5 says: *"Secret-marked env vars and headers
   for MCP servers are stored in Windows Credential Manager, never in the config file."* The code
   stores `env` and `headers` as **plain strings in `mcp-servers.json`**
   (`mcp-config.ts:15, 23`). There is no keyring integration on the MCP path. This is the one clear
   code-vs-ADR divergence.

Also divergent from ADR 0006, though less severe: the ADR says *"the user adds them explicitly in the
settings panel (an operator-role WS method)"* — that method does not exist. The invariant half of the
ADR (single sanctioned spawn site inside `mcp/`, agent has no path to the config) **is** honored.

### A.8 Exact operator procedure to add an MCP server today

1. Stop the Agent Core.
2. Create/edit `%USERPROFILE%\.takiagent\mcp-servers.json` (or `<TAKI_DATA_DIR>\mcp-servers.json` if
   the env var is set) with the flat object shape in §A.3.
3. Restart the Core (`pnpm core:dev` / `pnpm --filter @taki/core start` — both run
   `node --env-file-if-exists=../../.env.local src/main.ts`, `packages/core/package.json:8-9`).
4. Verify by log line: `"mcp servers connected"` with `{servers, tools}` counts (`mcp-manager.ts:55`).
   A bad file logs `"mcp config is malformed; starting with no MCP servers"` and boots with zero servers —
   **it does not fail loudly**, so the count line is the only confirmation.
5. To approve the tools, drive the agent from the CLI (the only client that answers `approval.request`),
   answer `always` once per server+tool; that persists to `mcp-approvals.json` and thereafter works from
   any client.

---

## B. Tool inventory + governance surfaces

### B.1 Every tool the chat agent can call today

Assembled at `chat-agent.ts:177` = memory tools + `extraTools` (`main.ts:286-293`) + per-character tools.

| Tool name | Source file | Crosses Permission Gate? | MCP approval? | Enable/disable surface |
|---|---|---|---|---|
| `memory_write` | `memory/memory-tools.ts:53` | no | no | none |
| `memory_search` | `memory/memory-tools.ts:54` | no | no | none |
| `memory_archive` | `memory/memory-tools.ts:55` | no | no | none |
| `load_skill` | `skills/load-skill-tool.ts:12` | no | no | per-skill via `skills-state.json` (no WS method) |
| `get_current_time` | `time/current-time-tool.ts:12` | no | no | none |
| `screenshot` | `capabilities/screenshot-tool.ts:38` | **yes** (`screenshot` cell) | no | none in production |
| `process_list` | `capabilities/process-list-tool.ts:19` | **yes** (`process-list`) | no | none in production |
| `clipboard_read` | `capabilities/clipboard-read-tool.ts:19` | **yes** (`clipboard-read`) | no | none in production |
| `clipboard_write` | `capabilities/clipboard-write-tool.ts:18` | **yes** (`clipboard-write`) | no | none in production |
| `shell_open` | `capabilities/shell-open-tool.ts:18` | **yes** (`shell-open:{url-safe,local-file,local-exec,blocked}`) | no | none in production |
| `exec` | `capabilities/exec-tool.ts:18` | **yes** (`exec:*` + `exec-policy.json` mode/allow/blocklist) | no | `exec-policy.json` `mode:"deny"` disables it |
| `read_file` | `workspace/read-file-tool.ts:31` | **no** — Core-side, confined to the Workspace root | no | none |
| `write_file` | `workspace/write-file-tool.ts:25` | **no** — Core-side, confined to the Workspace root | no | none |
| `avatar_set_expression` | `avatar/set-expression-tool.ts:15` | no | no | none |
| `avatar_play_motion` | `avatar/play-motion-tool.ts:15` | no | no | none |
| `<server>_<tool>` (MCP) | discovered at boot | **no** (never touches the Rust gate) | **yes** | delete the entry in `mcp-servers.json` + restart |

Not in the chat agent's set (background passes only, listed for completeness):
`createBackgroundMemoryTools` (same three names, write clamped to auto rungs, `memory-tools.ts:64-70`)
and the tidy pass set `memory_reinforce` / `memory_archive_supersede` / `memory_set_disclosure` /
`memory_refile` / `block_rethink` / finish (`memory/tidy-tools.ts:37-45`).

Node-advertised capability names (must agree with the governance cell keys) — `node.rs:50-64`:
`screenshot`, `screenshot-ambient`, `process-list`, `clipboard-read`, `clipboard-write`, `shell-open`,
`exec`, `foreground-window`. `screenshot-ambient` and `foreground-window` are driven by the perception
layer, not by an LLM tool.

### B.2 Rust-side governance map

**Permission Level** — `strict` / `standard` / `relaxed`
(`packages/shared/src/permission-level-schema.ts:20`; Rust mirror in `protocol.rs`).

- Source of truth: `<app_data_dir>\permission-level.json`, shape `{ "level": "standard" }`.
- Read **exactly once** at `node.rs:77` (`load_level`), then frozen into `GatePolicy` for the process
  lifetime — deliberately, so nothing mid-run can shift it (`gate.rs:116-121`, `level.rs:3`).
- Fail-safe: missing → `Standard`; corrupt / unknown value / extra key → warn + `Standard`, **never**
  `Relaxed` (`level.rs:13-29`, pinned by `corrupt_or_unknown_degrades_to_standard_not_relaxed`).
- **Nothing in the repo writes this file.** The operator hand-creates it.

**Per-capability postures** — `apps/desktop/src-tauri/src/gate/governance.rs`. 17 cells + 4 floor rows =
21 projection rows (`governance.rs:257-259`):

| Cell key | strict | standard | relaxed | persist |
|---|---|---|---|---|
| `shell-open:url-safe` | Ask | Auto | Auto | yes |
| `shell-open:local-file` / `:local-exec` | Ask | Ask | Auto | no |
| `exec:simple-allowlisted` | Ask | Auto | Auto | no |
| `exec:compound` / `:shell-reentry` / `:allowlist-miss` | Ask | Ask | Auto | no |
| `fs-write:in-workspace` | Auto | Auto | Auto | yes |
| `fs-write:dir-root` | Ask | Ask | Auto | yes (per-root) |
| `fs-write:outside-root` / `:skill-hook` | Ask | Ask | Auto | no |
| `screenshot`, `screenshot-ambient`, `process-list`, `clipboard-read`, `clipboard-write`, `foreground-window` | Ask | Ask | Auto | yes |

**Deny floors** (denied in EVERY tier, checked before any store lookup, `gate.rs:169-171`):
`shell-open:blocked`, `exec:blocked`, `fs-write:sensitive`, `fs-write:self-escalation`.

Note `fs-write:*` is FOUNDATION only — `fs_write_class.rs:4-8` states plainly there is no live
out-of-Workspace fs-write capability yet.

**The three governance files** (all under the Tauri `app_data_dir()`, i.e.
`%APPDATA%\cc.shiinataki.app\` — identifier from `tauri.conf.json:5`; resolved at `lib.rs:122`,
joined at `node.rs:73-82`):

| File | Written by | Read when | Core access over WS? |
|---|---|---|---|
| `permission-level.json` | **nobody in code** — operator by hand | once at `build_node` | **no** |
| `gate-decisions.json` | `gate.rs` human-answer arm ONLY | on each ask | **no** |
| `exec-policy.json` | **nobody in code** — operator by hand | once at `build_node` | **no** |
| (`audit.jsonl`) | `FileAuditor` | append-only | **no** |

`gate-decisions.json` has exactly one production writer, and that is enforced by a test that scans
`src/` and fails if a second `.remember(` call site appears in production code
(`gate.rs:831-852`, `decision_memory_has_exactly_one_production_writer`).

**Critically: the Core cannot read or write ANY of these over WS.** The `permission.*` methods
(`levelGet` / `levelSet` / `cellsGet` / `cellSet`) exist as **schemas only** in
`packages/shared/src/permission-level-schema.ts:11-16`. Grepping the whole repo: **no registration in
Core's method registry, no handler in Rust, no client call.** They are a designed-but-unimplemented
contract, tagged `#23` throughout `governance.rs`. Likewise `GatePolicy::disable()` is
`#[cfg(test)]`-only (`gate.rs:123-126`) — **there is no production path to disable a capability.**

### B.3 What a panel MAY and MAY NOT touch

The rulings, cited:

- **D36 supplement (T2b re-ruling, 2026-07-20)**, `docs/deferred-decisions.md:100`, bottom line ③:
  *"agent **永不能改任何权限配置**(Level/投影/floor/黑名单),该路径仅存于设置面板(operator-role)"* —
  the agent may never change any permission config; that path exists ONLY in the settings panel
  (operator role).
- Same entry, ②: skill/hook paths and permission files are physically separate; a skill that tries to
  edit policy still hits the self-escalation floor.
- `permission-level-schema.ts:8-10`: the `permission.*` methods are operator-role, mirroring
  `approval.respond`; *"the agent has NO tool that reaches them — a conversational grant rides the
  ordinary Approval flow (NL red line)."*
- `.trellis/spec/backend/permission-authorization.md:67` and `:95`: only `permission.levelSet` writes
  the Level file; only `permission.cellSet` (carrying `secondConfirm`) may change a floor cell.
- `fs_write_class.rs:20-23`: `gate-decisions.json`, `exec-policy.json`, `permission-level.json` are the
  self-escalation floor set — any agent write to them is denied in every tier.
- **D41** (`deferred-decisions.md:69`): the dir-root dialog must not offer an "always" button; that
  tightening lives in the UI layer, approved but not built.

So, for a settings page:

**MAY (operator role, once the backend exists):** set the Permission Level; set a non-floor cell's
posture; change a floor cell ONLY with the `secondConfirm: true` marker; view/revoke remembered
decisions; view the audit trail; edit `exec-policy.json`'s mode/allowlist/blocklist; enable/disable a
capability (needs a production `disable` path first).

**MUST NOT, ever:** be reachable from any agent tool or from an LLM-authored skill; auto-lower the
floor; accept a floor change without the explicit second confirm; let a "remember always" be written by
anything other than a human answering the dialog.

**Cannot today, for a plumbing reason not a policy one:** none of the above is reachable from Core at
all. The Core↔node WS channel is one-directional for governance — Core sends `capability.request`, the
node answers `capability.respond`. There is no node-role method that reads or writes gate state, and no
Core method that proxies one.

---

## C. What a panel could show/do TODAY vs what needs new backend work

### (i) Already exposed via existing WS methods

All operator-role, all Core-only (no Rust mirror). From `packages/core/src/server/methods/index.md`:

| Method | Gives the panel |
|---|---|
| `config.list` / `config.set` / `config.subscribe` (+ `config.changed`) | all 34 knobs with value + provenance + input hints; write with typed refusals |
| `memory.status` | window calibration per slot, compaction coverage + summary LENGTH, auto-write/tidy watermarks |
| `memory.tidy` | run the tidy pass now; returns per-class defect counts, edits, steps, utility-slot spend |
| `media.usage` / `media.clear` | attachment + memory-text byte footprint; purge attachments |
| `perception.pauseGet` / `pauseSet` / `card` | Privacy Pause + activity card |
| `character.list` / `costumes` / `costumeResolution` / `import` | costume page |
| `timeline.history` / `subscribe`, `chat.send` / `cancel`, `avatar.subscribe` / `report` | chat page |
| `approval.respond` | **exists** — the panel could answer MCP approvals if it also handled the `approval.request` notification |

The desktop client already wires `config.*` (`apps/desktop/src/lib/ws-client-methods.ts:92-96`,
`ws-client-routes.ts:98`), and the page registry pattern for adding a page is one row in
`apps/desktop/src/windows/home/pages.ts:28-34`.

### (ii) Model/tool-related knobs already in the registry

From `packages/core/src/config/knob-registry.ts` (34 rows total; **every row is `apply: "restart"`
except `TAKI_DATA_DIR` which is `env-only`** — nothing in Core is live-apply today):

| Key | Line | Default | Notes |
|---|---|---|---|
| `TAKI_MAX_STEPS` | `:122` | 10 | int 1–50, "Tool-loop step cap per turn" — **the knob the owner asked for; it already exists and is already panel-editable** |
| `TAKI_PROVIDER_BASE_URL` | `:102` | null | main chat provider |
| `TAKI_PROVIDER_API_KEY` | `:103` | null | **secret — `config.set` refuses** |
| `TAKI_PROVIDER_MODEL` | `:104` | null | |
| `TAKI_VLM_BASE_URL` / `_API_KEY` / `_MODEL` | `:105-107` | null | vision slot, all-or-nothing |
| `TAKI_UTILITY_BASE_URL` / `_API_KEY` / `_MODEL` | `:108-110` | null | background slot, all-or-nothing; absent ⇒ falls back to the main model |
| `TAKI_PROVIDER_CONTEXT_TOKENS` / `TAKI_VLM_…` / `TAKI_UTILITY_…` | `:113-115` | 128000-class default | declared window per slot |
| `TAKI_CONTEXT_HISTORY_RATIO` | `:116` | | share of window replayed as history |
| `TAKI_PROVIDER_INCLUDE_USAGE` | `:117` | false | ask provider for streaming usage numbers |
| `TAKI_COMPACT_TRIGGER_RATIO` / `TAKI_COMPACT_KEEP_MESSAGES` | `:118-119` | | compaction |

`TAKI_MAX_STEPS` is consumed at `main.ts:272` (`boot.agentConfig.maxSteps`) → `chat-agent.ts:178`
(`isStepCount(deps.maxSteps ?? 10)`). Because `loadAgentConfig` runs once at boot
(`boot/core-bootstrap.ts:98`), changing it takes effect at the next Core start — which is exactly what
the knob's `restart` badge already tells the user. **No new work is needed to make `TAKI_MAX_STEPS`
editable in the panel; it is already in `config.list` and the existing settings page renders it.** The
only open question is presentation: grouping it onto an "LLM & tools" page instead of the flat list.

### (iii) Needs new WS methods (does not exist in any form)

| Want | Why it needs new backend |
|---|---|
| **List MCP servers** | nothing exposes `mcp-servers.json`; the manager keeps no server-level state beyond the client list |
| **Add / edit / remove an MCP server** | no writer for that file exists; also needs an `enabled` field the schema does not have |
| **MCP connection status / "test connection"** | the manager records no per-server status; a failed server is only a log line |
| **List discovered MCP tools** | `tools()` returns the merged `ToolSet` but no method exposes it; `describe()` is internal to the approval gate |
| **Reload MCP without restart** | connect-at-boot only (§A.4); needs a re-connect path plus care about in-flight turns |
| **List / revoke remembered MCP approvals** | `mcp-approvals.json` has no read-out method and `DecisionStore` has no delete |
| **Approval prompt in the desktop UI** | `approval.respond` exists; the `approval.request` **notification handler does not exist in `apps/desktop`** — this is client-side work plus a dialog |
| **Any tool enable/disable** | no registry-level enable flag anywhere in Core |
| **Skills list / per-skill toggle** | `SkillsState` (`skills/skills-state.ts`) has `disable`/`enable`/`listDisabled` and persists to `skills-state.json`, but **no WS method exposes it** — this is the cheapest new method in the whole list: the state object already exists in `main.ts:166-169` |
| **Permission Level read/write** | `permission.levelGet`/`levelSet` are schemas only; needs a Rust-side handler AND a Core↔node channel that does not exist |
| **Per-cell posture read/write** | same; `GovernanceRegistry::project_level` already produces the exact `cellsGet` payload (`governance.rs:153-157`) but nothing calls it |
| **Capability enable/disable** | `GatePolicy::disable` is test-only (`gate.rs:123`) |
| **Exec policy editing** | `exec-policy.json` has no writer and no method |
| **Audit trail viewer** | `audit.jsonl` is append-only on the node with no read surface |
| **API key editing** | see §D |

### (iv) MUST NOT be panel-editable — or must carry a hard guard

- **Deny floors** (`shell-open:blocked`, `exec:blocked`, `fs-write:sensitive`,
  `fs-write:self-escalation`) may only change with the wire-level `secondConfirm: true` marker; a floor
  edit without it MUST be rejected server-side (`permission-level-schema.ts:51-57`;
  `permission-authorization.md:95`). Client-side confirmation alone is not sufficient — the marker is
  the *wire proof*, and the server is where it must be checked.
- **Nothing on this page may be reachable by a tool.** Everything here is operator-role, mirroring
  `approval.respond` (`permission-level-schema.ts:8-10`). D36 ③ (`deferred-decisions.md:100`).
- **`gate-decisions.json` must keep exactly one writer** — the human-answer arm in `gate.rs`. A panel
  that seeds an "always allow" directly would break the sweeping test at `gate.rs:831-852`. Revoking
  (deleting) an entry is a different operation and is safe; granting is not.
- **`TAKI_DATA_DIR`** is `env-only` and `config.set` refuses it (`config-writer.ts:41`) — the panel
  shows it locked.
- The three `*_API_KEY` knobs are refused by `config.set` with reason `secret` (`config-writer.ts:38-40`).

---

## D. Secrets reality check — the honest gap

**Where provider keys actually come from at boot:** plain `process.env`.
`loadProviderConfig(env)` zod-parses `TAKI_PROVIDER_BASE_URL/_API_KEY/_MODEL` and is **fatal-fast** —
a missing key kills the boot naming the variable (`config/provider-config.ts:9-25`, called at
`boot/core-bootstrap.ts:86-90`). Same pattern for the optional vision slot (`vision-config.ts`) and the
optional utility slot (`utility-config.ts:29-33`, all-or-nothing, partial set = fatal).

In development that env comes from the repo-root `.env.local`, loaded by the run scripts:
`packages/core/package.json:8-9` → `node --env-file-if-exists=../../.env.local src/main.ts`.
There is no production launcher yet (D24, `deferred-decisions.md:52`, still OPEN: the Shell does not
spawn the Core).

**Is the keyring used for provider keys?** No. `apps/desktop/src-tauri/src/secrets.rs` is the ONLY
keyring integration in the repo. Service name `"TakiAgent"` (`secrets.rs:11`) with exactly two entries:
`"node-token"` (the node's WS credential) and `"device-id"` (`ws_client.rs:26`, `node.rs:29`). It is
**Rust-side, on the desktop node** — the Core (TypeScript, and OS-neutral by invariant 8) has no
credential-store client of any kind. Grep confirms zero keyring/credential usage in `packages/core`.

**The config store deliberately refuses secrets** (`config-writer.ts:38-40`):

```ts
if (knob.secret === true) {
  return refuse("secret", `${key} is a secret; it lives in the OS credential store, not the config table`);
}
```

and `config.list` reports a secret as `value: null` + `secretSet: boolean`, where `secretSet` is true
**only when the env var is set** (`config-source.ts:90, 94`). So today the panel can say "set / not
set" and nothing more, and "set" specifically means "present in the environment".

**What "edit your API key in the panel" would require, end to end:**

1. A secret backend usable from the Core. Invariant 8 says `packages/core` must run on Windows AND
   Ubuntu, so this must be an interface with per-OS backends (the architecture doc already anticipates
   "secrets behind a per-OS backend interface"). Options: a Node keytar-class dependency (new dep, needs
   an ADR-level check against the pinned stack), or routing through the Rust node's existing
   `SecretStore` over WS — which would be a new node-role method and would break on a headless
   Ubuntu Core with no node attached.
2. New WS methods — `config.setSecret` / `config.clearSecret` — that never echo a value back, plus a
   deliberate carve-out in `config-writer.ts` (which today refuses ALL secrets by design).
3. A read path at boot: `loadProviderConfig` currently only reads env. It would need to consult the
   secret store when the env var is absent, without ever logging the value.
4. Restart semantics: model slots are `apply: "restart"`, so even after all of the above, saving a key
   would not affect the running process.
5. Logging discipline audit — invariant 5 and the fatal-fast messages deliberately name the *variable*,
   never the value.

**Honest summary:** there is currently no path from a panel text field to a stored API key. The three
key knobs are visible-as-presence-only, and the presence flag reflects the environment, not a store.
Anything better than "type it into `.env.local` and restart" is a real backend batch, not a panel batch.

---

## E. Recommendation sketch (INPUT for the leader — not a design)

### Lands cheaply now (frontend only, zero new backend)

1. **Regroup existing knobs onto an "LLM & tools" page.** `config.list` already carries key, value,
   provenance, `input` hints, `apply` class and description; the page registry takes one row
   (`pages.ts:28-34`). A grouped view (model slots / context+compaction / agent loop) is pure
   presentation over data already on the wire. `TAKI_MAX_STEPS` is included for free — it needs no
   backend work at all, only a home on the new page.
   *Caveat worth surfacing in the UI:* every knob is honestly badged "restart to apply" because nothing
   in Core re-reads config after boot (`boot/core-bootstrap.ts` runs every loader once at module scope).
2. **A read-only "what tools exist" list.** The 16 rows in §B.1 are static facts about the build; a
   hard-coded informational table costs nothing and is honest, as long as it is clearly labelled as
   *"this build ships these tools"* and does not pretend to be live state or offer toggles that do not
   exist. (If it must be live, that becomes item 4 below.)
3. **Show the three API keys as set/not-set with an explicit "set via environment" hint.** This is
   already what `config.list` returns; the current flat settings page renders it. It just needs honest
   copy on the new page so users are not hunting for a text field that will refuse them.

### Needs a backend batch (roughly ascending cost)

4. **`skills.list` / `skills.setEnabled`** — the cheapest genuinely new method in the codebase.
   `SkillsState` already has `isDisabled`/`disable`/`enable`/`listDisabled` and persists atomically
   (`skills/skills-state.ts:20-37`); `skillsScan` has the name/description metadata (`main.ts:163-169`).
   This is a copy of the `memory-tidy.ts` 33-line factory pattern plus a shared schema. Note the
   enable flag only affects `renderList()` / `load_skill`; skills are discovered at boot, so a newly
   dropped-in skill folder still needs a restart.
5. **MCP read-only surface**: `mcp.list` returning per-server `{key, transport, connected, toolCount,
   toolNames}`. Requires `McpManager` to retain per-entry outcome (it currently discards the
   `allSettled` results after logging, `mcp-manager.ts:44-54`) — a small, contained change. This alone
   turns MCP from invisible into inspectable and is the highest value-per-line item on the MCP track.
6. **Approval prompt in the desktop UI**: register the `approval.request` route in the home window and
   render a dialog answering `approval.respond`. Backend already complete. **Without this, MCP is not
   usable from the product's own UI at all** (§A.7 item 1) — which makes it a prerequisite for MCP
   management being meaningful, not a nice-to-have after it.
7. **MCP write surface** (`mcp.add` / `mcp.remove` / `mcp.setEnabled`): needs a writer for
   `mcp-servers.json`, an `enabled` field added to the schema, and a decision on restart-vs-reconnect.
   Also the natural moment to close the ADR 0006 secrets divergence (§A.7 item 4) — or to explicitly
   re-ratify storing headers/env in the file.
8. **Permission surface** (`permission.levelGet/levelSet/cellsGet/cellSet`): schemas exist, the Rust
   projection function exists, and **everything in between does not**. This needs a Core↔node channel
   for governance that has never existed (today the node only *answers* capability requests), a Rust
   handler, a writer for `permission-level.json` with the `secondConfirm` floor guard enforced
   server-side, and a decision about the frozen-at-boot Level (changing it currently cannot take effect
   until the node restarts, by design — `gate.rs:116-121`). This is the largest item and it is a
   security surface; it deserves its own task, not a page batch.

### Risk ranking (highest first)

1. **Permission surface (item 8)** — it is the agent's own authorization boundary. A bug here is a
   privilege escalation, and the codebase currently defends it with a source-scanning test
   (`gate.rs:831-852`) that a careless implementation would trip. Also needs the "operator-role only"
   red line re-proved end to end.
2. **API keys in the panel (§D)** — touches invariant 5 and invariant 8 simultaneously, needs a new
   dependency or a new cross-process channel, and is easy to get subtly wrong (value echoed in a log,
   in an error message, or in a `config.list` response).
3. **MCP write surface (item 7)** — spawns operator-configured child processes; a panel that writes
   `command`/`args` is a remote-ish code execution surface by design, so input handling and the
   "operator-role only" boundary matter. The ADR-vs-code secrets gap should be closed or consciously
   re-ratified in the same batch rather than inherited silently.
4. **MCP read surface + desktop approval dialog (items 5, 6)** — low risk; the approval dialog is
   fail-closed by construction (broker timeout = deny) so a buggy dialog degrades to "denied", not
   "allowed".
5. **Skills methods (item 4)** — lowest risk; the state file is explicitly *not* auth state
   (`skills-state.ts:39-40`: worst case a skill re-enables).
6. **Knob regrouping (items 1–3)** — no new authority, no new data on the wire.

### My read on whether MCP server management belongs in v1 of an "LLM & tools" page

**No for add/edit/remove; yes for a read-only list — and only if item 6 (the desktop approval dialog)
ships alongside it.**

The reasoning is not about effort, it is about the page telling the truth. Today, an operator who adds
an MCP server through a panel would get: no connection feedback (connect happens at boot), a mandatory
restart with no in-app way to trigger one, tools that appear in the agent's set but that the agent
cannot actually call from the desktop UI because no approval handler exists, and secrets written in
plaintext to a JSON file that ADR 0006 says should be in the credential manager. That is a feature that
looks finished and is not, which is the specific failure mode `docs/deferred-decisions.md` exists to
prevent.

A read-only "MCP servers" card — server name, transport, connected yes/no, discovered tool count, and
an explicit "edit `mcp-servers.json` and restart" hint — is honest, costs one contained change to
`McpManager`, and gives the operator the one thing they most lack today: **confirmation that their
hand-edited config actually worked.** Right now the only signal is a log line.

Full CRUD becomes the right call once reconnect-without-restart and the approval dialog exist. Those
two are the real prerequisites, and both are separable, testable batches.

---

## Caveats / Not found

- **Not found**: any implementation of `permission.levelGet` / `levelSet` / `cellsGet` / `cellSet`
  beyond the shared schemas + tests. No Core registration, no Rust handler, no client call.
- **Not found**: any WS method for MCP, skills, exec-policy, audit trail, or capability enable/disable.
- **Not found**: any writer for `permission-level.json` or `exec-policy.json` anywhere in the repo —
  both are hand-authored operator files.
- **Not found**: any keyring/credential-store usage in `packages/core` (the keyring is Rust-side only,
  two entries, node identity).
- **Not found**: any `approval.request` handler in `apps/desktop/src` (CLI only).
- ~~**Not verified**: the approval broker's timeout~~ → **VERIFIED by the leader (2026-08-04)**, read in
  full: `approval-broker.ts:35` `DEFAULT_TIMEOUT_MS = 60_000`, armed per ask at `:59`, settling to
  `{approved:false, scope:"once", reason:"approval timed out"}` (`TIMEOUT_REASON`, `:36`). The header
  comment states the rule outright: "an operator who never answers is a deny, not a hang (ruling 3)".
- ~~**Not verified**: `DEFAULT_CONTEXT_TOKENS`~~ → **VERIFIED**: `context-config.ts:15` = `131072`.
- ~~**Interpretation, flagged as such**: §A.7 item 1~~ → **CONFIRMED AT THE CODE LEVEL by the leader
  (2026-08-04)**, and promoted from inference to fact. Two independent checks: (a) `apps/desktop/src`
  grepped for `approval|Approval|APPROVAL` → **zero matches** (repo-wide, the only client-side handler
  is `apps/cli/src/chat-client.ts`); (b) the broker's fail-closed timeout confirmed above. There is no
  ambiguity left in the chain: no desktop handler can answer, and an unanswered ask denies at 60 s.
  What remains unperformed is only the runtime observation (launching the app with a live MCP server
  and watching the 60 s deny) — it can only confirm what the code already determines, so this claim is
  safe to drive decisions. Concrete consequence for the operator: from the home window an unremembered
  MCP tool call looks like the agent stalling for a minute, then failing, with nothing shown in the UI.

## Related specs

- `docs/adr/0006-mcp-processes-vs-no-os-invariant.md` — the MCP carve-out from invariant 1
- `docs/adr/0002-exec-in-v1-behind-permission-gate.md` — exec crosses the gate without exception
- `.trellis/spec/backend/permission-authorization.md` — Level store is operator-role; `secondConfirm`
- `docs/deferred-decisions.md:100` — D36 supplement: agent may NEVER change permission config
- `docs/deferred-decisions.md:69` — D41: dir-root dialog hides "always"
- `docs/deferred-decisions.md:82` — D54: owner-called knob convergence (no automatic trigger)
- `docs/PRODUCT.md:43` — the product-level target for MCP + skills management in settings
