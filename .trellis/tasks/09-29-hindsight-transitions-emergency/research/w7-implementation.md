# W7 Home Transition Integration — Implementation Handoff

Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.
Date: 2026-10-06. Owner: `/root/w5_head_prefetch_implement`; leader: `/root`.

## Result and source boundary

W7 implementation and its scoped automated gates are complete. Source is handed back for consolidated W8 review.
This report does not mark W8, original-environment acceptance, packaged WebView2/CSP or owner/manual AC passed.

Work stayed in `H:/TakiAgent`, `main`, HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`. The live session binding
`codex_01a10bce-c98d-7930-a034-2842a2739758` still names this task. No rebinding was needed. No sub-agent was spawned.
No commit/push/reset/rebase, finish/archive, dependency installation, Native edit, real-corpus open/reconversion or
parent-owned runtime/supervisor/evidence modification occurred. All new execution used owned synthetic fixtures.

`w7-source-ownership.json` lists SHA-256 and byte size for all 42 touched source/test/index/spec/config paths.
Manifest SHA-256: `3ec6c7c675ca41bc4c26883affc430282772dfa5800cdb3ee54e2a4aad05ce4f`.
These are final file identities; preexisting changes in shared files remain preserved.

## Delivered behavior

| Area | Final implementation |
| --- | --- |
| Shared/operator reads | New `memory.transitions.overview` and strict `MemoryTransitionOverviewSchema`; operator-only preview/status/overview return safe closed reasons. Typed Desktop wrappers validate every result. |
| Core action projection | Initial preview, original recovery and actual preclaim cancel permissions come from Core, including current selection, baseline/configuration, quarantine/foreign branch, exclusive families and nonterminal obligations left by terminal unknown operations. |
| Emergency boundary | `emergencyCanQuarantineOperation` is shared with actual admission. Eligible old Hindsight work can be bypassed; unrelated exclusive work and a previous emergency obligation cannot. No authority lease or publication proof was weakened. |
| History/progress | Up to 50 transition operations, active first, with `hasOlder`; original operation/transition identity, current-authority flag, commit/runtime/queue facts and original emergency disclosure. History remains visible under Local and unavailable target runtime. |
| Status corrections | Emergency never reports pending Native release. Recovery excludes retired authority, quarantine/foreign branches, active lease/executor and changed configuration. Historical targets are described as superseded, not as waiting for runtime repair. |
| Home UI | New independent Operations card, healthy preview with one confirmation, separate emergency preview/confirmation, refused v2 disclosure without an invented identity, explicit recover/cancel controls and diagnostics. Existing layout/theme/primitives remain. |
| Client ownership | Reuses the generic operation controller for subscribe-before-read, coalesced pushes, mutation serialization and refetch after every outcome. A disposable preview generation rejects stale responses and consumes one request identity synchronously before submission. |
| Deadlines | Transition preview/status/overview use bounded long read deadlines; generic submit gets a long unknown-outcome deadline only for transition requests. Native JSON-RPC timeout cleanup remains the only request timeout mechanism. No automatic replay on timeout, close, reconnect or remount. |
| Disclosure | Nullable surviving replica/application/Pending coordinates and backup age remain distinct from remote head/loss, which are explicitly unknown. No-backup does not mean no surviving data; equal cursors do not mean zero loss. |

The lightweight operator selection reader checks current marker, active epoch and receipt identity joins. It is
only a read/action projection and does not authorize mutation. Full independent preview/admission/publication
proofs and the existing truthful runtime readiness observer remain in their production paths.

## Files and integration seams

- Shared: `memory-transition-operator-schema.ts`, driver method registry and named public exports.
- Core: `transition-operator-actions.ts`, `transition-operator-overview.ts`, healthy status/service, emergency
  quarantine predicate, boot composition and authenticated transition methods.
- Desktop: typed memory-operation client, RPC deadline policy, generic feedback formatter seam, transition
  state/controller/hook/card/confirmation/disclosure/progress and Operations page placement. The generic unknown
  operation label no longer falsely attributes every unknown result to a Core restart.
- Tests: operator projection/method boundaries, pure controller/card/deadline tests, an actual authenticated WS
  client test, and a real Chromium DOM test using actual production W5/W6 services on synthetic evidence.
- Updated all eight touched source-folder indexes. New executable UI contract:
  `.trellis/spec/frontend/memory-transitions.md`, linked by the frontend index.

## Executed validation

All Vitest invocations used at most two workers. Desktop integration/browser groups ran files serially.
No W8-wide predecessor rerun was substituted for these focused gates.

| Command/gate | Actual result |
| --- | --- |
| Core six-file group below | PASS: 6 files, 41 tests, 41.43 s, exit 0 |
| Final Core projection/method rerun after selected-obligation guard | PASS: 2 files, 7 tests, 15.13 s, exit 0 |
| Desktop ten-file group below | PASS: 10 files, 60 tests, 54.41 s, exit 0 |
| Final actual WS/browser rerun with initiating window closed while Core still running | PASS: 2 files, 2 tests, 52.86 s, exit 0 |
| `pnpm lint` after final source changes | PASS, exit 0 |
| `pnpm typecheck` after final source changes | PASS, all five packages, exit 0 |
| `pnpm --filter @taki/desktop build` | PASS, Vite 8.1.3, exit 0; existing large Pet chunk warning retained |
| `git diff --check` | PASS, exit 0; Git emitted CRLF-to-LF normalization warnings for existing working-tree files |
| UTF-8/BOM read-back | All 42 manifest paths decoded strictly as UTF-8 without BOM |

Core command:

```powershell
pnpm --filter @taki/core exec vitest run src/memory/transitions/transition-operator-overview.test.ts src/server/methods/memory-transition-methods.test.ts src/memory/operations/memory-operation-kind-transition.test.ts src/memory/transitions/transition-emergency-admission.test.ts src/memory/transitions/transition-healthy-service.test.ts src/boot/memory-transition-boot.test.ts --maxWorkers=2
```

Desktop command:

```powershell
pnpm --filter @taki/desktop exec vitest run src/windows/home/pages/operations/memory-transitions-controller.test.ts src/windows/home/pages/operations/memory-transitions-card.test.tsx src/windows/home/pages/operations/memory-operations-controller.test.ts src/windows/home/pages/operations/memory-authority-state.test.ts src/windows/home/pages/operations/hindsight-activation-card.test.tsx src/windows/home/pages/operations/local-onboarding-card.test.tsx src/windows/home/pages/operations/memory-hindsight-backup-state.test.ts src/lib/rpc-deadline.test.ts src/lib/ws-client-transitions.test.ts src/windows/home/pages/operations/memory-transitions-browser.test.ts --maxWorkers=2 --no-file-parallelism
```

Final integration command:

```powershell
pnpm --filter @taki/desktop exec vitest run src/lib/ws-client-transitions.test.ts src/windows/home/pages/operations/memory-transitions-browser.test.ts --maxWorkers=2 --no-file-parallelism
```

## Actual WS and DOM evidence

Final artifact directory:
`.trellis/.runtime/w7-browser-artifacts/eef3ca2f-9ca9-4c77-af80-fc244d7ea7e2/`.
It contains `browser-check.py`, `result.txt` and the full-page `final.png`.

Final machine result:

```json
{
  "verdict": "W7_BROWSER_PASS",
  "submitCount": 3,
  "originalOperationId": "07d9d8a9-5afb-4018-bb63-028df144255e",
  "lostAckClientSeconds": 1.9210000000020955,
  "initiatorClosedWhileRunning": true,
  "nativeUnchangedDuringEmergency": true,
  "pageErrors": []
}
```

The three explicit submissions were healthy return, healthy reentry and emergency takeover. Keyboard Enter opened
the preview; cancellation received focus; Escape restored the opener. A separately opened emergency preview was
cancelled without submitting. Double activation of normal confirmation produced only one submit.

The owned server delayed the submit response by 1.8 seconds against an injected 1-second client long deadline.
The actual target bind was delayed by 3.5 seconds without replacing the producer. The initiating page was closed
while the original operation still reported running. A second authenticated page observed the same operation
complete, reconnected and retained its identity with no replay. Emergency used real Core capture/publication/bind
and produced no additional synthetic Native transport calls. All owned browser contexts and servers closed through
awaited teardown. The separate WS test also covers delayed preview timeout and late read-response discard.

The approximately 1.921-second value is wall-clock UI feedback latency in this synthetic fault scenario, including
browser scheduling/observation. It is not real-corpus admission latency. Real timers and `performance.now` were
left running; only the browser wall-clock identity was pinned to the synthetic Core fixture clock.

## Findings corrected during implementation

1. Core previously reported emergency Native release pending and overly broad recovery availability. Added the
   actual current/quarantine/configuration/lease/obligation gates and preserved original unknown histories.
2. Preview/status exceptions lost useful safe reasons. They now expose a closed reason without raw error text.
3. Preview/status were misclassified as mutations, and transition submit used the 15-second default. Added the
   explicit bounded policies without replay or external `Promise.race` requests.
4. The first DOM run found focus loss when the preview opener was disabled before confirmation mounted. Keeping
   preview entry controls available during the disposable read fixed Escape restoration; final DOM reruns pass.
5. Screenshot review found old completed targets displayed as waiting for runtime repair. The Core current-authority
   flag now distinguishes superseded history, and raw Bank identifiers were removed from primary progress lines.
6. The first emergency projection test used an incomplete synthetic B4 predecessor. It was corrected to run the
   real healthy cycle that materializes policy evidence; production checks were not weakened to fit the fixture.
7. The WS test initially asserted terminal state before the final coalesced push read completed. It now waits for
   the actual original terminal state and explicitly asserts the source is still running before initiator close.

Initial lint exit 1 reported only two cohesive function length overruns (59 versus 50 and 61 versus 60).
Under the owner's approved policy, exact-path limits are now 60 for the disposable transition controller and 65
for the healthy service lifetime with its read-only overview. No unrelated lint rule was suppressed. Final lint is 0.

## Limits and W8 handoff

- W6 final evidence remains the parent-owned truth; its recovery preview was 90.868 seconds, bind 178.172 seconds
  and queue settlement 256.554 seconds. These are not exact submit ACK measurements. Default long RPC remains
  bounded at 120 seconds and can time out on large real inputs; unknown outcome/observation behavior is verified,
  but timely real-corpus browser admission is not claimed. No production authority lease was extended.
- Browser/Vite ran the actual card, hook, client and production Core services, using deterministic synthetic
  Native evidence. It does not replace the accepted live Native/real-corpus W5/W6 results or certify packaged
  WebView2/CSP, remote Core, user credential portability or owner/manual acceptance.
- Consolidated W8 should review this complete action/preview/confirmation/history path and the exact manifest,
  especially identity-only action projection versus independent admission proof and original unknown recovery.
  No further permission or per-slice independent checker is needed for the already authorized W8 continuation.
- The new spec should be included in the leader's W8 review context. Task PRD/acceptance boxes were not changed.

