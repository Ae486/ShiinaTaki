# Exact input recovery feedback repair — 2026-10-30

This is a production Desktop correction identified by the coordinator's inspection of the previous native screenshots.
It supersedes the earlier sequencing addendum's interpretation of the remaining banner as harmless historical feedback.
The text was not labelled historical: it claimed the operation was still unconfirmed and the draft retained even after
canonical input recovery had confirmed acceptance and cleared that draft.

## Finding (fixed)

`SubagentController.commitDetail` reconciled canonical inputs through `SubagentDrafts.reconcile`, using the exact accepted
operation key. That correctly settled draft uncertainty, but the controller's separate warning had no operation identity
and remained indefinitely. The coordinator's candidate was independently verified in the actual controller and retained
native DOM/screenshots before changing production source.

The narrow repair binds the current unknown send/Continue warning to the mutation's Character, child, work and operation
key, plus the exact feedback object it produced. A matching canonical input clears only that warning. Starting another
action retires the old feedback association. Other keys, later action feedback, known control conflicts, Stop warnings and
independent read errors are not cleared by unrelated input recovery. Existing draft revision handling preserves a newer
local edit; no mutation is replayed and no canonical state is written by the client. This is one bounded local association,
not a notification history or a second acceptance owner.

## Changed paths

- `apps/desktop/src/features/subagents/subagent-controller.ts`: exact mutation identity and warning reconciliation.
- `apps/desktop/src/features/subagents/subagent-controller.test.ts`: wrong-key retention, exact canonical confirmation,
  replacement-client recovery with newer draft/late old reply, and newer conflict/read-error preservation.
- `apps/desktop/src/features/subagents/index.md` and `.trellis/spec/frontend/home-window.md`: delivered ownership contract.
- `apps/desktop/test/s7-subagent-native-smoke.mjs`: assert the obsolete current-state warning is absent after exact recovery.

Core, Shared, Rust, E2E fixtures, source validity, inbox/check-in policy and public/private persistence were unchanged.

## Verification

Before-repair native proof remains under
`target/followup-review-20261030/native-ui-diagnosis/final/2026-10-30T10-03-18-353Z/`.
Its accepted-input screenshot shows an empty draft alongside the still-current unconfirmed/draft-retained warning.
The initial new test command also failed the replacement-client regression against the inherited controller.

One new same-client test initially reused the fixture's fixed revision-1 hint after already consuming it, so its second
read correctly did not occur. The test was corrected to demand an explicit fresh read and to use distinct immutable input
identities; no production invalidation rule or assertion was relaxed. Both that intermediate failure and the original
before-repair log are retained.

```powershell
pnpm --filter @taki/desktop exec vitest run src/features/subagents/subagent-controller.test.ts src/features/subagents/subagent-conversation-transcript.test.ts --reporter=verbose
pnpm exec eslint apps/desktop/src/features/subagents/subagent-controller.ts apps/desktop/src/features/subagents/subagent-controller.test.ts apps/desktop/test/s7-subagent-native-smoke.mjs
pnpm --filter @taki/desktop typecheck
$env:TAKI_E2E_EVIDENCE_DIR = 'H:/TakiAgent-worktrees/t4/target/followup-review-20261030/exact-input-feedback/native-final'
node apps/desktop/test/s7-subagent-native-smoke.mjs
```

- Focused tests: PASS, 2 files / 22 tests.
- Scoped ESLint, Desktop TypeCheck and owned diff check: PASS.
- Supplemental native UI: PASS, six checks, exit 0; 6.86 seconds for the command. Vite's existing bundle-size advisory
  remains nonfatal. The final actual asset build includes the repaired controller.
- Native evidence reports `cleanupFailed=false`, `sourceUnchanged=true`, empty native output, and exactly one send.

The reviewer inspected the final native images and matching DOM captures at
[`2026-10-30T10-10-43-355Z`](../../../../target/followup-review-20261030/exact-input-feedback/native-final/2026-10-30T10-10-43-355Z/):

| State | Draft | Unknown warning | Send count |
| --- | --- | --- | --- |
| Canonical recovery held | Exact submitted text retained | Present | 1 |
| Same operation confirmed by canonical read | Empty | Absent | 1 |

The accepted text appears once in the private conversation. Screenshots prove the banner is actually removed, not merely
that a controller test expects null. The same native run preserves source/receipt distinction, user Stop, exact Continue,
draft/selection retention, read-failure recovery and empty-state behavior.

[`exact-input-feedback/`](../../../../target/followup-review-20261030/exact-input-feedback/) contains inherited preimages,
five-path ownership manifest, diffs/hashes, all static/test logs and the native run. Earlier screenshots are preserved.

## Handoff

Production Desktop source changed and is now frozen. The coordinator must refresh the complete Desktop suite/build and
final integrated/native evidence against this source. Core/Shared/headless gates retain their prior scope because their
inputs were not changed. This supplemental fixture uses actual WebView2/Home/controller but scripted Shared RPC state;
it is not production-Core, real-model or owner acceptance. No independently verified unresolved defect remains in this
specific warning-reconciliation correction.
