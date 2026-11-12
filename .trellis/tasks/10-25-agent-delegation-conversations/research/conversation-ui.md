# Research: Continuous private child conversation UI

- Query: How can the child page share the established Chat presentation and interaction behavior while retaining private authority, sender identity, reliable controls, reading position and truthful live activity?
- Scope: Internal code and specification research; no production edits or new dependencies.
- Date: 2026-10-25.
- Authority: The task PRD and the October 24 section of `docs/AGENT-DELEGATION-RESEARCH.md`; the last source-session instruction authorizes planning. The explicit dispatch names this task. The child session has no current-task pointer; the legacy `.trellis/.current-task` points to the old Avatar lab and was not changed.
- Evidence level: Current dirty-worktree source inspection. No browser/native interaction, test execution or human acceptance is claimed by this report.

## Findings

### Current behavior and concrete limitations

| Evidence | Finding and consequence |
| --- | --- |
| `apps/desktop/src/features/subagents/subagent-detail.tsx:22`, `:25`, `:46`, `:48`, `:54` | The view filters one work, renders a separate control form, then input records, transcript and result cards. It shares individual `TimelineMessage` rows, but not a continuous conversation container. |
| `apps/desktop/src/features/subagents/subagent-detail.tsx:25` | Message inclusion depends on a matching execution in the separately paged execution array. A loaded message can remain invisible when its execution is outside that independent page; the new projection must carry work identity with the message instead of relying on that join in the browser. |
| `apps/desktop/src/features/subagents/subagent-transcript.ts:13`, `:17`, `:21`, `:33` | Input receipt rows are omitted. Output/tool identities are scoped to Run/Attempt and message sequence; tool call/result are merged into one item. Retain this identity discipline, but integrate accepted input and report events instead of dropping them. |
| `apps/desktop/src/features/subagents/subagent-inputs.tsx:9` | The input panel already labels user/parent/system and distinguishes accepted input from model-intent inclusion. These semantics belong on actual conversation entries after redesign. |
| `packages/core/src/server/methods/subagent-methods.ts:30` | Operator Send/Continue/Stop binds user origin at the trusted RPC entry; it is not a browser-controlled sender claim. |
| `packages/core/src/agents/run-message-store.ts:123` | Model input explicitly distinguishes the real user, delegating Companion and trusted work owner. The UI must preserve the same distinctions without displaying the internal prompt wrapper as the user's actual words. |
| `apps/desktop/src/features/subagents/subagent-composer.tsx:20`, `:24`; `subagent-detail.tsx:46` | Draft is component-local and cleared only after an accepted response if the user has not edited it. That useful revision guard is lost on a child/work-key remount; selecting another work unmounts the old draft. |
| `apps/desktop/src/features/subagents/subagent-composer.tsx:34` | Current Send and Continue are different operations. Sending to a user-stopped child stores input without resuming it. A familiar `Send and continue` mapping must call the authoritative Continue operation deliberately, not silently reinterpret Send. |
| `apps/desktop/src/features/subagents/subagent-controller.ts:44`, `:108`, `:139` | Existing controller owns client generations, serialization, exact displayed-target checks, unknown-outcome messaging, read invalidation and accepted echoes. Reuse these protections rather than replace the controller with a simple chat hook. |
| `apps/desktop/src/features/subagents/subagent-controller.ts:62`; `use-subagents.ts:19` | Actual route/document visibility gates reads and publication. A hidden mutation can settle; re-entry reconciles. Preserve this retained-page behavior. |
| `apps/desktop/src/features/subagents/subagent-reads.ts:26`; `packages/core/src/harness/subagent-queries.ts:59` | History has independent ascending input/message/execution cursors. A refresh rereads the requested page depth from the beginning; the schema has no newest/older conversation page. This cannot directly support Chat's newest-first entry and prepend-older behavior efficiently or coherently. |
| `packages/shared/src/subagent-api-schema.ts:15`, `:35`, `:52` | The current summary has no `needs_input` state, and `subagent.changed` is a data-free invalidation hint. History returns raw category arrays, not a combined conversation page or live coverage. |
| `packages/core/src/harness/subagent-execution.ts:28`, `:43`; `packages/core/src/agents/run-message-store.ts:70` | The child supplies no `TurnContext.activity` and discards streamed deltas. Completed private steps persist and publish invalidation; this is not live token/tool presentation. An active child can legitimately show a run state while its next output is not yet visible. |
| `packages/core/src/agents/chat-agent.ts:310`, `:337`, `:405` | Shared execution already has an injected activity seam using the real SDK stream and invocation observer. A private scoped sink can reuse it. |
| `packages/core/src/agents/chat-activity-projection.ts:28`, `:33`, `:43` | Existing activity recovery is latest-per-Character. Feeding concurrent children into this projection would overwrite one another and contaminate main/Pet activity. It is not the child recovery owner. |
| `apps/desktop/src/windows/home/pages/chat/tool-result-display.ts:35`, `:47` | Delegation lacks a semantic formatter; unknown structured output becomes generic JSON. Main-model output compression and user-facing tool formatting are separate tasks. |

### Shared presentation boundary

Recommended approach: retain separate main and private controllers and extract a small shared conversation presentation surface from the existing Chat implementation. This is a refactor of existing components, not a second copy or a new chat framework.

1. **Conversation frame and transcript.** Generalize `TimelineView`'s input from the entire `ChatTimeline` return type to a narrow presentation contract: ordered groups/items, initial load/error, older-page availability and action, optional live content, and a stable target key. Reuse its single scroll container, row keys, date grouping, lazy Markdown, tool cards and new-content affordance. Main Chat supplies its existing adapter; the child controller supplies a private adapter. Keep main-specific adjuncts outside the shared frame.
2. **Sender-aware entries.** Extend the shared presentation item metadata with optional trusted sender display (`user`, `parent`, `system`, `worker`) and material/source details. Native model role remains independent. User input may align right; parent direction needs an explicit readable label, and system lifecycle notices should be visually distinct. Do not rely on color or map all `role:user` input to the human. Retain raw evidence identifiers internally while exposing readable labels.
3. **Composer.** Share the textarea/IME-safe Enter behavior, button styles and geometry. Let adapters own draft value, accepted-submission revision, action labels, whether input can be submitted during active work, and attachment capabilities. The current main `Composer` forbids Send while `isSending` and clears immediately; those are main-chat policies, not a suitable universal worker policy. A running child must remain addressable while Stop is available.
4. **Child-owned state.** Keep one in-memory draft and reading/paging state per Character/child and addressed work when necessary. Switching child or selecting an older work must not erase the draft or accidentally retarget it. Store current draft revision and submitted operation identity independently of a React remount. No private content in localStorage.
5. **Keep main behavior isolated.** Do not mount `ChatPage` or invoke `useChatTimeline` inside the child page. `chat-page.tsx:25` owns a separate Chat socket; `:30` and `:34` wire relationship presentation exposure; `:37` adds pattern/co-watching controls. Child reads can continue using Home's authenticated client. Shared presentation must not inherit primary Timeline writes, Memory hooks, presence exposure or Companion-specific adjuncts.

Known reusable source seams:

- `apps/desktop/src/windows/home/pages/chat/timeline-view.tsx:69`, `:82`, `:87`: stable flat keys and scrolling integration.
- `apps/desktop/src/windows/home/pages/chat/use-timeline-scroll.ts:43`, `:54`, `:75`, `:93`: selection ownership, prepend anchor, finite resize following and cleanup. Add target-state restore through an explicit adapter rather than duplicate these rules.
- `apps/desktop/src/windows/home/pages/chat/timeline-message.tsx:35`: semantic tool-card dispatch and safe Markdown/image presentation.
- `apps/desktop/src/windows/home/pages/chat/chat-transcript.ts:18`: existing discriminated presentation item union, including optional committed exposure. Private items must never receive primary committed targets.
- `apps/desktop/src/windows/home/pages/chat/composer.tsx:73`: IME-safe Enter decision; its primary send policy at `:80` must remain in the main adapter.
- `apps/desktop/src/features/subagents/subagent-state.ts:36`: exact target includes child, work, control version and active Run, with explicit nullable Run identity.

### Core projection needed before the final UI refactor

Use the existing input/message/result stores as content authorities. Add a continuous **read projection**, not another independently writable transcript or model-session store.

The combined page must provide:

- Stable `entryId` and per-conversation ordering coordinate; explicit child/work identity; optional Run/Attempt and native-part identity where relevant.
- Entry kind and trustworthy sender: accepted user/parent/system input, worker language/tool, asynchronous report, input request, final report, or runtime lifecycle notice.
- Readable content plus optional source/material evidence. Repeated model-intent receipts must update one accepted-input entry rather than repeat that input each time it is included in a request.
- Input acceptance and model-intent inclusion as separate facts. Likewise, parent-event acceptance, delivery and handling are separate from publication or actual presentation.
- Current authoritative summary/control target, response revision/watermark and exact paging cursor. Support newest page, bounded older pages and forward recovery after a coverage gap. Errors/unavailable/empty/exhausted must remain distinct.
- Work boundaries inside one conversation. An optional work focus or jump may locate a job; it must not split the child into unrelated transcripts or send future input to an old work by accident. Show the addressed work beside the composer when historical focus differs from active/latest work.
- Historical unknown ordering/sender facts remain unknown; do not manufacture an exact sequence from random Run IDs or assert that creation timestamps prove cross-table commit order.

**Ordering tradeoff:** a server-side union using existing timestamps and stable tie-breakers is cheap and can provide a deterministic historical projection, but cannot prove exact order for concurrent events sharing a timestamp or for accepted input before its first model receipt. For new events, prefer one narrow per-conversation commit-order reference index maintained transactionally by the existing owners. It stores kind/source reference/order, not duplicate input/output text or a new execution state. It can cover accepted inputs, private output batches and lifecycle/report references. Backfill historical entries deterministically with an explicitly legacy ordering basis. If the runtime plan provides equivalent common commit coordinates, reuse them instead of adding another index. The child-to-parent inbox sequence alone is insufficient: private user inputs intentionally do not enter that inbox.

Batch and live linkage must make handoff deterministic: identify the committed batch and complete set of references covering each live item. A first durable row cannot clear a whole in-flight step. Keep observed text until the complete committed replacement is available, preserving the DOM keys. Tool call/result pairing must survive page boundaries and remain scoped by Run/Attempt/invocation.

### Real private activity and recovery

Use the shared activity producer at actual SDK and tool-invocation observation boundaries. Supply an explicitly private sink to the child Run. Extract reusable pure activity/recovery mechanics where appropriate, but maintain a private scope keyed by child/Run/Attempt and bounded selected-child subscriptions; never reuse the Character-only main projection instance or broadcast channel.

- Install private handlers before subscription/snapshot. Merge intervening events after the snapshot watermark; reject retired client/child/Run/Attempt callbacks.
- Carry stable item identity, monotonic event sequence, actual tool phase/outcome and measured duration only if the producer knows it. No guessed token progress or fake timing.
- Keep durable completed/partial evidence and disposable active presentation separate. After restart, show retained partial text and canonical interrupted/unknown state; do not resume an old stream or resend commands.
- Overflow/gaps produce stale/unavailable presentation with a bounded snapshot/durable reread path. A long conversation must not become a whole-history reread on every token.
- Data-free `subagent.changed` remains useful for lists, control state and committed changes; do not add polling. Hidden views retain lightweight gap obligations, retire heavy selected-child observation, and reconcile once on visible re-entry.
- Main/Pet stream and child streams must be proven independent under concurrent activity. Private text is never automatically published to the relationship Timeline or exposure reporting.

### Controls and readable state

Recommended concrete UX mapping, subject to the final plan:

| Situation | Composer/control behavior | Truth to preserve |
| --- | --- | --- |
| Child idle or completed | Normal Send addresses the displayed valid conversation/work; deliberate continuation can create a new Run | Completed task does not close the conversation |
| Child running | Input remains editable and can be sent as asynchronous addressed input; Stop remains a separate available action | Acceptance does not imply the current model step received it |
| Child requests input | Show the question in sequence and a waiting-for-input state; Send supplies addressed input | Waiting is neither successful completion nor failure |
| User Stop in progress | Show stopping until canonical settlement; preserve draft and already accepted pending input | A Stop RPC acknowledgement is not terminal execution |
| User-stopped, no active Run | Expose `Continue` with empty draft and `Send and continue` with a draft; submit the authoritative Continue operation once | This is explicit user-origin continuation; parent input cannot clear the latch |
| User wants to store input while stopped | Keep the existing separate Send-only capability in a clearly labeled secondary action if retained | Stored input does not imply resume; never clear the latch through ordinary parent Send |
| Parent-stopped or externally interrupted | Explain the actual state and available explicit action from Core | Do not reuse user-stop notification suppression for unrelated failures |
| Reconnecting or stale target | Preserve readable content/draft; disable dependent actions until current target is reconciled | No offline command queue, no automatic mutation replay |
| Mutation timed out | Release busy state, retain draft/submitted operation and show unknown outcome; reread deliberately | Do not blindly retry under a new operation ID and duplicate input |
| View closed/navigation away | Retain appropriate local draft/reading state while mounted; release disposable observation | No child Stop, permanent closure or main report is implied |

A `Send and continue` action can reuse `subagent.continue` with the draft, because the RPC already binds user origin and carries direction/materials. Do not implement `send` followed by `continue` as two independent mutations. Existing `expectedControlVersion` and expected active Run checks survive all action variants. Reading an older work may require an explicit target switch before continuing; the browser must never guess the current work from a stale selection.

The current child RPC supports direction and source-aware text materials, not main Chat's binary image-attachment pipeline. Sharing the composer shell does not by itself authorize or implement new child image ingestion. Preserve all supported inputs and represent capabilities explicitly; do not show an attachment button that silently drops content. Whether to expand child media input is a separate scope decision if requested.

### Delegation result readability

Add a feature-owned semantic delegation formatter registered at the existing tool-display seam, analogous to the pattern/follow-up formatters. Render child label, requested action, truthful state, useful summary/output and actionable navigation. Exact action targets remain internally available; a readable name does not replace the target token.

Show final reports once in their conversation position. The tool invocation may show concise acceptance/state and link to the report; do not render the entire body again as both tool JSON and a separate result card. Parent handling/disposition and publication status should be compact linked details on the relevant report. Private user messages must not be mirrored into the parent just to make the UI coherent. Internal digest/operation bookkeeping does not belong in the normal reader path.

## Alternatives and maintenance tradeoffs

| Approach | Benefit | Cost / verdict |
| --- | --- | --- |
| Keep existing controller; extract shared frame, composer shell and sender-aware row presentation | Preserves generation/CAS protections and the accepted Chat reference; isolated main/private adapters | Recommended. Requires explicit shared props and backend coherent projection/live work; moderate focused refactor |
| Mount a parameterized full `ChatPage`/`useChatTimeline` for workers | Superficially maximum reuse | Reject: couples child private state to primary socket, Timeline, exposure, Memory and Companion adjuncts; conditional complexity grows |
| Copy Chat into the subagent feature and restyle it | Fast initial visual parity | Reject: duplicates scroll, IME, draft, stream handoff and reconnect behavior, recreating drift the owner asked to remove |

## Validation plan

No new test is needed merely to validate this research document. Later implementation should retain existing controller/presentation cases and add scenario-driven coverage at the actual seams:

| Scenario | Required evidence |
| --- | --- |
| User/parent/system inputs interleave with worker text/tool/result across Runs and work items | One stable ordered transcript; readable source labels; no repeated input receipts or duplicated report bodies; native tool pairs intact |
| More than one page of every source type; independently paged execution lookup would miss a message | Newest view is complete, older pages prepend without duplicates/gaps, scoped cursors reject wrong child; no browser execution-array join |
| New live event races snapshot, first durable row, complete batch and reconnect | Stable item/DOM identity; no dropped tail, duplicate tool/text, stale stream reconstruction or false completion |
| Two children and main Chat run concurrently | Independent activity and controls; child traffic does not overwrite main/Pet or another child |
| Pending send followed by typing, child switch, work switch, hide/show and reconnect | New draft survives; old acknowledgement clears only matching submitted revision; no target retargeting or automatic resend |
| Stop then private correction then Continue, and a concurrent parent message | One explicit user Continue clears the latch; parent Send cannot; Stop itself produces no main attention event; resumed reports work normally |
| Timeout/unknown result followed by successful reconciliation | Busy clears, truthful unknown state persists until evidence resolves it; input is not duplicated |
| Read-only history focus differs from active/latest work | Visible addressed target; stale action refuses; active worker remains untouched |
| User scrolls up/selects text while live output/tool details/older pages arrive | Reading anchor and selection stable; new-content button works; no token-by-token smooth-scroll |
| Long conversation, overflow or missing producer snapshot | Bounded presentation/read work and explicit unavailable/stale feedback; no invented metric or polling loop |
| Private conversation renders inside shared components | No primary Timeline append, Memory write, committed presence target or Companion adjunct activated |

Relevant existing test seams: `subagent-controller.test.ts` already covers subscription acknowledgement, target swap, exact CAS target, unknown reconnect outcome, conflict/refetch separation, hidden mutation settlement and work selection. `subagent-presentation.test.tsx` covers input receipts, publication truth, user Stop and Run/Attempt tool scoping. `composer.test.ts`, `use-timeline-scroll` and Chat activity/store tests protect the shared behavior; extend only for new contracts.

After implementation, run targeted deterministic suites, then project-required checks using actual scripts (`pnpm --filter @taki/desktop typecheck`, `pnpm --filter @taki/desktop test`, relevant root lint, and Desktop build). The current Desktop package has no separate `lint` script, despite a generic frontend-index example. Native WebView2 evidence should exercise the actual production UI/WS/Core over an isolated database with deterministic model transport, recording long-scroll, input/Stop/Continue, independent streams, reconnect, selection/focus and rendered sender/output states. Static markup and compilation do not establish interaction or visual acceptance. Personal owner acceptance remains unpassed until the user confirms it.

## Related specifications and references

- `.trellis/spec/frontend/home-window.md:107`: private conversation isolation and exact displayed-target controls.
- `.trellis/spec/frontend/foreground-chat-feedback.md`: stable ordered rows, complete commit handoff, safe Markdown and actual WebView2 checks.
- `.trellis/spec/frontend/reactive-read-models.md`: producer-driven reads, serialized mutation, hidden view lifecycle, cursor/anchor preservation and no polling.
- `.trellis/spec/frontend/operator-connection-recovery.md`: generation guards, request deadlines, unknown mutation outcomes and no intent replay.
- `.trellis/spec/frontend/state-management.md`, `component-guidelines.md`, `hook-guidelines.md`, `quality-guidelines.md`: shared presentation, disposable state and quality requirements.
- `.trellis/spec/backend/foreground-chat-activity.md`: current primary producer/recovery contract to preserve while reusing pure mechanics.
- Existing October 23 native evidence: `.trellis/tasks/10-21-agent-context-acceptance/research/native-runtime/report.md`. This is historical scripted-model evidence, not a fresh run or usability approval.
- Existing versions from `apps/desktop/package.json`: React `^19.2.0`, Zustand `^5.0.14`, `@tanstack/react-virtual` `3.14.9`. No dependency addition is justified by this UI plan. This report proposes no version-sensitive new library API and therefore does not claim a new external API validation campaign.

## Caveats / Not Found

- No child streaming activity producer/recovery is currently wired through `TurnContext.activity`; complete-step invalidation is the observed source boundary.
- No combined private ordering cursor exists in the inspected schema. Input acceptance, output persistence and lifecycle/report ordering must be resolved in Core before promising exact Chat chronology.
- No permanent-close feature is required or implemented by this plan. Closing the view must remain disposable.
- This report does not re-open settled product decisions, authorize production work, or claim human/native acceptance. API/type names and the exact ordering-index shape are implementation design choices to reconcile with the runtime research.
