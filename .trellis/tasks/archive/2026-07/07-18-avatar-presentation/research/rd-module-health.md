# Research: Module health notes (Q1 cleanup contract)

- **Query**: Debt observed while traversing avatar/, renderer live2d/, windows/pet/, chat-agent instruction path.
- **Scope**: internal
- **Date**: 2026-07-18

Severity key: **fix-in-T1** = the file WILL be touched by T1 (fix the debt in the same change);
**note-only** = untouched by T1 (off-limits per Q1 impl-boundary rule — record, do not refactor).

## Stale-header risks (repo rule: update INPUT/OUTPUT/POS when the contract changes) — all fix-in-T1

| File:line | Finding | Sev |
| --- | --- | --- |
| `apps/desktop/src/renderer/live2d/avatar-controller.ts:1-6,17-22` | header OUTPUT lists `{vocabulary, applyCommand, reactToClick, focusAt}`; C adds `handleProximity` → update header + the `AvatarController` interface | fix-in-T1 |
| `apps/desktop/src/renderer/pet-scene.ts:1-9,34-54` | `PetScene` type + header grow (idle scheduler dispose, `handleProximity`, B's drift callback) → refresh OUTPUT tag | fix-in-T1 |
| `apps/desktop/src/windows/pet/use-core-connection.ts:1-7,57-64` | header says "reports the model vocabulary"; B moves report authority to use-initial-costume → adjust OUTPUT/POS | fix-in-T1 |
| `apps/desktop/src/windows/pet/use-click-through.ts:1-9` | header brags "per-pixel click-through AND gaze"; C adds proximity on the same poll → add it to OUTPUT | fix-in-T1 |
| `packages/core/src/avatar/avatar-vocabulary.ts:1-6` | A appends discipline prose in `render()`; header OUTPUT ("the per-character list of manifest names") should note the usage rules too | fix-in-T1 |

## Duplication

| File:line | Finding | Sev |
| --- | --- | --- |
| `apps/desktop/src/windows/pet/use-initial-costume.ts:32-40` ↔ `features/character-import/use-costume-switch.ts:67-77` | `promote` and `applySwitch` are the SAME 4-step dance (costumeResolution → costumeAssetResolver → switchCostume → reportAvatar), differing only in timeout const + `saveLastCostume`. B touches both → candidate to extract a shared `resolveSwitchReport(deps)` helper | fix-in-T1 (low) |
| `packages/core/src/avatar/play-motion-tool.ts:10-38` ↔ `set-expression-tool.ts:10-35` | ~80% identical (tool() + try/catch publish + log + `{ok:true}`/error). Sanctioned by the one-tool-per-file naming rule, but a shared `publishAvatarTool(kind, deps, extraSchema)` builder would satisfy both DRY and the rule. A touches both descriptions | note-only (low; extract optional) |

## Size-cap / structure

| File:line | Finding | Sev |
| --- | --- | --- |
| `packages/core/src/agents/chat-agent.ts:68-139` | `runTurn` is ~71 lines — exceeds the 50-line function cap. It is D1-FROZEN (turn runtime), so DO NOT refactor; A only edits construction (line 88) + the deps interface | note-only (frozen — must not touch) |
| `packages/core/src/main.ts:274-308` | `createChatAgent({...})` call passes ~12 inline deps; composition-root wiring (exempt-ish). A adds one line (`stopConditions`) — keep the block readable, don't extract | note-only |
| `apps/desktop/src/renderer/pet-scene.ts:69-111` | `createPetScene` ~42 lines; C adds scheduler store/dispose + `handleProximity` delegate — keep new logic in `attachModel`/`switchCostume` helpers so the factory body stays under 50 | fix-in-T1 (watch) |

## Orphan risk

| File | Finding | Sev |
| --- | --- | --- |
| `apps/desktop/src/renderer/live2d/idle-behavior.ts` (+ `.test.ts` + `pet-scene.ts:17,129` import + `live2d/index.md`) | if C's `idle-motion.ts` subsumes `startIdleAnimation` (it no-ops for taki anyway — no `Idle` group), this becomes an orphan → delete it and its wiring, OR keep only as the real-`Idle`-group fast path. Decide in T1 | fix-in-T1 |

## Index.md updates required (per-directory index rule) — fix-in-T1

- `packages/core/src/avatar/index.md` — add `presentation-stop.ts` (A).
- `apps/desktop/src/renderer/live2d/index.md` — add `idle-motion.ts`, `proximity-reaction.ts` (C); remove `idle-behavior.ts` line if deleted.

## Clean (no debt found; cited for confidence)

`avatar-report.ts`, `avatar-vocabulary.ts`, `avatar-tools.ts`, `model-vocabulary.ts`, `settings-prune.ts`,
`load-character-model.ts`, `costume-switch.ts`, `base-prompt.ts`, `avatar-commands.ts`, `click-reactions.ts` — accurate
headers, within caps, single-responsibility. The prune/report renderer chain (B) is off-limits and correct; do not
touch beyond the observability/self-heal additions named in `rb-`.
</content>
