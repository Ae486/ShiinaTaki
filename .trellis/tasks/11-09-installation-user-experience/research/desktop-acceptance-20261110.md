# Packaged desktop acceptance continuation

The owner approved real desktop acceptance and performance closure, requested reuse of
the existing task, and then instructed continuation. The current session is bound to
`11-09-installation-user-experience` in the T4 worktree. This is S6 follow-through;
manual acceptance remains the owner's decision.

## Scope and evidence plan

- Use only the existing isolated Core/Shell/WebView profiles from
  `G:/taki-native-flow-artifacts-20261110/startup/fixture.json`.
- Verify imported Live2D first attachment, costume replacement, failed replacement
  preservation and reload recovery in the actual packaged WebView. Native ownership
  and findings are recorded in `packaged-avatar-acceptance-20261110.md`.
- Repeat the existing model-profile user journey against the packaged origin and
  deterministic loopback provider. Each run now has a unique response marker so old
  conversation history cannot satisfy fresh-reply checks. Saving still makes no
  automatic provider request; only the explicit test and two chat messages do.
- Observe current native process resources without a CDP CPU profiler: three
  approximately 30-second intervals in the empty scene, then loaded scene observations
  after functional checks settle. No build or other task-owned heavy test may overlap.
- Separately exercise bounded repeated profile/policy/listener changes in a fresh Core
  fixture. Record actual producer measurements and invariant checks separately from
  memory-leak claims. Coordinate its execution with native sampling.

No paid service, real profile, Hindsight internal change, installer, commit, push or
archive is part of this continuation. Existing successful full-package checks are
reused; new source changes, failures or uncovered concerns determine additional tests.

## Empty-scene resource observation

Actual processes: packaged Desktop 36860 and Core 37512. Desktop descendants are
enumerated from Windows parent IDs at each boundary; PID plus creation time stays
stable. There are 20 logical processors. No scene/window changes or profiler were
active during this measurement; other agents held execution.

| Metric | Three observed intervals / boundary observations |
| --- | --- |
| Interval lengths | 30.534 / 31.073 / 30.709 seconds |
| Desktop + WebView CPU, one logical core | 23.028 / 24.841 / 24.880 percent |
| Desktop + WebView CPU, whole machine | 1.151 / 1.242 / 1.244 percent |
| Core CPU, one logical core | 0.102 / 0 / 0.051 percent |
| Desktop + WebView private bytes | 332.83 -> 332.55 -> 330.76 -> 331.19 MiB |
| Desktop + WebView handles | 4205 -> 4205 -> 4203 -> 4203 |
| Core private bytes | 191.55 -> 191.81 -> 191.81 -> 191.81 MiB |
| Core handles | 265 at all four boundaries |

This current-build observation does not establish a historical regression result,
long-duration stability, or zero idle CPU. Working sets share pages and must not be
reported as unique resident memory. Existing cursor IPC remains a possible contributor;
it also serves DOM bubble/panel hit testing, so empty rendering alone does not justify
removing it.

Reproduction from T4:

```powershell
& .trellis/tasks/11-09-installation-user-experience/research/native-resource-sample.ps1 `
  -DesktopProcessId 36860 -CoreProcessId 37512 `
  -OutputPath G:/taki-native-flow-artifacts-20261110/acceptance/empty-resource.json
```

Raw data: `acceptance/empty-resource.json`; computed deltas:
`acceptance/empty-resource-summary.json`, both under the artifact root above.
Match process ID and creation time before subtracting CPU counters; divide by actual
elapsed seconds, and divide by logical-processor count only for whole-machine percent.

## Packaged model-profile journey

The eight existing native scenarios passed at `http://tauri.localhost` with a new
response marker `19eb018e`: draft save/reopen, keyless apply, explicit unsaved test,
failed candidate preservation, Utility configure/disable/inherit, first reply and
same-conversation Main switch, then Main disable with retained history. Exactly
three requests reached the local fixture: one explicit test and two streamed chat
calls; none had Authorization. Screenshots were inspected. The fresh marker is
visible in both new replies, so previous conversation content did not satisfy them.
Evidence: `model-ui-packaged/model-ui-native-results.json` and its screenshots.

## Repeated Core lifecycle

See [the lifecycle report](repeated-lifecycle-20261110.md). Thirty mixed chat/config
cycles and ninety configuration-only cycles passed, each after three warmups. Old
ports refused connections, credentials stayed byte-identical and live resource
counts stayed fixed; both fixture processes exited gracefully. The no-chat cohort
issued zero provider requests and naturally returned used heap to its baseline
(105.11 vs 105.32 MiB). Its final RSS remained above the post-GC baseline but below
its earlier warmup peak. These observations do not establish long-duration resident
memory acceptance or assign the mixed cohort's higher heap to a particular cause.

## Confirmed avatar blockers and independent challenge

Actual Home import succeeded, but the already-mounted Pet rejected the new costume
using its boot-time metadata. After reload, the Pet read current metadata but requested
the model from the default daily path instead of the selected G profile, receiving
404. A source-backed independent review also confirmed Home highlighted the default
costume even when no model was attached. The repair uses the existing native selected
profile as the asset root/scope authority, fresh metadata inside the existing attempt
budget and live Pet attachment evidence for Home's current costume. No imported asset
is bundled; remote metadata cannot grant local filesystem paths.

## Environment continuity

The owner confirmed that Desktop 36860 was manually closed; this is not a crash.
It was reopened as Desktop 7000 with the same isolated profile. Core 37512 stayed
running. Later rebuild inventories supersede these PIDs when recorded.

H reached zero free bytes and a report write failed. A reversible NTFS compression
attempt on three closed task-evidence directories freed no space. Only this task's
`artifacts/configuration-runtime-20261109/{before,after-core-initial,after-core}`
directories were then moved to
`G:/taki-native-flow-artifacts-20261110/relocated-core-evidence/`, with junctions at
their original paths. All 48 files were SHA256-verified at the destination and through
the original paths. This restored 32,206,848 bytes of H space; source, other caches
and real profiles were preserved. The relocation manifest and compression logs are
under `acceptance/`. Further build/evidence output stays on G.

## Remaining acceptance

The automated/native follow-through below is complete. Owner/manual acceptance,
paid-provider behavior, long-duration native resource stability and the separately
owned Hindsight work remain open. No manual PRD criterion is marked passed here.

## Avatar repair verification

The frontend repair and independent review are recorded in
[the frontend report](avatar-import-ui-repair-20261110.md) and
[the final source review](avatar-final-source-review-20261110.md).
Root's full Desktop run passed **229 files / 1,413 tests**. A subsequent two-file
observer lifetime correction passed nine focused tests, final Desktop typecheck and
scoped lint. Final root lint reports only the already-retained Hindsight function
size finding; it has not been changed or suppressed by this continuation.

The avatar-repair packaged build ran as Desktop **29776** (19:45:20.364 +08) with the same
Core **37512**. The old isolated A/B character directory was preserved as a verified
backup; a new C/D archive was imported through Home after the empty Pet had mounted.
No reload was needed to select and display C. Actual network evidence returned 200
for the selected-profile manifest/textures, and Home reported current only after
Pet attachment. The screenshot was visually inspected by both root and native owner.

Ten alternating C/D selections completed in about 514-531 ms each, retaining one
canvas. The fixtures use identical artwork with distinct costume identities/resource
paths, so this proves switching/lifecycle rather than visual variety. A deliberately
blocked D manifest produced an explicit failure while C, persisted last costume and
Home's current highlight remained intact. The block was removed afterward. Home-only
and Pet-only reload both restored actual C. Selected-root access returned 200 while
an owned sibling-path probe returned 403. A short instrumented render proof observed
6,008 draw calls and no invalid framebuffer/texture objects; all wrappers were restored
and observation connections closed before the resource sample.

The native mock-Scope test setup initially required a resource link that duplicated
the packaged executable's version resource. That test-only approach was withdrawn;
the final tree retains the original example-only linking and no new mock feature.
Final native verification uses four new root/configuration tests, two existing origin
tests, helper seven tests, clippy and the actual packaged scope/rendering observations.
The earlier 215-test run belonged to the intermediate mock setup and is not presented
as an exact-final-tree full-suite rerun. Detailed commands and evidence are owned by
[the native report](packaged-avatar-acceptance-20261110.md).

## Loaded-scene measurement and focus-seeding defect

After all build/test/GL instrumentation stopped and CDP clients closed, six intervals
totalling approximately 184.5 seconds observed the visible loaded C scene. Desktop
29776 and descendants used 35.998-42.561 percent of one logical processor, equivalent
to 1.800-2.128 percent of this 20-logical-processor machine. Private bytes ranged
354.16-360.64 MiB and ended at 357.68 MiB; handles ranged 4251-4262 and ended two below
the initial count. Core used at most 0.153 percent of one logical processor, with
221.84 MiB private bytes and 273 handles unchanged. No process-set churn occurred.

Read-back after sampling found a real mismatch: both `document.hasFocus()` and native
`is_focused` were false, but the governor still held `focused:true` and selected 30 FPS.
`use-render-governor.ts` subscribed to later focus events without reading initial native
focus. Thus a non-focused Pet could remain on the wrong existing tier until a focus
transition occurred. Root requested a narrow seed/listener lifecycle correction,
including event-versus-initial-read ordering and late listener disposal; no frame-tier
values or interaction policy are being changed.

Evidence: `acceptance/loaded-resource.json`, `loaded-resource-summary.json` and
`loaded-scene-after.json`. This 30-FPS observation becomes the directly relevant
before sample. The empty-scene sample has different rendering conditions and is not
used to claim a regression or optimization percentage for loaded content.

## Final focus correction and matched resource comparison

The focus hook now registers the native listener before reading `isFocused`, fences
the asynchronous seed with a focus revision, and disposes both late registrations
and callbacks from retired scenes. Native-query failure leaves a diagnostic and uses
current document focus without adding polling or overwriting a newer native event.
The existing frame tiers are unchanged. Two suites / **16 tests**, final Desktop
typecheck and scoped lint passed. Root read the final hook and lifecycle regression
tests; no additional broad rerun was needed for this isolated correction.

The final packaged build restored C automatically as Desktop **22468**, started
**20:03:26.028 +08**, with Core **37512** unchanged. Before and after sampling,
document focus, native focus and governor focus were all false; ticker stayed active
at the correct **15 FPS**, with the same costume/vocabulary and one canvas. Native
screenshots were visually checked. Observation clients and temporary instrumentation
were closed before sampling and after the final read-back.

Both loaded samples used the same hardware, debug packaging, model C, visible Pet and
native-unfocused state. The before controller incorrectly held focus true. The after
Desktop initially reopened Home on Chat, so root aligned Home to the before sample's
Costume page at **12:05:23.180 UTC**. The first two after intervals overlap or precede
that change and are excluded. The comparison uses the four complete subsequent after
intervals and the last four before intervals:

| Metric | Before, stale focus / 30 FPS | After, actual focus / 15 FPS |
| --- | ---: | ---: |
| Observed duration | 122.677 s | 122.620 s |
| Desktop + WebView CPU time | 48.359 s | 36.563 s |
| CPU, one logical processor | 39.420% | 29.818% |
| CPU, whole 20-logical-processor machine | 1.971% | 1.491% |
| Whole-machine interval range | 1.844-2.128% | 1.398-1.592% |

Normalized CPU usage decreased **24.36% in this matched observation pair**. This is
not a universal performance claim: process age, JIT/cache state and native allocations
differ after reopening, and the build is debug. Private bytes during the matched after
portion ranged 312.96-336.67 MiB and ended at 316.13 MiB; handles went from 4238 to 4202.
Core private bytes stayed 221.84 MiB with 273 handles throughout all seven boundaries.
These values do not establish memory improvement or a long-duration leak-free budget.
No task-owned build, test, profiler or model request overlapped the measurement.

Raw after data: `acceptance/loaded-focus-fixed-resource.json`; summary and explicit
selection: `loaded-focus-fixed-resource-summary.json`, `focus-comparison.json` and
`focus-sample-page-alignment.json`. The post-sample state is `focus-fixed-scene-after.json`.
The same `native-resource-sample.ps1` reproduction command applies with Desktop PID
22468, Core PID 37512 and `-Intervals 6`. Verify actual process creation times before
reusing any recorded PID.

The task context manifests now include the full costume-operation contract directly.
Its duplicate summary was removed from reactive-read-models to keep that existing
file within the configured injection limit; no contract was dropped. Both manifests
validate without truncation warnings. Final whitespace validation passed. The only
root lint finding remains the reserved Hindsight 53-line function.
