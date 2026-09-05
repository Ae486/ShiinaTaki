# Live tool feedback across Chat and Pet

## Goal

Show timely, truthful tool activity in Chat and Pet while keeping the existing Core execution and
continuous-timeline authority, with stable text segmentation and smooth layout transitions.

## Requirements

- Continue G2/G3/G3a/G3b/G3c and D67 audit items U8/U9/U10. The naming child supplies readable
  operation labels; live feedback must preserve canonical call/result identity internally.
- Reuse A2's immutable Run `toolDisplayNames` and optional Timeline `displayName` contract from
  [Operation Presentation](../../spec/backend/operation-presentation.md). Live and persisted entries
  must share the captured name; never look up a newer MCP catalog during the handoff.
- Chat interleaves one compact entry per tool call with language in actual order. Update state in
  place, keep terminal outcomes, and collapse useful operation details by default. A received call is
  not proof that execution started; failures including structured tool failures must not look successful.
- Reconcile live activity with persisted history atomically, without duplicate cards, lost text,
  stale spinners or replay of effects after reconnect. Do not create another durable timeline/runtime.
- Pet follows language A -> temporary tool bubble 1 -> language B -> temporary tool bubble 2.
  Keep A and B as separate language bubbles. The tool bubble names the tool, stops its running
  indicator on completion, and exits when the next text segment starts or the turn ends.
- Preserve layout continuity, reading/scroll/focus anchors and reduced-motion behavior during insert,
  removal and interrupted transitions. Detailed motion mechanics are delegated to the main session.
- On terminal error without subsequent language, show one error bubble containing the error message;
  do not add an action inside it. Broader error-code/message governance remains D77.
- Derive consecutive/multiple-tool and cancellation behavior consistently from the confirmed rules;
  resolve any remaining material product ambiguity before implementing that dependent behavior.

## Acceptance Criteria

- [ ] Text/tool/text/tool sequences render in true order before the turn completes.
- [ ] Call receipt, execution, success, failure and cancellation use real producer facts and reconcile
      with stored history without duplicates or terminal calls appearing active.
- [ ] Pet retains separate language segments, removes completed transient tools at the agreed boundary,
      and shows the agreed single terminal-error bubble.
- [ ] Long streams, historical scrolling, reconnect and late/out-of-order results preserve the active
      turn/selection and never trigger duplicate execution.
- [ ] Interrupted transitions and reduced motion leave no jumps, hidden input blockers or stale bubbles.
- [ ] Relevant Shared/Core/Desktop gates and real WebView2 interaction checks pass; owner visual
      acceptance remains explicit.

## Notes

- Planning child created with owner consent on 2026-09-05. Complete the source-backed event/data-flow
  design and ordered Chat/Pet execution slices before activation.
- Sources: [G2/G3 decisions](../08-22-t4-agent-architecture-observability/research/uiux-grill-2026-09-05.md),
  [motion design](../08-22-t4-agent-architecture-observability/research/uiux-motion-continuity-2026-09-05.md)
  and [useful details](../08-22-t4-agent-architecture-observability/research/uiux-useful-information-2026-09-05.md).
- Excluded: D68 Monitor rebuild, new Live2D configuration, D75/D76 compaction evaluation, D77 error
  taxonomy, Hindsight/memory changes, and proactive-Agent/heartbeat/cross-device implementation.
