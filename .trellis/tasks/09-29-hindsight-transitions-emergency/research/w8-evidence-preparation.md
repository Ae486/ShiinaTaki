# W8 evidence preparation

Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.
Prepared by `/root/w5_postpatch_review`, 2026-10-06, during parent-owned W6 actual execution.

**Preparation only. No W8 or manual gate is passed by this document.** The only write in this assignment is this
file. No tests, build, process startup, corpus/database access, source change or inventory rewrite was performed.
Inputs are PRD/design/implement, W8/W7 briefs, W7 checkpoint, W0-W6 reports and saved source identity documents.

## Current evidence boundary

- W0-W4 have scoped independent checks. W5's old independent report says INCOMPLETE because it predates the
  accepted actual journey; [the final W5 result](w5-healthy-final-result-2026-10-06.md) owns the later disposition.
  The old driver failure is retained, with separate producer-backed retention/timestamp audit corrections.
- W6's main independent report and several checkpoints predate COMMIT. Apply the context and bind-harness
  addenda, then the first Current section of [leader-now.md](leader-now.md), rather than treating their old
  no-receipt/running paragraphs as current. Consolidated W6 actual acceptance still needs its final parent report.
- Parent reports whole committed-recovery rehearsal PASS on new copy
  `stage4-w6/rehearsal-abf36a2b069f4b04a2a468ff91736cf9`, result SHA256
  `1adf77f5c041ed6d903e395de5963aa8684f4cc07e658910ccf4f94374e047ff`: emergency Node35988 and separate restart
  Node29112 exited normally with the same receipt/epoch, all three old unknown row hashes preserved, 2 Banks,
  722 Sources, 1275 records, 89 invalidated, zero new retention changes and zero additional Native/transport/model
  calls. Production bind took 178.354s; queue execution took 272.785s. These are parent-reported measurements,
  not new executions or runtime reads by this preparation.
- At handoff, original-copy actual committed recovery is running in exec70621, history
  `b389441a92e74f2988071642a3ef832e`. Parent alone owns that run, restart and D91. The task supervisor changed
  1800 to 3600 seconds after measured 29m20s rehearsal; production leases/heartbeat did not change. Do not restart
  an old fresh/uncommitted wrapper, access the live copy or infer completion from a progress observation.
- [W7 checkpoint](w7-checkpoint.md) is read-only preparation, not implementation. It identifies required Core
  action/status/reason and client deadline work in addition to UI wiring. W8 starts only after coherent W7 delivery
  and the parent's predecessor gate; current source/test/JSON/config remain frozen.

## Reusable evidence index

Each entry below means earlier evidence with its stated source/fixture boundary. Counts overlap and are not added.

| Key | Evidence to retain | What it actually establishes |
| --- | --- | --- |
| E0 | [W0 independent](w0-independent-check.md) | Exact manual request attribution, post-commit read uncertainty, compatible backup intervals, D93 seed/page refusal; 38-case group and later legacy upgrade case. R3 remained an inventory caveat until W4. |
| E1 | [W1 independent](w1-independent-check.md) | Durable request/recovery ownership, exclusion/CAS/cancellation, immutable queue evidence and unresolved claims; 102-case Core and 9-case Shared groups. Synthetic proof was not Native or authority acceptance. |
| E2 | [W2 independent](w2-independent-check.md) | Real owned-PG writer/fence/final-proof/delta/unused-initialization/restore coverage, plus actual Core claim/verify/resolve over HTTP. Native ownership and generated protocol evidence are independent of Core transport doubles. |
| E3 | [W3 independent](w3-independent-check.md) | Complete candidate/delta/history/SourceSet preservation, actual Local copy and actual unused-scope HTTP proof; 82 Core, 39 Shared and separate Native groups. Its real-data probe is structural, not the W5 round trip. |
| E4 | [W4 independent](w4-independent-check.md), [Core validation](w5-core-validation-independent-check.md), [post-COMMIT combined](w5-postcommit-combined-independent-check.md) | Real SQLite atomic publication, exact primary custody, original target receipts, runtime retirement/reconstruction, independent execution versus observed readiness, real-clock terminal boundaries and isolated main.ts boot. Later combined 166 tests include its four new cases. |
| E5 | [W5 independent](w5-independent-check.md), [snapshot recovery](w5-snapshot-renewal-independent-check.md), [Native renewal](w5-native-renewal-independent-check.md), [admission](w5-reentry-admission-independent-check.md) | Complete healthy composed producers, multipart/lost replies, 055/056 original recovery, changed Blocks, snapshot successor rules, concurrent Native renewal and current admission proof. |
| E5N | [Native candidate](w5-candidate-combined-independent-check.md), [Native view](w5-native-view-independent-check.md), [head prefetch](w5-head-prefetch-independent-check.md), [HTTP startup settle](w5-http-start-settle-check.md) | Bounded independent read lifetimes, byte/schema/Source guards, e40 migration behavior, final corruption rollback, real PG differential checks and exact helper preservation. Timing-only diagnostics are not separately added product coverage. |
| E5R | [W5 final actual result](w5-healthy-final-result-2026-10-06.md) and its JSON | Actual return, controlled Local policy/Block changes, same-Bank reentry, Native activation, ready runtime and terminal resolution. 722 unchanged Source mappings, 1275 final units, 68 receipt-backed expiry changes plus 21 prior invalidations. Real queue was empty; nonempty queue proof comes from E4/E5. Finalization made zero model calls; cumulative submissions remain 551. |
| E6 | [W6 independent](w6-independent-check.md), [context repair](w6-context-checker-repair.md), [bind harness](w6-bind-harness-checker-repair.md), [implementation](w6-implementation.md), [D91 runbook](w6-d91-runbook.md) | Synthetic no/hung-Native, missing evidence/custody, seal/ACK/COMMIT/bind/reopen, strict surviving-policy reuse, held unknown writes, independent emergency context and real lease guards. Owned Native restore tests retain complete rows/guards and original partial results. The latest harness group has 9 tests, including separate-process committed recovery with real retention. |
| E6R | Parent's whole rehearsal and `w6-committed-actual-source-preflight.json`; eventual final actual/D91 reports | Whole real-corpus bind/settlement and independent restart have parent evidence. Original-copy actual recovery/restart and current paired restore are still pending at this preparation boundary. A successful rehearsal is not their substitute. |
| E7 | [W7 checkpoint](w7-checkpoint.md), [W7 check brief](w7-check-brief.md) | Planned seams and missing behavior only. No W7 UI/build/client-producer acceptance exists yet. |

## T01-T18 and PRD requirements

`R1`-`R10` refer to numbered PRD Requirements, not historical R1/R2/R3 defect names. Core test names below are
relative to `packages/core/src`; Native names are under `hindsight-api-slim/tests/native_results`. Existing named
test paths were checked for presence. New W7 selectors must come from its final delivery, not invented filenames.

| Case / PRD | Reusable predecessor proof | Precise remaining W8 obligation and affected integration |
| --- | --- | --- |
| T01 / R8,R9 | E0 exact failed manual claim survives unrelated success/equal time/other Bank/reopen. | Preserve attribution through W7's composite status and labels; rerun affected `memory/operations/memory-operation-kind-replica.test.ts` and request-repo coverage in final Core suite. No new corpus sync is needed solely for UI changes. |
| T02 / R6,R9 | E0/E6 incompatible lineage/generation/epoch leaves backup ID/age but unknown interval; missing backup is not zero loss. | Exercise actual W7 emergency preview/disclosure for same and incompatible history, missing backup and unknown remote head. Pair `hindsight-backup-status.test.ts` with `transition-emergency-preview.test.ts`; do not derive loss from cursor equality. |
| T03 / R1,R3 | E4 fenced Character capture/assembly refuses or preserves witnessed unavailable scope; final inventory remains independent. | Final boot/composition and current action/preview paths must retain complete inventory. Reuse custody/runtime and `hindsight-lifecycle-journey.test.ts`; new W7 availability must not mistake setup rows or quiescence for closed coverage. |
| T04 / R7,R9 | E0 seed and incremental rollback guards retain both coordinates; supported reset remains separate. | Retain `hindsight-application-sync-runner.test.ts` and cursor-reset compatibility in final Core selection. No unproved Native-only restore fallback; D91 must use exact pair validation. |
| T05 / R4,R5,R8 | E1/E5/E6 duplicate identity, stale preview/config/epoch, exclusive claim, expiry recovery and cancellation CAS. | W7 Core-derived action/cancel/recovery state must agree with actual admission, including eligible emergency over hung Hindsight and unrelated Local busy. Integrate repo/operation tests, `transition-admission-verification`, emergency admission and real operator methods; UI double activation must cause one submission. |
| T06 / R1,R3 | E2 real finite maintenance/final certificate; E5 composed all-Bank order; E5R genuine final proofs. | Verify final producer dependencies remain covered and W7 confirmation invokes that same healthy driver. Keep `test_transition_proof.py`, proof renewal and healthy maintenance evidence. Do not run another full paid maintenance cycle when its inputs/source are unchanged. |
| T07 / R3,R7 | E2 engine/API/MCP/queue/worker/ID-only writer fences and stale descendants; later Native renewal checks concurrent final proof/claim. E6 adds quarantine and nonwaiting retirement. | Final Native source/capability identity and W6 retirement integration must remain covered; select real `test_transition_writers.py`, fence/recovery/proof-renewal cases if dependencies changed or final combined proof is needed. A transport fixture cannot certify Native locks. |
| T08 / R1,R2 | E3/E5 complete multi-cycle mutations, typed values, aliases/history, policy/lifecycle/Blocks; E5R actual preserved corpus and real expiry receipts. | Final Shared/Core suite must retain these oracles, especially `transition-healthy-journey`, delta, local timestamps, Source aliases and historical references. Verify real result's receipt/delta/preservation provenance; never restore the obsolete zero-upsert or literal UTC-spelling assertion. |
| T09 / R1,R2 | E3 stable old scope IDs and persisted new-scope mapping; real copied repeated SourceSet preserved over unused-scope HTTP. | Reuse local-candidate/unused-delta and `test_transition_unused_sources.py`/unused-scope evidence. W7 status labels must not use opaque Bank IDs as a substitute for logical scopes. No new Bank or manufactured B2 baseline fallback. |
| T10 / R2,R7 | E2/E3/E5 foreign target, used-then-cleared scope, missing mapping/baseline and incomplete retirement refuse. | W7 must expose actionable closed conflict/config/capability/foreign reasons and truthful availability. Exercise real preview refusal with current identity plus selected delta/unused/healthy-boundary tests; never advertise recovery of quarantined foreign history. |
| T11 / R4,R8 | E1/E4/E5 actual canonical callers receive durable queued ACK, bounded capacity/cutoff and ordered revision conflicts. | Final `transition-healthy-queue`, `transition-intent-executor`, queue-repo and canonical-tools tests; W7 must render COMMIT, runtime and per-intent settlement separately. E5R/E6R empty queues do not replace nonempty deterministic evidence. |
| T12 / R4,R7,R8 | E4/E5 admission/effect-before-ACK/reopen reconciles original target request; old Run/Effect is provenance only. | Connect lost/closed UI caller to original Core operation using actual WS/owner; count producer effects and submit requests, including reconnect/remount. Preserve effect-repo, reconstruction and executor coverage. No mutation replay from observation. |
| T13 / R3,R7 | E4 exact live/completed/compacted primary membership, late finalize and user-only cancellation; E6 held unknown ingestion plus late-primary races. | Reuse custody/source-disposition, healthy boundaries and emergency service/recovery tests at final source. Verify no new W7 cancellation action bypasses claim/custody rules. Missing source membership cannot be excused by a UI terminal label. |
| T14 / R3,R7 | E4/E5 constructor/bind/receipt corruption, shutdown/retired callbacks; E6 real final-clock COMMIT guard and same-receipt recovery. | Final `memory-transition-boot`, runtime-recovery, publication, healthy terminal-boundary and emergency process tests; independent final main.ts startup/stop must use the committed marker before writers. UI must keep committed-but-unavailable target visible. |
| T15 / R6,R9 | E6 zero/hung Native, missing/foreign backup, full surviving inventory, failed seal and same seal after lost ACK; actual seal/COMMIT plus E6R rehearsal exist. | Collect final original-copy actual emergency result and original input/seal preservation; W7 separate emergency confirmation must show uncertainty and never require new Native backup/model. No automatic healthy-to-emergency fallback. |
| T16 / R6,R7 | E6 synthetic COMMIT/reopen, unknown Pending preservation and foreign reentry/late-producer refusal; E6R same receipt/epoch and three old unknown hashes survive separate process. | Await original-copy actual recovery and separate restart, then reconcile exact receipt/incident/capture/old outcomes/counters. Final W7 recovery state must reject old foreign history and observe Local after restart. Do not rewrite earlier unknown operations or count them as completed. |
| T17 / R7,R9 | E6 Native full-table/trigger/COPY rollback and original partial-result tests; actual encrypted fixture-catalog Core process gate. | **Current actual D91 is open.** Require parent stage/capture -> Native restore -> owned PG stop -> seal/admit -> immutable pre-writer validation, all 56 table rows/guard modes, exact receipt/checkpoints/bodies and real fixture catalog. Reuse partial-operation fixture; do not fabricate an unfinished effect in the corpus. User/DPAPI portability remains manual. |
| T18 / R5,R6,R8 | E5 real method-registrar success/recovery and old main.ts authenticated socket smoke; existing controller generation guards. E7 has no delivered implementation. | **New full UI/client-producer proof required.** Actual W5/W6 owner behind authenticated WS; one healthy confirmation versus separate emergency; lost reply/close/reconnect/second observer/stale socket; Core-derived recovery/cancel and truthful unknowns; real DOM keyboard/focus/double activation. Count actual mutations and preserve one original operation. |

### PRD product acceptance roll-up

| PRD product outline | Evidence and remaining condition |
| --- | --- |
| Repeated healthy preservation | T06-T10, E3/E5/E5R. Retain final source compatibility and full suite evidence; no repeated corpus conversion. |
| Fenced writes and exact late primary custody | T03,T07,T11-T13. Actual lower producers are covered; validate W7 cancellation/observation cannot bypass them. |
| Lost reply/crash/lease/bind/reconstruction | T05,T12,T14,T16,T18. Await original-copy W6 completion and final UI recovery integration. |
| Offline uncertainty/restart/foreign isolation | T02,T15-T17. Current actual recovery/restart/D91 plus W7 disclosure remain required. |
| Closed initiator and second observer | T18. W7 implementation and actual WS/DOM proof do not yet exist. |
| Complete isolated end-to-end evidence | Final source/build/boot/native/restore and the above mappings must join after W7. Manual and original-environment criteria stay separate. |

R10 is a scope constraint across every row: Stage5 provisioning/templates/upgrade/cleanup, Stage6 supported-environment
and owner acceptance, D79-D83/D81 and D23 remote-Core merging remain open. Preserve C03 first-activation/PR03 custody,
C07 repeated transition/PR04 queue, C08 outage, C09 same-Core observation, and C10/PR01/PR02 pair recovery boundaries.

## Final checks to schedule after W7

1. **Establish final identity once.** Read W7 delivery/checks and final W6 actual/D91 report; verify both worktrees,
   explicit existing session binding, Core registry through057 and Native e40 lineage. Merge authorized path
   overlays in evolution order, retaining all old manifests and untracked files. A later file hash does not certify
   all of its callers: include affected producer/consumer dependencies when deciding which proof can be reused.
2. **Run one complete final package gate**, as required by implement/W8 brief, rather than repeating every prior
   wave command. Current Shared/Core scripts are `vitest run`; Desktop build is `vite build`. These commands are
   a plan, not executions performed by this preparation:

   ```powershell
   pnpm typecheck
   pnpm lint
   pnpm --filter @taki/shared exec vitest run --maxWorkers=2
   pnpm --filter @taki/core exec vitest run --maxWorkers=2
   pnpm --filter @taki/desktop exec vitest run --maxWorkers=2
   pnpm --filter @taki/desktop build
   git diff --check
   git -C H:/hindsight diff --check
   python ./.trellis/scripts/task.py validate 09-29-hindsight-transitions-emergency
   ```

   Keep Vitest groups sequential with at most two workers. Confirm W7 tests were actually selected: Desktop's
   package test script allows no tests, so an empty collection is not T18 proof. Check staged diffs and strict
   UTF-8/no-BOM/index/header requirements separately, including new files. Historical nonexistent selectors
   `transition-provider.test.ts` and `055-memory-transition-drivers.test.ts` must not be copied as coverage.
3. **Exercise final production integration.** Trace preview/status/action/reason through Shared, registered
   operator methods, typed client, controller and components to `memory.operations.submit` and composed W5/W6.
   Cover unauthorized role, stale preview, cancellation/claim race, unavailable committed Local and original
   recovery. No mock-only success or React-derived authority/action permission is sufficient. New W7 work touches
   `memory-transition-methods`, `memory-authority-status`, `transition-healthy-status`, operation adapters,
   Desktop `ws-client-memory-operations`/`rpc-deadline`, and Operations controller/state/card seams.
4. **Prove real client lifetime/latency behavior.** Parent measured emergency preview at 90.868s and complete
   recovery far beyond120s; bind/queue timings are not submit ACK measurements. Test the actual chosen request
   deadlines, late result, connection close and reattachment using one request identity. Capture submit/producer
   counts, not just button disabled state. A longer UI timeout cannot prove prompt ACK or replace unknown-result
   recovery. Browser/Vite focus/keyboard and two-client evidence is distinct from packaged WebView2/CSP/manual proof.
5. **Boot final main.ts in an isolated non-default root/port.** Existing W4/W5 Legacy/B2 boot is reusable background
   evidence; final W7 routes and current057 emergency marker need final composition proof. Authenticate a real
   operator, verify registered kinds/current selection/unavailable/recovery, stop cleanly, reopen where relevant
   and prove owned listeners/processes are gone with zero unintended Native/model requests. Do not use ordinary
   package start/dev blindly: both load `.env.local`; reuse an allowlisted isolated boot harness.
6. **Use Native and real evidence selectively.** Reuse E2/E3/E5N owned-PG regression evidence only while its
   dependency identities remain covered. Final Native integration should cover any changed fence/proof/delta/
   Source/restore boundary with existing owned fixtures, not repeat every historic 105/35/5-case group. Current
   D91 actual run is mandatory. Reuse accepted W5 corpus result and parent W6 actual/rehearsal proofs after their
   identity/preservation audit; rerun only a journey affected by a final repair. Never reconvert the corpus or
   start a preserved baseline. Keep unknown usage/cost unknown.
7. **Check generated/deployment consistency and deliver.** Match actual capability/build and API/codec changes
   against retained canonical OpenAPI, generated SDKs and maintained wrappers. Rehash unchanged generation outputs;
   regenerate only if a final public contract changed. Native scoped Ruff/format/types follow the actual owned
   set. Preserve historical full-tree Windows/MLX/Unix and optional-UUID diagnostics separately from scoped passes.
   Run Rust only for actual affected Rust/generated Rust scope. Document additive upgrade and receipt-based recovery;
   config reversal, old runtime revival or schema downgrade is not rollback. Produce final W8 report/checkpoint
   and new final ownership evidence only when dispatched; no commit/push/archive/manual pass follows automatically.

## Source evidence reuse rules

Manifest bytes were read/rehashed during this preparation; referenced runtime files and whole source inventories
were not re-audited. The current parent preflight records112 Taki paths, five Native dependencies and no mismatch;
it is a W6 overlay, not the entire historical Native/W0-W7 inventory.

| Current anchor | SHA256 / scope |
| --- | --- |
| `w5-postcommit-combined-final-source-manifest-v2.json` | `f11af891a68f0be930e4c68d7928e0a8eb19e1a0641a5b1675c179d4844c2832`; latest combined post-COMMIT check, with later W5/W6 overlays required. |
| `w5-head-prefetch-source-manifest.json` | `ca275f841f3f5a66620be833a692b33117b9256b735f1cf10f4c17f6522647fb`;404-entry bounded Native/helper chain. |
| `w5-http-checked-v4-source-manifest.json` | `d28d651db46f6c0c06d4387ac3d235026f996a1e142e6d9b0a95ecae8ad978ef`;5084-entry HTTP/dependency seal, not permission to rewrite older pins. |
| `w6-checker-source-ownership.json` | `9b8c55feba7956b89bde0227288d2d9677cfc98cdd495afa3344703c090e7d90`;22 repaired paths. |
| `w6-context-repair-source-ownership.json` | `a1b38b035235655a76c941bcb84e04cbee5bcb74d1b48ec6b844af6139dd8d3b`;13-path successor overlay. |
| `w6-bind-harness-source-ownership.json` | `92b2bebb0f849b3e2c439977ca7f563f4fe932e72217fcb62c060a6ad29e4f71`;6-path harness/test/spec overlay; production unchanged. |
| `w6-committed-actual-source-preflight.json` | `2ee61e204061b9cc4261b360b7e65f86e351eb087e17340ea8e806a244d935bb`;current actual launch overlay and parent3600s wrapper hash, plus exact whole-rehearsal result hash. |

Older W2/W3/W4/W5 checker manifests were also read/rehashed; preserve their ownership and diagnostic history.
For W0/W1, use their reports/logs plus later covering source overlays; do not invent a missing wave manifest.
Do not execute old audit helpers that overwrite delivery manifests. Final source reuse requires unchanged relevant
producer, schema, caller, configuration and test oracle, not merely an unchanged test file or baseline Git HEAD.
Core `main` HEAD remains `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`; Native `main` HEAD remains
`6a749ba3e7d8719e336d9d1d8735a8e09da4366b`; extensive uncommitted authorized changes require the path manifests.

When final checks pass, keep lower-layer reused evidence, newly executed final tests, parent actual results and
unperformed manual checks in separate columns. Never sum repeated suite counts, call a preparation/preflight an
execution, or promote a historical interrupted/failed driver to success. This document returns the reviewer to idle;
the parent dispatches final W8 only after W7 and the remaining W6 gates.
