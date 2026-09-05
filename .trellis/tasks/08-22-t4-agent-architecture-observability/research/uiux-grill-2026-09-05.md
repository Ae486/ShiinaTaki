# UI/UX requirement grill — 2026-09-05

Status: planning and decision recording. G1, G2, G3's Pet sequence, G3a's exit boundary, and G3c's
terminal error bubble are owner-confirmed. G3b adds an owner-confirmed continuity requirement with
detailed design delegated to the main session. Error-code/message cleanup is separately deferred as
D77. G4 confirms useful operation details and removal of meaningless internal metadata across user-facing pages.
G5 confirms a DSH-led Monitor UI rebuild; the current Monitor is a trace-validation prototype, not an accepted visual baseline.
The owner approved the six-batch sequence and proceeding with implementation on 2026-09-05, then
explicitly approved the naming/approval and live-feedback child-task creation. G4 frontend cleanup has
passed implementation and automated review; A1 of the naming/approval child is now in progress.
Later slices still require their complete source-backed design and execution artifacts. D64's command
disclosure policy is pending an explicit owner choice; D75 first-batch inclusion remains undecided.
This record coordinates the existing architecture/UI work. Verify the session task before every slice;
the legacy compaction pointer must never reactivate the archived task.

## G1 — next-stage scope (confirmed)

The next stage aims for readable execution, trustworthy state, and timely feedback. Plan the following
workstreams together, then implement them in separately reviewable batches:

| Workstream | Included outcome | Existing ownership |
|---|---|---|
| Monitor | Direct DSH Trajectory presentation port/rebuild, complete Chinese UI labels, useful execution facts and reliable interaction; current Monitor is only a functional prototype | D68/G5, `08-28-dsh-observability-expansion` |
| Chat/Pet tool feedback | Tool activity becomes visible while the turn is running, with truthful state and ordering | D67/U8/U9/U10, `09-05-uiux-live-tool-feedback` |
| Names and approval content | Understandable tool/capability names and enough safe, concrete context to understand an approval | N1/N2/N5/N7/I1 and N3/D64, `09-05-uiux-readable-operations` |

Owner feedback: the existing non-Monitor visual baseline is broadly satisfactory; its small visual
and interaction details can be collected for a later focused pass. G5 explicitly excludes Monitor
from that acceptance: its current UI only demonstrates traceability and is to be rebuilt primarily
from DSH. Reuse shared foundations where appropriate without inheriting the Monitor prototype's
layout or appearance. No broad feedback certifies asynchronous-state or performance acceptance.

Excluded from this stage: new Live2D configuration, theme/font-size settings entries, a broad visual
redesign of the other pages, and proactive-Agent/heartbeat/cross-device implementation. The G5 Monitor
rebuild is in scope. Perception activity push remains
an adjacent D67 item; G1 does not silently add it. Frozen architecture, permission, Memory Authority,
and compaction decisions remain binding.

## Task and document boundaries

- The architecture parent owns this shared planning record and later integration decisions.
- [The frontend PRD](../../08-30-frontend-uiux-optimization/prd.md) retains its pure-frontend scope.
  Its existing delivery must not acquire Core/Shared/Rust work through an expanded interpretation.
- [The D68 PRD](../../08-28-dsh-observability-expansion/prd.md) owns Monitor-specific work. Chat/Pet
  streaming and non-Monitor approval/name changes are not absorbed into D68.
- [The naming/approval child](../../09-05-uiux-readable-operations/prd.md) and
  [the live-feedback child](../../09-05-uiux-live-tool-feedback/prd.md) own their cross-layer contracts.
  The approved delivery order is frontend cleanup -> names/approvals -> DSH Monitor -> Chat -> Pet ->
  integration and focused polish. Chat and Pet remain separately verifiable slices in one child.
- [The original audit](../../../../docs/UIUX-OPTIMIZATION.md) is a dated issue inventory and candidate
  design, not a list of defects that are all still open. [The frontend report](../../../../docs/UIUX-FRONTEND-REPORT.md)
  describes the delivered batches and the limitations found during this refresh.
- The frontend `design.md` has a current G4 appendix and `implement.md` for the first cleanup slice;
  historical frontend batches are not re-executed. Each later complex slice also needs current PRD,
  design, execution plan and curated context before activation. Resolve material product ambiguity
  before implementing its dependent behavior.

The audit's provisional D70–D76 registrations collided with the actual deferred-decision registry.
Use N/U/P item IDs and the established D67/D68/D64 references instead. The registry currently assigns
D70 to `prepareStep` safety, D71–D74 to OpenBiliClaw, D75 to compaction token/benefit measurement, and
D76 to compaction prompt/version/quality evaluation. No registry entry is renumbered by this grill.

## Current evidence and implications

The following are source-review findings at T4 HEAD `3c67fd5`, not new browser, packaged-WebView,
profiling, or automated-test acceptance. Paths and line numbers are evidence anchors for this snapshot.

| Finding | Evidence | Planning implication |
|---|---|---|
| Chat/Pet lack live tool parts | `packages/core/src/agents/chat-agent.ts:282` observes SDK parts but yields text only; `packages/shared/src/chat-schema.ts:9` exposes delta/complete/error; the Chat in-flight row is text-only | Add presentation over the existing execution authority. Approval dialogs and Monitor already have live events; do not describe all tool activity as globally invisible. |
| Persisted tool state is misleading | `apps/desktop/src/windows/home/pages/chat/timeline-message.tsx:29` leaves a call labelled as running; `tool-card.tsx:21` tests the outer output type, allowing JSON `{ok:false}` to look successful | Reconcile call/result identity and normalized outcomes across live and persisted views. A received call is not proof that execution has started. |
| The right Inspector cannot reach its wide layout | `apps/desktop/src/windows/home/page-chrome.tsx:31` limits content to about 45rem inside `max-w-3xl px-6`; `pages/monitor/monitor-layout.tsx:36,55,95` requires `@3xl` (48rem) for the right pane and resize handle | Validate the actual parent container and real window sizes, not only the three-zone component in isolation. |
| Inspector responses can override newer selection or a close | `apps/desktop/src/windows/home/pages/monitor/monitor-controller.ts:250` checks client generation and Run, but not the latest selected row/request | Latest selection and explicit close must survive delayed replies. |
| Live summaries and selection recovery lag | The same controller's `:272` live path updates rows/cursor without refreshing Run summaries; `:163` refresh reads only the first 25 Runs | Preserve an older selected Run across reconnect/reactivation, and keep terminal state/counts current. |
| Existing useful facts are under-presented | Core already projects provider/model, timing/TTFT, token/reasoning/cache fields; Monitor rows omit metrics, filters expose only a subset, and `monitor-view.tsx:39` ignores the old technical-collapse hint | Consume existing facts first. G4 now removes meaningless technical fields from the UI entirely rather than merely collapsing them. Context/compaction benefit, request summaries, and delivery gaps still require real producers; absent values cannot become zero. |
| Tool/capability and approval labels remain generic | `apps/desktop/src/windows/home/pages/settings/permission-cells-card.tsx:27` titles cards with IDs; `packages/core/src/approval/approval-interaction-service.ts:195` omits safe labels in `authority.list()`; Core/MCP presentations still contain generic English labels | Use canonical identity with safe readable labels; changing display text must not change permission or approval binding. |
| Exec approval omits the concrete command | `apps/desktop/src-tauri/src/ws_challenge.rs:48` supplies classification, explicitly excluding raw command content | D64 remains the boundary for bounded, redacted, identity-bound command disclosure. |

Reuse the delivered token/primitive layer, IME guard, Dialog focus handling, Toast controls, MCP/Skills
master-detail with G4-curated useful details, Settings grouping/search, 40ms chat coalescing, 300 mounted-row
cap, image LRU, lazy Markdown, Monitor close/tail-follow controls, and hidden-page subscription gating.
Coalescing reduces update frequency; accumulated Markdown is still parsed again on a flush. It neither
establishes incremental parsing nor proves smoothness for arbitrarily long replies.

## G2 — Chat tool activity organization (confirmed)

- Show one compact entry per tool invocation, interleaved with text in actual occurrence order.
- Update that entry's status in place; retain its final success/failure state in the conversation.
- Keep useful operation details collapsed by default, following G4's field-selection rule and the
  existing privacy contract. Concrete input/output producer wiring belongs in the batch design.
- For example, a search followed by a file read produces two entries, each retaining its own outcome.

This confirms the presentation granularity and ordering, not a wire-event name or new payload
disclosure. The live-to-persisted transition must preserve the same invocation identity and final
state rather than duplicate entries or restore a completed call to a running label.

## G3 — Pet text and transient tool bubbles (confirmed)

The owner specifies separate bubble types in execution order:

- A language segment streams into its own text bubble. Deltas within that segment update the same
  bubble; a later language segment separated by a tool invocation creates a new bubble.
- A tool invocation appears in a separate temporary bubble below the existing text bubbles. Its
  content is the current tool's readable name.
- Once the tool bubble leaves, the text bubbles on either side remain separate. The example's final
  Pet view contains only its two language bubbles.

Owner example, with visible bubbles listed from top to bottom:

| Execution stage | Visible Pet bubbles |
|---|---|
| First language reply | Text A |
| First tool invocation | Text A, temporary Tool 1 |
| Next language reply after the first tool | Text A, Text B |
| Second tool invocation | Text A, Text B, temporary Tool 2 |
| Final tool has completed and the example finishes | Text A, Text B |

This replaces the earlier unaccepted recommendation of one current-activity summary line. It is a
Pet presentation rule; the full Chat view retains per-invocation entries and outcomes under G2.
Removing a temporary Pet bubble must not remove canonical tool records or merge text segments.

Existing UI evidence: `apps/desktop/src/features/chat-bubble/chat-bubble.tsx` currently has one reply
area inside the compact Pet overlay and an `OpenChatButton` calling `openHome("chat")`. The new
segmented view needs design against the existing presentation and bubble-visibility contracts;
the current single-reply component does not already implement this behavior.

### G3a — tool-bubble exit timing (confirmed)

After tool completion, retain the tool bubble until the next language segment starts or the turn ends.
Any execution indicator stops when the real tool invocation completes. The retained name does not
mean that the tool is still running. This defines the start of visual exit; its brief animation does
not delay execution or the arrival of the next text.

### G3b — motion continuity and layout stability (confirmed requirement; design delegated)

The owner requires smooth bubble appearance/disappearance and interactions between bubbles. Existing
language bubbles must not suddenly change position when a tool bubble leaves. Apply this concern to
the other UI/UX surfaces as well. The owner delegated the concrete transition and interaction design;
do not turn animation durations/easing choices into further approval questions.

[The motion continuity design](uiux-motion-continuity-2026-09-05.md) specifies anchored content,
coordinated opacity/occupied-space transitions, tool-to-text handoff, streaming/scroll behavior,
interruption safety, reduced motion, cross-surface application, and verification. Its detailed motion
values are design defaults for later implementation/visual tuning, not already accepted test results.
This requirement does not expand the existing task boundaries or authorize production implementation.

### G3c — Pet terminal error bubble (confirmed)

For the discussed case where an error ends the turn without a subsequent language reply, show one
error bubble containing the error message itself. The owner chose this direct presentation; do not
add the previously proposed Open Chat action inside the error bubble. The existing general chat
navigation remains separate. Preserve prior language bubbles and apply the same continuity rules.
This error bubble is not a successful assistant reply or an ordinary temporary tool-name bubble.

The owner separately requested an error-code/message cleanup because different failures often produce
the same vague message. Record it as **D77**, with [scope and source evidence](error-code-message-followup-2026-09-05.md).
The current bubble uses authoritative safe error text; the deferred work must preserve specific
causes and make them understandable without exposing raw exceptions or inventing missing reasons.

## G4 — useful details and removal of internal metadata (confirmed)

The owner rejected the suggestion to preserve arbitrary technical data in a secondary disclosure.
Use the local reference implementations to design useful operation details, and remove hashes,
internal revisions/generations, opaque IDs and similar meaningless information from MCP/Skills and
the other user-facing pages, including their expanded details. This is part of the current UI/UX
scope; moving the same information into an Inspector or copy control does not satisfy it.

[The reference study and removal inventory](uiux-useful-information-2026-09-05.md) records actual
DSH/Pi patterns, their exceptions, the affected TakiAgent fields, and tests preserving the old behavior.
Keep meaningful commands/inputs/results/diffs, names, configuration, error explanations and measured
usage/timing within existing privacy boundaries. Preserve internal data required for canonical records,
bindings, concurrency and replay; no schema deletion or replacement diagnostic screen is requested.

The older D65 and D68 wording allowing a general technical-details escape hatch is superseded by G4.
Frontend and observability specs and task artifacts must use the same field-selection rule. Normal
UI must not render a broad metadata dump merely because an API exposes those fields.

## G5 — DSH Trajectory port as the Monitor product baseline (confirmed)

The owner considers the current trace-monitoring UI unfinished and unsuitable as the product baseline:
it proves that Agent behavior can be tracked, but its information is cluttered, irrelevant fields remain,
Chinese labeling is incomplete, and its interaction/visual quality is unsatisfactory. This is owner
feedback, not a new visual test performed by this session.

Rebuild Monitor primarily by porting the DSH Trajectory presentation: its layout, information density,
grouped ledger, timing Overview, selected-record Inspector, controls, scrolling and visual hierarchy.
The work is more than repairing the current PageCard scaffold or changing a few labels. Follow
[D68's source-to-target port plan](../../08-28-dsh-observability-expansion/design.md).

Use DSH source/components/styles directly where practical, with necessary adapters for TakiAgent's
React/window stack, Core Run/Event facts, Chinese UI copy, G4 useful-field selection and privacy.
Do not import a second DSH runtime/Session authority or restore meaningless raw metadata. Model/tool
names, commands, paths and actual output keep their identity; system-owned labels and status text are
Chinese. Direct reuse retains the verified MIT attribution/license notice.

Monitor visual/interaction acceptance must compare representative states against DSH and include
actual WebView2 interaction. Existing traceability evidence and the earlier broad visual feedback do
not count as approval of Monitor's current appearance. Non-Monitor visual reuse remains unchanged.

Remaining Pet combinations include multiple tools without intervening language; derive their design
from G3 rather than reopening its confirmed normal and terminal-error behavior. The remaining scope
choice includes whether new D75 compaction measurements belong in the first delivery batch. D68
implements G5's DSH product baseline and G4's information selection. Resolve only material
product choices one at a time and derive implementation mechanics from existing contracts and source.

## Execution constraints for later batches

The [2026-09-06 execution delegation](uiux-execution-delegation-2026-09-06.md) supersedes the earlier
confirmation/commit restrictions below for the current UI/UX program. Main proceeds and commits
checked work autonomously; product fidelity, source review and truthful acceptance evidence remain.

- Work only in `H:/TakiAgent-worktrees/t4`; verify branch, worktree, and session task before execution.
- Semantic search uses `jbcontext`; YCE is prohibited. Include this restriction in every agent prompt.
  Read current source after an indexed hit; an index is not proof of current implementation.
- The main session owns scope, documents, shared contracts, integration, and final review. Implementation
  agents use `gpt-6-astra` with `high` effort; check agents use `gpt-6-astra` with `xhigh` effort.
  Subagents must not recursively dispatch. Preserve other contributors' changes.
- Owner process refinement (2026-09-05): main may skip a separate check agent for simple, low-risk
  changes or combine related checks to avoid waste. Focused verification still follows actual risk;
  authorization, protocol, streaming-state and data-consistency changes retain independent review.
  Do not re-run a completed check without new changes, failures or unresolved concerns.
- Explain the batch's scope, task ownership, acceptance, and collaboration boundary before starting
  implementation. Planning consent is not implementation consent.
- User communication is Simplified Chinese; engineering documents, code, and comments are English,
  encoded as UTF-8 without BOM. Keep the existing source size and function limits; do not compress
  formatting to meet a line count.
- No commit, push, task activation, finish, or archive is authorized by G1. The previous compaction
  closeout is complete and is not reopened here.
