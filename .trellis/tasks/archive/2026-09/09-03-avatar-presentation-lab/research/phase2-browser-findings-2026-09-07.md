# Phase 2 browser findings - 2026-09-07

## Scope and evidence

The owner reported that an unfiltered `angry02` motion still preserved `smile01`, and that Reset followed by Set of
the same expression returned false. The owner requested automated reproduction, screenshots, and functional checks
before delegating anything to manual testing. Work remains inside the lab; this is not production adoption or
Phase 3 implementation.

- Worktree: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`.
- Engine: installed `untitled-pixi-live2d-engine` 1.3.1; browser: Chromium 139.0.7258.5 via existing Playwright 1.54.1.
- Existing lab Vite service: `http://127.0.0.1:1420/lab/lab.html`.
- Original reproduction: `.trellis/.runtime/avatar-lab-before-20260907/` (12 independent browser cases).
- Reset controls: `.trellis/.runtime/avatar-lab-reset-controls-20260907/`.
- The runtime directories hold JSON frame samples, page/model PNGs, and `comparison.png`; they are local ignored
  evidence containing copyrighted model imagery and must not be committed or copied into a production build.
- Each browser case starts with a new context and a real model load. A Playwright response interception adds the
  scene observation handle only to the automation's copy of the bootstrap module. UI controls remain the action path.

## Original observations

| Costume / operation | Motion output | Final rendered parameter | Conclusion |
| --- | --- | --- | --- |
| C2 expression `smile01` alone | Eye form 0; brow form 0 | Eye form 1; brow form 0.5 | Static reference |
| C2 `angry02` alone | Eye form varies from 0 to -1; brow form -1 | Same as motion output | Motion authors an angry face |
| C2 smile then unfiltered angry motion | Eye form reaches -1; brow form -1 | Eye form remains 1; brow form remains 0.5 | Owner observation reproduced; no operator error |
| C2 unfiltered angry motion then smile | Eye form -1; brow form -1 | Eye form 1; brow form 0.5 | Both command orders preserve the smile |
| C2 filtered angry motion then smile | Eye form 0; brow form 0 | Eye form 1; brow form 0.5 | Filtering works, but is not needed for this smile to survive |
| C3 `exp_smile01` with `mtn_angry02_C`, either command order | `Paramsmile01` 0; `ParamBrowLForm` 0 | 1 and 0.3 respectively | Expression also survives without filtering |
| C3 filtered motion then smile | Same two motion values 0 | 1 and 0.3 respectively | This probe cannot distinguish the two inputs |
| Reset then same Set, both generations | Last body-motion/default output | Expression not restored; Set returns false | Reproduced bug |

The C2 unfiltered sequence captured 87 active-motion frames with eye-form fixed at 1 and brow-form fixed at 0.5.
The filtered sequence captured 85 active-motion frames with the same final values. The cached C2 motion contains
64 curves before filtering and 44 after excluding the 20 non-eye-open face ids. This directly demonstrates cache
mutation even though the rendered expression looks the same.

## Causes established against the actual engine

1. **C2 declared calc is not effective calc.** `Live2DExpression` parses add/mult and normalizes `def`, but
   `updateParamExe` always calls `setParamFloat(id, val * weight)`. The prior predicted -1 + 0.5 = -0.5 brow result
   was wrong. The final brow is set to +0.5 after the motion. C2 eye-open declared mult is likewise set to 0.95 for
   `smile01`, suppressing authored blink even when those ids are retained in the motion.
2. **Engine Reset preserves the previous selection.** `resetExpression()` only queues `defaultExpression`.
   `currentExpression` remains the previous cached object, so `setExpression(sameName)` returns false. Calling
   `restoreExpression()` restores the smile; switching to angry and then back to smile also succeeds. Both controls
   were reproduced, ruling out missing assets or a failed expression download.
3. **The old probe produced invalid conclusions.** It armed a timer after a failed Set, interpreted the dropdown
   selection as the applied expression, and returned yes/no while no motion was playing. The motion-only C2 case
   even reported survival for the initially selected expression without any Set action.
4. **C2 native looping does not exist at this entry point.** Both legacy `_startMotion(..., _loop)` implementations
   ignore loop. The long Reset reproduction became idle while the UI still said `loop=true`. Lab replay must be
   separately owned and cancelled by Stop all, a replacement command, or model disposal.
5. **Unavailable C3 parameters are not zero.** Broad tracking before expression initialization exposed null reads
   for phantom ids and repeated `toFixed` exceptions in the readout. Unknown values must remain unknown and cannot
   pass a numerical probe.

## Corrected acceptance rule

The gate asks whether filtering relinquishes the authored face curves while a successfully applied expression
survives an active body motion. It does not require an unfiltered failure. Cache counts, motion-output samples,
several final face parameters, channel activity, and screenshots are independent evidence. A single-parameter yes
does not certify the whole face, and idle/failed/unapplied/settling samples are not gate verdicts.

## Corrective implementation

- The lab expression controller serializes Set, restores an already selected expression, and cancels the engine's
  public reservation on Reset, replacement, and disposal. The panel additionally guards its continuation/timer
  with an operation revision, including Reset in the microtask window after engine completion.
- The probe follows the successfully applied expression, not the dropdown. It labels itself a single-parameter
  probe, uses a separate idle reference, and refuses yes/no for unapplied, pending, settling, failed, or unavailable
  data. Reset cancels the pending sample. Repeated Set reports `true (restored)`.
- Face parsing reports effective C2 set semantics and normalized values while preserving the declared-mult
  classification for the eye-open filter. C3 numeric Blend continues to mean the engine's additive fallback.
- C2 looping is explicitly lab-owned finish-event replay on each channel. C3 uses native looping. Stop all,
  channel replacement, and model disposal cancel replay. The replay has a frame-boundary handoff and is not
  advertised as native seamless looping.
- Null/nonfinite parameter values display as n/a and cannot pass a probe.

## Accepted browser results

**45 distinct scenarios passed across C2 and C3, with 4,102 sampled frames and zero browser exceptions in the
accepted cases.** Every accepted model capture is nonblank and changes between sampled images. The smallest
foreground ratio is 10.25%; the smallest changed-pixel ratio is 2.99%. These image checks complement, rather than
replace, channel activity and authored-motion parameter checks because built-in breathing also changes pixels.

Evidence directories:

- `.trellis/.runtime/avatar-lab-final-20260907/`: complete matrix, screenshots, frame JSON, `comparison.png`, and
  `reset-comparison.png`.
- `.trellis/.runtime/avatar-lab-loop-rerun-20260907/`: fresh C2 long-duration case after a development HMR update
  invalidated that case's setup in the first full run. The original failed setup remains in its original summary.
- `.trellis/.runtime/avatar-lab-pending-rerun-20260907/`: four cancellation cases with an explicit request barrier.
  The expression fetch is held until Reset or replacement Load completes, then released. This guarantees real
  overlap even when C3 rendering makes UI automation slower than a fixed artificial delay.
- `avatar-lab-final-20260907/accepted-summary.json`: consolidated latest results with each case's source summary,
  all original run summaries, and additional numerical eye-open assertions. No original evidence is discarded.

| Area | Accepted observation |
| --- | --- |
| C2 composition | Both command orders preserve eye form 1 and brow form 0.5, with or without filtering |
| C3 composition | Both orders preserve `Paramsmile01` 1 and brow form 0.3, with or without filtering |
| C2 cache | 64 curves unfiltered; 44 after ignoring 20 ids; 42 after also ignoring the 2 declared-mult eye-open ids |
| C3 cache | 105 curves unfiltered; 54 after the 69-id ignore request: only 51 of those ids occur in this motion, while 18 have no matching curve |
| Shared cache | Unfiltered replay retains filtered counts; invalidation restores original counts; parallel channels share the mutation |
| Channel composition | Primary plus all 3 parallel channels run together; filtered and one-unfiltered cases keep the successfully applied smile |
| Stop all | All channels remain stopped; the probe becomes an idle reference rather than a gate verdict |
| Long playback | C2 replay and C3 native loop remain active beyond one authored motion duration |
| Reset and repeated Set | Both generations restore the same expression successfully, including repeated Set without Reset |
| Selection-only change | The probe continues to identify the applied smile rather than interpreting the un-applied dropdown choice |
| Pending Set | Reset and replacement costume Load prevent the delayed Set from becoming active; no stale timer/verdict or browser exception |
| Failed Set | Injected HTTP 503 produces an explicit failed result and no survival verdict |
| Unknown parameter | C3 readout remains usable and reports n/a rather than crashing or inventing zero |

Eye-open measurements, while a motion is active:

| Costume / expression | Eye-open excluded from ignore ids | Eye-open included in ignore ids |
| --- | --- | --- |
| C2, no expression | Final approximately 0.0035 to 1: authored blink remains | Final 1: authored eye-open curve relinquished |
| C2, `smile01` | Motion output approximately 0.0049 to 1, final 0.95 | Motion output 1, final 0.95 |
| C3, no expression | Final 1 | Final 1; the secondary toggle changes no ids |
| C3, `exp_smile01` | Final 1.5 | Final 1.5; numeric Blend 2 is still additive |

The original eye-open manual expectation needed correction: even when the motion retains eye-open, an active C2
expression sets it afterward, and therefore can suppress visible blink independently of the ignore toggle.

## Quality and delivery boundary

- Focused corrective tests: 11 files / 56 tests passed, including the 0-7 microtask Reset race timings.
- Full desktop tests: 136 files / 772 tests passed (`pnpm --filter @taki/desktop test --maxWorkers=2`).
- Desktop typecheck passed; lab and automation ESLint passed. Repository lint has 0 errors and the pre-existing
  `packages/core/src/db/run-repo.ts:6` unused-disable warning.
- Desktop production build passed. Output root is only `assets`, `vendor`, `home.html`, `index.html`, `pet.html`;
  no lab/spike output exists. Existing production chunk-size/plugin-timing notices were not altered by this task.
- No production renderer, engine package, Core protocol, dependency, or model asset was changed. No commit/push or
  task archive was performed. The dev server remains available at the lab URL.

**Phase 2 has positive automated gate evidence for these two costumes.** The negative-control premise was corrected;
it is not a negative result. No additional manual test is needed to establish the tested functional behavior.
Subjective animation quality and Phase 3 overlays/relax are separate work and were not implemented or accepted here.
