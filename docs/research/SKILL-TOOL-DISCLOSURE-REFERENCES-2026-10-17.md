# Skill tool progressive disclosure: reference evidence

Date: 2026-10-17. Scope: reference research for the T4 worktree. No production changes, dependency installation, runtime execution, paid model calls, Git changes, or task binding were performed by this researcher. The historical `.trellis/.current-task` pointer was preserved.

## Recommendation

Keep three things separate: **a Skill package describes a workflow; a tool registry owns executable definitions; disclosure determines which authorized definitions reach the model.** A Skill can bundle scripts and resources without introducing a new native tool. New model-callable tools need an existing extension/plugin/native registration mechanism or an MCP server.

For TakiAgent, first reuse the installed AI SDK's `prepareStep` / `activeTools` mechanism to reveal existing registered tools after Skill selection. Preserve the ordinary tool execution and policy path. An additional general-purpose script runtime or executable Skill tool-manifest format is not justified by these references.

If the existing product already has search/describe/call controls, reuse them instead: Hermes and OpenClaw demonstrate that model-independent pattern. Do not implement both patterns merely to match every reference.

## Evidence versions and limits

| Source | Verified identity | Evidence limit |
| --- | --- | --- |
| Local Pi | `@earendil-works/pi-coding-agent` and `pi-agent-core` **0.84.2** | Package declarations, not an upstream commit. Neither reference directory contains `.git`. Documentation contains native deferred-loading claims not corroborated by the inspected provider/loop source. |
| Local Hermes | `hermes-agent` **0.18.2** | `pyproject.toml:8-10`; no local `.git` identity. Python implementation is a design reference, not a reusable TypeScript dependency. |
| Installed TakiAgent dependencies | `ai` **7.0.17**, `@ai-sdk/mcp` **2.0.10** | Read from the installed package manifests and distributed types/source; no runtime or provider acceptance test performed. |
| Agent Skills, OpenClaw, Anthropic official docs | Read on **2026-10-17** | Live, unversioned documentation retrieved through Exa; retrieval date does not prove publication date or an exact implementation version. |

Version references: `references/pi-main/packages/coding-agent/package.json:2-3`, `references/pi-main/packages/agent/package.json:2-3`, `references/hermes-agent-main/pyproject.toml:8-10`, `packages/core/node_modules/ai/package.json:2-3`, `packages/core/node_modules/@ai-sdk/mcp/package.json:2-3`.

## What a standard Skill packages

The [Agent Skills specification](https://agentskills.io/specification) defines a required `SKILL.md` and optional `scripts/`, `references/`, `assets/`, or other files. It defines three disclosure levels: metadata, instructions, and resources loaded as needed. It does **not** define executable registration through a `tools.json`, exported handler, or automatic script-to-tool schema conversion.

| Need | Standard Skill support | Execution owner |
| --- | --- | --- |
| Describe a workflow and when to use it | `name`, `description`, Markdown instructions | Existing Skill reader and prompt assembly |
| Package executable helpers | Scripts in the package; instructions explain invocation | Existing shell/code execution tool and its Host/policy constraints |
| Package large references and templates | Referenced files loaded when needed | Existing file/resource reader |
| Add a named native function with input schema and handler | Not a standard Skill feature | Host extension/plugin/native tool registration |
| Access an external typed tool catalog | Skill may document its use | MCP client discovers schemas and calls the server |
| Grant operating-system, credential, or tool permissions | Not a portable Skill authority | Existing product policy and approval mechanisms |

`allowed-tools` is experimental and implementation-dependent in the specification. Although its description uses “pre-approved tools,” it must not be interpreted here as a grant of authority, proof that a tool exists, or a way to override Host policy. At most it can inform a compatibility or disclosure decision within already-authorized tools. Pi's inspected Skill loader retains name, description, body, path, and model-invocation visibility; it does not register executable handlers from that field (`references/pi-main/packages/agent/src/harness/skills.ts:30-40,269-296`).

Anthropic's [Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) makes the same distinction operationally: metadata starts in context, the agent reads `SKILL.md`, and script code need not enter context when an existing execution tool runs it. Claude API Skills specifically run through its code-execution container; that product integration is not a portable runtime implied by the Skill format.

## Pi: registry and active tool set are separate

The Skill flow is catalog metadata -> `read` the full `SKILL.md` -> follow instructions and relative resources. See `references/pi-main/packages/coding-agent/docs/skills.md:65-72` and the invocation formatter in `references/pi-main/packages/agent/src/harness/skills.ts:37-40`.

Native tools use an **extension**: `pi.registerTool({ name, description, parameters, execute })`. `pi.getAllTools()` returns all registered definitions and `pi.setActiveTools(names)` selects a model-visible subset. Concrete source confirms that unknown names are ignored, active tools come from the registry, and the system prompt is rebuilt (`references/pi-main/packages/coding-agent/src/core/agent-session.ts:908-953`).

The documented dynamic-loading sequence is directly relevant:

1. Register tools so the runtime has validated names, schemas, and handlers.
2. Initially expose a loader and a small ordinary tool set.
3. The loader adds matching registered names to the active set.
4. The next model request receives the newly active definitions.

Reference: `references/pi-main/packages/coding-agent/docs/extensions.md:2344-2377,2468-2479`. Its example uses keyword matching; it does not require embeddings, a separate interpreter, or a provider-specific search tool.

**Evidence caution:** those documentation lines also promise additive result-anchored deferred definitions and native Anthropic/OpenAI cache preservation. The inspected `agent-session.ts` proves registry/visibility separation, while `agent.ts:437-471` and `agent-loop.ts:226-245` expose a next-turn context preparation seam. Targeted inspection did not establish the documented native `defer_loading` / `tool_reference` wiring in this snapshot. Treat the native optimization as a documentary design reference, not as verified working Pi behavior or justification to import this snapshot. Provider-neutral next-request filtering is sufficient for the requested capability.

## Hermes: knowledge disclosure and tool disclosure are distinct

Hermes has two separate layers:

| Layer | Concrete implementation |
| --- | --- |
| Skill knowledge | `skills_list()` -> `skill_view(name)` -> `skill_view(name, file_path)` |
| Tool schemas | `tool_search` -> `tool_describe` -> `tool_call` for deferred MCP/non-core plugin tools |

Skill reads return the complete instructions, source path, and categorized linked files. The reader does not turn each listed script into a native tool (`references/hermes-agent-main/tools/skills_tool.py:1564-1576,1684-1715,1753-1759`; `references/hermes-agent-main/website/docs/user-guide/features/skills.md:130-141`).

`tools/tool_search.py` implements the second layer. Its default automatic threshold is 10% of the model context estimate; core tools remain directly visible. The current catalog is rebuilt from current tool definitions instead of maintaining a drifting session-global replica. Search returns bounded name/source/description entries; describe returns the exact parameters (`references/hermes-agent-main/tools/tool_search.py:1-26,529-581,595-657`). The numerical threshold is a Hermes product choice, not a requirement for TakiAgent.

The most useful invariant is at execution: `model_tools.py:1082-1144` rebuilds the catalog with the session's enabled/disabled toolsets, rejects an underlying name outside that scoped catalog, then routes `tool_call` through the ordinary `handle_function_call`. Hooks, approvals, and result handling continue to see the underlying tool. Copy this **authority boundary**, not necessarily the extra generic dispatch tool.

## MCP: discovery, publication, and execution

MCP schema acquisition and model disclosure are separate operations. An authenticated client can discover the authorized tool catalog without putting all schemas in a model prompt.

Hermes demonstrates the full path:

1. Check the server's advertised `tools` capability.
2. Call `tools/list`, following `nextCursor` to obtain the complete catalog.
3. Convert each tool's `name`, `description`, and `inputSchema` to the native registry shape, apply configured include/exclude filters, and register an execution wrapper.
4. On invocation, call the same server session's `call_tool(tool_name, arguments=args)`.
5. On `notifications/tools/list_changed`, refresh the server catalog under a lock.

Source: `references/hermes-agent-main/tools/mcp_tool.py:584-621,2768-2797,4773-4789,5021-5085,4174-4185`; notification contract: `references/hermes-agent-main/website/docs/user-guide/features/mcp.md:524-536`. Resources and prompts have separate capability-gated utility operations; they are not executable Skill files or automatically interchangeable with MCP tools.

The current installed TypeScript APIs already cover discovery and dispatch:

| Existing API | Reuse |
| --- | --- |
| `MCPClient.listTools({ params: { cursor } })` | Fetch a server catalog page with schemas. Follow cursors explicitly when complete discovery is required. |
| `MCPClient.toolsFromDefinitions(definitions)` | Reuse SDK conversion/execution wrappers for an already-acquired catalog without another fetch. |
| `MCPClient.tools()` | Convenience acquisition plus conversion; in installed 2.0.10 it makes one `listTools()` request. |
| `MCPClient.callTool({ name, arguments, options })` | Existing MCP `tools/call` path; preserve runtime ownership and policy wrappers around it. |
| AI SDK `prepareStep` -> `{ activeTools }` | Select registered tools for each model step. Reveal a Skill's relevant tools on a following request. |
| AI SDK `tool`, `dynamicTool`, `jsonSchema`, `ToolSet` | Existing native definitions and schema wrappers; no additional tool runtime is needed merely for disclosure. |

Verified installed evidence: `packages/core/node_modules/@ai-sdk/mcp/dist/index.d.ts:637-680`; `dist/index.js:2387-2395,2414-2429,2527-2538`; `packages/core/node_modules/ai/dist/index.d.ts:8,1621-1685`; its `dist/index.js:2990-2996,5258-5268` explicitly filters the tool map before preparing provider tools. These installed-file references are verification evidence, not files to edit or vendor.

Do not claim automatic pagination or list-change refresh from `@ai-sdk/mcp@2.0.10`: the inspected `tools()` implementation reads one page, and the inspected client contains no `notifications/tools/list_changed` handler. A product-owned generation/reload mechanism must remain authoritative unless a concrete supported adapter is already present.

## Current official designs and portability

- [OpenClaw tools overview](https://docs.openclaw.ai/tools): a Skill teaches workflows with existing capabilities; a plugin adds an integration or runtime surface.
- [OpenClaw plugin tools](https://docs.openclaw.ai/plugins/agent-tools): typed `api.registerTool(...)` supplies native schema and execution. Plugin manifests declare ownership/activation. That manifest belongs to the **plugin**, not the Agent Skills format.
- [OpenClaw Tool Search](https://docs.openclaw.ai/tools/tool-search): the current structured controls are `tool_search`, `tool_describe`, and `dispatch_action`. They operate against a policy-filtered catalog and use normal execution. This differs from the local Hermes name `tool_call`; do not copy names across snapshots without checking.
- [OpenClaw Skills](https://docs.openclaw.ai/tools/skills/): `skills_search` and `skills_read` use the eligible session catalog. Search neither installs a Skill nor grants permission to execute its commands. Skill discovery remains separate from tool discovery.
- [Anthropic tool search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool): native deferred tools use `defer_loading: true` and `tool_reference` blocks. In the documented server-side pattern, every definition is still supplied to the API while only selected ones enter model context. This is **context deferral**, not proof of lower client request bytes or lazy MCP network discovery. It is a provider-specific optimization; retain ordinary filtered tool lists for other providers.

## Implementation criteria for the owning agent

1. Associate Skills with existing tool identities through an already-supported product mechanism. Where a Skill has only scripts, preserve the existing shell/script invocation model. Do not silently invent executable frontmatter or infer new authority from `allowed-tools`.
2. Compute disclosure from the current Run/Host's authorized catalog. Retain existing generation, cancellation, approval, and execution ownership; never search a broader process-global registry then authorize by visibility alone.
3. At first request, keep the catalog/loader and required ordinary tools available. After selection, use the existing step preparation to expose exact authorized definitions. No shared global mutable active set across concurrent Runs.
4. Exercise an offline two-step scenario: initial payload omits a deferred schema, selection succeeds, following payload includes it, and invocation follows the ordinary handler. Also check unknown/denied names, missing dependencies, and cross-Run isolation.
5. Treat native provider deferred loading, generic dispatch bridges, embedding search, and new plugin package formats as optional follow-ups only when a concrete current limitation requires them.

### Application to the proposed TakiAgent integration

The owning agent's proposed split fits these references: successful full `load_skill` can reveal a small, cohesive, product-registered Core tool bundle; `extension_describe` can reveal one selected MCP tool on the next step. In both cases the existing tool schemas can go through AI SDK `activeTools`, so the disclosure tool need not duplicate full schemas in its text result. This is an application recommendation, not a claim that Pi or Hermes implements those exact TakiAgent tool names.

Bundle ownership must come from trusted product registration bound to the captured Skill identity/source/revision. An arbitrary file, matching display name, or frontmatter field must not register handlers. A successful current-Run/current-generation full Skill read may change disclosure within existing authorization; failed reads, resource-only reads, stale transcript entries, or loads in another Run must not activate the bundle. Preserve the ordinary policy checks and bound MCP execution closures. Prefer the whole small bundle on Skill load to avoid an unnecessary second lookup; keep MCP disclosure per-tool to avoid revealing an unrelated external catalog.
