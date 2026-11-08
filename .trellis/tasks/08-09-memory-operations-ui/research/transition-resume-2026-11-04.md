# Research: Minimal current-build backup and transition verification

- Query: Resume implementation-plan section 2 through existing operations on disposable data, without rebuilding Stage 3/4 or waiting for D94-D96.
- Scope: internal; Taki source and retained evidence, plus the read-only `H:/hindsight` checkout.
- Date: 2026-11-04

## Findings

**Append the connected backup, healthy roundtrip and emergency steps to the current `first-use-runtime` journey. Add one bounded offline restore phase using the existing Native CLI and current Core preflight. No new harness or production framework is needed.** The legacy `.trellis/.current-task` is empty; the parent explicitly assigned this task and this report. Nothing was executed beyond reads and this report write.

### Reusable entries and present adaptation

| Entry | Role and necessary adaptation |
| --- | --- |
| `research/first-use-runtime/native-smoke.mjs:82,384,497` in this task | Existing real main.ts/WS/Home/Native journey; run from repo root with `node .trellis/tasks/08-09-memory-operations-ui/research/first-use-runtime/native-smoke.mjs`. Its `submit`/`awaitOperation`, `step`, restart and teardown are reusable. Append after the parent's v2 template step, before teardown; this report does not change that step. |
| `research/first-use-runtime/smoke-native.mjs:17,149` | Existing PG0 and guarded Native entry. **Backup route is currently disabled:** the clean launch environment omits both `HINDSIGHT_API_TAKI_BACKUP_ENABLED` and `HINDSIGHT_API_TAKI_BACKUP_DIR`. Set them in this fixture to `true` and an owned `G:/taki-first-use-<id>/native-backups` directory before launch. The archived `native_launcher.py` merely invokes `hindsight_api.main.main`; it does not enable backup. Native `api/taki_backup.py:46,114` confirms default-off and supports v2 observation when enabled. |
| `research/first-use-runtime/home-browser.mjs`, `home-check.py` | Extend existing Home actions for backup and transition previews/confirmation. Read/observe through the existing operator WS client. Do not introduce another Vite/browser server or operation ledger. |
| Stage 4 `research/w6-d91-runbook.md`, `w6-paired-native-restore.py:30,45,73`, `w6-paired-core-restore.mjs:18` | Reuse the stopped-copy, whole-row/trigger comparison and real encrypted fixture-catalog procedure. **Do not run these old scripts unchanged:** they pin the old H: root; the Native helper parses a v1 request and regenerates a backup. The complete W6 runner also has create-only ownership tied to historical W5. |
| `H:/hindsight/hindsight-api-slim/tests/native_results/template_backup_joint_helpers.py:298,342` | Current v2 CLI invocation and `physical_target`: new database, same schema identity, migrations, `_restore`, isolated restored engine and cleanup. `joint_service:272` exposes actual HTTP with `create_app(..., initialize_memory=False)` and `lifespan="off"`. Reuse this small procedure; its original evidence paths/driver/network-guard assumptions need current-task adaptation, so importing it is not a drop-in G: runner. |
| `packages/core/src/memory/hindsight-backup/hindsight-backup-preflight-operator.ts:18` | Current maintained restore entry: `runHindsightRestorePreflight({corePath, manifestPath, endpoint, catalog, signal?})`. Reads the sealed immutable Core and **fresh actual restored Native** v2 observation; constructs no Core writer and runs no migrations. Reuse the first-use fixture's actual catalog/master-key/host identity, not B3's secret stub. |

### One connected sequence and exact operation contract

All mutations go through `memory.operations.submit({ request })`. Observe the admitted ID with `memory.operations.status({ operationId })`, the existing operations subscription, and `memory.authority.status`. The current `submit` helper is at `native-smoke.mjs:90`; terminal does not necessarily mean successful.

1. **Capture and verify while Hindsight is healthy.** Finish the parent's v2 handoff, drain Pending and synchronize the current Banks. Click Home's create-backup action, equivalent to `{kind:"backup.capture", expectedEpochId:currentEpoch, route:"native-endpoint"}`. Require `completed`, a non-null `result.verifiedAt`, no mismatch and the original backup ID. Click verify, equivalent to `{kind:"backup.verify", backupId}`. Read `status.hindsight.backup.latest/lastVerified`; preserve sealed `core.sqlite`, `manifest.json`, and the actual Native-host ZIP named by the manifest. API backup returns proof/digest, not ZIP bytes; this fixture can copy its own local Native artifact for the restore phase.
2. **Healthy return.** Use `memory.transitions.overview({})` for availability, then `memory.transitions.preview({kind:"transition.return-local"})`. Home builds the exact request below and presents one normal confirmation. Require operation `completed`, `result.authorityCommitted===true`, `runtime==="ready"`, `queue==="settled"`, a receipt, a new Local epoch, and working ordinary Local recall.
3. **Intervening Local change, then re-entry.** Use the existing controlled chat/tool retain path for one additional uniquely identifiable memory; use existing registered maintenance/Block operations only if a changed edge needs them. Preview/confirm `transition.reenter-hindsight` with fresh identity. Require a new Hindsight epoch, the same Native Bank IDs/generations and existing mappings, one occurrence of the added item, and retained selected v2 template/default state. Read `memory.transitions.status({transitionId})` plus authority/runtime. Reuse W5's full mutation/expiry/Block/identity proof rather than manufacturing another complete corpus matrix. Current empty queue does not become evidence for nonempty queue recovery.
4. **Emergency on this disposable branch.** Capture/verify a new pair after re-entry so backup interval coordinates belong to its current epoch. Preserve it before emergency. Stop the owned Native process, keeping Core running; `native-fault.interrupt(true)` blocks only retain POSTs and is **not** provider unavailability. Open the separate emergency preview, retain nullable cursor/backup-age disclosure and explicitly unknown remote loss, then confirm `transition.emergency-local`. Require committed Local/ready/settled, a separate incident with `fullBackup:false`, no Native/model dependency during takeover, and successful ordinary Local use. Restart Core and require the same epoch/receipt. If testing old-provider exclusion, restart only this same owned Native and require re-entry refusal with no new authority publication. Do not create a new Bank set to make it pass.
5. **Physical restore independently from the preserved Hindsight pair.** After stopping this Core and any restarted Native, run the bounded procedure below. It restores the pre-emergency pair into another owned target; it does not reverse the emergency working database or touch originals.

Transition request shape (use the actual preview; do not synthesize `expected`):

```ts
{
  kind: preview.kind,
  requestId: crypto.randomUUID(),
  previewId: preview.previewId,
  previewHash: preview.previewHash,
  expected: preview.expected,
  confirmation: preview.kind === "transition.emergency-local"
    ? "emergency-takeover" : "healthy-switch",
  ...(preview.recovery ? { recovery: preview.recovery } : {}),
}
```

Source: `apps/desktop/src/windows/home/pages/operations/memory-transition-state.ts:42`; Shared `memory-transition-schema.ts:48`; registered reads `packages/core/src/server/methods/memory-transition-methods.ts:16`. A refused emergency preview has no usable `expected`; an unknown submit result is observed under its original ID, never automatically submitted again. For recovery, preview with `{kind, recoveryTransitionId}` and carry its returned recovery fields unchanged.

### Bounded physical restore and prerequisites

Use only a new database in the current owned PG, or a second owned PG0 under G:. Keep the archived schema name unchanged (normally `public`) and change the database/PG target; v2 configuration/schema observation is stronger than the old v1 fresh-schema drill. With Native/Core writers stopped, inspect the sealed artifacts and capture source table/trigger digests. Create the isolated target, then invoke the existing admin commands under a clean child environment whose `HINDSIGHT_API_DATABASE_URL` points **only** to that target:

```powershell
& H:/hindsight/.venv/Scripts/python.exe -B -m hindsight_api.admin.cli run-db-migration --schema public
& H:/hindsight/.venv/Scripts/python.exe -B -m hindsight_api.admin.cli restore <owned-native.zip> --schema public --yes
```

These are prepared commands, not commands executed in this research. Current CLI `admin/cli.py:468,651,751` validates target columns before its atomic COPY replacement and restores trigger modes. Supply fixture-only clean/offline settings; do not inherit owner `.env`, provider credentials or original URLs. Preserve the existing loopback guard for any thin helper.

Compare all current `BACKUP_TABLES` rows and trigger modes with the frozen source before any restored worker starts, using the existing W6 `inventory`/`triggers` logic and B3 `stored_rows` comparison. Do not hard-code 56/61 as the definition of completeness. Serve the restored engine for authenticated v2 observation using B3's no-lifespan/no-background-worker service pattern, with the same effective model/template configuration and fixture tenant identity. Call `runHindsightRestorePreflight` against that service and the exact sealed Core copy. Verify Core SHA/bytes remain unchanged, recorded migration head matches, full Bank/receipt/body closure and template observation pass, and the real fixture catalog is readable. Do not migrate the sealed `core.sqlite` before validating it. Starting restored Core writers is not necessary for this D91 gate; existing partial-effect/recovery evidence is reused.

Route b is an available fallback, not required in addition to the route-c happy path. If deliberately selected: submit `{kind:"backup.capture", expectedEpochId, route:"operator-artifact"}`; use its actual staged `native-request.json`; run `hindsight-admin backup <owned.zip> --schema public --taki-request <request.json> --taki-service-url <owned-source-url> --taki-api-key-env <fixture-key-variable-name>`; copy the ZIP into the owned `backups/inbox/`; submit `{kind:"backup.admit", expectedEpochId, backupId, fileName:"native-backup.zip"}` then verify. **V2 CLI backup needs actual service observation; the old v1 request-only invocation is insufficient.** Reference: Native `admin/cli.py:580` and `template_backup_joint_helpers.py:298`.

Prerequisites/cleanup: parent owns the single heavy runner; G: has the stated capacity and H: is nearly full. Existing fixture already stages PG/Core on G:, creates fixture-only custody, scrubs the API key and records child PIDs. Retain backup ZIPs, sealed Core, custody and failed results until the restore gate is complete. Current teardown `native-smoke.mjs:468` removes its PG, so place restoration before that cleanup or explicitly retain the owned source PG until comparison. Stop restored HTTP/engine/PG and Core gracefully, verify owned ports/PIDs gone, then remove only newly created database/PG resources. Never invoke old create-only W6 supervisors, start historical W5 PGDATA, copy original credentials, or delete the only retained recovery pair. Existing evidence-copying only takes top-level logs/JSONL; explicitly record artifact paths/digests and the restore result without dumping secret/catalog contents.

### Reused evidence versus migration 060

| Evidence | Reuse and current delta |
| --- | --- |
| Stage 4 `w5-healthy-final-result-2026-10-06.md` | Reused 722-source corpus, two Banks, actual healthy COMMIT, 1,275 final records and receipt-backed expiry/Block/policy preservation. Finalization made zero model calls. Preserve its old failed-driver corrections; do not rerun conversion. |
| Stage 4 `w6-final-result-2026-10-06.md`, `w6-d91-runbook.md` | Real offline emergency/restart/foreign-provider refusal and 56-table paired restore with actual fixture catalog. Original environment/DPAPI portability remain unproved. |
| Stage 4 `w8-independent-check.md` | Actual main.ts boots and WS/browser closure/reconnection without mutation replay, using synthetic Native transport. Current real Native connection and template-bearing transition are the useful added edges. |
| Template lifecycle `b3-whole-acceptance.md`, `b3-native-joint-06-result.json` | Customized and removed v2 physical pairs with exact 61-table equality, nonempty refresh history, matching/mismatching pair and fresh target refusal. Historical command: `H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py --allow-http-fixture -- tests/native_results/test_template_backup_pair.py -q --tb=short`. Retain as accepted coverage; no need to rerun both scenarios merely because Core gained 060. |
| Current migration 060 | `packages/core/src/db/migrations/060-hindsight-candidates.ts:9` adds five immutable candidate tables via `hindsight-candidate-domain-sql.ts:6`; it is not a Native table migration or a new restore algorithm. Verify current capture records Core head 60, immutable-copy/readback accepts that exact head, current operations still work, and the new candidate tables stay empty in this non-candidate journey. Existing `060-hindsight-candidates.test.ts:16` covers untouched sealed head059 plus writable upgrade/reopen; source readback is not a new execution. Do not migrate old archives or reinterpret 61 Native tables as a Core schema count. |

Related specs: `.trellis/spec/backend/memory-hindsight-backup.md`, `memory-transition-healthy-drivers.md`, `memory-transition-emergency.md`, and `.trellis/spec/frontend/memory-transitions.md`; acceptance allocations are this task's `research/s6-acceptance-plan-2026-10-24.md` C07/C08/C10 and applicable C16 subcases. External references: no web research needed; applicable Native fork/CLI source is `H:/hindsight` at the parent's stated eb6413a7 baseline with its existing worktree integration; Taki baseline is the parent's stated e260ff4 with migration 060. No Git operation or fresh version attestation was performed here.

## Caveats / Not Found

- This is readiness research, not current-build PASS. The fixture has not yet exercised these appended operations, v2 restore or emergency; report actual failures and blocked/not-run phases separately.
- There is no automatic whole-Core restore RPC to call. D91 is the explicit offline CLI + pre-writer procedure above; a narrow task-local adapter for current G: paths/v2 observation is necessary, not new product infrastructure.
- First-use completion, owner UI judgment, original-data activation, real-model quality and original credential portability remain separate. D94 managed installation, D95 upgrades and D96 extended faults remain later; this report closes none of them.

## Current first-use paired restore adapter

`first-use-runtime/paired-restore.mjs` exports `runPairedRestore({ ownedRoot, pairDir, nativeArchivePath,
pgPort, sourceDatabase: "taki_smoke", custodyDataDir, credentialsDir, apiKey })`. Call it after the fixture
Core and Native have stopped, before `removePg0`; the caller keeps ownership of the source PG lifecycle.
All inputs must belong to that generated `G:/taki-first-use-*` root. The API key is passed only to the
Native child environment; Core authentication resolves the actual encrypted fixture catalog with its
recorded host identity and existing read-only credentials-directory key source.

The Python companion creates one new database in that verified owned PG, retains the archive's schema,
and reuses Native migrations/CLI `_restore`. Every current `BACKUP_TABLES` binary COPY stream and row count
must equal its frozen ZIP entry before HTTP/engine startup. W6 whole-row inventories and trigger checks
also prove unchanged stopped-source data and unchanged restored data across the fresh authenticated v2
preflight. `sourceMatchesArchive` is informational: source progress between capture and stopping may be
legitimate, and `sourceAdvancedTables` identifies those differences without exposing rows.

Observation uses B3's `initialize_memory=False`/`lifespan="off"` service, injected offline fixture
providers, `SyncTaskBackend` and the supported maintenance-disable settings. Current Core preflight reads
the sealed immutable head060 copy, checks the five candidate tables remain empty, and validates the
complete pair/template/body closure with real custody. It starts no Core writer. After HTTP and engine
shutdown, only the new target database is dropped, without FORCE; source backups/catalog and PG remain.
Logs, per-table hashes and `result.json` stay in the returned `directory` under the owned root; failure
throws with that result in `error.detail`. Original pair/catalog/host files are hashed again after cleanup.

Implementation checks only: `node --check .../paired-restore.mjs` and Python `ast.parse` with `-B` passed.
The parent owns runtime execution and records its result separately. This adapter is not a new recovery
framework or evidence for original-user credential portability; existing customized/removed and fault
matrix results remain the reused coverage.
