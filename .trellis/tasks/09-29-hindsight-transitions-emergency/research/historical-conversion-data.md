# Historical conversion fixture availability

Update2026-10-01: the owner now REQUIRES staged real-data tests and permits necessary real LLM calls, but explicitly
forbids repeating the real corpus's Local-to-Hindsight conversion/extraction. Reuse these existing outputs in isolated
copies. `real-data-reuse-plan.md` supersedes older permission wording below; missing newer D77/activation evidence must
be reconciled legitimately without fabricating receipts or starting a new full conversion.

Checked 2026-09-29 during approved Stage 4 implementation. Owner explicitly permitted use of surviving historical Local/Hindsight conversion data if useful. Read-only inspection only; no native startup, credentials, model calls, migrations or writes to the historical data.

## Located evidence

- Historical contract: `../../08-09-hindsight-initial-cutover/research/d78-real-data-execution.md`.
- Historical validation: `../../08-09-hindsight-initial-cutover/research/d78-real-data-validation-2026-09-09.md`.
- Successful third run: `H:/TakiAgent/.trellis/.runtime/d78-real-data/654131f0175a/`. Earlier runs `06acadec47e7` and `cd01c5453b1e` also survive; preserve them as failed historical evidence.
- `source-snapshot.sqlite` (10551296 bytes) and `validation.sqlite` (84086784 bytes) both pass SQLite `PRAGMA quick_check` through read-only connections. Both retain 2 Canonical Banks, 722 sources, 722 units, 722 policies and operation receipts; FTS has 701 visible rows. No memory text was printed.
- Validation database retains 1 cutover run, 1 coverage capture and 2 replica checkpoints, with no authority activation receipts: historical import readiness does not prove a live authority switch.
- Native PostgreSQL directory and outcome evidence survive. Physical presence alone does not prove current server startup compatibility or native logical integrity.

## Reuse boundary

Use a new isolated copy with SQLite online backup (including WAL), retain the original files, and migrate only the copy. For native reuse, verify stopped ownership and physical-version compatibility before cloning/startup, or use a verified logical export to an owned fresh target. Do not start or mutate the retained historical instance directly. Keep sensitive databases and logs in ignored private runtime storage; only counts, hashes, identities and sanitized outcomes belong in task evidence.

The old 722-record corpus is useful for representation preservation but does not cover all Stage 4 mutations, new scopes, empty Banks, unknown effects, queue conflicts or crash boundaries. Supplement it with deterministic fixtures. No new paid-model call or original-data authority replacement is implied by locating this corpus.

## Current table inventory caveat

The retained validation DB has 1944 `hindsight_replica_records` and 1944 staging records, 2 native import evidence rows and 2 verification evidence rows. The newer B5 `hindsight_replica_sync_records`/checkpoints and `hindsight_source_evidence`/unit/object-binding tables are empty. This is a D78 import/raw-reconciliation fixture, not an already complete D77 application runtime fixture or an activated Hindsight authority. Reuse must go through current production capture/import/projection and activation prerequisites on copies; do not manufacture missing application evidence or mark the old DB ready merely by updating its schema.

Retained native logical kinds (read-only aggregate, no payload disclosure): `bank` 2, `directive` 2, `document` 722, `memory_unit` 1216, `mental_model` 2. These are concrete corpus coverage, not proof of all newer application-state representations.

## Stage 4 isolated source copies

Prepared `H:/TakiAgent/.trellis/.runtime/stage4-conversion-source/` with the same directory ACL as the retained successful run. SQLite online backup from read-only source connections captured both databases including committed WAL state. Both copies pass quick_check and retain722 sources/units; hashes and sizes are in private `inventory.json`. No migration or conversion was run on either copy yet. Preserve these baseline copies and derive per-test working databases for current-code validation. Original historical databases remain retained.

## Current-code migration and coverage preflight

Ran `node .trellis/tasks/09-29-hindsight-transitions-emergency/research/actual-data-preflight.mjs` against new per-run copies under private `stage4-conversion-source/preflight-3bc850be-7c99-4673-a92d-030ffda63cf6`. Exit0. Source snapshot upgraded35->52; validation DB upgraded40->52. All existing fields in Canonical non-FTS tables, legacy/migration evidence tables and Blocks, plus original migration receipts, remain equal by sorted-row hashes. Both quick checks pass. Current production coverage reader returns722 sources,2 Banks,2893 witnesses and identical content digest `0a74e297f46f9bb527b25957bdf5a5111030e908e06d2a25448d78ecc336efee`. Detailed table counts/hashes are private in result.json; no content was logged. This is upgrade/coverage readiness, not a new native transfer or a Stage4 round-trip.

Additional read-only comparison of all 33 historical `hindsight_*` tables in the retained validation baseline against its upgraded52 working copy confirms all pre-existing columns/rows unchanged, including1944 raw replica records and current import/verification evidence. No additional copy, migration or native operation was performed for this comparison.
