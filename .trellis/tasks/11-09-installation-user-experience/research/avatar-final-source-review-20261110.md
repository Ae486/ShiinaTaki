# Independent avatar acceptance repair review

Date: 2026-11-10. Read-only review by acceptance_core. Workspace
H:/TakiAgent-worktrees/t4, branch task/t4-skills-mcp-productization.
Authority: the existing installation-user-experience PRD and costume-operation
lifecycle contracts; review limited to the newly completed avatar acceptance repair.

## Outcome

No confirmed blocking correctness finding in the reviewed final production source.
No production source was changed. This is an independent source/path review, not an
additional native acceptance run or a claim that all race interleavings are tested.

## Verified boundaries

- `src/lib/costume-switch-attempt.ts:179` performs its current costume metadata read
  through the existing AttemptGate before external-ref resolution and native path
  composition. Unknown/unrenderable is classified only after a successful read;
  a read rejection remains an error. The existing remaining-budget renderer stage
  and exact-once abort path remain in force.
- `features/character-import/use-costume-switch.ts:101` retires a pending manual
  attempt when its physical client or scene is replaced and advances its generation.
  Later stage completion cannot publish stale hook state. Attachment releases the
  manual guard before report settlement, and emits scene invalidation afterward.
- `src-tauri/src/character_assets.rs:13` captures an absolute root from the native
  selected profile. `resolve` grants only its characters subtree; the command accepts
  no renderer-selected path and checks actual Home/Pet window plus origin. The
  default packaged asset scope is empty. Registration exists in lib.rs/build.rs and
  the Home/Pet-only character-assets capability. Core/Desktop dev launch scripts
  preserve their established relative-profile interpretation.
- `src/lib/character-asset-url.ts` derives settings and resource paths from the native
  returned root, preserving the existing external-reference resolver and null refusal.
  It no longer reconstructs a default-profile path from frontend home-directory data.
- `windows/home/pages/costume/costume-select-state.ts:47` uses successful command
  results only to clear command state and request a new observation; a late result
  cannot directly restore a stale current-costume highlight.
- `costume-scene-observer.ts:28` retires the prior request before every fresh read;
  snapshots require the active exact request ID. Stop/hide and Pet destruction clear
  observation, retire the timer and reject older replies. Timeout has no automatic poll.
- `use-costume-scene-observation.ts:32` registers before requesting, cleans successful
  listeners if a peer registration fails, disposes late registrations, and clears the
  previous selected claim on entry/retirement. Pet destruction targets the actual Pet
  native window. The Home timing accessor is stable across client generations.
- `windows/pet/use-costume-scene-observer.ts` answers from actual reportSnapshot,
  fences retired listeners and signals readiness/reset. Manual attachment and initial
  promotion both invalidate Home. Initial promotion retains its existing scene-life
  commit latch and reconnect behavior; metadata remains load intent, not selection proof.
- `pet-stage.tsx` wires the scene observer alongside initial promotion and manual
  switching. Home costume-list projection contains resource rows only, with no default
  or last-costume fallback masquerading as an attached model.

## Evidence inspected and limits

Inspected the targeted production diff, native command/capability/build registration,
client-generation adapter, actual scene attachment/reportSnapshot path, Home observer
and reducer tests, fresh-metadata/deadline tests, manual report-pending guard test,
and initial-promotion interruption tests. Root's reported stale-highlight/registration
cleanup correction is present and its tests explicitly cover successful and late
listener disposal.

No heavy tests, build, native interactions, process changes or configuration changes
were run by this review. Root owns final packaged-native proof and already-recorded
Desktop tests/typecheck/lint. The intermediate native mock-build workaround was not
reviewed or treated as final evidence. Hindsight and unrelated work were untouched.
