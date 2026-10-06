# W5 first actual-model HTTP attempt: startup failure

The first parent-owned HTTP attempt failed before model initialization, migration, Node launch or HTTP.
This is a startup blocker, not a measured performance failure. Owner steering on2026-10-06 prioritizes
completion and correctness over additional performance margin; resolve this narrow blocker and continue.

## Identity and command

After reading the final independent PASS, parent verified its report SHA256
`0d81b30fbdf069a4b4ec17292176a4d9a6c63a1597237718e0ad63efe1df9f7c`, all37 independent evidence files
under ledger `96abf5327742175c53aee4fcbf07a19770ed73d3562cc43982489080ac82e4f0`, and all5084 runtime
entries at checked-v2 SHA256 `921a6dc4ac0b3d80f880bca3a2b3679314be3800b3c77ffdbafa9584ab93d415`.

```powershell
& H:/hindsight/.venv/Scripts/python.exe -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-http-diagnostic.py --run-reviewed-clone
```

- Job: `.trellis/.runtime/w5-actual-embedding-d52390aae4ca4493a623a9329149e974`.
- Fresh clone: `w5-candidate-native-clone-45ed001c16f24854a265167744a4a919`, port13628.
- Parent PID37792; verified direct worker PID7396. Exec session52836 ended with exit1.
- Same original transition/delta/request hash; no admission, renewal or mutation was sent.

## Observed failure and preservation

The worker stopped after phase `pg-started`, with `AssertionError`. `REPORT.started` and a PG process
identity are absent, root `start.log` is empty, and no root `postgres.log` or migration-before record exists.
The exact original assertion/pg_ctl return code is not captured by the frozen helper. The wrapping error
must not be treated as proof of the precise operating-system cause.

No embedding report was produced: actualDocumentEncodingCalls=0, applyCalls=0, stages empty,
migrationRehearsalCompleted=false and Node launched=false. Supervision was61.282s with no watchdog timeout.
Final diagnostic/HTTP/authority flags are false. Parent/Python before/after inventories all match the same
5084-entry seal; Node inventories are correctly absent and final success is refused.

All source/input/Core/original/source-code preservation flags pass. Owned clone cleanup reports stopped and
port released. Parent independently found no13628/18495/18496 listeners or matching clone/job process.
Working SQLite remains `5f12a7385d6b1fa97bcd98fc1a529a891660f76fa053792ea213519109b5ceb3`.
The real working pair remains stopped; no migration, maintenance, Local edit, renewal or authority recovery occurred.

| Retained file | SHA256 |
| --- | --- |
| Job `result.json` | 4c3ec482aa1098112fb9a191dbf98b9ea42751b0e7a0a2ef39138c3642ec05e2 |
| Job `http-result.json` | ea1199d62043170888182144728d7e487f36e7fd4c1362026afbaebae29f5582 |
| Collected clone `result.json` | 343a280cadc7572e0daa05e50fc2847ceadb29bca3f9877e0b364a926c4e42cd |

## Narrow next step

Parent source reading found a real environment-preservation defect: NEW `w5_http_composition.run_child`
clears `os.environ` before calling `control.child_environment(job)`. The latter reads the current environment,
so PATH/SYSTEMROOT/COMSPEC/TEMP/USERPROFILE and other approved Windows variables are lost. The frozen actual
model helper correctly calculates the retained environment before clearing it. Current small HTTP fixtures
did not invoke this full child-startup seam.

A harmless parent `pg_ctl --version` probe returned0 and PostgreSQL18.1 under both retained and empty
allowlisted environments. Thus the version probe is insufficient to establish startup causation. The sole
reviewer will use a minimal owned synthetic startup fixture, correct only justified NEW HTTP helper behavior,
preserve the failed seal/preimages, and publish a new checked source identity. No broad performance work or
real-corpus/model/working-pair action is delegated. Parent resumes functional validation after this check.
