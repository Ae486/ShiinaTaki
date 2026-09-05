# D68-B: DSH UI port and current-contract adapter map

Status: read-only source preflight and executable design preparation. D68-B production has not
started. The active main-session task is `09-05-uiux-readable-operations`; its A1/A2 work continues
independently. Source snapshot: T4 worktree, branch `task/t4-skills-mcp-productization`, HEAD `3c67fd5`
plus the uncommitted UI/UX work. Historical D68-A, cache and Compaction acceptance is not repeated.

## 1. Reference composition and concrete reuse

Source: `references/deepseek-harness-master/packages/client/ui-trajectory`, licensed under the root
DeepSeek MIT license, Copyright (c) 2026 DeepSeek. `README.md` defines the interaction contract;
the following current source files and corresponding styles were read together.

| Reference | Retained behavior and visual structure | TakiAgent adaptation |
|---|---|---|
| `src/client/TrajectoryView.tsx:447`, `views.module.css` | Full-height Toolbar -> fixed Overview -> ledger/temporary Inspector; no stacked page cards | Character Run browser replaces conversation selection. Omit the conversation composer and its reserved height. |
| `TrajectoryToolbar.tsx`, `TrajectoryToolbar.module.css` | Compact search, duration-mode and independent grouping controls; 32 px reference toolbar, 20 px controls | Chinese labels and accessible names; retain actual provider/model/tool values. Allow a wrapped narrow toolbar without clipping controls. |
| `TrajectoryTimeline.module.css`, `README.md` | Three-lane 50 px Overview, neutral older-history prefix, recorded timing, range focus, wheel zoom and right-drag pan | Lanes represent actual model/tool/system facts. Missing durations remain start markers. Preserve first-output timing semantics instead of claiming first-text-token timing. |
| `TrajectoryTable.tsx`, `TrajectoryTable.module.css` | Compact semantic event/content rows, 30 px ordinary rows, selected-row treatment, turn/request separators and conditional resizable Inspector | One Run with Attempt/request groups; internal event sequence is never a displayed ordinal. Keep a narrow closable detail drawer. |
| `trajectory-virtual-rows.ts`, Table virtualizer integration | Stable record keys, measurable separator grouping, 100-row virtualization threshold and 12-row overscan | Retain stable event/request identities internally, preserve prepended anchors and pause following during inspection. No composer padding. |

Use the reference CSS density, separators, hover/selection treatment and scroll geometry as the
starting point, mapping its tokens to the existing TakiAgent theme. Adapt copied modules into cohesive
files under the project source-size rules; do not import DSH runtime stores or port its large Table
module wholesale. Include the full DeepSeek MIT notice in a colocated third-party notice and source
attribution in substantially adapted files.

The DSH package locks `@tanstack/react-virtual@3.14.9` and `@tanstack/virtual-core@3.17.7`.
Its peer dependencies explicitly support React/ReactDOM 19; the registry metadata was checked with
`pnpm view @tanstack/react-virtual@3.14.9 version peerDependencies --json`. Desktop has neither this
virtualizer nor `diff` in its dependencies. Proposed dependency change: add only the exact
`@tanstack/react-virtual@3.14.9` version so the port can retain DSH's measured-row behavior. Do not add
`diff`: TakiAgent does not currently produce an authorized old/new content pair for a Monitor diff.
Main adopted this dependency under the owner's 2026-09-06 execution delegation. Installation belongs
to the reviewed D68-B slice; no manifest or lockfile had changed when this preflight was recorded.

## 2. Existing TakiAgent authority and facts

The bounded explorer used two jbcontext queries and verified their stale-index hits against current
source. It made no edits or test/acceptance claims. Its native task pointer was `none`; it used the
main-supplied task path without touching the legacy Compaction pointer.

| Current source | Reusable contract |
|---|---|
| `packages/core/src/agents/chat-agent.ts:233` and `run-observability-telemetry.ts:178` | Existing model middleware and SDK telemetry already produce real model start/first-output/settlement, provider/model, optional measured duration and first-output duration. |
| `packages/shared/src/run-event-schema.ts:127` | Durable model facts retain `effectId`/`callId`; first output can be text, reasoning or tool output. It is not necessarily a first text token. |
| `packages/core/src/agents/tool-observability.ts:59` | Real tool start/result, `toolCallId`, optional model-call/effect association, outcome/error class and optional duration. Stream-only fallback can legitimately lack association or timing. |
| `packages/core/src/db/effect-repo.ts:148` | Usage buckets and `usage.settled` are persisted atomically. Input/output/total, reasoning, cache-read/write exist only when supplied upstream. |
| `packages/core/src/observability/observability-query-service.ts:130` | `sumComplete` omits an aggregate bucket when any constituent is unknown. Preserve this contract; never substitute zero. |
| `packages/core/src/harness/effect-lifecycle-service.ts:32` | Durable append precedes live publication. The bus is a notification optimization, not another authority. |
| `packages/shared/src/observability-schema.ts:21` | Run summaries already have timestamps, optional completed duration, attempt/model/tool/failure/retry counts, usage quality and optional cache buckets. |
| `packages/core/src/server/methods/observability-methods.ts:38` | Operator-only, Character-authorized query; connection-scoped selected-Run subscription with backfill. |

There is no current Monitor-specific contract for raw prompt text, assistant message bodies, full
tool input/output, tool definitions or content diffs. Do not read relationship Timeline or raw Host/MCP
payloads to fill DSH tabs. Show only applicable semantic sections backed by existing safe facts; do not
add empty generic payload panels. D75 compaction-benefit measurement remains an unchosen separate
scope item, and absent cache information remains `缓存信息未提供`.

## 3. Required adapter changes before the presentation port

These are concrete residuals in the existing projection/transport/client path, not a repeat of D68-A.

| Residual | Evidence | Required correction |
|---|---|---|
| Request identity is dropped | `observability-query-service.ts:149`; `TrajectoryRowSchema` keeps only Attempt `groupKey` | Add optional internal machine event kind and exact model/effect/tool association to the safe projection. Pair only matching identities; retain honest isolated/start-only records when association or earlier history is absent. Never parse a Chinese label or infer Step from Attempt/time proximity. |
| History starts at the beginning | `TrajectoryParamsSchema` only has forward `afterSeq`; `RunEventRepo.list` reads all later events | Add bounded tail/before queries while preserving forward queries for subscription recovery. The first UI page loads the tail; older pages prepend in chronological order without replacing the live cursor. |
| Same-Run Inspector replies race | `monitor-controller.ts:258-269` checks client generation and Run only | Add an Inspector request/selection epoch; selection replacement and close invalidate both success and failure callbacks and settle loading state. |
| Live summary stays stale | `monitor-controller.ts:272-284` only merges rows/cursor | Re-read the authorized selected Run summary in response to committed-event invalidation, coalescing overlapping requests with at most one trailing refresh. No polling or totals inferred from the loaded window. Preserve the loaded rows and reading anchor. |
| Older selected Run disappears | `monitor-controller.ts:169-175` preserves selection only among the newest 25 Runs | Keep selection independent of list-page membership. Restore its authorized summary/trajectory through the existing Run query after reconnect/reactivation; clear it only on a real unavailable/forbidden response or explicit selection change. |
| Right pane cannot use wide layout | `page-chrome.tsx:31`; `monitor-page.tsx:174`; `monitor-layout.tsx:36` | Give Monitor a dedicated full-height/full-width body. Leave unrelated page chrome behavior unchanged. |
| Inspector exposes bookkeeping | `monitor-view.tsx:53` renders all `technical` fields; old test requires Event ID copying | Remove primary/expanded/tooltip/copy/AX presentation of internal metadata. Keep query and selection identities internal; replace the obsolete display assertions. |

The captured-name helper from A2 is the shared presentation source. For new tool observations, capture
the readable label with the same Run context and persist it as optional bounded metadata; keep the
canonical tool key for replay/routing/filter identity. Old records use fixed known-tool Chinese names
or generic tool text. Do not resolve old MCP names from a current catalog or split routing keys.

### History wire shape to finalize in the executable slice

Keep existing `afterSeq` and forward `cursor` behavior for legacy callers/backfill. New optional tail
and exclusive-before selection must be mutually exclusive with a nonzero `afterSeq`; limits remain
1..200. A backward page returns chronological rows plus explicit older-history availability/cursor.
The client keeps its latest observed cursor separate from the oldest loaded boundary. A before-page
response can never rewind live subscription state. Validate out-of-range/stale cursors with the same
Character authorization as current trajectory reads. Prefer a bounded repository page query over
fetching the complete ledger just to slice rows in the UI.

Expose only bounded safe correlation fields and applicable semantic Inspector sections. Reuse current
redaction/mode gates. Do not change the execution ledger identity, add a monitor database, synthesize
missing timings, or add an independent refresh protocol for other Home pages.

## 4. Executable slice ownership

1. Main finalizes the additive query/row/Inspector field contracts under the recorded delegation,
   updates D68 design/implement/manifests, and switches the task after the completed A1/A2 checkpoint.
2. One D68-B implement agent owns the coherent Shared/Core adapter + Desktop port and on-touch indexes.
   It uses `gpt-6-astra/high`, no recursive delegation, and jbcontext only for needed semantic discovery.
3. One combined `gpt-6-astra/xhigh` check covers the cross-layer slice. Cosmetic follow-ups can be
   reviewed by main or included in that check under the owner's resource-saving rule.
4. Reuse the isolated frontend-only WebView2 harness from G4, then separately exercise actual isolated
   Core producers. Synthetic UI evidence and real Core evidence remain separately labeled. Owner
   visual/interaction acceptance is never auto-completed.

The A1/A2 follow-up subsequently validated the same harness against its final build (6/6 groups).
Reuse its ignored `readable-operations-20260906/launch-detached.py` pattern for bounded hidden launches
with closed inherited handles; compound startup-tool calls had stalled before this fallback. See the
[naming-task evidence](../../09-05-uiux-readable-operations/implementation-evidence-a1-a2-2026-09-06.md).

## 5. Required verification

- Shared schemas: optional correlation/display metadata, legacy forward query compatibility,
  tail/before bounds and mutual exclusion, no raw-payload admission, missing-value semantics.
- Core projection/query: deterministic replay, exact request/tool/usage association, sparse and
  out-of-order facts, page edges, unknown buckets, Character authorization and all three Monitor modes.
- Controller: A/B Inspector reply order, close-before-success/error, old client generation, older Run
  restoration, event-driven summary refresh, retained forward cursor during prepend and reconnect.
- Ledger/Overview: one chronological occurrence per underlying record, real request grouping,
  independent collapse controls, literal loaded-window search, inclusive range focus, clear/zoom/pan,
  start-only timing, bounded mounted rows, stable prepend/follow behavior and reduced motion.
- Real WebView2: default/selected/expanded/live/history/narrow states compared with the DSH source
  composition; full Chinese system/AX copy; no hidden bookkeeping exposure; focus/close/resize and
  uninterrupted reading anchors. A static three-pane screenshot is insufficient.
- Full relevant Shared/Core/Desktop checks, workspace typecheck/root lint, Desktop build, task context
  validation and scoped diff/encoding checks. Preserve all unrelated dirty work and manual ACs.
