# Foreground Chat/Pet live-feedback delivery evidence

Status: **implementation, independent source review and delegated engineering acceptance passed on
2026-09-07**. All required package and native-window gates passed; scoped Git/program delivery follows.

## Scope and authority

The owner delegated completion, real-window engineering acceptance and checked local commits for
the approved UI/UX sequence. This child follows G4/A1/A2, D64 and the D68 Monitor delivery, with the
checked upstream integration `258b35b` as its baseline. All work stays in the isolated T4 worktree.
Personal owner inspection is distinct from this delegated engineering acceptance.

The change supplies one ordered foreground activity producer, bounded Character snapshots, exact
invocation facts and optional Timeline presentation metadata. Chat interleaves language and tools,
keeps terminal outcomes and reconciles history atomically. Pet retains separate language bubbles,
retires transient tools at language/end boundaries and preserves reading and continuous geometry.
It reuses the existing Runtime, Governance, canonical Timeline, D64 negotiation and D68 facts.

Perception push and the wider D67 audit, D69 tool-repair investigation, D75/D76 measurement/evaluation,
D77 error taxonomy and actual T4 initiative/Heartbeat/cross-device delivery remain separate.
Unrelated Avatar Lab, OpenBiliClaw, Desktop build configuration and task metadata are protected.

## Implemented contracts

- `chat.activity` is a strict, payload-bounded, Character-scoped ordered event stream. Its item IDs
  distinguish SDK call-ID reuse. Actual receipt, processing, approval, dispatch and final outcomes
  come from producers; no timer or UI state invents execution or success.
- `chat.activity.read` retains at most the latest **started** foreground turn per Character, bounded
  to 512 items and 1 MiB of display text. A queued admission does not replace the running turn.
  Capacity/staleness is explicit, observer disposal never executes/cancels, and reconnect never resends.
- Migration **035** adds nullable presentation JSON while retaining migrations 001-034, canonical
  content/parts/output, replay and Compaction source identity. Completed SDK steps and actual partial
  language persist once. A complete transaction precedes legacy appends and `timeline.committed`.
- Chat buffers partial appends and reuses the same semantic DOM keys at complete-batch handoff.
  Missing history is recovered within known coverage/turn anchors, including a pending batch wholly
  absent from the newest page. Useful result details retain literal business content and safe markup.
- Pet shares the activity adapter while preserving explicit opening and presentation gates. Its fixed
  top composer and internally scrolling transcript use distinct text/tool identities, measured natural
  occupancy and CSS-driven finite transitions. Exiting or transparent reserved space cannot block input.
  Reduced/zero motion, cancellation, visibility, close and generation replacement dispose stale work.

## Review and native-window findings

The combined independent review uses `gpt-6-astra/xhigh`; implementation uses `gpt-6-astra/high`.
The coordinator owns actual Core/native-window QA, specifications, evidence and scoped commits.

| Finding | Concrete trigger and correction | Evidence boundary |
| --- | --- | --- |
| Queue projection ownership | A second acknowledged-but-queued request replaced the running snapshot. Projection start now occurs after Character queue acquisition. | Focused producer tests and actual two-sender Core proof passed. |
| LF-R1 completed-step duplication | `onStepEnd` can capture A before public `finish-step` consumption; iterator close appended A twice. Partial persistence now uses exact step provenance, preserving legitimate A/tool/A. | Actual-SDK barrier regressions and independent original-probe recheck passed. |
| LF-R2 missing old batch | Reconnect's newest 50 rows can wholly omit a pending older batch. Catch-up uses saved turn/coverage anchors and preserves reachable gap cursors. | Focused regressions and final native two-page recovery across 30 later turns passed, retaining selected text and without resend. |
| LF-R3 conflicting references | Optional text/tool references sharing an item ID could hide canonical tool content. Row/batch consistency rejects conflicting references and retains readable canonical fallback. | Shared/Core/Desktop regressions and byte-identical canonical replay/output checks passed. Valid headers survive with empty references; invalid headers are omitted. |
| LF-W1 selected tool heading | The first result explanation swapped the heading's parent from `div` to `details`, clearing selection. The stable heading now has a sibling disclosure with reserved control space. | Focused fix and final real-WebView selected-title identity/selection checks passed. |
| LF-W2 initial overflow follow | An already-rendered waiting bubble became 24 animated segments; the settled viewport remained at scrollTop 0 with 1468 px content and 552 px viewport. Tail-follow now rechecks current reading ownership at finite CSS settlement. | Final real-window barrier reached scrollTop 916, native wheel moved to 266, selected reading position stayed fixed, and explicit return resumed tail-follow. |
| Native Core shutdown | Forced exit after HTTP fetch triggered a Windows libuv assertion; natural exit then exposed late accepted-WebSocket callbacks after SQLite closure. Teardown now awaits actual connection closure before storage release and lets native I/O retire naturally. | Actual Core regression, WS regression and native roundtrips passed; see the dedicated shutdown evidence. |

Details for the runtime repair are in
[Core shutdown evidence](research/core-shutdown-evidence-2026-09-07.md). The final independent report
and source inventory are retained under `target/uiux-live-feedback-20260907/check/`.

## Verification record

Final logs and inventories are under `target/uiux-live-feedback-20260907/`.

| Gate | Final result | Evidence |
| --- | --- | --- |
| Shared suite | 47 files / 446 passed | `implement/final-shared-full.log` |
| Core suite | 312 files / 2,064 passed; one existing skip | `implement/final-core-full-bounded.log` |
| Desktop suite | 131 files / 751 passed, including existing non-owned Lab tests | `implement/final-desktop-full.log` |
| Workspace typecheck | All five projects passed; subsequent Core test-only check passed | `implement/final-workspace-typecheck.log`, `final-core-typecheck-after-mirror.log` |
| Root lint | Passed; one existing unused-disable warning in `run-repo.ts` | `implement/final-root-lint.log` |
| Desktop build | Passed; existing chunk-size advisory | `implement/final-desktop-build.log` |
| Independent source/gates review | PASS; no unresolved finding; 127 files verified | `check/final-review.md`, `check/source-freeze.json` |
| Actual Core activity | Ordered/reused-ID, failure and observer-reconnect/cancel 3/3; seven local scripted provider requests | `root-native-reviewed.log`, `native-roundtrip-results.json` |
| Actual Core queued admission | Passed; active snapshot/terminal preserved | `root-native-queue-reviewed.log` |
| Actual Core shutdown | Open/concurrently-closing peer variants 2/2, natural exit without kill | `root-shutdown-reviewed.log` |
| Native WebView2 interactions | 15/15 groups; zero page/console errors | `root-final-r2-window.log`, final QA `interaction-results.json` |
| Artifact/CSP/source proof | Both pages passed; 24 build files, 320 frontend/Shared/config sources, 127 reviewed files, 22 QA inputs and 78 read-only model files verified | `root-final-r2-artifacts.log`, final QA `artifact-verification.json` |
| Native process cleanup | Graceful fixture shutdown; no remaining owned process or listener | Final QA `cleanup.json`, 2026-09-07T13:58:33Z |

The initial concurrent Core run found one stale migration-tail assertion and three timing-sensitive
failures in unchanged tests. The migration mirror was aligned with 035; the other three files passed
in isolation (40 tests), then the entire Core suite passed with four workers. Production/test
timeouts were not changed. Shared/Desktop checks were retained because their verified source did
not change. The existing skip is not counted as a passed test.

Final immutable native QA directory:
`.trellis/.runtime/uiux-qa/live-feedback-final-20260907-r2/`.
Its seven Chat groups cover selected tool heading, exact phases/order/reused IDs and atomic handoff,
safe useful details, snapshot/push reconnect, an old batch behind 30 later turns, a 121-row missing
commit, early acknowledgement/completion and unavailable recovery. Eight Pet groups cover ordered
segmentation/geometry, concurrent and late outcomes, one error bubble, long-stream scrolling and
selection, interruption/cancelled CSS, reduced/zero duration, close/reopen and real native visibility.

The measured Pet frame stayed x96/y24/w288/h592 in a 480x640 logical window at DPR 1.5. Entry,
tool-to-language handoff and tail exit produced 30/28/29 distinct intermediate heights. The shared
handoff envelope changed from 42.5625 to 79.6875 px without collapsing through zero; earlier fitting
language and composer anchors stayed stable, and tail height plus spacing were fully released.
Four actual CSS animations were cancelled and still settled; the actual WebView2 controller emitted
hidden/visible events and restored retained content. The coordinator also inspected final Chat,
segmented Pet and message-only error screenshots for legibility and layout.

The first frozen UI run passed 14/15 but used a policy-refusal fixture for the long disconnected
interval, preventing authentication/recovery from starting. The replacement fixture holds the
replacement connect acknowledgement while later turns finish, then permits normal subscription and
history recovery. The full 15 groups passed in the new immutable directory. Production source and
build hashes were unchanged; the earlier failed fixture evidence remains preserved separately.

Source inventory SHA-256: `e3f72732d81a88d36eb82327150580bec340229dcfecaefd2d7fe80afac100d9`.
Independent freeze SHA-256: `ababfbeb025fe4492e1be49e3d4fb8739c9e5bad6c1f52fe5a154bff5eaa0ca1`.
Build inventory SHA-256: `5e95b9bc939efe26725d4c5f7b8d45f9fda71ed244c067251da935181e1c25f5`.
The build contains only Home/index/Pet HTML entries; no Lab/Spike entry is bundled.

The native harness runs unchanged production Home/Pet HTML/JS/CSS with the production CSP and a typed
loopback-only synthetic transport. It serves the existing 78 development-model files read-only from
an allowlist; none are copied or embedded. A Pet-only ignored-host command changes real WebView2
controller visibility without showing the HWND or replacing `document.hidden`. Actual Core producer,
authorization, SQLite and signal behavior are verified separately from this synthetic UI transport.
No paid provider, production database or real clipboard operation is part of these checks.

## Deployment and rollback

Use the existing locked workspace build and coordinated Core/Desktop release. There is no new
dependency, secret, environment variable or external service. Core's normal migration runner adds
the nullable column; legacy rows and old append consumers retain their existing canonical data.

Rollback of this behavior must retain the additive column and canonical records. Revert only the
reviewed foreground-feedback changes through the normal coordinated release process; preserve the
completed D64/D68 and upstream Memory contracts. Do not delete presentation data or rewrite replay
history as a rollback shortcut.

Checked local commits and final task/program status are recorded in the coordinator's program
delivery checkpoint. No push or task archival is included in this child delivery.
