# Exec invocation guidance review

Date: 2026-11-04. Workspace: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`.
Reviewed working tree: `cd3cd91b51d299d82c808b324d60284711314e6c` plus the uncommitted Exec guidance changes.
The approved pilot and delivery report use checkpoint `d1c7067`; the intervening delegation work was preserved.

## Findings (fixed)

None. The reviewed description and local index match the current implementation. No production source was changed
by this review; the only reviewer-owned change is this report.

## Findings (not fixed)

None within the assigned Exec guidance scope. Future invocation quality and net savings are unmeasured outcomes,
not established defects in this change. The parent owns final workspace checks and the separate Avatar experiment.

## Scope and requirements

The original goal is lower unnecessary model/token cost while preserving capability, quality and first-call
correctness without overdesign. This approved slice changes only `packages/core/src/capabilities/exec-tool.ts`
and its entry in `packages/core/src/capabilities/index.md`. It improves truthful invocation guidance rather than
adding a command-repair mechanism, execution options, prompt layer or new tool dependency.

The reviewer read the active task PRD/check context, the relevant tool/permission contracts,
`research/pilot-plan-20261104.md` and `research/exec-guidance-delivery-20261104.md`. The global `.current-task`
still points to `09-03-avatar-presentation-lab`, whose PRD is absent here. The explicit current-session assignment
selects this task; the global pointer was left untouched.

## Concrete code checks

| Claim or invariant | Current implementation and result |
| --- | --- |
| One command string, no implicit shell | `exec-tool.ts:28` retains the single-string schema. `exec/parser.rs:33` tokenizes it; `exec/sandbox.rs:61` rejects `Complex` before spawning. `Command::new` receives the resolved executable and `.args` receives the remaining tokens. Approval supplies no interpreter. |
| Quoted arguments, literal backslashes | `exec/parser.rs:41` and `:49` group single/double quoted content; the other characters, including backslashes, are retained. The example's entire pipe expression is one interpreter argument. No POSIX escape or variable expansion is promised. |
| Trusted PATH excludes cwd | `exec/resolve.rs:32` filters the configured cwd and literal dot from bare-name lookup. `exec/sandbox.rs:104` uses the resulting absolute path, or returns the actionable missing-program error. Explicit path-qualified targets retain the existing absolute/relative handling; the description does not claim relative paths are forbidden. |
| Fresh process and configured cwd/environment | `exec/sandbox.rs:77` creates a new process, sets configured cwd and null stdin; `:88` clears inherited environment and copies only allowlisted Host keys. `ExecPolicy::load` owns cwd selection. Invocation-local cwd/env changes cannot mutate a later invocation. This does not claim isolation from filesystem or other external effects. |
| Policy may allow, require approval or refuse | The live route remains `exec-tool.ts:32` to `route-capability.ts:57` and the broker. Current Host code uses `ws_client.rs:615` for trusted classification plus the captured Core projection and stricter local constraints. `ws_client.rs:339` rechecks immediately before handler execution; approved resume also rechecks at `:666`. The description avoids the obsolete claim that every non-allowlisted command must always ask. |
| Cross-platform and Host scoping | `node.rs:68`/`:110` registers the same Exec handler used by desktop `lib.rs:163` and headless `bin/taki-node.rs:32`. The PowerShell example is explicitly Windows-only and conditional on installation; Git is likewise conditional. No Bash, pwsh, persistent shell, background handle, universal interpreter availability or copied timeout default is promised. Linux execution was not observed. |
| Read result fields rather than `ok:true` alone | `exec/sandbox.rs:115` returns the captured exit/status fields. Nonzero exit is retained; timeout/output overflow return a null exit with the relevant flags. `exec-tool.ts:34` parses and returns those fields without changing them. A spawn/structural/governance failure remains a failure. |
| No unavailable sibling-tool dependency | Dedicated file tools are preferred only "when available". The description names no sibling tool or activation path and adds no tool requirement. |
| Execution and retention unchanged | The source diff contains only the concatenated description; the index diff changes one role entry. The opaque schema, route, handler, result shape, logs, permissions and retention are unchanged. Production Exec Rust sources have no diff from `d1c7067`. |

The existing module-contract header still describes the unchanged pass-through/never-throw responsibility.
The local index was updated. The parent-owned `tool-design.md` working change already records the same truthful
Host invocation contract; no additional spec modification was needed from this review.
The changed definition reaches actual tool assembly: `main.ts:521`/`:526` supply the capability factory to the
Agent's extra/interactive bags; `agent-tool-assembly.ts:33` merges those tools before disclosure and SDK construction
in `agent-attempt.ts:124`. The description is not confined to an unused registration.

## Fixture evidence reviewed

The reviewer inspected `target/exec-guidance-20261104/verify-exec-guidance.rs`, `execution-evidence.txt` and
`description-size-and-sources.json`; the fixture was not rerun. It imports the production parser, resolver and
sandbox with `#[path]`, with only surrounding holder types supplied by the fixture. SHA256 comparison confirmed
all three recorded source hashes still match current files.

Representative assertions and the recorded successful run cover:

- Exact `git --version` and Windows PowerShell examples, including the pipe script as one argv element.
- Compound/no-shell rejection before spawn and a deliberately missing executable's actual resolver failure.
- A quoted executable under a path with spaces, arguments containing spaces/literal metacharacters/backslashes.
- Fresh cwd/environment and an excluded inherited sentinel across separate subprocess invocations.
- A real nonzero exit, timeout and output cap retaining their `ExecOutput` fields.

This is real Windows subprocess evidence from the implementer, not a mocked tokenizer. It does not exercise the
live Permission Gate, Tauri/WebSocket transport, another Host or a real model's invocation decisions. Current
permission/dispatch wiring was verified statically from source rather than inferred from fixture success.

## Verification

- **Lint: pass for the reviewed source.** Reviewer ran
  `pnpm exec eslint packages/core/src/capabilities/exec-tool.ts` successfully.
- **TypeCheck: pass for Core.** Reviewer ran `pnpm --filter @taki/core typecheck` successfully.
- **Whitespace: pass.** Reviewer ran
  `git diff --check -- packages/core/src/capabilities/exec-tool.ts packages/core/src/capabilities/index.md`.
- **Tests: existing targeted evidence passes.** The implementer's delivery record reports Exec routing tests
  **3/3** passed; the source confirms opaque pass-through, retained timeout/truncation result and never-throw
  governed denial coverage. The recorded Rust fixture passes the representative probes above. No prose-freezing
  test was added and no test suite was repeated by the reviewer for this description-only change.
- **Parent workspace gates:** parent reported workspace typecheck, Clippy and full Rust tests passed. Root lint
  has the pre-existing `artifacts/runtime-inbox-preimages-20261025` line-limit failure. The initial full TypeScript
  Core invocation had **19 failed / 4,554 passed / 6 skipped**, with asynchronous/time-limit failures across 12
  unrelated files. The parent reran those 12 files with `--maxWorkers 2`: **101/101 passed**, without code or test
  changes. Shared **727**, Desktop **1,369** and CLI **50** tests passed; Rust **204 library + 7 binary = 211** tests
  passed. These reports are not new reviewer executions. The lower-concurrency recovery is recorded separately
  from the initial failing invocation; root lint remains an unrelated workspace failure.

## Cost and delivery limits

The recorded description-only local estimate grows **78 to 266 units (+188)**, from 311 to 1,062 UTF-16 units.
The script measures evaluated TypeScript string literals using the existing estimator; these are not provider
token counts or full-schema request costs. The added guidance recurs when disclosed and can initially disrupt a
cached prefix. This explicit instruction-cost increase is accepted within the approved pilot to address observed
compound/no-shell and missing-program mistakes. No equivalent-task real-model comparison establishes improved
first-call correctness, fewer corrections, lower total cost or general savings yet.

This review made no model call, live data change, service restart, commit, push, archive or task-state change.
Avatar and unrelated delegation artifacts remain outside the reviewed production diff. Manual owner acceptance
and eventual natural-use quality/cost evaluation remain separate from these automated/static checks.
