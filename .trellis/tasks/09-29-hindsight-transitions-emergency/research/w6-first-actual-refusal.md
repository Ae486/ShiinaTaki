# W6 first actual execution: pre-admission expiry refusal

The first actual emergency run failed truthfully with `MEMORY_TRANSITION_STALE`. Its original result remains failed.
No emergency operation, capture, incident or authority replacement was admitted. Independent restart and D91 were
not started. The owned Node exited normally with code1; the supervisor did not force-stop it. All preserved W5/W6
inputs and frozen sources passed final checks; no Native, transport or model request was made.

History: `<prepared>/emergency-history/ac140a8d81a24846b150cfc93f313e80/`.
Original supervisor SHA256: `16630f6f0fa1e3b7cd6453586e4d7581985046be6684650d47116a6fd92a77ae`.
Stopped Core SHA256: `5c25bd398ba2af5743059d6cd048a2a0dfb1593a3b658a8d86ef943395d4995a`.
No Core WAL/SHM remains. Exec session13166 finished exit1; emergency Node PID34580 is stopped.

## Measured boundary

- Core opening/composition:00:33:05.976Z; offline preview starts00:36:20.446Z.
- Preview created00:37:39.836Z, expires00:39:39.836Z, eligible/complete2Banks, no verified backup, remote loss unknown.
- Submit starts00:37:39.842Z:6ms after issue, well inside the120s validity window.
- The synchronous admission performs repeated expensive identity checks and crosses expiry before completion.
- Supervisor finishes00:41:04.211Z. This is a functional admission-time issue, not a reason to drop identity checks.

Parent immutable read-back compared complete ordered rows against preserved `application.sqlite`:
`memory_authority_selection`1row, `memory_transition_intents`2, `memory_transition_receipts`2 and `memory_operations`15
all have identical hashes. Emergency captures/incidents/surviving evidence/foreign branches/both quarantine tables
are empty. Selected authority remains the original Hindsight epoch and W5 receipt. No action was partly admitted.

The W6 checker owns the narrow repair: one synchronous emergency owner admission records its valid-at-entry time;
both plans share that bounded context while still revalidating stored preview/current config/epoch/inventory.
Healthy final-TTL behavior and expired fresh-submit refusal stay intact. Preview issue time already follows its
expensive read and needs no correction. The exact final implementation/regressions belong in the check report.

## Explicit successor, not blind retry

`w6-owned-emergency-admission-retry.py` defaults to inert. The explicit
`--run-reviewed-unadmitted-copy` entry reuses the original supervisor's separate-process emergency/restart execution,
but admits only this exact stopped Core and failed report, unchanged historical rows and empty emergency tables.
It creates a new retained history and records the preceding attempt. Any second history, WAL, checkpoint, changed
Core, changed report or new admission refuses. It does not edit a stored preview or original runner/pin/result.

The successor allows1800seconds per phase because the real first run used almost nine minutes before refusal.
This permits finite complete work without changing production TTLs, leases or deadlines. Source must be released
again before execution; actual successor execution remains pending.

Synthetic verification:9PASS0.77s; valid read-only preflight, inert default, changed Core/history/WAL/checkpoint/report
refusal and admission/incident refusal even when a hypothetical caller changes the whole-file pin. Ruff E/F/I and
format pass with the Native research helper's120-column convention (the88-column invocation only flagged full
SHA constants). The default command returns `executed:false`. Original actual input was not opened by these tests.

Parent subsequently ran only the successor's `preflight()` against the stopped actual copy:PASS, stopped=true,
emergencyCompleted=false, exact prior report/Core/table hashes and preserved inputs confirmed. No actual driver,
Native/model service or writer was started. The actual retry remains pending the checker's patch source release.
