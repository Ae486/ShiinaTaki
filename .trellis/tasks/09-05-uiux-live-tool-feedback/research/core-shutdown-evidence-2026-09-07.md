# Native Core shutdown repair discovered by live-feedback acceptance

## Scope and cause

Root owns this narrow runtime repair alongside L1-L3. The independent native feedback scenarios exercised
actual Node v24.18.0, AI SDK and SQLite with isolated data and a loopback scripted provider. Their business
assertions passed, but immediate process exit could abort Windows libuv with
`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\\win\\async.c:94`, exit `3221226505`.
The same failure reproduced against exact pre-L1 Core sources. A minimal process with no Taki/SDK/SQLite
imports reproduced it after two local fetches: forced immediate/deferred/disconnected exit failed 9/9;
natural exit passed 3/3. File-backed stderr also reproduced the failure and is not a workaround.

The new real-Core regression exposed a second existing teardown defect. `ws@8.21.0` closes its internally
owned HTTP listener without waiting for every upgraded socket's close event. Core then closed SQLite,
and the socket's registered Chat cancellation callback later read the closed DB. The resulting uncaught
exception forced exit 1 and hit the same native assertion. This explained why independently closing
peers before shutdown passed while open or concurrently closing peers still failed after the first fix.
Request-body consumption and inherited test environment were ruled out; their diagnostic changes were removed.

## Final repair

- `main.ts` preserves admission seal, scheduler/recovery stop, bounded turn drain, server, Skill/MCP and
  SQLite ordering. Its final action is now `process.exitCode = 0`, allowing native I/O to retire naturally.
- `WsServer.close()` registers a close waiter for each accepted client, stops the listener, performs the
  existing socket termination, and waits for listener plus all connection cleanup before resolving.
- Added a real-socket unit regression and a real-Core E2E with open/concurrently closing client variants.
  The latter drives two local HTTP400 Chat failures, requests the real graceful handler through a
  test-only IPC preload, and proves exit 0 without a kill. It never loads `.env.local`, a real provider,
  user data, a Host process or OS capability. All temporary resources are cleaned in `finally`.
- Production has no new RPC, signal interception, retry policy, delay or debug instrumentation. This
  repair does not reopen the deferred D77 error taxonomy or change invocation/governance semantics.

## Reproduced and verified

Artifacts are ignored under `target/uiux-live-feedback-20260907/`:

| Gate | Result | Evidence |
| --- | --- | --- |
| New E2E before repair | Failed with native exit `3221226505` | `root-shutdown-red.log` |
| Natural-exit-only diagnostic | Failed; trace isolated late closed-DB cancellation | `root-shutdown-trace-stack.log` |
| New WS lifecycle regression before repair | Failed: 2 connections remained after close resolved | `root-ws-close-red.log` |
| Final real-Core E2E | 2 passed | `root-shutdown-green-final.log` |
| WS/Timeline/activity server focused tests | 3 files, 25 passed | `root-ws-close-green.log` |
| Core and E2E typechecks | Passed | `root-core-typecheck.log`, `root-e2e-typecheck.log` |
| Scoped source lint | Passed | `root-shutdown-lint-final.log` |
| Native ordered/failure/cancel feedback | 3/3, seven synthetic provider requests, graceful exits | `root-native-final.log`, `native-roundtrip-results.json` |
| Native queued admission | Passed with first-turn snapshot/terminal preserved and clean exit | `root-native-queue-final.log`, latest `native/queued-admission-*/result.json` |
| Three Monitor startup/storage modes | DISABLED/FEEDBACK_ONLY/FULL_LOCAL passed; migrations 001-035, nullable presentation and idempotent reopen; zero provider calls | `root-boot-final.log`, `core-boot-result.json` |
| Relevant real-process lifecycle suite | 9 files / 19 unique cases passed after the targeted stale-assertion correction below | `root-e2e-lifecycle.log`, `root-e2e-mcp-final.log` |

The broader lifecycle run covers Core shutdown, canonical-local Memory composition, governance/Host generations,
two-Node Extension routing, MCP, Skills, isolated Secret Catalog and D64 approval/resume. Eight files passed
initially (18 cases total including two other MCP cases). The sole failure was an old MCP presentation assertion
expecting `echo` as the action label, superseded by A1 commit `a771496`. Root aligned that existing test with the
reviewed `调用 MCP 工具` action label and additionally asserted exact server/tool target fields and unchanged
canonical capability identity. Its whole three-case MCP file then passed; no production MCP code changed.
The current T4 `taki-node` was built with `cargo build --locked --bin taki-node` before this run. Provider
configuration stayed dummy/local and the selected tests did not use the real clipboard or open external URLs.

The independent L1-L3 review and final full gates included this change and passed. After the R1/R3
repairs, the coordinator repeated actual Core ordered/failure/cancel (3/3), queued admission and both
shutdown variants (2/2) successfully; see `root-native-reviewed.log`, `root-native-queue-reviewed.log`
and `root-shutdown-reviewed.log`. These process tests do not themselves claim Chat/Pet visual
acceptance or owner inspection. The initial isolated scripts remain clearly
marked diagnostic evidence in ignored `target/`; no production instrumentation remains.

## Prevention

The executable shutdown contract now lives in
`.trellis/spec/backend/server-push-and-connection-auth.md`; E2E fixture guidance links to it. A listening
port's closure is not proof that connection-bound cleanup or native I/O has finished. Future shutdown
changes must test attached peers, concurrent peer closure and post-fetch actual process exit, rather
than only checking a shutdown log or using a forced kill.
