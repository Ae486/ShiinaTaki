# Real-provider timezone diagnosis — 2026-09-28

## Scope and observed symptom

- Active task: C3 `09-11-initiative-pattern-authoring`, in `H:/TakiAgent-worktrees/t4` on
  `task/t4-skills-mcp-productization`.
- The parent observed a real DeepSeek reply using approximately 18:40 while the stored User Timezone was UTC and
  the actual UTC clock was approximately 10:40. This checkout's Core host zone is `Asia/Shanghai`.
- The separate model claim about "yesterday" is not evidence of this timezone defect. No claim is made that timezone
  wiring alone fixes invented historical statements; the parent records that finding independently.
- Initial work changed only existing focused tests and this report. The parent subsequently authorized the optional
  port implementation while reserving `main.ts` wiring until the real-provider baseline ended; unspecified callers
  therefore retained baseline behavior throughout that run.

## Deterministic reproduction before the fix

The Agent regression composes the actual `UserTimezoneService` over the companion fixture's migrated SQLite database,
then captures the request received by the installed SDK's `MockLanguageModelV4`. It asserts the authoritative singleton
is UTC before invoking `createChatAgent`. This observes the actual outgoing system/user message boundary rather than
testing a renderer in isolation.

At the fixed instant `2026-09-28T10:40:45.678Z`:

| Boundary | Required | Baseline observed |
| --- | --- | --- |
| User timezone service | `UTC` | `UTC` |
| Agent current-time tail | `Current local time: 10:40.` | `Current local time: 18:40.` |
| Exact-time tool `timezone` | `UTC` | `Asia/Shanghai` |
| Exact-time tool `local` | `2026/9/28 10:40:45` in this locale | `2026/9/28 18:40:45` |
| Exact-time tool UTC instant | `2026-09-28T10:40:45.678Z` | Correct: the defect is zone projection, not the clock instant |

A second Agent scenario sets the actual authority to `America/New_York` at `2026-09-28T00:30:00.000Z`. It requires
Sunday `2026-09-27` and `20:30`, then changes the committed authority to UTC during awaited automatic recall. The initial
request must keep its one captured zone; the next turn must use Monday `2026-09-28`, `00:30` and UTC. Baseline instead
renders the host calendar's Monday on the first request.

Command:

```powershell
pnpm --filter @taki/core exec vitest run src/agents/chat-agent-time.test.ts src/time/current-time-tool.test.ts src/time/time-context.test.ts --reporter=dot
```

Baseline result: exit code 1; 5 new tests failed, 22 passed. All 17 existing `time-context` tests passed, including
explicit-zone rendering and civil-day boundary cases. The first diagnostic run also found a synchronous-tool assertion
incorrectly using `.resolves`; that test harness assertion was corrected before recording the five semantic failures.

## Ranked hypotheses and source evidence

1. Missing authority wiring makes both Agent renderers and the exact-time tool use process-local defaults. Confirmed
   at the request/tool boundaries above: the baseline calls `renderDayDate(now)` and `renderCurrentTime(now)` without a
   zone; `get_current_time` calls `toLocaleString()` and reads default `Intl` timezone directly.
2. Stale timezone capture after a settings change could preserve the wrong zone. The regression additionally pins a
   single captured zone across one attempt and a fresh service read for the next attempt/turn and each tool execution.
3. Incorrect renderer date arithmetic could shift the calendar even with correct wiring. Existing explicit-zone
   renderer tests pass; no renderer algorithm change is indicated.

## Implemented minimal wiring

- Optional `ChatAgentDeps.userTimezone?: () => string`; capture once per attempt beside its existing single clock
  read, then pass that same zone to stable day and volatile time renderers. Include the explicit user zone in the
  stable instructions. Legacy callers that omit the port retain their local-clock behavior.
- Optional `createCurrentTimeTool({ userTimezone?: () => string } = {})`; read the live authority once on each tool
  execution and use it for both `local` projection and the returned `timezone`. Authority-read failure remains a
  structured tool error rather than falling back to the host. UTC ISO/epoch/capturedAt remain the same instant.
- Parent owns `main.ts`: the earlier static-tool construction needs a lazy closure because the timezone service is
  declared later. The exact integration change is:

```diff
-const staticCoreTools: ToolSet = { ...createCurrentTimeTool(), ...readFileTool, ...writeFileTool };
+const staticCoreTools: ToolSet = { ...createCurrentTimeTool({ userTimezone: () => userTimezoneService.timezone() }), ...readFileTool, ...writeFileTool };
 const chatAgent = createChatAgent({
       model,
+      userTimezone: userTimezoneService.timezone,
```

A settings update does not cancel primary chat. The in-flight attempt retains its captured coherent day/time context;
the next attempt reads current authority. The precise-time tool is intentionally live at invocation, so it may report
a newly selected zone when called after a settings update. Existing selected initiative context is left unchanged.

Changed files owned by this assignment:

- `packages/core/src/agents/chat-agent.ts`, `chat-agent-time.test.ts`, `index.md`.
- `packages/core/src/time/current-time-tool.ts`, `current-time-tool.test.ts`, `index.md`.
- `.trellis/spec/backend/user-timezone.md`, `.trellis/spec/backend/agent-runtime.md`, and this report.

No new production module, dependency, tool schema, cancellation path or test file was introduced. No temporary debug
instrumentation was added. Parent changes to `main.ts` and the real-provider harness remain parent-owned.

## Post-fix verification

| Command | Result |
| --- | --- |
| The same three-file reproduction command above | Exit 0; 27/27 tests passed |
| `pnpm --filter @taki/core exec vitest run src/agents/chat-agent src/time --reporter=dot` | Exit 0; 24 files, 128/128 tests passed, including legacy prompt/cache/cancellation/retry behavior |
| `pnpm --filter @taki/core exec vitest run src/time/current-time-tool.test.ts --reporter=dot` | Exit 0; 6/6 tests passed after supplying the installed SDK's required execution `context` field |
| `pnpm lint` | Exit 0; no diagnostics |
| `pnpm --filter @taki/core typecheck` | Exit 0 after the test-call fix below |
| `pnpm exec eslint packages/core/src/agents/chat-agent.ts packages/core/src/agents/chat-agent-time.test.ts packages/core/src/time/current-time-tool.ts packages/core/src/time/current-time-tool.test.ts` | Exit 0 after the final test-only edit |
| Scoped `git diff --check` over the eight implementation/test/spec/index files | Exit 0 |

The first Core typecheck identified four new direct-tool test calls missing the installed AI SDK v7
`ToolExecutionOptions.context` field. They now pass `context: undefined` explicitly, with no type assertion bypass.
The follow-up Core typecheck completed with exit code 0.

## Remaining verification boundary

The deterministic regressions establish correct request/tool timezone projection. Actual production composition and
the real-provider rerun remain the parent's acceptance work. This report does not claim the separate invented
"yesterday" statement or heartbeat provider/schema failure is fixed. No commit, push, finish or archive was performed.

## Root integration addendum

Main now supplies the live UserTimezoneService to both ChatAgent and the lazily invoked current-time tool. The
repaired and final real batches each passed both one-shot reminder cases with exact stored UTC-instant assertions.
The final two reminders both store `2026-09-29T09:00:00.000Z`. See the separate
[real-model report](real-llm-acceptance-2026-09-28.md) for schema/authoring fixes, final gates and remaining prose limits.
