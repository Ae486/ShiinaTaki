# DSH observability expansion and Monitor UX design

## 1. Design boundary

The existing Core Run state and append-only `run_events` ledger remain the only execution authorities. D68 adds facts
at fixed Core seams and projects them into a DSH-shaped developer view. It does not add a DSH Session, a second Agent
loop, a monitor database, or a relationship-timeline writer.

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

Existing DSH research is sufficient for the architecture and presentation direction. One additional targeted explore is
required before coding because the live TakiAgent adapter still needs verified AI SDK v7 stream-part shapes and exact
model/tool observation seams. The explore is read-only and records concrete symbols, payload inputs, and tests; it does not
reopen the architecture decision or modify production code.

After explore, D68 is executed as two coherent slices: D68-A owns Shared/Core producers plus projection/Inspector data;
D68-B owns the DSH-shaped Desktop layout and interaction. The real D68-A usage evidence exposed an avoidable Harness
prefix-cache defect, so child task `08-28-harness-prompt-cache-stability` is a required gate between those slices. It
stabilizes model-visible request prefixes and proves materially improved real-provider cache reuse before UI work can
resume. Each executable task/slice has one impl and one check, with no secondary agent dispatch. Before each dispatch,
the main session sets the session-scoped task pointer. The prompt starts with the exact `Active task:` path and requires
child-side `task.py current --source` verification/correction before work begins.

## 2. Reference mapping: copy DSH, adapt only domain boundaries

### Adopt directly from DSH

- One chronological ledger with grouped Turn/Step-like execution boundaries.
- A wide-screen split view: compact browser/list, central trajectory table, right-side selected-record Inspector.
- Fixed Overview time strip above the trajectory.
- Semantic main rows; detail tabs for usage, timing, input/output, schema and context.
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
| Raw local inspector | bounded redacted developer detail | Mandatory secret/sensor/authorization exclusion |

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

The wire model may retain opaque selection keys, but they are never rendered as ordinary content.

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

The default tab leads with status, provider/model or tool name, outcome, duration, usage and bounded summary. Long content
uses independently collapsible sections. A final `技术关联` disclosure is collapsed by default and is available only in
an authorized local mode; it may contain IDs, sequence, schema version and digest for targeted debugging. The default
Inspector contains no such fields.

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

Use a full-height three-region workspace:

```text
┌────────────────────────────────────────────────────────────┐
│ 筛选 / 搜索 / 实时状态 / 尾部跟随                         │
├───────────────┬──────────────────────────┬─────────────────┤
│ Run 浏览器     │ Overview + 轨迹账本       │ Inspector   ×   │
│ 标题/状态/耗时 │ Attempt / Model / Tool   │ 概览 用量 耗时  │
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
| `FULL_LOCAL` | retained | full bounded semantic trace | redacted, authorized detail; technical linkage collapsed |

Mandatory exclusions apply in all modes. Pino remains process diagnostics and is not a producer source.

## 7. Compatibility and migration

- No new framework or observability dependency is required; use existing TypeScript, Zod, SQLite, WS and React.
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
- Full gates: Shared/Core/Desktop typecheck, tests, lint, Desktop build, task validation and `git diff --check`.
