# Parent-owned W6 emergency supervision

`w6-owned-emergency-runner.py` supervises the single prepared W6 Core copy from
`w6-private-copy-preparation.md`. It does not create another corpus copy, start PostgreSQL/Native, restore data,
inject credentials, or retry an interrupted operation. The implementer supplies `w6-owned-emergency-driver.mjs`
with the agreed arguments: `--run-owned-copy`, `--core-data-dir`, `--core-db-path`, `--result-path`, plus
`--phase emergency|restart`. The driver must not spawn processes. The supervisor sequentially starts two independent
Node processes, retaining each result and PID under separate phase directories. Emergency writes the sanitized
`core/w6-emergency-checkpoint.json` after closing Core; restart verifies its stopped Core hash and original
operation/transition/candidate/receipt/epoch before recovering the same authority. The driver carries cumulative
counters from that checkpoint and reports each phase's new dispatch separately.

The default command is inert. Actual execution remains pending until the complete W6 driver is reviewed and source
ownership is quiescent. A real run verifies the original stopped W5 pair and all 1665 prepared input files, exact Core
input hash, separate Core/PG layout, absence of stale WAL and a create-only supervisor lock. It records the current
Taki/driver source inventory rather than trying to match the superseded W5 production-code manifest.

Each child uses the existing clean-environment allowlist and no shell. Its logs, original result, process exit,
before/after Core hashes and preservation evidence remain under the new unique `emergency-history/<id>/` directory.
A 900-second execution ceiling terminates only the owned child and records failure; it never retries, deletes WAL,
or infers rollback. A failure to stop the owned child retains the supervisor lock. Any prior execution requires
explicit state review. Both phases require exit 0 and a literal `completed:true` result; actual zero-dispatch,
authority, data-preservation and restart acceptance still require review of the driver's measured evidence.

## Synthetic verification on 2026-10-06

No actual corpus database was opened or migrated, and no actual Core/Native/model service was started.

```powershell
& H:/hindsight/.venv/Scripts/python.exe -X utf8 -B -s -m pytest .trellis/tasks/09-29-hindsight-transitions-emergency/research/test_w6_owned_emergency_runner.py -q --tb=short
& H:/hindsight/.venv/Scripts/ruff.exe check --select E,F,I .trellis/tasks/09-29-hindsight-transitions-emergency/research/w6-owned-emergency-runner.py .trellis/tasks/09-29-hindsight-transitions-emergency/research/test_w6_owned_emergency_runner.py
& H:/hindsight/.venv/Scripts/python.exe -X utf8 -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w6-owned-emergency-runner.py
```

- 14 PASS in 4.49s: inert default; predecessor/prepared input drift, stale WAL and wrong layout refuse before child;
  actual synthetic child success, exit failure, incomplete/truthy-string result, source drift, no automatic rerun,
  exact owned-child timeout cleanup and retained evidence; an existing lock remains untouched; code changes are
  detected while progress Markdown remains outside the runtime source inventory; two separate child processes
  consume the same stopped checkpoint, and restart failure preserves the completed emergency result.
- Ruff E/F/I and formatting pass. The first lint invocation found two string/docstring wrapping issues; both fixed.
- Default execution exits 0 and reports `executed:false`.

After review, the parent-only actual command is the same runner with `--run-reviewed-emergency`. It has not been run.
The default and 14 synthetic passes do not establish W6 product acceptance or D91 paired-restore acceptance.
