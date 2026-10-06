# Parent-Only Trigger Diagnostic V2: Exact Character Bank

V2 corrects the pre-run blocker in V1: the preserved transition has two acquired/fenced Banks, so selecting a sole
transition owner is invalid. V1's script, notes and manifest remain byte-identical historical delivery artifacts.
Use `w5-candidate-trigger-readonly-diagnostic-v2.py` for the reviewed run; do not run V1 against this corpus.

The implementer has not executed V2, opened the preserved SQLite input, started a clone or issued diagnostic SQL.
Validation is static syntax/lint/format and a source-difference audit only. The reader production fix remains frozen.

## Exact selection

V2 verifies the inherited immutable copy manifest, then opens the preserved `INPUT/application.sqlite` with
`mode=ro&immutable=1`. It selects a unique `memory_transition_preparations` row bound to:

- Transition `6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53`.
- Delta operation `6497dfc9-e287-4cb1-96b5-1020ea1eabc4`.
- Request hash `946b0a8228df74206a91ea4154e34d6592082e5afae2c069a71846e8e301b8d7`.

The query uses all three predicates and `LIMIT 2`; no first-owner or first-preparation fallback exists. V2 also checks
the row ID against `preparationId`, the preparation and executor transition IDs, the explicit Character scope and
nonempty character ID, and equality of `scope.nativeBankId` with `target.bank_id`. The request hash is matched to the
previously audited immutable input; V2 does not import Native codec/engine code to reinterpret the request.

The SQLite SELECT has a progress deadline and the connection is closed in `finally`. The file SHA256 and inherited
input manifest are rechecked afterward. No SQLite writes, migrations, repairs or change of stored identity occurs.

On the PostgreSQL clone, V2 records both owners' Bank IDs, transition ID, phase, revision and generation. It requires
the expected two distinct owners and exactly one membership match for the prepared Character Bank. It samples only
that exact Bank. Both-owner truth remains in `transitionOwners`, while `selectedPreparation` and
`selectedNativeBankId` identify the diagnostic target. Unexpected owner count, missing target or duplicate preparation
fails before endpoint sampling.

## Unchanged diagnostic scope

All remaining SQL, clone custody, source/size/port guards, read-only repeatable-read transaction, time/query bounds,
stored-definition/index/type inspection, endpoint SELECT/EXPLAIN comparisons and cleanup are unchanged from V1.
See `w5-candidate-trigger-readonly-diagnostic-notes.md` for those reviewed details; its V1 command is superseded by:

```text
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-candidate-trigger-readonly-diagnostic-v2.py --run-reviewed-clone
```

This remains parent-run-only after review. No trigger production/migration repair, full apply, profiler, model call
or real-operation resume is included. V2 readiness does not claim runtime execution or performance success.
