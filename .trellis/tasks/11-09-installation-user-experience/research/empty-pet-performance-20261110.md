# Empty Pet renderer idle investigation

Date: 2026-11-10. Investigation, focused renderer correction and comparable observations of the
isolated packaged native fixture. Both observation windows were read-only: no navigation,
reload, focus, resize or visibility changes. The native-flow worker rebuilt/reopened the same
fixture between samples, preserving its empty-model state. No model asset, provider or
Hindsight setting was changed.

## Measured observation

The integration owner confirmed its CPU-heavy tests had completed and held further heavy work
while this 15-second observation ran. Targets were packaged Desktop PID 11992 and Core PID 31260,
with the Desktop's process descendants selected from actual parent PID relationships. CDP was 19224.
The measurement finished at `2026-11-10T17:49:54.9412493+08:00`.

| Process/group | CPU seconds in 15.0392 seconds | One logical-core equivalent |
| --- | ---: | ---: |
| Native Desktop | 0.82812 | 5.506% |
| Owned WebView processes | 3.21874 | 21.403% |
| Desktop + WebView | 4.04686 | 26.909% |
| Core | 0.00000 | 0.000% |

There are 20 logical processors, so the Desktop/WebView sum is approximately 1.345% of total
machine capacity. This is the bounded before sample, not a distribution.
Summed working sets are not unique resident memory because Windows may share pages.

Read-only inspection of the actual Pet scene found:

```json
{"snapshot":{"motions":[],"expressions":[]},
 "ticker":{"started":true,"maxFPS":15},
 "inputs":{"activity":"idle","focused":false,"hidden":false,"throttling":true}}
```

The page was `http://tauri.localhost/pet.html`, visible and unfocused, with one 720x960 canvas.
Home was also a packaged page at `http://tauri.localhost/home.html`. The absence of the dev-only
default Live2D resource in this packaged fixture is already understood; it is not evidence of a
rollback and does not authorize packaging proprietary default assets.

An accompanying 10 ms sampling CPU profile reported 1331 idle samples, 63 program samples,
12 `readPixels`, 12 native `fetch`, 5 `getRandomValues`, 4 `requestAnimationFrame`, and 2 Pixi
`_tick` samples, plus small others. Pet CDP metrics changed by 1.161982 seconds TaskDuration,
0.440731 seconds ScriptDuration, and 0 Layout/RecalcStyle work. DevToolsCommandDuration was
0.165151 seconds, so profiling overhead is explicitly present and the measurement must not be
treated as an uninstrumented production baseline.

Evidence on G: (to avoid the almost-full H: volume):

- `G:/taki-native-flow-artifacts-20261110/empty-pet-idle-cpu-before.json`
- `G:/taki-native-flow-artifacts-20261110/empty-pet-idle-profile-before.json`

## Source-supported cause

Before this correction, `renderer/render-governor.ts` started its ticker during construction from
idle/focused/visible defaults and chose 15 FPS on blur, without a renderable-content prerequisite.
Disabling throttling also bypassed hidden/asleep pauses; that loaded-model behavior is preserved.

`renderer/pet-scene.ts` creates that governor before the best-effort initial model load, registers
the frame-gated alpha mask callback, and permits `slot.current === null` after missing assets.
The same callback still runs every fourth governed frame. `renderer/alpha-mask-source.ts`
renders the stage into a texture and calls synchronous `renderer.extract.pixels()` each refresh.
The actual empty-scene ticker and sampled `readPixels` confirm this path is running, rather than
only being theoretically reachable.

There is a separate visible-page cursor poll in `windows/pet/use-click-through.ts`, approximately
31 Hz, which makes native IPC calls for cursor position and occasionally window origin. It serves
DOM bubble/panel hit testing as well as model gaze, so its remaining cost cannot be removed simply
by saying the canvas has no model. This investigation does not attribute all CPU to Pixi/mask work.

## Selected correction

Add an independent renderable-content input to the existing governor. Initialize the Pet scene
with it false, pause regardless of focus/activity/throttling when no model is attached, and set it
true only after successful model attachment. Preserve the current activity/focus/visibility tiers
once content exists. Keep the one-shot mask prime, resize and attachment refreshes; stopping the
governed ticker then stops repeated empty renders/readbacks without adding a new timer.

The default governor behavior for other existing callers should remain renderable. Pet startup
must supply the false state before the constructor's first `apply`, to avoid unnecessary initial
start. On successful attach, refresh the mask before resuming frames so click-through uses the
new silhouette immediately. Costume swaps load before removing the old model, so an existing
model remains renderable during failed replacement; preserve that recovery behavior.

Required checks: empty boot stays paused across focus/activity/visibility/throttle changes;
successful first attach resumes the applicable tier; failed initial load stays paused; failed
replacement preserves the existing model; hidden/asleep attach remains correctly paused when
throttling is enabled; force-mask/teardown/stale switch behavior stays valid. Follow with the same
packaged isolated process and comparable idle sampling to quantify actual benefit. No asset
packaging or current-window changes are part of this proposal.

Potential regression is a stage stuck paused after attach, so the actual attach boundary must
publish renderability, not model-request start or a guessed readiness signal. The gain is bounded:
cursor IPC and other background work remain. The measurements below bound the observed gain;
they do not establish the full task's performance or owner acceptance.

The integration owner approved this focused implementation after reviewing the measured evidence.
`RenderGovernor` now has an additive renderable-content input (default true for existing callers),
and `createPetScene` supplies false before the constructor's first apply. Every unrelated flag leaves
an empty ticker paused. Attachment primes the mask before marking it renderable; disposal pauses it.
No asset source, import, packaging or currently running window was changed during implementation.

`render-governor.test.ts`, `pet-scene.test.ts` and existing costume-switch tests passed: 3 files /
23 tests. Scoped ESLint and Desktop typecheck passed. Coverage includes empty scene through flag changes, first attach
resuming the current blur tier, hidden/asleep attachment behavior and existing switch/teardown
contracts.

## Packaged after observation

The native-flow worker rebuilt the production frontend and Desktop, stopped only its owned
Desktop tree, and reopened the same isolated fixture. New Desktop PID was 36860, started at
`2026-11-10T17:57:31.654+08:00`; Core PID 31260 and CDP port 19224 were unchanged.
The worker checked the packaged gate and inspected Home/Pet screenshots before closing its
CDP clients. The integration owner again held CPU-heavy tests during the 15-second observation.
The sample ended at `2026-11-10T18:02:37.0145426+08:00`.

The actual Pet was visible and unfocused, with one canvas and empty motion/expression inventory.
Its governor had `renderable=false`, `ticker.started=false`, and `maxFPS=0` (the latter is the
unmodified Pixi default limit, not evidence of zero callbacks by itself). This directly proves
the intended content gate reached the running packaged scene.

| Process/group | Before CPU seconds / 15.0392 s | After CPU seconds / 15.0419 s |
| --- | ---: | ---: |
| Native Desktop | 0.82812 | 0.54688 |
| Owned WebView processes | 3.21874 | 3.15626 |
| Desktop + WebView | 4.04686 | 3.70314 |
| Core | 0.00000 | 0.01562 |

Normalizing for duration, Desktop/WebView usage changed from 26.909% to 24.619% of one logical
core (1.345% to 1.231% of this 20-logical-processor machine): **8.51% lower in this single pair**.
Do not attribute the entire difference to the renderer or extrapolate it to loaded avatars,
startup, configuration latency, or general application performance.

Both samples used the same 10 ms CDP CPU-profiler interval alongside process CPU measurement:

| Pet evidence | Before | After |
| --- | ---: | ---: |
| Sampled `readPixels` | 12 | 0 |
| Sampled `requestAnimationFrame` | 4 | 1 |
| Sampled Pixi `_tick` | 2 | 1 |
| TaskDuration delta | 1.161982 s | 0.944649 s |
| ScriptDuration delta | 0.440731 s | 0.313556 s |
| DevToolsCommandDuration delta | 0.165151 s | 0.116457 s |
| Layout / style-recalculation counts | 0 / 0 | 0 / 0 |

No `readPixels` sample appeared after the correction, consistent with the stopped governed
ticker and its frame-gated mask callback. Sampling cannot prove every possible readback is
absent, and the remaining RAF/Pixi samples show that this change does not stop every internal
library timer. Native `fetch`/IPC still appeared; the existing cursor poll remains outside scope.

Limits: these are single instrumented observations, with measured DevTools overhead, not
uninstrumented distributions. DOM focus was false for both; the governor's cached focus input
was false before and true after reopening. The empty-content gate is independent of that input,
but the difference is retained in the evidence rather than hidden. Process ages and resident
working sets differed after reopening, so no memory improvement/regression is inferred from
the recorded working-set totals. No loaded-model native transition or owner/manual acceptance
was performed in this slice; first-attachment and replacement behavior have deterministic tests.

After evidence:

- `G:/taki-native-flow-artifacts-20261110/empty-pet-idle-cpu-after.json`
- `G:/taki-native-flow-artifacts-20261110/empty-pet-idle-profile-after.json`
- Native-flow screenshots `startup/renderer-fixed-home.png` and `startup/renderer-fixed-pet.png`
  under the same artifact root.

Reproduction: identify the explicit owned Desktop/Core PIDs, recursively select descendants
from `Win32_Process.ParentProcessId`, then compare `Get-Process.CPU` across a Stopwatch-timed
15-second sleep. In parallel attach only to the owned `pet.html` CDP target, enable Performance,
read its metrics and React-held scene's governor without setters, then call
`Profiler.setSamplingInterval({ interval: 10000 })` (microseconds) and profile for 15 seconds.
Stop profiling, read metrics, disable both
domains, and close the client. Keep the window state/profile unchanged and pause other build/test
work for the observation. Retain raw nodes/samples and process rows, not just summary percentages.
