# Costume Operation Lifecycle Contract

> Costume switching spans Home, Pet, Tauri path composition, the Live2D renderer, and Core avatar synchronization.
> The visible scene is the presentation truth. Renderer attachment is the irreversible worn-costume commit boundary.

## 1. Scope / Trigger

Use this contract when changing costume selection, cross-window costume events, asset resolution, renderer deadlines,
Cancel behavior, `last-costume`, initial promotion, `PetScene.reportSnapshot()`, or `avatar.report` recovery.

## 2. Signatures

```typescript
type CostumeAttemptStopReason = "cancelled" | "superseded" | "deadline";

interface CostumeCommit {
  costumeId: string;
  vocabulary: AvatarVocabulary;
}

interface CostumeAttemptOutcome {
  committed: true;
  report: "synced" | "recovery-needed";
}

interface CostumeAttemptHandle {
  result: Promise<CostumeAttemptOutcome>;
  cancel(reason?: "cancelled" | "superseded"): boolean;
  committed(): boolean;
}

type CostumeReportSyncState =
  | { kind: "idle" }
  | { kind: "pending"; costumeId: string; source: "switch" | "reconnect" }
  | { kind: "recovery-needed"; costumeId: string; source: "switch" | "reconnect"; message: string }
  | { kind: "synced"; costumeId: string; source: "switch" | "reconnect" };
```

The cross-window protocol remains:

```typescript
type CostumePhase = "started" | "succeeded" | "failed" | "cancelled";
interface CostumeResultPayload {
  costumeId: string;
  phase: CostumePhase;
  reason?: string;
}
```

## 3. Contracts

### One captured attempt budget

- `startCostumeSwitchAttempt` captures `petCostumeTotalMs` and `rendererLoadMs` exactly once from the initiating
  client's current timing policy. Reconnect or config changes do not restart or lengthen an existing attempt.
- One attempt gate spans Core costume resolution, Tauri asset/path composition, renderer load, attachment commit, and
  bounded report synchronization. Every awaited pre-render stage checks the stop token before the next stage starts.
- The renderer timeout is `min(rendererLoadMs, remaining total budget)`. Cancel/deadline/supersession during a live
  renderer load calls `PetScene.abortSwitch()` exactly once so a late model self-discards through its switch ticket.
- Cancel is accepted only before attachment. After commit there is no rollback API, so the report stage completes as
  synchronized or recovery-needed rather than pretending the visible model was cancelled.

### Attachment is commit

- `PetScene.switchCostume()` resolves only after the candidate model has attached. That resolution synchronously commits
  the costume before any later deadline callback can classify report health.
- Commit updates the live scene snapshot, window-local selected/current state, and best-effort `last-costume`
  persistence. A storage failure is diagnostic and cannot turn visible success into failure.
- Home receives `succeeded` from attachment truth. `avatar.report` acknowledgement is a separate synchronization step;
  failure or unknown outcome produces `recovery-needed`, never a failed visible switch.
- `PetScene.reportSnapshot()` is the only reconnect report authority. It includes a costume ID only when that costume
  attached in the current scene; `localStorage` and click intent cannot fabricate it.

### Result-bearing Home boundary

- Home selection follows `pet:costume-result`, never the click. Only the commanded row is pending.
- The Home result timer captures `homeResultMs` once when that pending attempt begins. A Home client generation change
  must not restart the timer.
- The invariant is `rendererLoadMs < petCostumeTotalMs < homeResultMs`; Core rejects timing changes that violate it.
- Cancel releases Home first, then emits the cancel command. A dead Pet cannot wedge the page.
- A late `succeeded` result remains authoritative: Home follows the costume Pet is visibly wearing and clears a stale
  deadline error.

### Recovery and last-good behavior

- A report failure stores only synchronization health. The next authenticated Pet generation reports the current live
  snapshot and can move the latest report ticket to synchronized.
- Initial imported-costume promotion has `idle | running | committed` scene-lifetime state. Pre-commit interruption
  returns to idle for retry; an attached scene is latched and ordinary reconnect does not reload it.
- `character.costumes` refresh failure retains last-good metadata. The current protocol cannot distinguish an
  unimported character from a transient read failure, so this path stays silent and retries on a later client.
- The single-flight guard is released at attachment, not delayed until report acknowledgement. A later switch may begin
  while the prior committed report is still pending.

## 4. Validation & Error Matrix

| Condition | Required behavior |
|-----------|-------------------|
| Unknown/unrenderable costume or Pet not ready | Emit named `failed` refusal; Home releases pending |
| Cancel/deadline during Core resolution or path composition | Stop before renderer/report side effects |
| Cancel/deadline during renderer load | Call `abortSwitch`; late model self-discards; keep old identity |
| Renderer load rejects before attachment | Emit `failed`; preserve old scene/selection/last-costume |
| Renderer resolves at the deadline boundary first | Attachment commits; later timer cannot relabel it failed |
| Report acknowledgement resolves first | Mark synchronized |
| Report fails/times out after attachment | Keep visible success; mark recovery-needed; re-report on reconnect |
| `last-costume` write fails after attachment | Warn; keep committed in-memory truth and Home success |
| Home never receives a result | Its captured deadline releases pending and shows retryable error |
| Late success arrives after Home timeout | Move selection to the actual worn costume and clear stale error |
| Initial promotion is interrupted pre-commit | Return to idle and retry on a later authenticated generation |

## 5. Good / Base / Bad Cases

- Good: resolution -> path composition -> renderer attaches -> selection and `last-costume` commit -> Home succeeds ->
  report acknowledges -> synchronization becomes `synced`.
- Base: renderer attaches but report times out. The new costume remains selected and visible, report state becomes
  `recovery-needed`, and reconnect re-reports the live snapshot without reloading the costume.
- Base: operator cancels while resolution is pending. Home releases immediately; renderer never starts; the attempt
  emits one terminal cancellation and another selection can begin.
- Bad: wait for `avatar.report` before admitting attachment, then report `failed` while the new model is already visible
  and persistence still names the old costume.
- Bad: put one timeout only around the renderer or let a Home reconnect restart its result timer.

## 6. Tests Required

- `costume-switch-attempt.test.ts`: unresolved pre-render stages, total deadline, renderer remaining budget, Cancel and
  deadline races, exact-boundary renderer/report winners, exact-once abort, and attachment-time commit.
- `costume-report-sync.test.ts`: pending/synced/recovery-needed transitions, stale ticket suppression, and reconnect
  recovery.
- `pet-scene.test.ts` and renderer switch tests: late stale model self-discard, load-before-teardown, snapshot costume
  identity, and model-less first attach.
- `use-costume-switch.test.ts`: guard release at commit, later report independence, supersession, last-good metadata,
  and no stale UI updates.
- `initial-costume-promotion.test.ts`: pre-commit retry, committed latch, fallback attempt, and reconnect non-reload.
- Home reducer/deadline tests: result-only selection, Cancel-first release, client replacement not restarting the timer,
  late success authority, and locked refusal vocabulary.
- Manual: repeat #74/#75 on the D59/D61 build, real renderer timeout/late load, Pet restart with `last-costume`, and
  packaged Pet path/ACL resolution.

## 7. Wrong vs Correct

```typescript
// Wrong: reporting is treated as the commit even though the renderer already replaced the visible model.
const vocabulary = await scene.switchCostume(source);
await client.reportAvatar({ ...vocabulary, costume });
saveLastCostume(costume);
publish({ costumeId: costume, phase: "succeeded" });

// Correct: attachment commits presentation; reporting is recoverable synchronization.
const attempt = startCostumeSwitchAttempt({
  client,
  scene,
  costume,
  settingsFile,
  onCommit: ({ costumeId }) => {
    saveLastCostume(costumeId);
    publish({ costumeId, phase: "succeeded" });
  },
});
await attempt.result; // { committed: true, report: "synced" | "recovery-needed" }
```
