# Working-pair migration and ordinary reentry recovery

Parent-only execution. The implementation agent must not read or start the real working pair.

- Preserve every entry of `w5-http-checked-v4-source-manifest.json` and add only NEW task helpers/evidence.
- Require the existing owned working root, stopped PostgreSQL18495/HTTP18496, the reviewed Core hash,
  model counter301, completed RETURN and already-applied Local revision2 changes. Never create a copy.
- Reuse `w5-reused-native.py::main`, including its source verification, custody, old-result retention,
  model environment, original driver, native shutdown and final preservation. Wrap only its `execute`
  seam to migrate before MemoryEngine initialization. No production or sealed-helper edits.
- Use authenticated, identity-checked read-only snapshots before/after explicit Alembic e30-to-e40.
  Only the reviewed association function body and Alembic revision may differ. Preserve all complete
  rows, sequence values, historical maintenance, other functions/triggers/indexes and stable DDL.
- A committed e40 without a completed, matching durable migration proof refuses recovery. A valid proof
  may be reused on subsequent invocations; never silently repair or rerun a migration.
- Initial ordinary recovery uses cumulative cap301, no approval and no renewal. Require the same admitted
  reentry and exact prepared delta; derive Bank A from that preparation, never from sorted bank names.
  The original gate captures the actual plan and pauses before maintenance. Model count stays301.
- Subsequent explicitly supplied per-Bank approvals may use the same entry only after valid migration
  proof exists. Approval never permits RETURN, Local effect replay, renewal or a new logical transition.
- Normal fast-stop and exact process identity checks also cover an exception during old pg_ctl startup.
  Preserve incomplete proof and diagnostic files on failure; never kill an arbitrary PID.

Validation is one coherent offline/owned-synthetic gate: authorization/wiring refusal, migration/DDL/row
preservation and authenticated synthetic PostgreSQL. No full model, HTTP or performance suite is repeated.
