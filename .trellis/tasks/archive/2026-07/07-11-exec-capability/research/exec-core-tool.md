# Research: exec core-side tool (`exec-tool.ts`)

- **Query**: core-side exec-tool input schema (bare string vs argv), output mapping to the model, error codes, registration
- **Scope**: internal (core capability tools + shared schemas + wire error union)
- **Date**: 2026-07-11

## Verdict (read first)

1. **Input schema: `{ command: string }` (bare string), NOT `{ argv: string[] }`.** A bare command is the natural agent affordance (the model emits `"git status"`, not `["git","status"]`), and it keeps ALL parsing on the Shell side where the security boundary lives (exec-parser.md). If the core pre-split into argv, the core would be doing security-relevant tokenization outside the gate — wrong layer, and it would let a caller bypass the parser by hand-crafting argv. **The Shell parses the one true string.** Flag as a design decision but the recommendation is firm and invariant-aligned.
2. **exec mirrors the existing Shell-tool shape exactly** (`shell-open-tool.ts`): a `create*Tool(deps)` factory returning `ToolSet`, `execute` NEVER throws, routes via `routeCapability(deps, "exec", input)`, parses the opaque output with its own zod schema, returns a structured result. One module + one registry entry (invariant 7).
3. **Error codes: add NOTHING to the wire `CapabilityErrorCode` union.** The wire union stays `DENIED | EXEC_FAILED | UNSUPPORTED_CAPABILITY`. A blocked command = `DENIED` (or `EXEC_FAILED` with a "blocked" message — see below). A nonzero exit / timeout is NOT a wire error — it is a **successful capability execution** whose OUTPUT struct carries `exitCode`, `timedOut`, `truncated`. The model needs to SEE stderr + exit code to reason; folding them into `EXEC_FAILED` would hide the output. **Recommend: nonzero-exit and timeout ride in the Ok output payload, not the error union.**

## Findings

### The tool shape to mirror

`packages/core/src/capabilities/shell-open-tool.ts` is the template:
- `export function createExecTool(deps: ExecToolDeps): ToolSet` where `ExecToolDeps = CapabilityRouteDeps & { logger: Logger }`.
- `execute` wraps everything in try/catch, returns `{ ok:false, code:"INTERNAL_ERROR", message }` on an unexpected throw (never propagates — the LLM must always get a readable structured result; CLAUDE.md working rule: "a failing tool call must degrade into a structured error the LLM can read, never a crash").
- On the happy path: `const routed = await routeCapability(deps, "exec", { command }); if (!routed.ok) return routed; const output = ExecOutputSchema.parse(routed.output); return { ok:true, ...mapped };`
- Logging is metadata-only (`log.info({ /* NOT the command */ }, "exec ran")`) — the command is content; mirror shell-open which logs `{ kind }` not the target.

`routeCapability` (`route-capability.ts`) already handles NO_NODE + broker outcomes and never throws; exec reuses it unchanged. The broker (`capability-broker.ts`) already carries the opaque output through (Option A). NO core-side changes to the broker/route/registry channel are needed — exec is purely additive (invariant 7 confirmed by #11's generalization to opaque `Value`).

### Input schema

```ts
inputSchema: z.object({ command: z.string().min(1) })
```
- Bare string. Rationale above. Mirror in Rust: the Shell's exec `CapabilityExec::run` reads `input["command"].as_str()` (like shell_open reads `kind`/`target` in `parse_target`), and its `detail(input)` returns the command for the ESCALATE dialog (exactly as shell_open's `detail` surfaces the target — `shell_open.rs:43`).
- **Flag:** `{command:string}` shifts 100% of parsing to the Shell. That is the correct security posture (single parse, at the boundary), but it means the core tool cannot validate the command's safety at all — it is an opaque pass-through. Confirm this is intended (it is, per exec-parser.md).

### Output schema (new entry in `capability-outputs.ts`)

Mirror the sandbox output shape (exec-sandbox.md) as a zod schema + a Rust serde struct + a golden fixture (the #10/#11 cross-language double-assert pattern — `protocol.rs:240` reparse table + vitest schema):
```ts
export const ExecOutputSchema = z.strictObject({
  exitCode: z.number().int().nullable(),   // null when killed (timedOut / cap)
  stdout: z.string(),                       // content — never logged
  stderr: z.string(),
  truncated: z.boolean(),
  timedOut: z.boolean(),
  durationMs: z.number().int().nonnegative(),
});
```
- `stdout`/`stderr` are content (may contain secrets the command printed) → never enter a core log, same treatment as clipboard text / screenshot data.
- Add a matching golden fixture under `packages/shared/fixtures/protocol/exec-output.*.json` and a `"exec-output"` arm in `protocol.rs` `reparse()` so the cross-language round-trip trap covers it (the mechanical anti-drift guarantee #10 established).

### Error-code mapping (no wire-union change)

| Situation | Surfaced as | Why |
|---|---|---|
| Command auto-run or approved, ran, exit 0 | Ok output, `exitCode:0` | normal |
| Ran, exit ≠ 0 | **Ok output**, `exitCode:N`, stderr populated | the model must read stderr/exit to reason; NOT an error |
| Timed out (killed) | **Ok output**, `timedOut:true`, `exitCode:null` | a result, not a failure — the model learns it hung |
| Output over cap | Ok output, `truncated:true` | a result flag |
| Policy BLOCK (catastrophic) or `deny` mode | wire `DENIED` | user/policy refused; same as a gate deny |
| ESCALATE dialog → user denies / timeout | wire `DENIED` | existing gate deny path |
| Spawn failed (program not found, etc.) | wire `EXEC_FAILED` | genuine execution failure (`ExecError::failed`, `capabilities_impl.rs:25`) |
| Unknown capability | wire `UNSUPPORTED_CAPABILITY` | registry miss (existing) |

**Recommendation: do NOT add `BLOCKED` / `TIMED_OUT` / `NONZERO_EXIT` to the wire union.** `TIMED_OUT`/`NONZERO_EXIT` belong in the output struct (they are successful executions with informative results). `BLOCKED` folds into `DENIED` (a refusal is a refusal from the model's perspective; the message text can say "blocked by policy"). This keeps the closed union stable (invariant 3 — the union is shared + serde-mirrored; every addition touches Rust + zod + fixtures) and matches how #11 kept the union at three by folding capability-specific failures into `EXEC_FAILED` + output fields.

- **Minor flag:** if the leader wants the model to *distinguish* a policy-block from a user-dialog-deny, a distinct `BLOCKED` code would do it — but that is a wire-union change (Rust enum + zod enum + fixtures + the round-trip test). Recommend against for v1; the message string differentiates them adequately.

### Registration (invariant 7 — one module + one entry)

- **Core:** new file `packages/core/src/capabilities/exec-tool.ts` exporting `createExecTool`; wired wherever the other capability tools are assembled into the agent's ToolSet (same site as `createShellOpenTool`). Update `packages/core/src/capabilities/index.md`.
- **Shell:** new file `apps/desktop/src-tauri/src/capabilities_impl/exec.rs` (the parser + policy + spawn, or split into `exec/parser.rs` + `exec/sandbox.rs` per the no-mod.rs / size-cap rules — the parser alone will approach the 300-line TS / 500-line Rust caps given its test tables, so splitting is likely required). Register with one `handlers.register(Arc::new(ExecExec))` in `lib.rs:92-97` and one `"exec"` entry in the `capabilities` vec (`lib.rs:106-112`).
- **Rust output struct** in `protocol.rs` next to the other `*Output` mirrors; **wire error union unchanged**.

### External References (internal)

- `packages/core/src/capabilities/shell-open-tool.ts` — the tool factory template (execute-never-throws, route→parse→return).
- `packages/core/src/capabilities/route-capability.ts` + `capability-broker.ts` — the shared route/broker exec reuses unchanged (opaque output already generalized in #11).
- `packages/shared/src/capability-schema.ts:25` — the closed `CapabilityErrorCodeSchema` (`DENIED|EXEC_FAILED|UNSUPPORTED_CAPABILITY`) to leave unchanged.
- `packages/shared/src/capability-outputs.ts` — where `ExecOutputSchema` joins (Option A, one schema per capability).
- `apps/desktop/src-tauri/src/capabilities_impl/shell_open.rs:43-54` — the `detail(input)` pattern exec copies to surface the command to the ESCALATE dialog.
- `apps/desktop/src-tauri/src/lib.rs:92-112` — the one-register-call + one-capability-vec-entry wiring (invariant 7).
- `apps/desktop/src-tauri/src/protocol.rs:240-247` — the `reparse()` golden-fixture table exec-output must be added to (cross-language anti-drift).

## Caveats / Not Found

- The exact assembly site where core capability tools are combined into the agent ToolSet was not opened in this pass (shell-open-tool exports a factory; the caller that registers it lives in the agent/tools wiring). Implement-time should grep for `createShellOpenTool(` to find the single registration point and add `createExecTool` alongside it.

## Leader decisions needed

1. **Input: `{command:string}` vs `{argv:string[]}`** — recommend bare `{command:string}` (single parse at the Shell boundary; argv would move security-relevant tokenization to the core). Firm recommendation; confirm.
2. **Wire error union: leave at three?** — recommend YES (nonzero-exit + timeout → Ok output fields; block → `DENIED`). Adding `BLOCKED`/`TIMED_OUT` is a schema+serde+fixture change; recommend against for v1. Confirm whether the model needs to distinguish policy-block from user-deny (the only reason to add `BLOCKED`).
