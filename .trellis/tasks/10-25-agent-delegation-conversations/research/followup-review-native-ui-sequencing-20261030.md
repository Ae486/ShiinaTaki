# Supplemental native UI sequencing repair — 2026-10-30

The supplemental native UI script now passes all six checks against actual WebView2 and production Home/WsClient/
controller presentation with the existing scripted RPC fixture. This is not production-Core/model or human acceptance.
Only `apps/desktop/test/s7-subagent-native-smoke.mjs` and `apps/desktop/test/index.md` changed; fixture server/data,
production UI/Core/Shared and Rust were not modified. Source is frozen again.

## Findings (fixed)

### Server receipt was treated as client reconciliation

The coordinator's preserved run at
`target/agent-delegation-20261030-validation/native-ui/2026-10-30T09-59-23-559Z` passed the first four checks, then timed
out waiting for enabled `发送输入`. Its failure screenshot shows the new draft with the stale-target banner. The script
waited only for `fixture.controlCalls.length === 2` after Continue, then immediately edited the next draft.

That count proves the fixture received the request, not that the client processed its reply and refreshed the exact
target. Continue advances control version 3 to 4. A newer draft edited during that interval intentionally retains its
old target/revision; `SubagentDrafts.accepted` does not delete intervening user edits, and the UI correctly refuses to
silently retarget it. This was a harness ordering error rather than a broken Send control.

The script now waits for actual client Continue feedback, cleared submitted draft and refreshed enabled child controls
before editing the next independent draft. It adds no fixed sleep and does not click through a stale-target warning.

### Accepted-but-ACK-lost input was expected to remain unknown after canonical recovery

The diagnostic native rerun instrumented the exact transition and changed its scheduling enough to pass the first
race. It then reproduced the next stale expectation at `replacement read readiness`:
`target/followup-review-20261030/native-ui-diagnosis/reproduction/2026-10-30T10-01-21-908Z`.

The retained DOM and fixture receipts show one `subagent.send`, its accepted input in the conversation and an empty
draft after reconnect. The fixture's `dropSend` stores the input before dropping the socket/ACK. The real controller
therefore recognizes the same operation key on canonical history recovery and clears draft uncertainty correctly.
The script incorrectly waited indefinitely for an enabled manual `已核对，允许重新提交` control.

The revised scenario uses the fixture's existing history hold to test both real phases explicitly:

1. Accept the send and lose its ACK, while canonical reads remain held. Observe the unknown-outcome warning, retain the
   exact draft, and prove the send count is one. Capture screenshot and DOM.
2. Release canonical history. Require the accepted text once in the selected conversation, the cleared draft and
   restored controls. Assert exactly one input with the original operation key and still one send. Capture both states.

The following read-failure test creates a new independent draft before injecting its failure, preserving its intended
draft-retention/read-retry check. It no longer relies on a previously accepted draft remaining unsent.

## Evidence and checks

The `diagnose` feedback loop used existing screenshots/source first, then a native diagnostic run with structured DOM,
button, draft and control-receipt captures. Failure capture is now retained as useful test evidence, not console logging
or production instrumentation. The original failed runs remain intact.

Final passing run:
[`2026-10-30T10-03-18-353Z`](../../../../target/followup-review-20261030/native-ui-diagnosis/final/2026-10-30T10-03-18-353Z/).
Its `evidence.json` reports `status=passed`, six checks, `cleanupFailed=false`, `sourceUnchanged=true`, three total controls
(Stop, Continue, Send) and empty native stderr/stdout. The actual temporary profile is deliberately retained and recorded.

The reviewer inspected `reconnect-unknown-draft.png` and `reconnect-canonical-input.png` plus their matching JSON DOM
captures. Before canonical recovery the unknown draft is present; afterward it is empty, the manual uncertainty
control is gone and the accepted input occurs exactly once. The general RPC-error banner remained visible in this run.
The coordinator's later screenshot review correctly identified its present-tense wording as a production defect;
the [exact-input feedback addendum](followup-review-exact-input-feedback-20261030.md) records its separate verified repair.

```powershell
$env:TAKI_E2E_EVIDENCE_DIR = 'H:/TakiAgent-worktrees/t4/target/followup-review-20261030/native-ui-diagnosis/final'
node apps/desktop/test/s7-subagent-native-smoke.mjs
node --check apps/desktop/test/s7-subagent-native-smoke.mjs
pnpm exec eslint apps/desktop/test/s7-subagent-native-smoke.mjs
pnpm --filter @taki/desktop typecheck
git diff --check -- apps/desktop/test/s7-subagent-native-smoke.mjs apps/desktop/test/index.md
```

- Native supplemental UI: PASS, six checks, exit 0; command completed in 6.52 seconds. The existing Vite large-chunk
  advisory remains nonfatal and was not suppressed.
- Syntax, scoped ESLint, Desktop TypeCheck and diff check: PASS.
- Existing fixture server/data SHA-256: unchanged. Native before/after manifest: unchanged for the passing run.
- No real model, production Core, dependency change, unknown-directory cleanup, source reset or Git delivery occurred.

[`native-ui-diagnosis/`](../../../../target/followup-review-20261030/native-ui-diagnosis/) retains separate diagnostic and
final logs, inherited preimages, two-file ownership manifest, hashes/diffs and static-check results. No unresolved
in-scope harness defect remains. The coordinator owns the separate production-Core native campaign and full acceptance.
