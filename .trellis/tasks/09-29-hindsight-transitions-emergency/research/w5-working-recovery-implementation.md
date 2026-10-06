# W5 working-pair migration and ordinary recovery delivery

Implementation and scoped validation **PASS**. Parent owns all actual working-pair reads and execution.
This delivery does not claim that the working pair has migrated or that Bank A maintenance has run.

## Parent execution

From `H:/TakiAgent`, independently verify the delivered SHA256 of
`w5-working-recovery-source-manifest.json`, then run:

```powershell
& H:/hindsight/.venv/Scripts/python.exe -B -s .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-working-recovery.py --run-reviewed-working-copy
```

No argument is inert. The first execution fixes stage=`reentry`, cumulative cap=`301`,
maintenance approval=`None`, renewal=`None`. There is no root, DSN, RETURN or renewal option.
The source inventory preserves all5084 v4 entries unchanged and adds only the listed NEW files.

The expected successful result is **staged pause**, not authority COMMIT. Check both exit0 and the
NEW `working-recovery-history/<id>/result.json`: completed=true, exact Bank A actualPlan,
modelSubmissionsBefore/After=301, ordinaryRecoveryPreserved=true, cleanup stopped/portsReleased=true,
originalSiblingPreserved=true and sealedSourcesPreserved=true. The existing `run-result.json` must
show nodeExit2 and stagedPause.outcome=`staged_pause`. The referenced actual plan must be unapproved,
for transition `6d27eb9b-6bbd-4b56-8ef4-0fda9c5eec53`, and the durable native plan must remain incomplete.
The original gate performs the actual Core outcome_unknown, Native fence/owner and plan identity audit.

The parent separately reported a successful read-only preflight on the actual stopped working pair:
Bank A=`taki-hs-v1-c-d60b8f9887b9060b6c4bf519d7c87b71`, derived from the exact prepared operation
`6497dfc9-e287-4cb1-96b5-1020ea1eabc4`, not from Bank ordering. Preparation SHA256 is
`b6212e75ebf2f5264708237d455fbd287f874a884d4154f27e07f2d7700d0a0d` and the Core remains
`5f12a7385d6b1fa97bcd98fc1a529a891660f76fa053792ea213519109b5ceb3`.
These are parent-reported observations; the implementation agent never opened that pair.

After reviewing an actual plan, a later parent-authorized invocation may use the same entry with
`--maintenance-approval <exact-review-file> --submission-cap <finite-cumulative-cap>`.
It requires an existing valid migration proof, retains the supplied approval before startup and
uses the existing exact per-Bank gate/accounting. A missing Bank allowance still pauses at that Bank.
This capability is not an approval for A or B and was not exercised against real models here.

## Implementation boundaries

- `w5-working-recovery.py` wraps the old supervisor's `execute` only. The old `main`, `prepare`,
  `source_verified`, environment/credential custody, old-result retention, Node healthy driver,
  HTTP/engine drain and normal PG shutdown remain in use. No old helper or production source changed.
- `w5_working_custody.py` requires the existing stopped lexical root, nonlinked PG/Core files,
  released18495/18496 ports, exact initial Core SHA, counter301 and already-applied Local revision2
  policy/Block values. Its read-only SQLite preflight checks admitted same-transition ownership and
  the exact delta preparation. The original driver still validates its full immutable production proofs.
  Its narrow command wrapper also handles lost startup ACKs: verify PID/data/port/executable/creation
  identity before a normal fast-stop. It never starts the original sibling or terminates a guessed PID.
- `w5_working_migration.py` uses the existing complete-row capture with a scoped, restored authenticated
  asyncpg adapter before the engine exists. It validates actual PG principal/data directory/search path,
  refuses additional database sessions or uncaptured foreign table data, and captures63 table-like
  objects in the synthetic fixture, including sequence values and materialized rows. Stable relation,
  column/type/constraint/default/view/rule/policy/sequence/function attributes are also compared.
- Explicit Alembic e30-to-e40 retains only the reviewed function-body change and revision advance.
  It never calls the broader `run_migrations()` bootstrap. Before/after snapshots and completed proof
  persist in NEW `working-e40-migration-*.json`. Core/checkpoint/counter must remain unchanged through
  migration. e40 without a valid proof, incomplete evidence, old-function mismatch or any row/DDL drift
  refuses normal recovery. Evidence is retained for review, without automatic retry/repair/downgrade.
- Subsequent valid e40 proof reuse permits normal recovery's row/sequence-value changes while checking
  the same function, revision, identity and stable DDL. The original migration's complete row evidence
  remains immutable. Each invocation preserves old submissions, RETURN anchor, Local changes and
  original preparation; new submissions must be ordinary recoveries of the same transition.

No production spec update is needed: these are task-only execution/proof helpers within the existing
healthy-driver and per-Bank review contracts. No task pointer, commit, push or archive action occurred.

## Concentrated verification

- Ruff E/F/I, format and ty: PASS for all five NEW Python files including the check runner.
- Complete focused gate:8 tests PASS in24.34s, including one actual authenticated synthetic PostgreSQL.
- Final affected offline check:7 PASS,1 synthetic deselected in0.57s after strengthening the startup-ACK
  and incomplete-proof cases. The authenticated migration code was unchanged; no second full suite.
- Synthetic root:`.trellis/.runtime/w5-working-synthetic-a4db32041c8e4c33a54e435952898a2e`, PG10649.
  Real e30 schema history was installed, a Bank and bytea/identity/view/materialized fixture added,
  wrong password refused, and e40 migration proved all63 captured table-like states plus stable DDL.
  New function SHA256:`72a1716fac4a7ce714fa2a0bf9e77d1b3ba80b9f59dc189640c3d5e1df8044c3`.
  Further insert/sequence advancement passed proof reuse; added-column DDL was refused. Normal fast-stop
  completed and port released. Copies of its before/after/proof/result evidence are in `w5-working-checks`.
- Tests also prove inert/default/invalid CLI handling, cap301 zero permission, restored credential adapter
  on connection failure, identity/function/OID/row/catalog drift refusal, e40-without-proof refusal,
  incomplete-proof refusal, preparation-derived Bank A and same-transition recovery enforcement.

The first synthetic harness run timed out because pg_ctl's detached child inherited `capture_output`
pipes. The harness now writes dedicated command logs with DEVNULL stdin, matching the old supervisor's
file-log approach. The failed synthetic PG10317 was identity-checked and normally stopped; no test Python
remained. `initial-test-timeout.json` preserves this failure instead of hiding it. This issue did not affect
the original supervisor. No actual HTTP/model/performance suite or real-corpus conversion was repeated.

Machine-readable command/results: `w5-working-checks/{lint,format,types,tests,offline}.json`.
Real runtime execution, actual plan review and later A/B approvals remain parent-owned next steps.
