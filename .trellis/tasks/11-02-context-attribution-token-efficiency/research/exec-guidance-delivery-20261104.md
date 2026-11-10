# Exec invocation guidance delivery

Date: 2026-11-04. Baseline: `d1c7067`. Scope follows [the approved pilot](pilot-plan-20261104.md) and [the execution investigation](long-command-analysis-20261104.md).

## Delivered change

`packages/core/src/capabilities/exec-tool.ts` now describes executable-plus-arguments invocation on the selected Execution Host, rather than promising a shell. It explains the single-string input, trusted-PATH lookup excluding cwd, corrected invocation after a missing program, quoted paths/arguments, literal backslashes, and an explicit installed interpreter for shell syntax. Each invocation starts at the Host's configured cwd with a scrubbed environment; cwd/environment changes do not survive into later calls. Dedicated file tools are preferred only when available.

The description also states that current policy can allow, require approval or refuse execution, that approval does not supply a shell, and that `ok:true` alone does not prove command success. Nonzero exit, timeout and truncation remain execution results whose fields must be inspected. The opaque `command` schema, routing, never-throw handler, output, permissions, Host execution, timeouts and output caps are unchanged. The local capabilities `index.md` entry was updated with the module's guidance responsibility.

The two examples are conditional on program availability:

```text
git --version
powershell.exe -NoProfile -NonInteractive -Command "Get-ChildItem -Name | Select-Object -First 5"
```

The second example is explicitly scoped to Windows. This machine has Windows PowerShell at `C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe` and Git at `G:/Git/cmd/git.exe`; actual bare-name lookup was exercised through the production resolver. No Bash or `pwsh` installation is assumed. The examples are read-only and do not introduce a Git workflow.

The owner-supplied [prompt catalog](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog), section 5.2, informed the writing approach only: scope, valid examples and readable results. Its stateful Bash, persistent cwd/environment, 120-second default and background-output contracts do not apply here and were not adopted.

## Size and tradeoff

The measurement script parses the old/new TypeScript string literals and calls the existing `memory/token-estimator.ts::estimateTokens`; it does not dispatch a model request.

| Description-only measure | Baseline | Delivered | Delta |
| --- | ---: | ---: | ---: |
| UTF-16 length | 311 | 1,062 | +751 |
| UTF-8 bytes | 313 | 1,062 | +749 |
| Whitespace-separated words | 51 | 153 | +102 |
| Local estimator units | 78 | 266 | +188 |

This is an intentional small instruction-cost increase addressing the four compound/no-shell and two missing-program failures observed in the selected recent cohort. The additional units recur wherever this tool description is exposed. These are local heuristic units for the description, not provider tokens, full schema totals, measured savings or an invoice. Changing the tool definition can also invalidate an existing cache prefix initially. No real-model before/after invocation-quality or total-cost comparison was run for this slice, so fewer future corrections and net savings remain unproven.

## Verification evidence

Environment: Windows, Node `v24.18.0`, Rust `1.97.0 (2d8144b78 2026-07-07)`, Vitest `4.1.10`, isolated worktree `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`.

The ignored fixture `target/exec-guidance-20261104/verify-exec-guidance.rs` imports these **unchanged production source files** using Rust `#[path]`: `capabilities_impl/exec/parser.rs`, `resolve.rs` and `sandbox.rs`. It executes the actual tokenizer, program resolver, subprocess spawn, scrubbed environment and output collector. Minimal fixture-only `ExecError`, `ExecOutput` and `Sandbox` holders supply the surrounding types; their field shapes were checked against production. This is stronger than a reimplemented tokenizer or shell-only smoke, but it does not exercise the live Permission Gate, Tauri transport or user service.

```powershell
rustc --edition=2021 -o target/exec-guidance-20261104/verify-exec-guidance.exe target/exec-guidance-20261104/verify-exec-guidance.rs
& .\target\exec-guidance-20261104\verify-exec-guidance.exe
node target/exec-guidance-20261104/measure-description.mjs
pnpm --filter @taki/core exec vitest run src/capabilities/exec-tool.test.ts
pnpm --filter @taki/core typecheck
pnpm exec eslint packages/core/src/capabilities/exec-tool.ts
git diff --check -- packages/core/src/capabilities/exec-tool.ts packages/core/src/capabilities/index.md
```

| Check | Observed result |
| --- | --- |
| Exact `git --version` example | Parsed as two argv elements; real spawn, exit 0, expected Git version output |
| Exact Windows interpreter example | Entire pipe expression retained as one argument; real interpreter spawn, expected bounded fixture-directory listing, exit 0 |
| `git --version && git --version` | Production structural error before spawn: `compound or shell commands cannot run without a shell; approve a single command` |
| Deliberately absent fixture program | Production error: `cannot locate ... on the trusted PATH (cwd excluded)` |
| Quoted executable/argv/path | Fixture executable copied under `path with spaces/argv probe.exe`; spaces, literal `&` and Windows backslashes survived real spawn |
| Fresh cwd/environment | One interpreter call changed its cwd and environment; the next call used the configured fixture cwd, retained neither change, and excluded a fixture-parent environment sentinel |
| Nonzero exit / timeout / truncation | Retained `ExecOutput`: exit 1 with stderr, null exit with `timedOut:true`, and capped output with `truncated:true`; no tool failure was substituted |
| Existing TS exec routing tests | 3/3 passed: opaque pass-through, timeout/output semantics, governed denial without throwing |
| Core typecheck / targeted ESLint / scoped whitespace check | Passed |
| Production Rust source diff | No changes to parser, resolver or sandbox |

The fixture uses a five-second deadline and 8 KiB cap for ordinary probes, 100 ms for its sleeper and 32 bytes for its capped-output probe. These are verification inputs, not new production defaults. An initial fixture assertion compared Windows path separators as strings; it was corrected to compare canonical paths. The final complete fixture passed. No production defect or workaround resulted from that assertion.

Local reproducibility artifacts remain ignored under `target/exec-guidance-20261104/`: Rust fixture, binary, copied argv probe, execution evidence, description-measurement script and source-hash/size JSON. No conversation bodies, credentials, database writes, model calls or historical command reconstruction were used.

## Delivery boundaries and follow-up

Tracked files changed by this slice:

- `packages/core/src/capabilities/exec-tool.ts`
- `packages/core/src/capabilities/index.md`
- This report.

The parent owns final workspace checks and any subsequent natural-use quality/cost observation. No full workspace suite or Cargo gate was launched by this slice because Rust production code is untouched and the parent coordinates those gates. Automated evidence does not establish owner manual acceptance, another Host's interpreter availability, or behavioral improvement by a real model. Avatar, Shared schemas, databases and other collaborators' edits remain outside this slice. No commit, push, archive, service restart or paid call was performed.
