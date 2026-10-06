# W6 implementation checkpoint

Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.
Owner: `/root/w5_head_prefetch_implement`; parent: `/root`.

## Current / remaining (2026-10-06, supersedes historical checkpoints below)

- W6 is implemented through offline preview/admission/service, immutable capture/seal/incident, surviving candidate,
  W4 atomic COMMIT, exact restart/reply-loss recovery, foreign branch isolation and nonwaiting producer retirement.
  Source handoff is ready; see `w6-implementation.md` and its final gates. Parent actual corpus has not been executed.
  Do not repeat W5 or inspect actual private data.
- Latest service gate: 11 PASS, including original Pending/parent/application rows and held-unknown hashes, production
  runtime guard rejection of late callbacks, hung healthy/replica/backup, committed reentry, absent credentials,
  setup pending and primary finalize during copy / after COMMIT before bind. Recovery's five close/reopen boundaries
  and 057 upgrade/reopen/failure rollback tests also passed in the final Core group:207PASS/1existing skip,30files.
- Owned emergency driver now requires `--run-owned-copy --core-data-dir <root/core> --core-db-path <root/core/taki.db>
  --result-path <new-history/phase/result.json> --phase emergency|restart`. Parent starts two independent Node processes.
  Driver starts no child or Native process. First-phase failure never auto-retries. Last three corrections count both
  model methods, restrict diagnostics, and derive retention settings via production config; protocol retest PASS.
- Current D91 Native proof: four tests (transition backup; generic backup; application backup) PASS on owned PG, all
  stopped. Latest CLI synthetic root `stage4-w6-restore/synthetic-8ea538d3-5c9f-47f6-a3d0-b7ba1ecfd677`: 56 full tables,
  original trigger modes and proof match; required publication/admission/immutable guard presence and O/A modes checked;
  actual missing and R-mode cases refuse; no automatic retry; stopped=true. No Native production code changes.
- D91 Core stage/seal/preflight process protocol PASS with real original operation-owner route-b capture/admit, actual
  encrypted fixture catalog and full Core closure. `w6-d91-runbook.md`, spec/index and implementation report are complete.
  Shared23PASS, lifecycle22PASS (including parent-approved D87 current-contract correction), root lint/typecheck PASS.
- Parent owns PRD/execution-status/leader-now, consolidated independent review and actual emergency/restart/D91 runs.
  Product/manual acceptance remains open. No further implementation work is known before review/actual evidence.
  Keep this section current at handoff. Historical sections below are evidence of earlier work, not remaining scope.

## Authorization and boundaries

- Parent released source ownership for the complete W6 wave after final W5 functional acceptance.
- Continue implementation without another approval/checker gate. No delegation, commits, archive, new dependency, or original-data writes.
- Work in `H:/TakiAgent`, branch `main`; initial HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
- Existing parent session binding: `codex_01a10bce-c98d-7930-a034-2842a2739758`; empty legacy `.current-task` is not authoritative.
- Parent alone prepares/starts the actual corpus copy at `.trellis/.runtime/stage4-w6/<newuuid>/`, preserving the stopped W5 pair. Implementer uses owned synthetic fixtures only.
- Parent requested an explicit sanitized, lazy real-data harness interface. Do not implement another copy pipeline.

## Current state (updated after first seal tests)

- Latest boundary PASS: `src/db/memory-transition-emergency-publication.test.ts`2/2, actual Core synthetic healthy return/reentry predecessor then emergency. Full installed logical fields/Source aliases/SourceSets match candidate; duplicate COMMIT returns same receipt; injected receipt failure rolls back epoch/marker/foreign branch while retaining sealed incident.
- Implemented `memory-transition-surviving-capture.ts`, `memory-transition-emergency-candidate.ts`, `memory-transition-emergency-publication.ts`; W4 `publishMemoryTransition` now dispatches the explicit emergency typed join inside its existing outer transaction. Publication reader recognizesversion2 emergency only; healthy guards remain. Shared emergency publication/candidate are separate schemas; no healthy native proof is fabricated.057 additionally owns immutable surviving-evidence and foreign-branch tables.
- Generic Local reconstruction uses `LocalBankProjectionInput`/`TransitionProjectionContext`, called from unchanged healthy certificate wrapper or `projectSurvivingLocalBank`. Source aliases, historical edges and pending Source extraction reuse the same code. Missing native-derived policy under emergency currently refuses (no fresh authenticated absence proof); this is an explicit incomplete-evidence safety limit.
- `readEmergencyTransitionCustody` separately permits held incomplete old ingestion spans and moves only unconsumed witnesses; healthy incomplete-span refusal remains. Mixed unknown/new membership needs focused integration coverage before claiming full primary semantics.
- `readEmergencySnapshot` now names per-Bank `survivingEvidenceId` and exact held Pending/parent/application-command/ingestion-span row hashes in the manifest. `prepareEmergencyCandidate` binds materialized bytes to those identities. No new original effect is dispatched.
- Last Shared/Core typechecks passed before newest fixture/unknown-effect/publication changes; rerun at the next coherent stage. `transitionProjectionContext.bundle` remains exported for existing callers, while emergency uses its smaller content context.
- Parent owns `research/w6-owned-emergency-runner.py` supervision wrapper. Implementer must deliver lazy `research/w6-owned-emergency-driver.mjs` with `--run-owned-copy --core-data-dir <prepared/core> --core-db-path <prepared/core/taki.db> --result-path <new run result>`. Emergency/restart never startsNative/PG. D91 restore interface remains separate.
- Still not implemented: offline preview/admission/service/runtime wiring; busy producer supersession/quarantine; nonwaiting native retirement; complete unknown/mixed-primary/late-callback cases; D91 current restore gates/runbook/harness; indexes/specs/final report.

- Shared capture/coverage/snapshot contracts and additive057 capture/incident tables are implemented, with registry updated.057 has run only in owned synthetic tests; parent actual corpus remains through056.
- Stage3 store now seals `incident-<id>.partial` atomically into `incident-<id>`, verifies original-ID read-back, refuses corruption/conflicts, and never deletes a prior partial/seal during failed retries.
- Metadata comes from the completed copied SQLite. `openReadonlyDatabase` uses SQLite immutable URI: ordinary readOnly was experimentally found to create WAL/SHM sidecars. This helper is only for completed immutable standalone backups.
- Added `memory-transition-emergency-repo.ts`, `hindsight-emergency-snapshot.ts`, Shared emergency schema. Existing backup emergency/store tests:11PASS/1existing skipped. New `hindsight-emergency-transition-seal.test.ts`:5PASS (copy boundary, lost ACK, identity/corruption, prior partial, failed copy). Shared/Core typechecks passed before the latest projection edits; rerun after the next coherent boundary.
- In progress (not tested/typechecked yet): Shared surviving Bank evidence/emergency candidate, `transition-surviving-evidence.ts`, generic healthy/emergency Local reconstruction in `transition-local-projection.ts`, Source alias/historical-reference reuse, `surviving_evidence` document/table extension.
- Actual parent-prepared layout is separate: `<prepared>/data` is Native PGDATA; `<prepared>/application.sqlite` is preserved input; CoreDataDir=`<prepared>/core`, CoreDbPath=`<prepared>/core/taki.db`, incident store=`core/backups`. Never put Core files into PGDATA. Read only the sanitized preparation report, never actual runtime content.
- Parent approved the concrete busy/fence gap repair: emergency admission may atomically classify superseded native-dependent operations as outcome_unknown plus append immutable quarantine joins, preserving all effects/receipts/queues. Do not fake native completion or mark old attempts terminal. Cover hanging healthy, manual replica.sync, backup.capture and Pending/lifecycle workers; reuse actual epoch/late-publication guards before adding new ones. Determine ownership from actual selected epoch/receipt, including a committed reentry whose request predecessor was Local. Unrelated/Local exclusive actions remain busy.
- Tests/harness must retain cumulative network/model counters: capture callsBeforeEmergency and preexistingInFlight, then prove zero new dispatch across preview/admission/seal/COMMIT/bind. Never reset historical counters.

## Initial mapping notes

- W6 brief/design emergency and recovery sections read; initial source mapping completed.
- `trellis-before-dev` loaded and package discovery run: single repo, backend/frontend layers.
- The actual Stage3 emergency/store paths are `packages/core/src/memory/hindsight-backup/`, not `memory/hindsight/` as the brief's provisional paths suggest.
- Existing `sealEmergencyEvidence` mints its own ID and reads metadata before backup; `writeIncident` writes directly into the final directory. W6 needs persisted identity, snapshot-derived metadata, atomic seal and verified exact-ID read-back.
- Healthy final proof/publication guards explicitly reject incident IDs. Preserve those; add an explicit emergency evidence/candidate join.
- `transition-runtime.ts` currently awaits healthy native fences/scheduler and `hindsight.retire()`. Emergency requires a nonblocking local retirement seam that cannot await a hung native request.
- `transition-current-identity.ts` requires complete checkpoints for healthy preview. Emergency must separately disclose missing/partial surviving evidence, without reusing bounded backup display inventory.
- W5 final real healthy journey is closed; do not repeat W5 audits/tests/model work. Parent supplies its final stopped pair, Core SHA `274e1ccbd651bcd8c64f88f7ceb0d80c56a3701e5a5a62309369cbfbd0235a45`.

## Remaining work

1. Finish relevant curated context and source mapping: replica closure, projection, immutable migration registry, operation/composition, retirement.
2. Shared contracts first; incident storage/capture, explicit emergency candidate, W4 atomic publication/recovery, offline driver and foreign-branch guard.
3. Focused synthetic tests for offline/hung transport, seal/lost ACK, custody/unknown effects, constructor/restart and old branch.
4. Current D91 runbook and owned restore fixtures; lazy real-data harness and sanitized parent inputs.
5. Targeted tests (max two Vitest workers), type/lint/spec/index/diff/encoding checks, implementation report and parent consolidated review.
