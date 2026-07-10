# PRD — MCP client (stdio + HTTP) with approval stub + Skills loader

**GitHub issues**: #8 + #9 merged (M2). Parent: #1. Blocked by: #3 (DONE).
**Trellis task**: `07-10-mcp-and-skills`
**Research** (all verdicts empirically probed — trust them over memory): `research/ai-sdk-mcp-client.md`, `research/v7-tool-approval.md`, `research/skills-loader.md`

## 1. Goal

Two pluggable extension surfaces for the agent loop:

- **MCP client** (#8): core connects at boot to operator-configured MCP servers (stdio + Streamable HTTP via `@ai-sdk/mcp@2.0.10`), discovered tools join the per-turn ToolSet under namespaced keys. Every MCP tool call passes an **approval gate** (v7 native `toolApproval`) that asks the operator CLI over WS and remembers decisions per server+tool (once / session / always / never).
- **Skills loader** (#9): `SKILL.md` folders discovered under the skills root; name+description listed cheaply in system context; full body lazy-loaded via a `load_skill` tool; per-skill enable/disable persisted.

## 2. Leader rulings (settled — do not re-litigate)

1. **Approval mechanism = v7 native `toolApproval`** (generic async fn form on ToolLoopAgent). Probed: awaiting a WS round-trip inside the fn and returning `'approved'`/`{type:'denied', reason}` keeps everything in ONE `stream()` call; on deny the SDK feeds the model `execution-denied` + reason automatically. Do NOT use `'user-approval'` (stop/resubmit — wrong fit) and do NOT hand-wrap execute for approval. The existing text-delta pump in chat-agent stays untouched (approval parts flow through `result.stream` and are ignored there).
2. **WS leg = Option B** (research §2): no envelope changes. Shared gains `APPROVAL_METHODS` + `ApprovalRequestSchema` `{approvalId, serverName, toolName, input}` + `ApprovalRespondParamsSchema` `{approvalId, approved, scope: 'once'|'session'|'always'}`. Core sends `approval.request` as a **notification** via the asking turn's `ctx.notify`; CLI answers with a normal `approval.respond` request (operator role). Correlation via pending `Map<approvalId, resolver>` in an ApprovalBroker.
3. **Timeout = deny** (fail-closed): 60 s, reason `"approval timed out"`. `ctx.onClose` denies all pending immediately. Late/unknown `approval.respond` → `{accepted:false}`, never an error (post-timeout responses are normal).
4. **Decision memory**: `deny+always` = `never`. `always`/`never` persist to `<dataDir>/mcp-approvals.json` (paired-device-store pattern: zod file schema, atomic temp+rename); `session` = in-memory map (core lifetime); `once` = not stored. Persisted `always` → no ask; `never` → auto-deny without ask.
5. **Approval scope**: MCP tools ONLY. Internal tools (memory_*, load_skill) bypass — the generic fn returns the no-approval status for names not in the MCP set (verify exact status literal, `'not-applicable'` vs `'approved'`, against installed `AI_DTS` before coding).
6. **MCP config** = operator file `<dataDir>/mcp-servers.json` (zod: record of serverKey → stdio `{command, args?, env?, cwd?}` | http `{url, headers?}`). Missing file = zero servers, normal boot. Malformed file = structured boot warning + zero servers (MCP is an extension — never kills the companion; contrast devices.json which is auth state and stays fatal). No LLM-reachable path touches this file (AC #8-2).
7. **Connect at boot**, `Promise.allSettled`; a failing server → `log.warn` + skipped, others live (AC #8-5). Cached aggregated ToolSet served per turn; no per-turn rediscovery; refresh = core restart (list_changed unsupported by lib — research caveat). Close all clients in the shutdown chain.
8. **Namespacing**: ToolSet key = `${serverKey}_${toolName}` (serverKey sanitized `[a-zA-Z0-9_-]`); key rename is safe — execute closes over the raw name (probed). Collisions after namespacing: last-wins + warn.
9. **Execute wrapping**: spread-and-replace each MCP tool's execute with try/catch → `{ok:false, code, message}` (research §5; MCPClientError.code preserved). `isError:true` results pass through as-is (already model-readable).
10. **Skills**: root `<dataDir>/skills/<name>/SKILL.md`. Lazy-load via `load_skill(name)` tool mirroring memory-tools conventions (execute never throws; closed local error codes `NOT_FOUND | DISABLED | IO_ERROR`). Skills list enters context **in chat-agent instructions composition** — `[memory.assemble(...), skills.renderList()].join("\n\n")` — NEVER through the memory assembler (module boundary). Empty list → `renderList()` returns `""` (no section).
11. **Frontmatter parser reuse** with the one-char relaxation: `KEY_RE` in `memory/frontmatter.ts` gains `-` (hyphenated keys like `allowed-tools` must not invalidate a file). Memory keys are hyphen-free — no conflict; keep all existing frontmatter tests green. Single-line `description` only in v1 (block scalars → skip-with-warning). `allowed-tools` parsed-and-ignored.
12. **Skill validity**: required `name` (kebab, must equal directory name) + `description`. Scanner returns `{skills, invalid}` mirroring #6 ReconcileStats; boot logs invalid list; never crashes.
13. **Enable/disable**: `<dataDir>/skills-state.json` `{disabled: string[]}`, default-enabled, paired-device-store pattern. Disabled skill: excluded from `renderList()` AND `load_skill` returns `{ok:false, code:"DISABLED"}`. Skill dirs stay pristine (never write into them).
14. **ADR 0006 carve-out**: our code never imports `node:child_process`; the spawn lives inside `@ai-sdk/mcp`. Enforcement shape: only `packages/core/src/mcp/` may import `@ai-sdk/mcp` / `@ai-sdk/mcp/mcp-stdio` (document in mcp/index.md; grep-verifiable). Windows note in config docs: stdio `command` must be a real exe (`node`) or `cmd /c npx ...` — shell:false.
15. **M3 seam**: ApprovalBroker + approval-schema are the exact surface the Permission Gate will reuse (decision fn body swaps WS-ask for Rust gate). Keep the broker MCP-agnostic: it brokers `{serverName, toolName, input}` asks, knows nothing about MCP clients.

## 3. File map

```
packages/shared/src/approval-schema.ts (+test)        # APPROVAL_METHODS + request/respond schemas; export via index.ts
packages/core/src/mcp/mcp-config.ts (+test)           # mcp-servers.json load/validate (missing→[], malformed→warn+[])
packages/core/src/mcp/mcp-manager.ts (+test)          # connect all, namespace, wrap execute, aggregate ToolSet, closeAll
packages/core/src/mcp/index.md
packages/core/src/approval/approval-broker.ts (+test) # pending map + timeout race + onClose deny; MCP-agnostic
packages/core/src/approval/decision-store.ts (+test)  # mcp-approvals.json (always/never) + session map + resolve()
packages/core/src/approval/index.md
packages/core/src/server/methods/approval-respond.ts (+test)   # operator-role registry method → broker.resolve
packages/core/src/skills/skill-scanner.ts (+test)     # discover + validate → {skills, invalid}
packages/core/src/skills/skills-state.ts (+test)      # skills-state.json
packages/core/src/skills/skills-loader.ts (+test)     # renderList() + load(name) honoring state
packages/core/src/skills/load-skill-tool.ts (+test)   # the tool(); thin over loader
packages/core/src/skills/index.md
packages/core/src/memory/frontmatter.ts               # EDIT: KEY_RE hyphen relaxation (+test row)
packages/core/src/agents/chat-agent.ts                # EDIT: tools merge (memory+skills+mcp), instructions compose,
                                                      #       toolApproval fn, stream() gains a per-turn notify/onClose handle
packages/core/src/server/methods/chat-send.ts         # EDIT: pass ctx handle into stream()
packages/core/src/main.ts                             # EDIT: wire mcp-manager + broker + skills; shutdown closeAll
packages/core/src/testing/mcp-fixture.mjs (or fixtures/ dir)   # 3-method stdio fixture (research §4a, plain .mjs)
apps/cli/src/approval-prompt.ts (+test)               # render ask, parse answer → {approved, scope}
apps/cli/src/chat-client.ts                           # EDIT: approval.request handler → prompt → approval.respond
```

Headers + index.md everywhere touched. All prompts/CLI copy are why-commented string constants.

## 4. TDD plan (mock model + in-memory MCP transport for units; ONE real-spawn integration test)

| Cycle | Tests |
| --- | --- |
| A shared | T1 approval schemas: valid parse, bad scope/missing id rejected; methods constants |
| B mcp config | T2 missing file → `[]`; malformed JSON / bad shape → warn + `[]` (boot survives); valid stdio+http parse |
| C mcp manager | T3 discovery via **in-memory custom transport** (copy mock-mcp-transport pattern, research §4c): tools namespaced `${serverKey}_${toolName}`; T4 execute wrap: JSON-RPC error → `{ok:false, code:-32601,...}`; T5 one server connect-fails → warn + others live; T6 **stdio integration**: spawn fixture .mjs via `process.execPath`, initialize→list→call end-to-end; T7 http fixture via node:http (POST 200 / notif 202 / GET 405); T8 closeAll idempotent |
| D approval | T9 broker: ask → notification payload correct → resolve(approved) → `'approved'`; T10 timeout → denied `"approval timed out"`; T11 decision-store: `always` skips ask, `never` auto-denies, `session` survives across asks but not across store instances, `once` not remembered; T12 onClose → all pending denied; T13 approvals file round-trip + malformed file → warn + empty (approvals are re-askable, not fatal) |
| E chat loop | T14 ToolLoopAgent + mock model calling an MCP tool: approval fn invoked with toolName; deny → model's next call sees `execution-denied` (probe pattern, research §1 B); T15 memory/load_skill calls NEVER hit the broker; T16 existing chat-agent tests stay green (new deps optional) |
| F skills | T17 scanner: valid discovery; name≠dir → invalid; missing description → invalid; malformed frontmatter → invalid; `{skills, invalid}` shape; T18 frontmatter: hyphenated key parses now + ALL existing memory frontmatter tests untouched; T19 renderList lists enabled only, `""` when none; load returns body; NOT_FOUND / DISABLED codes; T20 skills-state round-trip, default-enabled |
| G method | T21 approval.respond: operator-gated (node role → FORBIDDEN), resolves pending, unknown/late id → `{accepted:false}` |
| H cli | T22 approval-prompt: answer mapping (y/s/a/d/n → approved+scope), invalid answer re-prompt |

## 5. Constraints (restate to agents verbatim)

Standing engineering standards: INPUT/OUTPUT/POS headers, index.md per touched dir, TS ≤300 lines/fn ≤50/params ≤3, kebab-case, closed error unions, why-only comments, pino logs carry ids/counts NEVER content (skill bodies, tool inputs are content — log names/lengths only. Exception: the approval ask must show the operator the tool input — that goes in the WS frame to the CLI, not in core logs). Zero new npm deps. Never code `@ai-sdk/mcp` / `ai` APIs from memory — the research files cite installed `.d.ts` lines; verify anything beyond them against `node_modules`. `fs` access only via the established config/dataDir patterns (mcp/skills/approval state files are core-owned dataDir state — same sanction class as devices.json; skills dirs are read-only). All 282 existing tests stay green. If you boot the core for a sanity check: non-default `TAKI_WS_PORT`, kill the process tree afterwards.

## 6. Verification

```bash
pnpm -r typecheck && pnpm lint && pnpm -r test
```

Leader live smoke: fresh dataDir → `mcp-servers.json` pointing at the stdio fixture + a node:http fixture → boot core (direct node, port pre-check) → pair CLI → ask the model to use an MCP tool → CLI approval prompt appears → approve `always` → tool runs; restart core → same ask → NO prompt (persisted); deny path → model gracefully reports denial; kill the stdio fixture config → boot degrades with warning; drop a skill folder → list appears in a turn, model `load_skill`s it live.

AC mapping (#8): AC1←T3/T6/T7+smoke · AC2←ruling 6 (grep: no tool writes config) · AC3←ruling 14 grep · AC4←T9-T13+smoke · AC5←T5+smoke · AC6←cycles C/D. (#9): AC1←T17+smoke · AC2←T19 (lazy: body only via tool) · AC3←T19/T20 · AC4←T17 · AC5←cycle F.
