# Cancel-retract: "not yet spoken → retract, already speaking → stop" — implementation brief

User-approved design (2026-07-17, option 1). Applies to the chat window's 中断 button (bubble has no cancel entry).

## Semantics (locked)

- Cancel while the turn has produced NOTHING (no completed steps, no partial text — i.e. exactly when today's
  persistTurn would persist nothing beyond the user row): **retract** — the just-appended user timeline row is
  deleted (DB + live UI), the message text returns to the composer draft, and the message never enters model
  memory (autoMemory/imageMemory must NOT fire for the turn).
- Cancel after ANY output persisted (a completed step with tool calls, or partial text): **stop** — exactly
  today's behavior (partial persisted, error notice). No changes to this path.
- Attachments of a retracted message are NOT restored client-side (bytes stay in the content-addressed store
  until TTL GC; the user re-picks). Note this in a code comment.

## Verified current-state facts (do not re-derive)

- `chat-agent.ts` stream(): `store.appendUser(...)` runs at stream start; the finally block calls
  `persistTurn(store, characterId, { result, pendingStepText, streamEnded })`; after it, DETACHED
  `autoMemory?.onTurnCompleted` fires unconditionally and `imageMemory?.onImageTurn` fires for image turns.
- `persistTurn`: appends completed-step messages (result.responseMessages resolved, reject→[]) +
  `pendingStepText` if non-empty. Abort at step 0 ⇒ both empty ⇒ nothing persisted.
- Cancel path: `chat.cancel` → TurnRegistry.cancel → AbortController.abort → the SDK throws out of the stream →
  chat-send `pump` catch → `chat.error { code: PROVIDER_ERROR, message: "turn cancelled by operator" }` (this is
  what the operator sees today as the cancel notice).
- Tool cards render from PERSISTED tool rows (timeline.appended after the turn) — there is no mid-turn tool push,
  so "she hasn't spoken" is fully captured by "nothing persisted beyond the user row".
- D1 freeze (see the turn-runtime spec/PRDs): stream loop / persistTurn / abort / toolApproval byte-unchanged;
  ONLY named additive seams. The detached autoMemory/imageMemory calls are post-freeze additions (#17) and may be
  conditioned.

## Design

### Shared protocol (additive only; verify protocol.rs — do NOT touch the Rust-mirrored ErrorCode enum)

1. `ChatErrorSchema` += `retracted: z.boolean().optional()` — true only on the retract outcome. Confirm ChatError
   is NOT mirrored in `apps/desktop/src-tauri/src/protocol.rs`; if it unexpectedly is, mirror the optional field.
2. New timeline notification: `TIMELINE_METHODS.removed = "timeline.removed"`,
   `TimelineRemovedSchema = { characterId, seq }` (+ exports + schema tests). Operator-only push, no Rust mirror.

### Core

3. `db/timeline-repo.ts`: `deleteEntry(characterId, seq)` (SQL delete; single-writer invariant 2 holds).
4. `agents/conversation-store.ts`: `appendUser` returns the appended entry (or at least its seq — callers:
   chat-agent + tests). New `removeEntry(characterId, seq)` → repo.deleteEntry + fire a new `onRemove` hook
   (mirror the existing `onAppend` wiring; main.ts wires it to timeline-subscriptions).
5. `server/timeline-subscriptions.ts` (or wherever publish lives): `publishRemoved(entry-ref)` pushing
   `timeline.removed` to the character's subscribers; main.ts wires conversation-store.onRemove → publishRemoved.
6. `agents/chat-agent.ts` — NAMED ADDITIVE SEAM, frozen bodies untouched:
   - Capture `const userEntry = store.appendUser(...)` (was void).
   - `TurnContext` += optional `onRetract?: () => void`.
   - AFTER the existing finally (persistTurn) — do not modify persistTurn itself — compute
     `const completedCount = await Promise.resolve(result.responseMessages).then((m) => m.length, () => 0)` and
     `const retract = (turn?.signal?.aborted ?? false) && completedCount === 0 && pendingStepText.length === 0`.
     When retract: `store.removeEntry(characterId, userEntry.seq)`, call `turn?.onRetract?.()`, and SKIP the
     detached autoMemory/imageMemory calls (guard both with `!retract`). When not retract: behavior byte-identical
     to today.
7. `server/methods/chat-send.ts` pump: provide `onRetract` in the turn handle (sets a local flag); in the catch,
   when the flag is set send `chat.error { code: PROVIDER_ERROR, message: "cancelled before reply; message retracted",
   retracted: true }` instead of the raw abort message. (The retract turn always exits via the abort throw.)

### Desktop UI

8. `lib/ws-client.ts`: register `timeline.removed` (zod-parse via TimelineRemovedSchema) → `onTimelineRemoved(cb)`
   registration mirroring `onTimelineAppended`; `ChatHandlers.onError` gains the optional `retracted` boolean
   (thread the parsed field through).
9. `windows/chat/chat-timeline-store.ts`: `removeEntry(seq)` reducer (filter entries).
10. `windows/chat/use-chat-timeline.ts`:
    - register `onTimelineRemoved` → store.removeEntry.
    - runSend onError: when `retracted === true` → `clearInflight()` + set hook state `retractedDraft = message`
      (the send's own message argument — thread it into runSend) and NO toast; otherwise current behavior
      (clearInflight + pushToast(reason)).
    - `ChatTimeline` += `retractedDraft: string | null` + `consumeRetractedDraft: () => void`.
11. `windows/chat/composer.tsx`: effect — when `retractedDraft !== null`: if the draft is empty, restore it into
    the textarea; if the user already typed something new, surface the retracted text as an info toast instead
    (never overwrite). Then consume. Props extend accordingly (chat-window threads them).
12. The pet bubble parses ChatError too — additive field is harmless; no bubble changes.

## Conventions

CLAUDE.md law: kebab-case; module-contract headers on new files; file<=300/fn<=50/params<=3 (deps objects);
zod XSchema + z.infer, no parallel interfaces; one WS notification schema next to its siblings; index.md updated
for every touched folder; comments why-only English; erasableSyntaxOnly (no param properties/enums).

## Tests (define before coding)

- shared: TimelineRemovedSchema + ChatError.retracted parse tests (existing chat/timeline schema test files).
- core timeline-repo: deleteEntry removes the row, later reads exclude it.
- core conversation-store: removeEntry fires onRemove + repo delete; appendUser returns the entry/seq.
- core chat-agent (extend chat-agent tests, mock model): cancel-before-output (abort pre-first-delta) ⇒ user row
  deleted, onRetract called, autoMemory/imageMemory NOT called, nothing persisted; cancel-after-partial ⇒ current
  behavior preserved (partial persisted, no retract, autoMemory fires).
- core chat-send (if a method-level test exists): retract flag reaches chat.error payload.
- ui ws-client test: timeline.removed dispatches the registered handler; chat.error retracted flows to onError.
- ui chat-timeline-store test: removeEntry reducer.
- Gates: `pnpm -r test`, both tsc, `pnpm lint`, `pnpm --filter desktop build`, core boot smoke
  (`TAKI_WS_PORT=18974 pnpm --filter @taki/core exec node --env-file-if-exists=../../.env.local src/main.ts`
  — kill after "ws server listening"; the user's real core owns 8974).

## Out of scope

- Bubble cancel entry; attachment restore; message-level edit/delete/regenerate (D33); ErrorCode enum changes.
