# DSH observability expansion and Monitor UX design

## 1. Design boundary

The existing Core Run state and append-only `run_events` ledger remain the only execution authorities. D68 adds facts
at fixed Core seams and projects them into a DSH-shaped developer view. It does not add a DSH Session, a second Agent
loop, a monitor database, or a relationship-timeline writer.

G5 product baseline (owner, 2026-09-05): the current Monitor is only a trace-validation prototype and
has no visual/interaction acceptance. Rebuild the presentation primarily by porting DSH Trajectory's
composition, styles and interactions. Preserve useful Core/data work; do not make the old PageCard
scaffold or the accepted non-Monitor visual baseline a constraint on this rebuild.

G4 presentation clarification (2026-09-05): remove meaningless IDs/hashes/internal generations and
revisions from user-facing details, including the Monitor Inspector in local mode. Preserve required
wire/internal identities. The [reference study and field inventory](../08-22-t4-agent-architecture-observability/research/uiux-useful-information-2026-09-05.md)
supersedes the earlier generic technical-disclosure recommendation.

```text
Run/Attempt/Effect/Model/Tool/Governance transitions
  -> versioned durable Run Events + post-commit live bus
  -> ObservabilityQueryService
       -> Run browser summary
       -> DSH-shaped trajectory ledger + Overview
       -> semantic Inspector
  -> operator WS query/subscribe methods
  -> disposable Desktop Monitor client
```

The event ledger is evidence; mutable Run/Attempt state remains the recovery cursor. Live notifications are an
optimization for UI responsiveness and are never required for correctness.

## 1.1 Preflight and delegation boundary

The following captures the original stage ordering. As of 2026-09-05, the prompt-cache and compaction
children are archived and their gates are complete; the G4 presentation work does not reopen them.

Existing DSH research is sufficient for the architecture and presentation direction. One additional targeted explore is
required before coding because the live TakiAgent adapter still needs verified AI SDK v7 stream-part shapes and exact
model/tool observation seams. The explore is read-only and records concrete symbols, payload inputs, and tests; it does not
reopen the architecture decision or modify production code.

After explore, D68 is executed as producer/projection work followed by the DSH-shaped Desktop layout. The real D68-A
usage evidence exposed an avoidable Harness prefix-cache defect; archived child task `08-28-harness-prompt-cache-stability`
closed that gate and proved materially improved real-provider cache reuse. A second child task,
`08-29-compaction-harness`, now owns token-first Replay, complete-request pressure, general Context Reduction,
Memory-provider-independent composition, and durable summary lifecycle. It is a required gate before D68-B UI work. The
UI must not become the next priority while a known long-history/compaction defect can still invalidate context or provider
cost. Each executable task/slice has one impl and one check, with no secondary agent dispatch. Before each dispatch, the
main session sets the session-scoped task pointer. The prompt starts with the exact `Active task:` path and requires
child-side `task.py current --source` verification/correction before work begins.

## 2. Direct DSH presentation port and necessary TakiAgent adapters

The [2026-09-06 adapter preflight](research/d68-b-ui-port-adapter-map-2026-09-06.md) records the
current source/style comparison, existing durable facts, exact client/projection gaps and the proposed
virtualizer dependency. Main adopted that dependency under the owner's 2026-09-06 execution delegation.
Finalize the additive adapter contract before activating D68-B; do not reopen completed stages.

Default to reuse/port of the local MIT source, not a newly invented dashboard inspired only by the
idea of a trajectory. The reference package is
`references/deepseek-harness-master/packages/client/ui-trajectory`. Its README describes the full
interaction target. `TrajectoryView.tsx:447-502` composes Toolbar -> Timeline -> Table, and the Table
owns its conditional record Inspector; TakiAgent's Run selection replaces the source conversation
selection boundary without introducing a second Session/runtime.

| Source under `src/client/` | Port target |
|---|---|
| `TrajectoryView.tsx`, `views.module.css` | Full-height composition, relative density/spacing, search/grouping state and Overview/ledger coordination |
| `TrajectoryToolbar.tsx` | Search, grouping controls, meaningful request totals and time/duration controls with Chinese captions |
| `TrajectoryTimeline.tsx`, `TrajectoryTimeline.module.css`, `timeline.ts` | Timing Overview, record/range focus, zoom/pan and truthful missing-history/start-only rendering |
| `TrajectoryTable.tsx`, `TrajectoryTable.module.css` | Compact semantic rows, turn/request/tool grouping, selected/detail states, resizable Inspector and content presentation |
| `trajectory-virtual-rows.ts` and Table history/follow logic | Bounded mounted rows, older-page loading, stable keys/measurements, initial tail placement and pause-on-scroll-up |
| `trajectory-record.ts`, `layout.ts` | Adapt presentation records to TakiAgent's Run/Attempt/model/tool facts; do not copy the source runtime/state authority |

Read the matching styles and behavior with each component; copying structure without its density,
state treatment and scroll behavior does not meet G5. Keep source attribution and the DeepSeek MIT
copyright/license notice for substantial copies. This source includes React, `@tanstack/react-virtual`,
`diff` and DSH-specific primitives/runtime imports; inventory compatibility and minimal adapters in
the executable slice plan rather than importing the whole DSH workspace or assuming those dependencies
already exist in Desktop. Resolve any needed dependency changes before implementation begins.

Necessary adaptations are limited to the local React/window/styling integration, existing Core/query
facts, Chinese UI labels, G4 useful-field selection, privacy and actual responsive constraints. Reuse
project foundations where compatible with DSH's target appearance; do not wrap the port back into the
old vertically stacked cards. Detailed timeline spans require real timing facts; missing information
stays absent/unknown instead of being invented to resemble a reference screenshot.

DSH's composer-overlay hooks belong to its conversation shell. TakiAgent Monitor is read-only: omit
that composer integration and unused reserved composer space. A visible row ordinal or step count may
support navigation; it must not expose a canonical event sequence or opaque identity as metadata.

### Adopt directly from DSH

- One chronological ledger with grouped Turn/Step-like execution boundaries.
- A wide-screen split view: compact browser/list, central trajectory table, right-side selected-record Inspector.
- Fixed Overview time strip above the trajectory.
- Semantic rows and useful detail for usage, timing, input/output and context; G4 excludes internal bookkeeping dumps.
- Explicit close button for the Inspector; selection is replaceable and does not permanently append cards.
- Turn and Assistant tool groups have independent expand/collapse controls with `aria-expanded`.
- Older-history loading, virtualization when volume warrants it, stable row keys, tail-follow at the current end, and
  follow suspension while the user inspects older rows.
- `current`, `shadowed`, and `log-only` surface classification.

### Adapt for TakiAgent

| DSH concept | TakiAgent mapping | Constraint |
|---|---|---|
| Session | Character-owned Run collection | No DSH Session authority |
| Turn | Run lifecycle / trigger boundary | A background Run need not create relationship content |
| Step | One model request plus its tool work | Do not call every Attempt a Step |
| Tool/Subtool | model-requested Tool, MCP, Host, or future child execution | Preserve effect and lineage semantics |
| Session query | Character-authorized Run query | Authorization is Character/role based |
| Local operation inspection | Useful bounded redacted operation detail | G4 field relevance plus mandatory secret/sensor/authorization exclusion; no generic metadata fallback |

## 3. Durable producer model

### 3.1 Event envelope

Extend the existing closed `run-event.v1` discriminated union additively. Each new event must have:

- stable `runId` and optional `attemptId`;
- contiguous durable `seq` and `occurredAt` assigned by the existing repository;
- a fixed category/source mapping;
- bounded payload fields with strict Zod validation;
- no prompt body, credential, authorization material, raw sensor/media bytes, or unbounded tool payload;
- enough references to pair start/finish facts and rebuild the same projection after restart.

Do not reinterpret existing `effect.*` or `usage.settled` semantics. Add model/tool/context/governance/retry/recovery
facts as new payload kinds, or introduce a new event schema version only if additive compatibility is impossible.

### 3.2 Producer seams

1. **Model middleware**
   - append a request-start fact at the existing model effect preparation boundary;
   - observe the first meaningful stream part and append one first-stream fact;
   - append one settled fact on finish, provider error, abort, or interrupted stream;
   - carry provider/model, effect reference, timing and finish classification;
   - reuse authoritative usage settlement; do not count detached callbacks twice.

2. **Tool/governed execution boundary**
   - append a semantic call-start fact when the model/tool dispatcher has a normalized tool call;
   - append a result-settled fact after the governed tool/effect settlement;
   - include tool name, stable call reference if the SDK supplies one, outcome, error class, duration and approval state;
   - keep raw arguments/results behind a separately produced, redacted detail contract; absence is valid.

3. **Context/admission boundary**
   - append a bounded context snapshot for the immutable Run snapshot and accounting quality;
   - include source categories and authoritative context-window/accounting values only;
   - never store the assembled prompt or full tool schema in the canonical monitor payload.

4. **Run/recovery/governance boundaries**
   - append retry/recovery facts where RunRepo already commits those transitions;
   - append approval asked/decided facts at the Approval authority, without secrets or authorization tokens;
   - reserve delivery facts for the actual delivery authority; do not infer them from `chat.complete`.

5. **Cache**
   - pass through provider-neutral `cacheReadTokens` / `cacheWriteTokens` only when the adapter reports disjoint,
     authoritative buckets;
   - do not emit hit/miss, zero, or `miss` when the provider has no cache signal.

All producer observers must contain errors and avoid blocking the Agent loop. Event append and state settlement must
follow existing transaction/ordering rules.

## 4. Projection and query model

### 4.1 Run browser summary

`RunMonitorSummary` is a compact projection with Chinese presentation labels generated at the UI boundary. It contains:

- Character display name, trigger and initiator;
- state/outcome, queued/start/terminal times and measured total duration;
- attempt count, model-request count, tool success/failure counts;
- provider/model summary;
- input/output/total usage and quality;
- retry, approval, recovery and delivery summaries when facts exist;
- optional cache read/write totals only when authoritative.

The wire model may retain opaque selection keys, but they are not rendered in user-facing content or expanded details.

### 4.2 Trajectory rows

Project durable events into semantic rows with one closed mapper:

```text
触发 / Run
  Attempt 1
    上下文
    模型请求
    助手输出
    工具调用
    工具结果
    审批
    重试 / 恢复
    用量
```

Rows expose Chinese `label`, `phase`, `status`, `outcome`, `summary`, `duration`, and category. `current`, `shadowed`,
and `log-only` remain machine values with Chinese display labels. A paired call/result may be one ordinary Tool row while
the underlying events remain independently queryable.

### 4.3 Inspector contract

The Inspector is a selection projection, not a page card. It has a header with type/location and a close action. Tabs are
conditional and Chinese:

| Record | Default tabs |
|---|---|
| Model request | 概览、用量、耗时、上下文、选项 |
| Assistant output | 概览、输出、用量、耗时 |
| Tool | 概览、输入摘要、结果摘要、工具定义、耗时 |
| Approval | 概览、决定、耗时 |
| Retry/recovery | 概览、原因、关联重试 |

Tabs lead with status, provider/model or tool name, outcome, duration, usage and bounded operation content. Long useful
content may use independently collapsible sections. G4 removes IDs, sequence/schema bookkeeping, digest and internal
revision/generation fields from this user-facing Inspector, including local mode. Do not add a `技术关联` panel or copy
fallback for those values. Internal identities remain available to query/replay logic and canonical evidence.

### 4.4 Chinese presentation map

Keep all protocol values in English and centralize UI translation in a presentation mapper. Minimum labels include:

| Wire value | UI label |
|---|---|
| `running` | 运行中 |
| `completed` | 已完成 |
| `failed` | 失败 |
| `cancelled` | 已取消 |
| `outcome_unknown` | 结果未知 |
| `model` | 模型请求 |
| `tool` | 工具 |
| `usage` | 用量 |
| `recovery` | 恢复 |
| `log-only` | 仅记录 |
| `shadowed` | 已被替代 |

Accessibility labels, loading states, errors, empty states, filter options, close buttons and disclosure controls follow
the same Chinese-only rule.

## 5. Desktop layout and interaction

### 5.1 Wide screens

Use the DSH composition and visual hierarchy inside TakiAgent's full-height workspace. Integrate the
Run browser at the source conversation-selection boundary; the ledger/Overview/Inspector are the
reference-led main surface. The existing page-width wrapper must not make the right Inspector unreachable.

```text
┌────────────────────────────────────────────────────────────┐
│ 筛选 / 搜索 / 实时状态 / 尾部跟随                         │
├───────────────┬──────────────────────────┬─────────────────┤
│ 执行记录       │ 时间概览 + 执行轨迹        │ 详情        ×   │
│ 标题/状态/耗时 │ 执行尝试 / 模型 / 工具     │ 概览 用量 耗时  │
│ 模型/用量      │ 折叠、分页、尾部跟随      │ 输入 输出 定义  │
└───────────────┴──────────────────────────┴─────────────────┘
```

The Inspector region is absent when no row is selected, allowing the ledger to expand. Opening a record never causes an
irreversible navigation. Closing it clears selection and restores the ledger width.

### 5.2 Narrow screens

Keep the same order and semantic hierarchy but stack the Run browser above the ledger and render the Inspector as a
bottom drawer with a visible close button. No information is moved into an opaque technical dump.

### 5.3 Disclosure and scrolling rules

- Every expandable section has a labeled button/chevron, `aria-expanded`, and a deterministic initial state.
- Clicking the same control closes the section; Escape/close also dismisses the Inspector.
- New live rows append/update in place. If the user is at the tail, follow it; if the user has scrolled up, show a
  nonintrusive “有新记录” affordance and do not move the viewport.
- Load older rows at the history boundary with an in-place loading state and preserve scroll anchor.
- On reconnect, backfill from the durable cursor before resubscribing; stale/overflow state remains visible until healed.

## 6. Privacy and modes

| Mode | Canonical ledger | Monitor projection | Detail |
|---|---|---|---|
| `DISABLED` | retained for correctness | hidden/rejected | none |
| `FEEDBACK_ONLY` | retained | semantic lifecycle/effect/usage | no content-bearing detail |
| `FULL_LOCAL` | retained | full bounded semantic trace | useful redacted authorized detail; G4 internal metadata excluded from UI |

Mandatory exclusions apply in all modes. Pino remains process diagnostics and is not a producer source.

## 7. Compatibility and migration

- Keep the existing Core/WS/React architecture. The source component dependency inventory determines minimal UI
  adapters or separately reviewed library additions; direct reuse does not authorize a DSH runtime dependency.
- Additive JSON payload kinds fit the existing `run_events` storage. Add indexes/materialized counters only after measured
  query volume demonstrates a need.
- Existing clients must continue parsing older events. Unknown required event kinds must fail closed according to the
  shared contract; optional detail is omitted rather than guessed.
- Relationship Timeline remains untouched by Monitor projection.

## 8. Verification strategy

- Shared schema tests: strict bounds, English wire values, Chinese presentation mapping, forbidden payload patterns,
  cache omission, backward-compatible event parsing.
- Core producer tests: model success/error/interruption/first stream, tool success/failure, usage reported/estimated/
  unknown, context snapshot, approval, retry/recovery, and replay equality.
- Query tests: summary counts/totals, filters, current/shadowed/log-only, missing-field omission, Character authorization.
- Desktop tests: three-region rendering, Chinese labels, Inspector open/close, each disclosure toggles both ways,
  responsive fallback, live update, tail suspension, older-page loading and reconnect restoration.
- G5 visual/interaction gate: compare default, selection, grouped/collapsed, input/output detail, live-tail,
  historical-scroll, empty/error and narrow states against DSH at representative window sizes. Record deliberate
  domain/privacy/G4 differences and verify actual WebView2 interaction. Existing traceability evidence is not UI approval.
- Chinese-copy audit includes toolbar/Overview/Inspector tabs, statuses, tooltips, empty/error/loading text and
  accessible labels. UI-owned English fallback text is a defect; real model/tool names and content retain their identity.
- Full gates: Shared/Core/Desktop typecheck, tests, lint, Desktop build, task validation and `git diff --check`.
