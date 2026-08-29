# Harness prompt-prefix cache stability implementation plan

## Execution boundary

This is one coherent Core Harness slice with one impl agent and one formal check agent. The implementation must work with
the existing dirty D68-A worktree and must not revert, rewrite or commit unrelated observability changes.

## Step 1 — Load contracts and verify the active task

1. Verify `cwd`, branch, worktree, HEAD, dirty paths and `task.py current --source`.
2. Read this task's PRD, design, research artifact, backend specs and the checked-in DSH cache/tool-order references.
3. Use `jbcontext` only for any remaining semantic discovery; YCE remains disabled.

## Step 2 — Lock the deterministic regressions

1. Add extension-registry tests for different Run ids, identical rendered context and preserved per-Run tool binding.
2. Add a focused ChatAgent prefix-cache test covering stable system/tool headers, canonical tool order, within-Run strict
   tool continuation and the honest cross-Turn `<turn-context>` boundary.
3. Run the focused tests before production edits and record which assertions fail on the current implementation.

## Step 3 — Implement the minimal production fix

1. Remove the UUID value from model-visible extension context while retaining stable semantic guidance.
2. Assemble ChatAgent tools once and provide a complete locale-independent sorted `toolOrder` to ToolLoopAgent.
3. Keep snapshots, results, closures, generation leases, Governance, Approval, Effect/Run identity and schemas unchanged.
4. Do not touch memory assembly, Host context, compaction, UI, observability payloads or provider-specific production code.

## Step 4 — Focused and package verification

1. Run extension and ChatAgent prefix-cache tests.
2. Run relevant extension, MCP, approval, governance, memory, compaction and ChatAgent suites.
3. Run Core typecheck and lint.

## Step 5 — Real provider verification

1. Add or reuse a key-gated E2E fixture with an isolated temporary data directory and stable 55k-80k history.
2. Execute a harmless tool Turn and an immediate follow-up Turn against the configured real DeepSeek provider.
3. Read normalized per-request usage only; assert arithmetic, request classification, normal output and tool evidence.
4. Require at least 50% cache-read ratio and at least +30 percentage-point improvement over the 10.1% baseline on the
   comparable follow-up request.
5. Repeat with a fresh temporary data directory. Persist a bounded count-only result under `research/`.

If the first live run misses the threshold, do not weaken the gate. Inspect system/tool/header digests and legitimate
semantic boundaries, update the design with evidence, then fix the next proven volatile component.

## Step 6 — Formal check and close

1. Dispatch exactly one check agent after implementation and live verification finish.
2. Run full relevant Core tests/typecheck/lint, task validation and `git diff --check`.
3. Update the backend runtime/extension specs if the stable-prefix contract is not already executable there.
4. Commit this child task separately from D68-B UI. Parent D68 resumes at Stage 5 only after this gate closes.

## Owned files

- `packages/core/src/extensions/extension-registry.ts`
- `packages/core/src/extensions/extension-registry.test.ts`
- `packages/core/src/agents/chat-agent.ts`
- `packages/core/src/agents/chat-agent-prefix-cache.test.ts` (new, if this is the cleanest focused seam)
- focused `e2e/src/` cache acceptance test and existing fixture helpers only when required
- this task's planning/research/context files
- directly relevant backend specs after implementation learning

## Non-owned / forbidden expansion

- Desktop Monitor and general Home UI
- memory semantics or migration
- Host catalog semantics without a new failing deterministic test
- provider-specific production adapter branches
- D68-A observability code except where compilation requires using its current live contracts
- commits, push, rebase, reset or archive by the impl/check agents

## Validation commands

The implementer must identify exact package scripts from `package.json`; expected gates include focused Vitest tests,
Core test/typecheck/lint, the key-gated real E2E command, Trellis validation and `git diff --check`.

## Rollback point

Before the real provider probe, the patch is limited to instructions/tool ordering plus deterministic tests. If a
compatibility failure appears, revert only those child-task changes; no database or protocol rollback is required.
