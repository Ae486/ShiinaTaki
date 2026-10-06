# Parent-Only Trigger Diagnostic V3: Catalog Encoding and Durable Failure Facts

V3 changes only the PostgreSQL internal-char projection and diagnostic result encoding. V2 and the reader repair
remain byte-identical. The implementer has not run V3, opened preserved SQLite/PG data, copied data, started a
service, issued diagnostic SQL or invoked a model. This delivery is ready for parent review and execution only.

## V2 failure and provenance

The parent reported that V2 failed with `TypeError` while serializing bytes in `clone.write_json`. Both the inherited
main and the outer finally failed to persist `result.json`. The selected `pg_trigger.tgenabled` internal `char`
was the suspected source; a byte value also fails V2's enabled-trigger string comparison.

The parent reported retained clone `w5-candidate-native-clone-c41df6be48174ae380a539b2c019eb8b` stopped, ownership
`stopped=true`, no PID, no listeners on 1511/18495/18496, and no full apply/model work. These are parent-reported
cleanup facts, not a new implementer runtime inspection or a substitute for the missing V2 result.

## Minimal changes

- Catalog SQL now selects `t.tgenabled::text AS tgenabled`. No other SQL changes. Remaining catalog projections are
  text/name, text arrays/null, booleans and integers; the function OID is already cast to text. Definitions and plans
  retain their existing content and interpretation.
- `write_result` encodes before opening the file. A `TypeError` or `ValueError` records an encoding-failure flag and
  a closed error class. It retains the original diagnostic error; an encoding-only failure receives
  `ReportSerializationError`, so the inherited main's existing error gate refuses success.
- The fallback contains only a fixed meaning, output root, closed error classes and current lifecycle/preservation
  booleans. Missing or malformed facts become null. Arbitrary payloads, exception text and stacks are omitted.
  The outer finally writes again after reader-source and port checks, retaining the latest actual booleans.
- Only `result.json` uses the replacement writer. Ownership/source manifests use the unchanged inherited writer.
  A final encoding-failure gate also prevents a degraded report from being accepted. Filesystem write errors remain
  explicit; this patch does not claim durability when the filesystem itself refuses a write.

`w5-candidate-trigger-readonly-diagnostic-v3.patch` is the complete diff. Removing these exact changes produces the
same AST as V2. All budgets, preparation/Bank selection, SELECT-only guards, read-only transaction, custody,
copy/start/stop sequence and source checks are unchanged. No production source or migration was changed.

## Verification

`w5-candidate-trigger-readonly-diagnostic-v3-test.py` uses only a fake catalog and temporary JSON files. It imports
V2/V3 without invoking their entry points or importing the clone custody helper. **4 tests passed in 0.022s**:

1. Reproduce V2's enabled-trigger failure and subsequent bytes serialization failure with modeled driver output.
2. Pass V3's actual complete catalog-validation pipeline and persist/read its metadata and final report.
3. Preserve the original failure, false preservation facts and updated outer-finally cleanup facts after byte failure.
4. Refuse encoding-only bytes, circular and non-finite payloads; omit unknown exception names and absent success facts.

Scoped Ruff `E,F,I` at 120 columns and `ruff format --check` passed for the script and tests. Syntax/AST audit passed;
V2's 13 manifest entries and all 17 frozen reader entries were rehashed unchanged. No length-limit override was needed.
See `w5-candidate-trigger-readonly-diagnostic-v3-source-audit.json` and the versioned V3 manifest.

## Parent command and remaining gate

After reviewing the V3 script, patch and manifest:

```text
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-candidate-trigger-readonly-diagnostic-v3.py --run-reviewed-clone
```

V3 readiness is not runtime or latency acceptance. The diagnostic still cannot establish full trigger cost,
publication fencing/cascade correctness or full-apply latency. No trigger production repair, real-operation resume,
Git operation or task-lifecycle action is included.
