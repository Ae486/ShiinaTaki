# Research: Live vocabulary report trace (1b)

- **Query**: Does the Pet UI report the raw or pruned vocabulary, and does a costume switch re-report? Locate the dead-names defect.
- **Scope**: internal (renderer + hooks + core report method + engine types)
- **Date**: 2026-07-18

## Headline finding (contradicts the PRD's premise — verify before coding)

**Both halves of the PRD's hypothesized 1b bug are ALREADY implemented and correct in the current tree.** The reported
vocabulary is the PRUNED/playable set, and all three report trigger points fire. A "reports raw names / never
re-reports" defect does **not** reproduce from the code. The impl agent MUST reproduce the owner's dead-names evidence
against a live cross-ref costume FIRST; the likely real source is outside the report path (ranked hypotheses below).

## Q1: WHAT does the Pet UI report? → the PRUNED, actually-playable set

Evidence chain (each link verified):

1. `apps/desktop/src/renderer/live2d/load-character-model.ts:48-59` `toAbsoluteSettings()` calls
   `pruneSettings(raw, source.resolve)` **before** `createSettings(...)` — motion/expression entries with an
   unresolvable file ref are stripped, and an emptied motion group is dropped
   (`settings-prune.ts:61` "an emptied group would be an unplayable phantom name").
2. The engine copies its manager definitions FROM the (pruned) `ModelSettings`, it does NOT re-read the raw manifest:
   `node_modules/.pnpm/untitled-pixi-live2d-engine_*/.../types/index.d.ts:3380` — *"Motion definitions **copied from
   ModelSettings**."*; `:3791` — *"Expression definitions **copied from ModelSettings**."*
3. `apps/desktop/src/renderer/live2d/model-vocabulary.ts:15-22` `readVocabulary()` reads exactly those:
   `Object.keys(motionManager.definitions)` + `expressionManager.definitions.map(name)`.

⇒ For an imported costume, `readVocabulary` → `avatar.report` carries only names the engine can actually play. The
prune is keyed on `.File`/`.file`; readVocabulary reports `.Name`/`.name` of the SAME kept entries — consistent. The
raw-vs-pruned defect is already closed by #18 (`load-character-model.ts:44-47` header states this intent explicitly).

Exception: the DEV fallback model (`DEV_MODEL_SOURCE`, a string source) skips prune (`load-character-model.ts:27`) —
but that costume (arbeit) is self-contained with no cross-refs, so it has no dead names to prune.

## Q2: does a costume switch re-report? → YES, three trigger points

| Site | File:line | Fires when | Vocab source |
| --- | --- | --- | --- |
| Boot report | `windows/pet/use-core-connection.ts:62` | first `status.kind==="connected"` (+ reconnect) | `scene.reportVocabulary()` = live worn model, or `{[],[]}` when model-less |
| Dev→imported promotion | `windows/pet/use-initial-costume.ts:39` | once, after promoting to the last-worn imported costume | the promoted model's re-read vocab |
| Manual panel switch | `features/character-import/use-costume-switch.ts:76` | every operator costume pick | the switched model's re-read vocab |

`avatar-report.ts:22` `vocabulary.set()` **fully replaces** the character's prior names (no merge/stale accumulation).
`costume-switch.test.ts:40` already pins "reads the NEW model's vocabulary (not the old one)".

## Ordering analysis (why there is no dead-names race)

Both boot reports go over the SAME ordered WS connection (both hooks read the one `client` from `connection-store`).
`pet-stage.tsx:34` mounts `useCoreConnection` before `:35` `useInitialCostume`, and use-core-connection issues its
`reportAvatar` **synchronously** at effect time while use-initial-costume issues its report only after several `await`s
(characterCostumes + costumeResolution + model load). So the boot report is SENT first and the promotion report SENT
later → WebSocket in-order delivery → last-write-wins resolves to the worn (imported) costume. A later reconnect
re-fires use-core-connection reading the CURRENT promoted model (still correct). `costume-switch.ts` loads before
teardown, so `slot.current` is never null mid-switch — no empty-window clobber. **No path in the code leaves the Core
holding names the worn costume lacks.**

## Ranked hypotheses for the owner's "dead names" evidence (impl verifies against a live costume)

1. **Persona/prompt data names expressions the costume lacks (most likely; NOT a report bug).** `main.ts:132-139`
   injects per-character persona cards read from `promptDir` (`memory/persona-provider.ts`). If the Shiina Taki persona
   card lists example expression/motion names ("template names") that arbeit/the worn costume doesn't define, the LLM
   holds them regardless of the (correct) vocabulary report. **Impl: read the actual persona file under `prompt/` and
   check for baked avatar names; fix belongs in the persona card, not the report path.**
2. **Evidence predates #18's prune wiring** (`load-character-model.ts` prune landed with character import, last commit
   archived #18). The dead-names screenshot may be from before that merge.
3. **Core restart mid-session.** The Core vocabulary is an in-memory `Map` (`avatar-vocabulary.ts:23`). If the Core
   restarts without the Pet UI's WS dropping, no re-report fires (promotion is one-shot); a stale/empty vocab persists.
   Low likelihood in the packaged single-process case.

## Recommended T1 deliverable (defensible regardless of root cause)

The report content is already correct, so 1b's real value is **observability + self-healing**, which also directly
satisfies acceptance #2 ("a costume switch provably re-reports (log/WS trace)"):

1. **Make the re-report provable (acceptance #2).** Add one structured log line inside `ws-client.ts:187`
   `reportAvatar` (e.g. `console.info("[avatar] reported vocab", { motions: n, expressions: m })`) so every boot /
   promotion / switch report leaves a trace. Single centralized site — all three callers inherit it. ~2 lines.
2. **Self-heal vocabulary drift (closes hypothesis 3 and any residual).** `avatar-commands.ts:30-33` `unknownName()`
   is the exact smoking-gun detector: the Core pushed a name the live model lacks. Route that miss to a re-report:
   `applyAvatarCommand` gains an optional `onVocabularyDrift?: () => void` (renderer stays framework-free — the callback
   is injected by `use-core-connection` and calls `client.reportAvatar({...scene.reportVocabulary()})`). Wire it through
   `avatar-controller.applyCommand` → `pet-scene.applyAvatarCommand`. Then a stale LLM name provokes an immediate
   corrective re-report instead of a silent drop. ONE new optional callback, no protocol change.
3. **Do NOT rewrite the prune or the report paths — they are correct.** No `@taki/shared` change needed.

## Tests

- **Reproduction (manual, mandatory first)**: import a cross-ref BanG-Dream costume, wear it, log the injected vocab
  (via deliverable 1's log), confirm it equals the playable set. If dead names appear, capture WHICH names and grep the
  persona card for them (hypothesis 1).
- **Self-heal unit** (`avatar-commands.test.ts`): `applyAvatarCommand(model, {kind:"motion", name:"ghost"}, VOCAB,
  onDrift)` with `ghost ∉ VOCAB.motions` → asserts `onDrift` called once and returns false; a known name → `onDrift`
  not called. RED before wiring the callback.
- **Report-trace** (`ws-client` test or hook test): a fake client records `reportAvatar` calls; assert a
  `switchCostume`-driven `applySwitch` produces a report whose names equal the new model's `readVocab` result (extends
  the existing `costume-switch.test.ts` pattern into the hook).

## Files (for the impl agent)

| File | Action |
| --- | --- |
| `apps/desktop/src/lib/ws-client.ts:187` | add structured log to `reportAvatar` (observability — accept #2) |
| `apps/desktop/src/renderer/live2d/avatar-commands.ts` | add optional `onVocabularyDrift` param, call it in `unknownName` |
| `apps/desktop/src/renderer/live2d/avatar-controller.ts` + `pet-scene.ts` | thread the drift callback out to the bridge |
| `apps/desktop/src/windows/pet/use-core-connection.ts` | inject the drift callback → `reportAvatar(scene.reportVocabulary())` |
| `prompt/` persona card (if hypothesis 1 confirmed) | remove/relax baked avatar names — NOT a code fix |

## Caveats / Not found

- I could not run the app; the dead-names symptom is asserted by the owner, not reproduced here. The code review is
  conclusive that the REPORT path is correct — do not assume otherwise without a live repro.
- I did not open the actual `prompt/` persona file (outside the traced report path); hypothesis 1 needs that read.
- If a live repro DOES show the report itself carrying dead names, that would contradict the engine "copied from
  ModelSettings" contract — re-verify the engine version and `motionManager.definitions` at runtime before coding.
</content>
