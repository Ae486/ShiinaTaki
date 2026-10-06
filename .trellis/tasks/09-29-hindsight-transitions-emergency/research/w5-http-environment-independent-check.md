# W5 HTTP child environment and PostgreSQL startup repair

Date: 2026-10-06. Status: **affected startup boundary PASS; ready for parent continuation**.
Scope: NEW HTTP composition and manifest selection only. No real-corpus clone, working pair, model,
HTTP apply, migration or maintenance was accessed or executed by this review.

## Findings (fixed)

- File: `w5_http_composition.py`, `run_child`.
  Cause: it cleared `os.environ` before `control.child_environment(job)` built its allowlist. The child
  lost inherited Windows PATH, SYSTEMROOT, COMSPEC, TEMP/TMP, USERPROFILE and the other approved values.
  The frozen working implementation correctly computes the retained environment first.
  Fix: compute `retained` first, then clear/update and apply the existing task-only HTTP settings.
  The filter still excludes provider secrets and cache overrides and retains the existing offline and
  absent-credential-path settings.
- File: `w5_http_composition.py`, NEW `observe_pg_start` adapter.
  Cause: the frozen PG adapter wrote phase `pg-started` even after a nonzero pg_ctl exit; the later
  assertion discarded the numeric cause. The HTTP adapter now preserves the first startup failure in
  `http-pg-start-failure.json` and `childReport.httpPgStartFailure`: fixed site `pg_ctl.start`, error
  class, numeric exit code and hex status when available. It corrects the phase to `pg-start-failed`.
  It does not change the original return code, swallow an exception, retry, print command arguments or
  environment values, or modify the frozen lifecycle helper.
- Files: `w5_http_inventory.py`, `w5-http-client.mjs`.
  Both now select the NEW checked v3 manifest. No client behavior, timer or performance setting changed.

## Concrete reproduction

A fresh empty `initdb` cluster, the pinned PostgreSQL 18.1 tools and the exact frozen `pg_command`
function were used. Only that function was compiled from its AST, avoiding imports of the original
real-corpus helper chain. The original start arguments/configuration shape and actual subprocess path
were retained; all data and ports were owned synthetic fixtures.

| Environment | pg_ctl --version | Actual pg_ctl start | Process/log result |
| --- | --- | --- | --- |
| Buggy HTTP environment after clearing Windows variables | 0 | 3221225477 / `0xc0000005` | No owned PostgreSQL process; empty command log; no postgres.log on first attempt |
| Approved Windows environment retained | 0 | 0 | Owned executable/creation/data/port identity verified; normal stop succeeded |

This directly proves that the version probe misses the startup failure. Follow-up isolation on the same
empty cluster also found that removing SYSTEMROOT from the otherwise retained environment produces exit 1;
the synthetic PostgreSQL log records failed IPv4 socket creation. COMSPEC alone does not restore a working
environment. The repair preserves the complete existing allowlist.

The parent's earlier real run did not save the pg_ctl exit code. Its reported stage and empty-log pattern
match this independently reproduced failure, but this report does **not** retroactively claim that the real
run had the same numeric status. That clone and its reports were not accessed here.

## Verification

- The NEW `test_w5_http_environment.py` calls the actual `composition.run_child`, its actual
  `models.install` custody adapter and the exact frozen `pg_command`. A controlled rehearsal loader supplies
  only a fresh empty cluster; the real-corpus/model/migration continuation is excluded. Source-verifier
  reports are stubbed only inside this focused boundary test; final actual source verification is separate.
- Before repair, this real startup seam failed with `3221225477 == 0` (1 RED, 4.03s). See
  `w5-http-environment-checks/run-child-red.txt` and `run-child-seam-red.json`.
- After repair, **2 PASS in 4.68s**: actual run_child preserves every approved value immediately before
  program invocation, excludes sentinel API keys/HF cache overrides, retains the HTTP settings, starts
  the owned PG, and writes the after-source report; the second case verifies first-failure numeric/site
  preservation even when a later command returns a different failure code.
- Scoped Ruff check/format, `ty` on the two changed Python runtime modules, and Node syntax: **PASS**.
  An unused import in the new probe was removed. The initial probe's localized initdb text caused a
  UTF-8 capture error; new captures use raw bytes. Startup return-code, PID and log-size evidence were
  unaffected. The final real startup test ran with clean captured output.
- Python and Node independently verify the exact same final **5084-entry** manifest. No broad HTTP,
  model, end-to-end or performance-margin loop was repeated.
- All three newly created synthetic fixture clusters have no postmaster PID and released ports, verified
  after the tests. Their synthetic data/log directories are retained as evidence; no pg0 registry was used.

Exact commands, outputs and fixture states are in the NEW `w5-http-environment-checks/` directory:

```powershell
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5_http_environment_probe.py --run-synthetic
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-http-environment-checks/run_checks.py tests
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-http-environment-checks/run_checks.py quality
```

## Final identity and continuation

Manifest: `w5-http-checked-v3-source-manifest.json`, 5084 entries.

SHA256: `12ab49508b637cca1ac51567dee58a4d064830720d638c28ca182b81097a7884`.

Only three NEW HTTP files changed relative to checked v2; the other **5081 entries** retain their bytes.
The full original 404-entry predecessor, dependencies, production sources, old helpers/reports, leader
documents and task pointer are unchanged. Checked-v2's manifest remains
`921a6dc4ac0b3d80f880bca3a2b3679314be3800b3c77ffdbafa9584ab93d415`; it and the six HTTP source/test preimages
were saved before repair under `w5-http-environment-checks/preimages/`. Exact changed identities are in
`w5-http-environment-checks/source.json`.

Parent continuation uses the existing inert-by-default entry, now selecting checked v3:

```powershell
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-http-diagnostic.py --run-reviewed-clone
```

The parent owns any real-model retry and its data/cleanup gates. This repair does not prove model readiness,
actual HTTP acceptance, working-pair recovery or W5/manual acceptance. No commit, push or archive was performed.
