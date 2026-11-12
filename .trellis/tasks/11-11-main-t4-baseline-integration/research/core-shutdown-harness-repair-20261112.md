# Controlled Journey IPC Shutdown Repair

Date: 2026-11-12. Workspace: `G:/TakiAgent-integration`, branch
`integration/main-t4-20261111`. Production source and the journey's 60-second graceful
shutdown budget are unchanged.

## Trigger and diagnosis

The full controlled journey rooted at `G:/taki-first-use-zkwd8V` passed 11 stages through
step 7, then failed step 8's strict clean-Core-exit assertion. Its original receipt is
`first-use-runtime/results/2026-11-12T09-42-31.030Z/result.json`. The parent confirmed
cleanup and `sourceUnchanged=true` before this repair.

Ranked hypotheses were a harness-owned referenced IPC channel, an unfinished production
producer, and an accepted-socket leak. The fast feedback loop is an actual production
Core boot through the same `bootCore` / `runCoreChild` / `stopCore` helpers, with a fresh
G data directory, isolated OS profile, generated test master key, and an authenticated
operator socket kept open when shutdown starts. A loopback-only unused provider runs in
the test parent. There is no Native Hindsight, PostgreSQL, real model, or real-profile
service in this regression.

The pre-fix run reproduced forced shutdown at the unchanged 60-second budget. After Core
logged MCP closure, test-only IPC diagnostics reported `process.exitCode=0`, IPC still
connected, and exactly three active `PipeWrap` resources. The authenticated socket was
already closed, with no shutdown error. This distinguishes the referenced test IPC from
unfinished application work or a socket leak.

The source agrees: `packages/core/src/main.ts` now sets `process.exitCode=0` after its
actual cleanup, permitting natural Node exit and native-I/O retirement. The old
`smoke-core.mjs` registered `process.on("message")` but never released its IPC channel.
The existing `.trellis/spec/backend/server-push-and-connection-auth.md` shutdown contract
and `e2e/src/core-shutdown.e2e.test.ts` already require test-owned IPC release.

## Minimal correction

Only the `shutdown` message branch in `first-use-runtime/smoke-core.mjs` changed:

```javascript
process.emit("SIGINT");
if (process.connected) process.disconnect();
```

The existing production SIGINT handler runs first. Releasing the test's channel then lets
real application handles drain naturally. There is no `process.exit` shortcut, production
shutdown rewrite, timeout increase, or weakened `code===0 && !forced` assertion.

The new task-only [Core shutdown smoke](core-shutdown-smoke.mjs) is the reproducible
regression and diagnostic entrypoint. Its additional observation message only reports
resource types and profile location; it does not mutate production state or disconnect
anything itself.

## Actual before/after evidence

Commands from `G:/TakiAgent-integration`, Node `v24.18.0`:

```powershell
# Before the helper correction; deliberately asserts the original failure.
node .trellis/tasks/11-11-main-t4-baseline-integration/research/core-shutdown-smoke.mjs --expect-forced

# After the helper correction; asserts strict natural exit.
node .trellis/tasks/11-11-main-t4-baseline-integration/research/core-shutdown-smoke.mjs
```

| Observation | Before | After |
| --- | --- | --- |
| Shutdown budget | 60,000 ms | 60,000 ms |
| Observed shutdown duration | 60,051 ms | 83 ms |
| Exit code / signal | `null` / `SIGTERM` | `0` / `null` |
| Forced teardown | `true` | `false` |
| Production SIGINT handler count | 1 | 1 |
| MCP closed / operator socket closed | Both true | Both true |
| Shutdown error / native assertion | None | None |
| Provider requests / refused egress | 0 / 0 | 0 / 0 |
| Core exited / test provider closed | Both true | Both true |
| Total fixture duration | 64,531 ms | 4,572 ms |

The baseline script's `status=passed` means the expected failure reproduced, not that a
forced shutdown passed product acceptance.

- [Before receipt](core-shutdown-before-2026-11-12T09-59-47.772Z.json), owned root
  `G:/taki-codex-work/integration-core-shutdown-U6A064`, Core PID `23712`.
- [After receipt](core-shutdown-after-2026-11-12T10-02-26.431Z.json), owned root
  `G:/taki-codex-work/integration-core-shutdown-Iw182a`, Core PID `20664`.
- `main.ts` SHA-256 is identical in both runs and after each teardown:
  `0069ee2a0ddab4bdc4b88099af18742249b9a82f536c994866489ce0fbd0f52d`.
- `node --check` passed for both harness files; `git diff --check` passed for
  `smoke-core.mjs`; both files are UTF-8 without BOM or trailing whitespace.
- After both runs, a Windows process/listener inspection found zero surviving Core PIDs
  and zero listeners owned by either PID. The owned logs/data are retained for diagnosis.

## Limits and handoff

The regression exercises actual Core initialization, operator authentication, its real
SIGINT cleanup, accepted-socket closure, storage release, and natural process exit. It
does not exercise active Native/PG work, pending model calls, the complete memory journey,
or owner-manual acceptance. Those remain separate full-journey gates.

The parent received the code-frozen handoff immediately after the successful regression
and syntax checks. Only this documentation and read-only cleanup inspection followed;
the running full journey's harness bytes were not edited.
