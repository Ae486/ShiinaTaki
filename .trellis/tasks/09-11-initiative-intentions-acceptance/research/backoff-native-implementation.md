# C4 Native Backoff and Follow-up Display Evidence

Date: 2026-09-28. Workspace: `H:/TakiAgent-worktrees/t4`; branch `task/t4-skills-mcp-productization`.
Task: `09-11-initiative-intentions-acceptance`. This is engineering evidence, not owner acceptance.

## Final result

`node apps/desktop/test/c4-backoff-native-smoke.mjs` completed with exit code 0 and **8/8 checks passed**.
Final execution wall time was 6.52 seconds, including the fixture Vite build. No Rust build was needed.

Evidence directory: [validation/backoff-native-2026-09-28T14-37-32-684Z](validation/backoff-native-2026-09-28T14-37-32-684Z/).

- [evidence.json](validation/backoff-native-2026-09-28T14-37-32-684Z/evidence.json): named checks, final success,
  sampled UI values, exact RPC call counts/connections, source hashes before/after, isolated profile and shell hash.
- [run-summary.log](validation/backoff-native-2026-09-28T14-37-32-684Z/run-summary.log): explicit command, observed
  exit code/wall time and the eight assertions, transcribed from the completed execution and retained JSON.
- `01-unknown-status.png`, `02-daily-stage.png`: unknown status and dynamic daily-stage disclosure.
- `03-accepted-reset-refresh-failure.png`, `04-reconnected-without-reset-replay.png`: separate reset/read outcomes
  and preserved uncertainty after lost acknowledgement.
- `05-follow-up-details-selection.png`, `follow-up-selected-text.json`: actual Chat result and native selected text.
- `06-reset-invalidation-failure.png`: correct failure disclosure after the reset notification/echo race.

The final screenshots for accepted reset/read failure, follow-up selection and notification-race failure were
also visually inspected. Text and actions were visible, reset stayed disabled with stale state, and the original
tool result remained a semantic finite-window explanation. This does not substitute for owner design approval.

## Real versus scripted boundaries

The executable is the existing T4 `debug/examples/c2-presence-fixture.exe`. It runs real WebView2 Home and passive
secondary windows, with a fresh temporary profile, fresh loopback assets/WS ports and no production Node/keyring.
Vite builds the existing `c3-pattern-fixture.html` and unmodified production HomeShell, Monitor, Chat, WsClient and
display components. `c2-native-driver.mjs` supplies the existing bounded CDP control and screenshot protocol.

The new server reuses the C3 fixture transport and isolated SQLite setup. Backoff stages/counts, Monitor responses,
follow-up tool output and connection failures are **scripted**, with Shared validation. They do not execute the
production backoff service, prove qualified human opportunity, call a model or alter real quotas. C4's separate
Core/process evidence covers those actual owners. The native result proves presentation/transport/controller
behavior over the tested responses. Clicks are scripted; native selection and accessibility are queried from
the real WebView. No OS clipboard read/write, hardware IME, Live2D/model appearance or owner quality is claimed.

## Eight assertions

1. A cold failed read renders all four values as unknown, with reset disabled and no invented normal/zero state.
2. Valid pushed status changes render 1x/2x/4x/daily stages, exact counts and locale-rendered eligibility instants
   while retaining the same policy-section node.
3. A held warm read preserves the card; a finite hint burst requires only one trailing covering read.
4. A hidden Monitor does not read on invalidation; returning to its actual route reconciles once.
5. A successful reset preserves existing daily usage, while its failed follow-up read remains a separate visible
   error and disables another reset until a successful refresh.
6. A committed scripted reset with a deliberately dropped reply reconnects through the actual Home client,
   reads current state and preserves uncertainty. The recorded reset-call count increases exactly once.
7. The actual Chat tool card expands its finite-window text. Native selection and the WebView accessibility tree
   omit tool/correlation keys, and the original scripted canonical Timeline part remains unchanged.
8. A reset notification arriving before its response cannot consume the later reconciliation's failure: success
   feedback and a current read failure both remain visible after the actual race.

## Demonstrated defect and correction

The first seven native assertions passed before assertion 8 exposed a real controller race. A reset-generated
changed notification started a read before the reset response. Accepting the echo advanced `acceptUpdate`, so
the shared read coordinator correctly treated that older read's failure as superseded. However, the backoff
controller had joined that read for its post-reset reconciliation; its fresh-read obligation disappeared and
the UI remained stale without explaining the failure.

After root coordination, `InitiativeBackoffController.reset` was changed only at this owner seam: retire the
pre-echo read, accept the valid echo, then start the covering read in a new epoch. The shared coordinator and
other domains were not changed. The additional deterministic test rejects both the superseded and current
reads, checks the retained echo/current error and confirms one reset with no automatic read retry loop.
The scoped controller suite passed **11 tests**, and the final native assertion/screenshot passed on rebuilt assets.

## Harness corrections and limitations

Earlier retained failed directories are not passes. Test-only corrections addressed a CDP attempt to serialize
a DOM element, the two valid unknown-outcome phrasings depending on disconnect timing, and this Windows host's
low port-0 allocation. One run received HTTP port 3659 and WebView2 refused it with `ERR_UNSAFE_PORT`; retrying
port 0 stayed in the low range. C4 now selects explicit random high loopback ports. The C3 fixture gained only
an optional `port` argument, defaulting to its original 0; its normal call contract remains compatible.

Vite emitted the existing advisory chunk-size warning. The successful test has no GUI stderr diagnostic.
The script closed HTTP/WS services, CDP sessions and its native process; a subsequent
`Get-Process -Name c2-presence-fixture -ErrorAction SilentlyContinue` returned no process. The root was notified
before starting its full Core regression. Isolated temporary fixture assets/profile remain available for evidence;
no cleanup targeted the normal user profile or any other worktree.

## Files and checks

- New: `apps/desktop/test/c4-backoff-native-server.mjs` and `c4-backoff-native-smoke.mjs`.
- Narrow test fixture change: `c3-pattern-native-server.mjs` optional explicit WS port.
- Product fix: `initiative-backoff-controller.ts` plus its focused regression test.
- Navigation/specs/evidence: Desktop test index, frontend interaction-pattern contract, prior UI evidence,
  this report, [owner-manual-acceptance.md](owner-manual-acceptance.md), screenshots and JSON.
- `node --check` for both new scripts: passed.
- Scoped ESLint for the controller/test and three native fixture scripts: passed.
- `pnpm --filter @taki/desktop exec vitest run src/features/initiative-patterns/initiative-backoff-controller.test.tsx`:
  1 file / 11 tests passed.
- `pnpm --filter @taki/desktop typecheck`: passed after the controller fix.
- Final evidence confirms identical before/after source hashes. Scoped text checks cover UTF-8 without BOM,
  trailing whitespace and `git diff --check`; no native rerun followed these documentation-only updates.

The owner checklist has four concrete flows and a source-backed production-launch limitation: the normal Shell
still uses its fixed Credential Manager service, application data directory and default endpoint. This round did
not create a production Shell staging deployment. Core-only `TAKI_DATA_DIR`/port variables or a WebView profile
override do not isolate that Shell; no ineffective deployment command or owner pass is supplied.
