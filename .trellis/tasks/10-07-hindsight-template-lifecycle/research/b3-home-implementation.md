# B3 Home template management implementation

## Handoff status

Implementation is ready for independent Home review under the existing Stage 5B authorization. The heavy check
window has been returned to root/Native. This is not an independent PASS or a whole-5B completion claim.
Final Desktop type verification is pending the Core backup v1/v2 consumer corrections described below. The
three newly added backup error labels and their three assertions also await the next allocated small check window.

Root confirmed the empty global `.current-task` pointer is expected for this session; the explicitly dispatched
active task remains `.trellis/tasks/10-07-hindsight-template-lifecycle`. No task metadata, Core/Shared/Native code,
dependencies, original data, installed service or Git lifecycle was changed by this Home implementation.

## Delivered behavior and source ownership

- `apps/desktop/src/lib/ws-client-hindsight-templates.ts` validates both sides of all four released read methods.
  Minimal `ws-client.ts` / `ws-client-methods.ts` composition installs the adapter. `rpc-deadline.ts` gives preview
  and single-child Native observation bounded long-read deadlines; local status/detail use interactive reads.
  Template submit remains an ordinary durable ACK with an unknown outcome after timeout, not a synchronous job.
- `hindsight-template-state.ts`, `hindsight-template-controller.ts` and `use-hindsight-templates.ts` own only
  disposable Home state over the existing memory-operation controller. Every preview detail belongs to the same
  exact preview, and every Bank detail must finish before one synchronously consumed confirmation is usable.
  Scope, editing, connection, identity/selection and plan changes invalidate obsolete consent. Unsubmitted local
  drafts survive reconnect; external version changes require explicit reload. An unfinished resource form blocks
  both preview and confirmation. No read polls, stores browser truth or replays a write.
- `hindsight-template-editor.tsx`, `hindsight-template-resource-editor.tsx` and
  `hindsight-template-resource-form.tsx` implement scope defaults, per-Bank template removal and independent text,
  label, model and directive choices. `value`, `inherit` and `suppress` remain distinct; complete nested definitions,
  tags, triggers, priorities and enablement survive edits. Duplicate additions and identifier changes refuse.
  Version changes clear separately chosen generation requests so old choices cannot silently target removed models.
- `hindsight-template-preview.tsx` shows every Bank's exact config/resource changes, complete before-images,
  deletion content/history/dependency consequences and optional provider work. Existing-resource enrollment,
  deletions and provider work require separate acknowledgements. Same-name directive adoption uses actual selected
  UUIDs; multiple candidates are not automatically adopted. Cancel receives focus and Escape restores the opener.
- `hindsight-template-plan.tsx` separates Native receipt, Core publication, current runtime, original operation and
  historical child records. Recovery uses only Core's original `recoverPlanId`. A current child read validates the
  exact plan/Bank/child and clears prior success on unavailable/stale/error results. Reconnect rereads only the
  selected child's result after status. Historical rollout records retain their observation time and are never
  displayed as current generation progress.
- `hindsight-template-card.tsx` and `operations-page.tsx` mount the surface in actual Operations. Scope options
  come from Core's Bank list, catalogs from Core template status, and selected/latest user revisions stay distinct.
- The root-approved one-line `memory-operations-controller.ts` fix applies the injected error formatter to a
  subscription failure as well as a mutation failure. The default formatter remains unchanged; templates cannot
  leak arbitrary subscription exception text through the common controller.
- The later root-approved `memory-hindsight-backup-state.ts` edit adds three closed messages for unproven template
  history, unpublished changes and required Native observation. Its existing view-model suite now also asserts
  that these errors do not offer manual export as a bypass. These three new assertions have not yet run.
- Updated navigation: `apps/desktop/src/lib/index.md`, Operations `index.md`, and the template management contract
  in `.trellis/spec/frontend/home-window.md`. Existing W9, 5A, B1 and B2 changes were preserved.

The exact released source paths and SHA-256 hashes are in `b3-home-source-release-01.json`. Full input inventories
captured before the two check batches are `b3-home-inputs-01.json` and `b3-home-inputs-02.json`; command/result
artifacts name the applicable inventory and any subsequently changed test input.

## Checks and retained failure evidence

All checks ran serially with at most two Vitest workers. Every `*-result.json` records actual command arguments,
working directory, start/end times and exit status. No passing result substitutes for a failed command.

| Check | Latest evidence | Actual result |
| --- | --- | --- |
| Strict read adapter, complete resource choices, common operation controller | `b3-home-standalone-02.log` and result JSON | 3 files / 15 tests passed; exit 0 |
| Real authenticated WsClient/Core controller integration, including actual scope roster | `b3-home-controller-03.log` and result JSON | 1 file / 10 tests passed; exit 0 |
| Actual Operations with two real Chromium pages | `b3-home-browser-02.log`, result JSON and browser artifacts below | 1 test passed, 4 durable submits, no page errors; exit 0 |
| Adjacent WsClient, 5A, W7, onboarding and authority/activation presentation | `b3-home-adjacent-01.log` and result JSON | 7 files / 92 tests passed; exit 0 |
| Changed template/adapter/common-controller source lint | `b3-home-lint-03-result.json` | 21 files checked, exit 0; the later backup label-only edit is pending its small follow-up check |
| Desktop types against current Shared/Core source | `b3-home-types-02.log` and result JSON | Exit 2; see unresolved cross-owner type closure below |

Retained unsuccessful attempts:

1. `b3-home-lint-01.log`: four initial local findings (unused import and three four-argument helpers), corrected
   before the successful scoped lint runs. `b3-home-types-01.log` is an earlier, pre-final-Shared pass only.
2. `b3-home-standalone-01`: the installed Vitest 4.1.10 rejected the removed `--minWorkers` option. The next command
   retained `--maxWorkers=2` and passed; no test assertion or source behavior changed for this CLI correction.
3. `b3-home-controller-01`: five stale/null-state assertions failed. Production `refreshController` coalesces a
   refresh into a pending push read and returns immediately. The test now awaits the existing `loading` completion
   signal and asserts `error === null`; all original outcome, identity and no-reapply assertions remain. The second
   run passed all ten cases, and the roster-corrected third run also passed.
4. `b3-home-browser-01`: the first fixture used `fakeSetup()`'s empty Bank status, so the actual Home Bank selector
   had no persisted Bank options. It had already proved preview, lost ACK, partial second-observer recovery and
   reconnect. The fixture now obtains `setup.status()` from the same production connection/Bank repository read
   used by the real setup service; neither the UI nor its response invents Bank choices. Browser-02 passed.

## Real browser evidence

Passed run directory:
`research/b3-home-browser/3504f142-9739-4b38-8fbd-0ea0ca7a1d02/`

- `all-bank-preview.png`: complete two-Bank consequences with no prior Native write; keyboard cancellation and
  opener-focus restoration were exercised before capturing this renewed preview.
- `partial-original-plan.png`: the second observer sees the durable original partial plan after the initiator
  timed out and closed while the explicitly held second Bank was still pending.
- `customization-consequences.png`: complete user model and explicit provider acknowledgement after a new preview.
- `derived-current-failure.png`: historical pending remains historical while a new failed read clears the earlier
  completed current result.
- `result.txt` and `browser-check.py`: exact assertions and captured summary. The original operation was
  `a90608a2-89cc-4cce-9426-b69f7cba8bf1`; the scenario submitted exactly four commands (initial apply, recovery,
  customization apply, removal apply). Explicit text equal to the actual Taki template and a complete user model
  survived Taki removal and a real Operations remount. The removed state was asserted but not separately captured.

The failed first run remains under `research/b3-home-browser/4389bddd-b539-447a-835b-38ee0fbed65a/`, including
its two genuine screenshots and failure traceback. No additional browser process was started just for screenshots.

## Fixture boundary and outstanding closure

`hindsight-template-test-fixture.ts` uses the real Core template service, method registry, authority reader,
operation service, push subscriptions, authenticated loopback WS and physical SQLite reopen. It stops the fixture's
original operation owner before creating its sole subscription-enabled replacement, including after reopen.
Explicit gates control only fake Native transport outcomes. Shutdown releases gates and drains/closes owners,
server and isolated storage. This proves Home/Core orchestration and observation, not Native SQL/authentication,
real provider work or full production runtime composition: Native evidence, sync checkpoint advancement and the
runtime replacement delegate remain the existing Core fixture's documented synthetic seams.

`b3-home-types-02` reported one Desktop map missing the three new backup codes and four Core v1/v2 consumer
diagnostics at `hindsight-backup-admit.ts:56` and `hindsight-backup-service.ts:169,171,194`. The Desktop mapping is
now statically corrected; Core owns its consumer/union changes. No cast, exclusion, schema weakening or alternate
wrapper was used to hide them. Root will allocate the small mapping-suite/lint/final-Desktop-types closure after
Core is coherent. The three post-check mapping assertions, final type result and independent Home review remain
open. Whole-5B Native/Core backup validation belongs to their existing owners/root.

No packaged WebView2/CSP, installed Native, original credentials/data, real model-provider calls or manual owner
acceptance was performed. No commit/push/finish/archive or Stage 5C work was started.
