# First-use evidence and wiring audit

Date: 2026-10-29. Scope: the updated existing-instance plan and subsequent backup/transition scope.
This is a read-only source and retained-evidence audit, not a new runtime, model, UI or owner acceptance.
No original database, credential, stopped test service or historical target was opened for execution.
A read-only 6.1-sol explorer traced current wiring; Root checked the concrete gaps.

## Conclusion

Actual-data and actual Native verification already covers conversion, provider-only reconstruction,
ordinary memory use, healthy round trips, emergency recovery and paired restore. Do not repeat corpus
conversion or recreate Stage 1-4 producers from the September missing-feature matrix. Reuse its
A01-A54/C01-C16 identifiers, but apply the later evidence below and current source.

The specific first-use gaps are Home Hindsight-key entry and operator schedule configuration.
Initial v1 setup followed by an explicit v2 template action is a supported staged path, not missing
activation. A current intended-build journey through these UI edges remains to verify.

## Retained verification and limits

| Capability / cases | Existing evidence | What it proves and does not prove |
| --- | --- | --- |
| Actual Core data -> Hindsight; A10/A11, C03 substrate | [D78 actual-data result](../../08-09-hindsight-initial-cutover/research/d78-real-data-validation-2026-09-09.md), completed 2026-09-10; private run 654131f0175a/actual-result-summary.json | Real copy of 722 sources/units in two Banks, 701 valid sources consolidated, 21 invalidated preserved, 1,944 raw snapshot records; real models, B4 eligible, lost replies recovered after SQLite reopen. Original authority was not activated. |
| Field preservation and Hindsight -> empty Core reconstruction; A01/A08, C05/C06 | [D77 actual-data acceptance](../../08-09-memory-runtime-integration/research/d77-owner-acceptance-validation-2026-09-12.md); private d77-acceptance/9e41c8d27fa0 comparison/reconstruction proofs | All 722 original memories/sources and two Blocks preserved; 1,944 heads/projections and 1,942 artifacts reconstructed with interrupted read/reopen. The original overall run failed retrieval/Reflect/curator quality gates; those failures remain. |
| Actual Recall/automatic recall/Reflect and bounded curator continuation; A24-A26, C05 | [B6 closeout](../../08-09-memory-runtime-integration/research/b6-closeout-validation-2026-09-13.md); private d77-api-acceptance/ca744d0f8a27/api-b6-closeout-1-* | Later configured-model run passes original-target recalls, automatic recall and grounded Reflect. Bounded curator recovery/progress passes, while original policy failures/eventual completion remain unresolved. Direct hidden-record exclusion passes; derived hidden content remains D81. No owner quality judgment or original activation. |
| Existing-instance setup/activation/use/sync/new Character/revalidate/restart; A12/A16/A17/A27/A30-A34, C01-C06/C09 parts | [Real Native smoke](../../archive/2026-09/09-25-hindsight-native-smoke/research/native-smoke-2026-09-25.md), then [capture-sync repair and rerun](../../archive/2026-09/09-26-hindsight-capture-sync-resilience/implement.md) and its research/smoke-rerun/result.json | Actual Core WS and patched Native/PG, scripted Core model and Native mock LLM. Final rerun passes all nine steps including post-ingestion conflict probe 6b. Secret is supplied through RPC, not a Home input; mock recall does not prove semantic quality. Later budget clamp has deterministic coverage, not another real smoke run. |
| Healthy Hindsight -> Local -> Hindsight on reused corpus; A35/A36/A38, C07 | [W5 final result](../../09-29-hindsight-transitions-emergency/research/w5-healthy-final-result-2026-10-06.md) and sibling JSON | Actual COMMIT, ready runtime and two active Banks; 722 source mappings and 1,275 final records, including 21 prior plus 68 receipt-backed Local expiry invalidations; policy/Block changes preserved without reconversion. Real corpus queue was empty; nonempty queue proof is deterministic. Old failed driver/unknown outcomes remain preserved. |
| Emergency/restart and actual paired restore; A37/A39, C08/C10 | [W6 final result](../../09-29-hindsight-transitions-emergency/research/w6-final-result-2026-10-06.md) and sibling JSON | Actual isolated emergency recovery/restart, no new Native/model calls, returning old authority refused. Real backup.capture/native CLI restore and pre-writer pair verification; 56 tables equal. Fixture credentials only, no original-user restore or DPAPI portability proof. |
| Main boot and multiple browser observers; A34/A44/A45, C09/C12 parts | [W8 consolidated review](../../09-29-hindsight-transitions-emergency/research/w8-independent-check.md), w8-final-evidence.json; [W9 resolution](../../09-29-hindsight-transitions-emergency/research/stage4-review-2026-10-07.md) | Seven actual main.ts boots plus authenticated WS/browser transitions, timeout/close/reconnect without resubmission. Native transport in browser/boot fixtures is synthetic. W9 later closes the final live-lease guard gap. Not installed Tauri/WebView2 or human acceptance. |
| Versioned templates and customized/removed paired restore; A23/A33, C10/C16 parts | [5B whole acceptance](../../10-07-hindsight-template-lifecycle/research/b3-whole-acceptance.md), joint-06/boot/Desktop result records | Actual HTTP/PG tests and two physical restores with complete 61-table equality, customized/removed overlays and refresh history; real browser scenarios and Core head059 boot. Supplies later v2-template restore coverage beyond the older 56-table drill. Does not establish full model/software upgrade, real-model quality or original-environment acceptance. |

Counts above describe different object sets and runs; do not add them into one test/data total.
September smoke defects D1-D3 were followed by the dedicated correction and passing rerun; they are
not newly discovered open blockers. D81 and bounded-assessment limitations remain.

## Readback performed in this audit

- D78 actual summary, completion/supervisor/source-verification records exist. The summary reports
  actual_validation_passed=true, B4 eligibility, two imports and three reopens, authority_activated=false.
- D77 original-field and cold reconstruction proofs exist. Reconstruction states
  originalSourceTablesUsed=false; no private memory bodies were printed.
- B6 summary reports scoped checks passed, owner acceptance and original activation false.
  Curator retains originalPoliciesAllAssessed=false, eventualCompletionProven=false and
  wholeLibraryReviewed=false.
- Original Native smoke failure and corrected rerun both exist. The latter is passed, with no fatal
  error and all nine steps passed.
- W5/W6/W8 machine-readable final records and private result roots exist. All 28 evidence files
  listed by the W8 final record still match their retained bytes and hashes.
- 5B joint-06, actual Core boot and full Desktop results exist with exit 0. Their acceptance report
  records fixture and coverage limits; they were not rerun.
- All 30 files in the D1-B source checkpoint match current bytes. Its old pending-review status is
  historical: the [completed combined review](../../10-14-hindsight-managed-deployment/research/combined-d1b-api-artifact-review-01a180b6.md)
  accepts D1-B source/integration with no blocker, while retaining a separate C2b cleanup defect.
  Three specifically recorded B6 policy/runtime/admission source hashes also match. This does not
  establish that every dependency in the old full graph is unchanged.

## Current source wiring

The explorer traced Home actions, registered RPCs, boot composition and Native clients.
Root separately checked the key, template-order and scheduler-configuration findings.

| Path | Current anchors (workspace-relative) | Disposition |
| --- | --- | --- |
| Connection settings -> setup -> activation | apps/desktop/src/windows/home/pages/settings/config-groups.ts:70; operations/hindsight-activation-actions.ts:41; operations/memory-operations-controller.ts:153; packages/core/src/main.ts:277; memory/operations/memory-operation-kind-setup.ts:28; memory/hindsight-activation/hindsight-activation-chain.ts:72; memory/runtime-composition.ts:169 | Producers and RPC are connected; fresh Home validation is blocked by its action filter, as corrected below. Reuse the producers and real Native evidence. |
| Selected runtime -> chat/tools/primary ingestion | packages/core/src/main.ts:418; memory/hindsight/hindsight-memory-runtime.ts:50; hindsight-memory-provider.ts:37; hindsight-memory-subsystem.ts:80; hindsight-native-result-client.ts:29; hindsight-runtime-client.ts:25 | Retain/recall and primary-source ingestion are connected but distinct entry paths. |
| Manual incremental/full sync and default automatic scheduling | operations/memory-authority-card.tsx:71; memory-operations-controller.ts:168; packages/core/src/memory/operations/memory-operation-kind-replica.ts:31; memory/hindsight/hindsight-replica-scheduler.ts:71; hindsight-runtime-bank-service.ts:65 | Implemented; no second scheduler is needed. |
| Reopen/observation and selected-runtime restart | operations/use-hindsight-activation.ts:26; memory-operations-controller.ts:156; packages/core/src/memory/operations/memory-operation-service.ts:85; memory/runtime-composition.ts:194 | Core owns state and recovery; Home re-subscribes/reads rather than replaying mutations. |

Desktop operations anchors are under apps/desktop/src/windows/home/pages/. Core memory anchors
are under packages/core/src/. Unqualified Hindsight runtime files are under memory/hindsight/.

## Concrete remaining edges

1. **Home Hindsight credential entry (A28/A41, C02/D89).** Core fixes the ref
   memory.hindsight.connection.api-key in packages/core/src/config/hindsight-config.ts:22.
   Operator secret.set is implemented in server/methods/secret-methods.ts:38; the client has secretSet.
   Settings knob-input.tsx:42-48 only renders secret presence; use-config.ts:86 saves ordinary config.
   Desktop secretSet calls are confined to the MCP editor, whose refs are generated as MCP env/header
   refs. Add the Hindsight write-only entry/presence/clear flow using the existing secret service.
   The successful RPC fixture did not test this missing UI edge.

2. **User-selectable synchronization settings (A15/A17, C06 manual-mode subcase).**
   packages/core/src/db/hindsight-replica-scheduler-repo.ts:100-103 supports schedule config, but the
   production scheduler ensureBank calls at lines 75/124/137/196 pass only { bank }; no current
   operator RPC/Home path changes automatic/manual-only mode or intervals. Default automatic polling
   and manual sync buttons work. Wire the existing configuration substrate; do not replace the
   scheduler or confuse a manual sync action with disabling automatic sync.

3. **Explain and exercise the v1 -> v2 template workflow (A23/A33, C02/C16).**
   hindsight-setup-stages.ts:10-15 uses the immutable v1 loader; taki-bank-template-v1.ts:29 rejects
   another revision. V2 catalog/taxonomy and Home template.apply are connected separately.
   template-plan-guard.ts:35-36 requires Hindsight authority; template-runtime-selection.ts:19-26
   deliberately preserves unenrolled v1 Banks. The supported path is v1 setup -> activation ->
   explicit v2 template/default apply. Do not set the legacy revision knob to v2 or invent a
   mandatory pre-activation v2 requirement. Record the order and verify the handoff.

4. **Current intended-build integration and owner observations.** Historical tests do not combine the
   missing key/schedule UI edges, current migrations/template code, actual Native and intended Home in
   one verified journey. Exercise changed edges after implementation; use deterministic tests for
   existing race contracts and reuse historical corpus evidence. Installed Tauri appearance, actual
   key custody, original-data activation and subjective model quality remain D89 observations.
   The supplementary [Q1-Q5 verification](first-use-questions-and-verification-2026-10-29.md) exposed
   one missed UI blocker: migration 022 seeds `unconfigured`, but
   `hindsight-activation-actions.ts` allows validate only in `ready-to-validate`, `compatible`, or
   `failed`; no production writer advances to `ready-to-validate`. Core already accepts an idle
   `unconfigured` validation and enforces configuration readiness. Include fresh Home validation in
   this increment and its regression. Earlier RPC smoke bypassed this button eligibility.

## Controlled provider entry and measured baseline

Select the existing native-smoke fixture family, not C2b managed_bootstrap:
archive/2026-09/09-25-hindsight-native-smoke/research/native-smoke.mjs and native_launcher.py, which
invokes hindsight_api.main.main. Use actual isolated PG/Native, a scripted Core provider and Native
mock LLM with existing cached embedding/reranker assets.

The archived orchestrator cannot run unchanged: its ../../../../packages import now resolves under
.trellis/tasks/packages, which does not exist; fixed ./evidence/ output would overwrite old evidence.
Adapt a small current-task runner/reference with existing helpers and fresh output; preserve archives.
Verify paths, current compatibility, cached assets and isolation before launch. Do not copy historical
provider credentials or start old corpus targets instead of preparing disposable data.

Current source baseline observed: Taki main/e260ff4b0bf663b5faa0187bc6ec701fd2f007cd; Native
main/eb6413a7f58c4f3f0adb88a33a99516f8707fef7, both with inherited working-tree changes.
Core migration060 and D1-B operation/label integration belong to this graph; their 30-file checkpoint
matches and combined source review is complete. Native template lifecycle and other uncommitted files
must be included in a future build. This audit has not frozen or run that complete build. Old
head040/050/057/059 results remain evidence for their own versions.

## Next execution order

1. Reuse the passing evidence above; do not recreate conversion, activation, scheduler, backup or
   transition foundations. Retain old failures and documented corrective results.
2. Complete Hindsight-key UI, fresh-validation eligibility, and schedule-configuration edges; explain v1/v2 ordering and external
   Native model configuration. Use existing services and one integrated review.
3. Refresh the small Native fixture entry/output/build assumptions, then run the current first-use
   Home/WS/Native path and bounded outage recovery on disposable data.
4. For plan section 2, reuse W5/W6/W8 and 5B restore evidence; check changed template/migration/operator
   edges and the intended-build scenario, not another whole-corpus conversion.
5. Present the scoped usable result and remaining D89 observations. D94-D96 keep their later priority;
   the C2b API cleanup finding applies before using that producer.

No new product acceptance is granted. No production code, archived evidence, live data, service,
dependency or Git lifecycle action was changed.
