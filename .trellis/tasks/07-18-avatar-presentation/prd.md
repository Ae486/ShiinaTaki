# T1 — Avatar Presentation (表情动作专项)

M5 task 1 of 11 (blueprint: `docs/devlog/m5.md`). No single GitHub issue — packaged-testing increments (2026-07-18 owner report) + D17's M5 half. Four items, ordered; each lands independently.

## Scope

### 1. Tool-reply discipline (1c — research-first, the bug that degrades every conversation)

Evidence (owner screenshot 2026-07-18): one user message produced 5 assistant segments interleaved with avatar tool calls, ending in filler ("嗯。") and self-conversation drift ("嗯，拜拜。回来再聊" — nobody said goodbye). Mechanism (verified): every avatar tool call ends a ToolLoopAgent step; the `{ok:true}` result forces the model to generate ANOTHER step; having nothing substantive left, it pads — and continues from its OWN last utterance.

Fix directions (research ranks them):
- Prompt layer: avatar vocabulary section gains hard rules — express ALONGSIDE the reply (same step); after a tool result, either substantive content or STOP; never respond to your own message.
- Structural layer (must respect the D1 freeze — `stopWhen`/agent-construction options are allowed, frozen loop bodies are not): step-cap/stop-condition tuning, per-turn avatar-call budget, tool-result shape.
- Sediment the taxonomy (fire-and-forget presentation tools vs read-the-result info tools) into `.trellis/spec/` tool-design guidance.

### 2. Live vocabulary reporting fix (1b)

`avatar-vocabulary.ts` seam already supports live re-reporting (`set` from avatar.report; header says "re-reports on load / costume-swap"), but runtime evidence shows the LLM holds template names that don't exist on the worn costume (cross-character-ref costumes; unknown names are silently ignored). Research locates: WHAT the Pet UI reports (raw settings list vs post-prune resolved list — #18's `settings-prune`/`costumeResolution` data exists) and WHETHER a costume switch re-reports. Fix: report the PRUNED, actually-playable inventory + force re-report on every switch.

### 3. Idle Motion scheduler (1a — renderer reflex, zero-LLM)

Per CONTEXT.md **Idle Motion**: after any one-shot motion finishes → automatic return to the idle state (today: freeze on last frame); while idle → random motions drawn from a preset pool at random intervals. Deterministic, works offline. First Hook consumer (motion-finish → idle return) — but NO generic hook bus yet (YAGNI; extraction when a second consumer appears — write internals extraction-friendly). Pool source v1: derived from the worn costume's resolvable motions (operator-configurable pool arrives with settings #24/#26 — defer the UI, not the mechanism). Must be costume-switch-safe (ticket/isStale pattern) and model-absence-safe.

### 4. Mouse-proximity reactions (D17's M5 half)

Cursor approaching the pet triggers a reaction (BANDORI increment); throttled/cooldown so it never spams. Agent-chosen expressions are Heartbeat territory (T4) — NOT this task.

## Q1 cleanup contract (blueprint)

Research brief includes module-health notes for touched modules (avatar/, renderer live2d/, chat-agent instruction path). Impl fixes debt ONLY in files the task touches (duplication, orphans, stale headers, size caps); untouched files are off-limits. Check verifies both.

## Constraints

- CONTEXT.md terms exactly (Idle Motion / Hook / Heartbeat). Idle animation (engine breathing/blink) is distinct from Idle Motion.
- D1-frozen turn runtime: no frozen-body edits; construction-level knobs (`stopWhen`, instructions, tool sets) are the allowed surface. v7 abort double-ending law applies to any test touching cancellation.
- Renderer stays framework-free (zero React imports); packaged-build defect classes spec applies (`.trellis/spec/frontend/packaged-build.md`); per-window ACL law for any new Tauri API call.
- Protocol: if avatar.report's shape needs a field, additive zod evolution in `@taki/shared` (check protocol.rs mirror status).
- Motion playback keeps `{loop:false}` discipline for one-shots (C3 Meta.Loop gotcha).

## Acceptance

1. (1c) A normal expressive turn produces NO filler segments after the final substantive content (manual packaged round); tool-design taxonomy sedimented in spec.
2. (1b) Wearing a cross-ref costume, the injected vocabulary equals the playable set (no dead names); a costume switch provably re-reports (log/WS trace).
3. (1a) A click reaction ends in a return to idle (no last-frame freeze); idle-pool motions fire at random intervals; costume switch mid-motion and model-less stage are safe.
4. (D17) Proximity triggers a reaction with cooldown; click-through/gaze unaffected.
5. Gates: `pnpm -r test`, desktop+core tsc, lint, packaged smoke; existing avatar/e2e tests stay green.
