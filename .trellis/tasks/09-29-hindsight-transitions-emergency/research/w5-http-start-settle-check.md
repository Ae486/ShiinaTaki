# W5 HTTP exceptional PG startup settle preservation

Date: 2026-10-06. Status: **PASS for this affected boundary**.

## Findings (fixed)

`w5_http_composition.observe_pg_start` previously changed the phase to `pg-start-failed` for both a
returned nonzero status and an exception. The frozen V1 parent waits for `START_SETTLE_SECONDS` only
when the saved phase is `pg-starting`, using its original monotonic anchor. An exceptional pg_ctl start
may leave PostgreSQL still starting, so replacing that phase bypassed the existing bounded settle.

The phase change now occurs only after a returned nonzero code. An exception records the first fixed
`pg_ctl.start` site/error class and re-raises the same exception, preserving the phase file and time anchor.
No frozen helper, timeout, cleanup policy or successful-start behavior changed.

## Verification

Exactly one NEW offline regression ran: `test_exceptional_start_preserves_phase_and_monotonic_anchor`.
It raises a `TimeoutExpired` without launching a process, verifies the same exception object is re-raised,
checks the phase file remains byte-identical (including its monotonic value), and confirms the fixed failure
diagnostic was persisted. **1 PASS in 0.42s**.

Scoped Ruff check/format, ty for the changed Python runtime modules and Node syntax all pass.
Exact commands and outputs are in `w5-http-start-settle-checks/*.json`; the reproducible runner is
`w5-http-start-settle-checks/check.py`. No PG fixture, HTTP, model or performance test was repeated.

## Final source

`w5-http-checked-v4-source-manifest.json`: **5084 entries**.

SHA256: `d28d651db46f6c0c06d4387ac3d235026f996a1e142e6d9b0a95ecae8ad978ef`.

Python and Node independently verify this same final source identity. Relative to v3, only the NEW HTTP
composition and the Python/Node manifest-selection files changed; the other 5081 entries remain unchanged.
The original 404 entries, dependencies and production sources are preserved. The v3 manifest remains
`12ab49508b637cca1ac51567dee58a4d064830720d638c28ca182b81097a7884`; affected preimages, including the
previous independent test, are retained under `w5-http-start-settle-checks/preimages/`.

No confirmed issue remains in this narrow boundary. Real execution and its acceptance remain parent-owned.
The existing entry selects v4 without changing its invocation:

```powershell
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-http-diagnostic.py --run-reviewed-clone
```

No parent documents, task pointer, real clone or working-pair state were modified.
