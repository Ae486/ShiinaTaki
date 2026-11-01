# Retained native reconnect failure: port audit

This bounded read-only audit inspected the existing failed native run and its immediate successful retry. It did
not launch Core/native UI, make model calls, or change source/configuration.

## Retained observations

| | Earlier failure | Immediate retry |
| --- | --- | --- |
| Validation directory | `native-runtime-recovery/2026-10-30T10-50-18-522Z` | `native-runtime-recovery-retry/2026-10-30T10-53-37-738Z` |
| Native checks | 7 passed, then failed | 8 passed |
| Core scenario start/end | 10:50:20.596Z / 10:50:59.539Z | 10:53:39.692Z / 10:53:54.162Z |
| Final recorded phase | `native-complete` | `exercise-passed` |
| Session deadline / cleanup failure | Both false | Both false |
| Native stdout/stderr artifact | `native-output.log` is empty | `native-output.log` is empty |
| Retained WebView navigation URL | `http://127.0.0.1:8026/test/c2-presence-fixture.html?window=home` (also pet) | Same path on port 7103 (also pet) |

Directories are relative to `target/agent-delegation-20261030-validation/`. The failure is recorded at
`native-runtime-recovery.log:17`: `Error: Timed out: fresh authenticated UI connection`, with the failing call at
`apps/desktop/test/s7-subagent-runtime-smoke.mjs:254`.

Navigation URLs were read only from the two retained fixture-owned WebView History databases identified by each
`fixture-location.json`: `G:/Temp/taki-s7-native-fixture-DWdHSi` and `G:/Temp/taki-s7-native-fixture-rLuR9Q`.
The navigation ports 8026 and 7103 are asset-server ports, not the Core/relay WebSocket ports. Neither is in the
WHATWG bad-port table already retained by the initiative diagnosis.

No loopback URL occurs in either run's JSON artifacts; the effective-settings artifacts contain no WS/port entry.
The retained artifacts therefore do not establish the numeric Core or relay WS port before or after reconnect.

## What the source evidence establishes

Both native evidence manifests pin `test/s7-subagent-runtime-smoke.mjs` to
`3651b3ad177c310dbe1c007eee6f8224bc72315c1d83841e9a67299ce81c5cbd`, matching the inspected current file.
At lines 249-255, the script captures `relay.connectionCount()`, toggles `setOffline(true)`, captures the disconnected
view, toggles `setOffline(false)`, then waits for both a greater connection count and disappearance of the UI's
recovering message. `openCoreRelay` retains one listener and the same captured upstream Core WS URL; `setOffline`
only toggles its flag and terminates existing connection pairs. It does not rebind, restart Core or change ports.

The first seven actual UI checks already succeeded through this same endpoint. A static forbidden-port rejection
of that endpoint does not explain why only the later reconnect phase failed. The retained log does not distinguish
whether the reconnect-count condition, the UI recovery condition, or both remained false; intermediate counters,
authentication states and precise reconnect timestamps were not saved.

## Conclusion

The existing evidence does **not** support attributing this native timeout to the initiative fixture's Fetch
bad-port defect. Numeric WS ports remain unknown, and the native reconnection root cause remains unresolved.
Keep the failed seven-check attempt and successful eight-check retry separate. No native/WS allocator change is
justified by this audit alone. A future recurrence would need endpoint, connection-count and UI/auth-state evidence
at the failure boundary to distinguish its actual stage.
