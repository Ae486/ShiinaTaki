# Actual mouth pose capability

## Result

The model can be posed beyond amplitude-only opening without changing the engine. `taki/live_01` visibly supports
closed, open, horizontally spread and small rounded mouth shapes. Several useful A/E/I/O/U-like candidates can
therefore be displayed. `taki/arbeit` also has multiple mouth controls but its shape range is more limited; the
same candidate numbers do not produce equivalent visible shapes between the two costumes.

These are static viseme candidates, not phoneme recognition or timed speech acceptance. Multiple phonemes share
a visible pose (for example M/B/P closure); U and U-umlaut also need not have distinct external lip geometry.
No independent tongue placement or lower-lip/upper-teeth F/V pose was established by this experiment.

## Authority and method

- User request: determine how far the actual mouth parameters can be controlled and whether representative
  phoneme mouth shapes can be posed. Owner separately required using the existing Lab task and retaining records.
- Task/session binding was repaired and verified; see `session-binding-2026-09-08.md`.
- Browser: Chromium 139.0.7258.5 via existing Playwright; engine: installed untitled-pixi-live2d-engine 1.3.1.
- A fresh isolated lab context was used per costume. No speech or external service was called.
- Capture freezes declared model parameters at a baseline in the existing `beforeModelUpdate` hook, then applies
  the requested mouth values through the existing parameter API. Native lip-sync is disabled only in that isolated
  page. This isolates geometry from blink, motion, breathing and expression changes. All state disappears on close.
- The model was magnified for actual near-mouth canvas crops. There are 45 range/reference-preset screenshots and
  14 additional candidate-pose screenshots: 59 total. Browser errors: zero. Every declared-parameter readback
  matched the requested value clamped to its actual model range (tolerance 0.001).
- C3 ranges came from public core parameter enumeration/minimum/maximum methods. C2 has no public enumerator:
  the diagnostic reads the pinned runtime's pre-existing ID table `getModelContext()._$pb`, minimum `_$Rr` and
  maximum `_$Or` arrays. The actual setter source was checked to confirm those arrays are its clamp boundaries.
  This is research-only introspection, not a proposed production API or portable runtime contract.

## Measured controls

| Control | C2 arbeit | Range | C3 live_01 | Range |
| --- | --- | --- | --- | --- |
| Opening | `PARAM_MOUTH_OPEN_Y` | 0 to 1 | `ParamMouthOpenY` | 0 to 1 |
| Shape | `PARAM_MOUTH_FORM_01` | -0.5 to 1 | `ParamMouthForm` | -1 to 1 |
| Vertical adjustment | `PARAM_MOUTH_FORM_Y` | -1 to 1 | `ParamMouthupdawn` | -1 to 1 |
| Scale | `PARAM_MOUTH_SCALE` | -1 to 1 | `Param16` | -1 to 1 |
| Width | No separate declared mouth-width ID in this costume | n/a | `Param31` | -1 to 1 |
| Additional | n/a | n/a | `ParamMouthside`, `ParamMouthStrength`, `Param30` (corners) | -1 to 1 |
| Raised corners | n/a | n/a | `Param9` | 0 to 1 |

All other parameters were held at the same baseline when comparing cells. The native speech default's weighted
contribution near 0.4 is not the model's maximum opening: direct writes can use the full 0-to-1 opening range.
Values interpolate continuously; they are not a fixed set of six prerecorded mouth pictures. Going outside a
declared range is clamped and cannot synthesize additional shapes absent from the rig.

## C3 candidate combinations

The following values were actually rendered and captured. Names describe visual intentions, not certified
phonetic labels. Parameters not mentioned here stay at the neutral baseline.

| Candidate | OpenY | MouthForm | Additional controls | Observed appearance |
| --- | --- | --- | --- | --- |
| M/B/P closure | 0 | 0 | none | Closed lips |
| A | 0.85 | 0 | none | Broad open mouth |
| E | 0.35 | 0.45 | none | Flatter opening with visible teeth |
| I | 0.22 | 1 | none | Horizontally spread narrow mouth |
| O | 0.60 | -1 | none | Clearly rounded opening |
| U | 0.48 | -1 | `Param31=-1`, `Param16=-1` | Smaller, narrower rounded opening |
| U-umlaut candidate | 0.32 | -0.6 | `Param31=-0.65` | Small oval; not demonstrated as a separately recognizable phonetic pose |

The O and U cells provide concrete evidence that this rig can display more than a single jaw-opening dimension.
The U-umlaut candidate is only an initial visual sample; sharing the U-like rounded family may be more appropriate
than claiming an independent shape. Tongue position and perceptual pronunciation distinction were not evaluated.

## C2 differences and the reference limitation

On `arbeit`, negative `PARAM_MOUTH_FORM_01` opens a different, somewhat downturned mouth while positive values
spread the corners. A-like opening, closure and I-like spreading are useful; our O/U candidates mostly changed
opening/size and did not reproduce the distinct rounded/pursed appearance seen in `live_01`. Treat this as a
costume capability difference and use reduced pose groups where appropriate.

The literal reference ID `PARAM_MOUTH_FORM` is not declared in `arbeit`. In the diagnostic, writing it to 1 yields
a readable value but the captured image is pixel-identical to the OpenY=0.5 baseline: changed pixels 0, mean channel
difference 0. By comparison, actual `PARAM_MOUTH_FORM_01=-0.5` changes 1,512 crop pixels, and value 1 changes 1,815.
The legacy runtime registers unknown IDs, so a successful set/get is not proof of visible model support.

BANDORI's Python layer sends `PARAM_MOUTH_FORM` unchanged; its Lua dependency is absent from the local reference
checkout. We cannot claim that this reference's final model binding correctly maps every costume. See
`reference-mouth-control-2026-09-08.md` for the exact verified boundary. The useful idea is separate open/form
control with model-specific mapping, not copying a constant table and assuming the same geometry everywhere.

## Evidence and reproduction

Run from `H:/TakiAgent-worktrees/t4` with the existing lab server at `http://localhost:1420`:

```powershell
$env:TAKI_LAB_PLAYWRIGHT_MODULE = 'G:/Roaming/Python/Python312/site-packages/playwright/driver/package/index.mjs'
node .trellis/tasks/09-03-avatar-presentation-lab/research/mouth-pose-probe.mjs .trellis/.runtime/avatar-lab-mouth-poses-new
$env:TAKI_MOUTH_POSE_SET = 'candidates'
node .trellis/tasks/09-03-avatar-presentation-lab/research/mouth-pose-probe.mjs .trellis/.runtime/avatar-lab-mouth-candidates-new
```

Original evidence:

- `.trellis/.runtime/avatar-lab-mouth-poses-20260908/`: both JSON reports and full parameter/reference-preset sheets.
- `.trellis/.runtime/avatar-lab-mouth-candidates-20260908/`: both candidate-pose JSON reports and seven-pose sheets.
- Each JSON contains declared ranges, requested values, clamped frame readbacks, pixel differences and browser errors.
- All images are actual rendered model crops and remain git-ignored; only the report and reproduction script are tracked candidates.

Current normal page controls can hold one parameter at a time. Use `beforeModelUpdate`, write mode `set` and Hold
to test opening alone. The multi-parameter candidate poses above were applied by this isolated diagnostic, not
added as a product/lab preset selector. No automatic mouth driver, audio-to-phoneme mapping or production adoption
was implemented, and no task finish/archive/commit/push occurred.
