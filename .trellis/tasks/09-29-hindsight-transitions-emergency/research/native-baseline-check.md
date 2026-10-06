# Native environment and baseline check

2026-09-29, before W2 native changes. Ran the existing native compatibility and maintenance migration suites against a fresh owned PostgreSQL18 database through the task-owned `native-tests.mjs` runner. Runner reuses archived ownership helpers and a copied loopback-only egress guard; repository .env loading is disabled, configured provider is mock, local embedding/reranker/tokenizer caches are used offline. No historical instance or original data was started.

Command (cwd H:/TakiAgent):

```powershell
node .trellis/tasks/09-29-hindsight-transitions-emergency/research/native-tests.mjs tests/native_results/test_cutover_compatibility.py tests/native_results/test_cutover_maintenance_migration.py
```

Result: **31 passed in 88.71 seconds**, runner exit0. Owned instance `taki-drill-071b686f8c6d`, port8704, verified data path under private runtime `stage4-native-tests/8bd7128ae8bde388`; stopped cleanly and retained for evidence. No egress refusals. All 205 pre-existing native changed-file hashes still match `native-preimplementation-baseline.json`.

This proves the current test environment and existing D78 compatibility/maintenance migration baseline. It does not prove Stage 4 persistent fencing, final transition proof, delta transfer, Core integration or actual-data conversion. W2 must add and exercise those actual writer paths. The runner accepts only explicit native tests/ paths and runs pytest sequentially (-n0); it starts a fresh fixture per invocation and retains it stopped, so future runs must continue recording owned resources.

## Post-W2 regression in progress

The leader reran the same two selectors on 2026-09-30 after the transition implementation. Runtime
`630d3d11b91418dc`, instance `taki-drill-2b12743c8a89`, port2600: **29 passed / 2 failed in91.24s**, exit1,
stopped true. Logs and result remain in the private runtime. This does not replace the clean pre-W2 baseline.

- `test_cutover_compatibility.py:24` expects the old `taki-memory-hindsight-0.9.0-d77-v1` build while the implemented
  current producer correctly reports `taki-memory-hindsight-0.9.0-transitions-v1`. Update that current-build assertion
  while keeping independent D78 capability assertions.
- `test_cutover_maintenance_migration.py:149` starts with the latest schema, creates a Bank, and downgrades to its old
  test boundary. The new e30 migration correctly refuses to destroy retained Bank-origin evidence. Construct a genuine
  previous-revision schema before seeding the legacy evidence, then exercise its upgrade. Do not disable the new
  immutable-history guard or weaken downgrade refusal to accommodate a historical fixture shortcut.

The W2 implementer adapted those tests without changing historical migrations or bypassing e30 guards. The migration
fixture now returns the still-empty owned schema to the real maintenance revision before generating its old producer
receipts, then exercises the original previous-revision downgrade/upgrade and recovery sequence.

The leader's two-case rerun passed: runtime `a4092c3371b33c60`, instance `taki-drill-1cc82ea55e55`, port3574,
**2 passed in15.06s**, exit0, stopped true. Its selectors were the two exact test names above. Together with the29
unaffected passes, the31 legacy cases are now covered after W2, across two runs. Do not count repeated executions as
new unique coverage. No repeat is required unless later source changes affect these contracts. W2's own full and
independent gates remain separate.

## SDK generation readiness

The existing Windows canonical runner is `.trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_windows_codegen.py`; read its adjacent README before use. Its JRE17, OpenAPI generator7.10.0 JAR and Go1.25 executable still exist under `.trellis/.runtime/g1-toolchain`. Generate only after W2 freezes native schema, using canonical sources/postprocessors and preserved maintained wrappers; no Docker/global install is required by this runner. Existing native `scripts/generate-clients.sh` cleans generated build trees, so use the reviewed Windows runner instead of invoking it blindly. SDK live-service tests remain excluded unless running against the owned fixture. No generation was run during this readiness check.
