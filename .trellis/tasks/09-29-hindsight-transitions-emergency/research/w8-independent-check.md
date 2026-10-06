# W8 consolidated independent check

Active task: `.trellis/tasks/09-29-hindsight-transitions-emergency`.
Reviewer: `/root/w5_postpatch_review`; final review date: 2026-10-06.

## Verdict

**PASS for the approved W0-W7 implementation and isolated automated/real-data evidence scope.** The complete
Shared/Core/Desktop suites, root lint/types, Desktop build, final actual main.ts boot/recovery, authenticated
WS/browser observation and scoped Native/Rust checks pass. Concrete review findings were fixed below. No unresolved
implementation blocker remains. The leader owns PRD acceptance/HANDOFF updates; owner/manual and supported-original-
environment acceptance remain unconfirmed. This report does not authorize original-data replacement or publication.

Taki: `H:/TakiAgent`, `main`, HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
Native: `H:/hindsight`, `main`, HEAD `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`.
The live session remains bound to this task; the empty legacy pointer was not rebound. No subagents, dependency
installation, Git mutation, corpus conversion, paid model call, protected baseline startup or archive occurred.

## Findings (fixed)

### F1. Misleading initialized-authority guidance and untranslated primary progress

- Files: Desktop Operations `memory-transition-state.ts`, `memory-transitions-card.tsx`,
  `memory-transition-progress.tsx`, colocated card/browser tests, frontend spec and directory index.
- Issue: wrong-provider reasons always recommended first onboarding, including an already initialized Local
  authority after emergency. Missing baseline also implied first activation without enough evidence. Native phases
  such as `active` and `retired` appeared as raw English in ordinary progress.
- Fix: contextual text distinguishes already-selected Local/Hindsight from no selected authority. Missing baseline
  directs inspection of initialization/history without prescribing another first activation. The shared closed
  Native phases have exhaustive Chinese labels. Core `allowed/reason` remains the sole permission gate.
- Verification: rendered state checks and the final real browser screenshot/assertions; all Desktop tests pass.

### F2. Migration regression expectations omitted the delivered tail

- Files: `packages/core/src/db/pending-memory-repo.test.ts`, `scheduled-task-repo.test.ts`, and migrations
  `041-canonical-memory-maintenance.test.ts`, `053-memory-transition-candidates.test.ts`,
  `054-memory-transition-publication.test.ts`.
- Issue: eight full-suite cases expected a registry ending at050 or056, although final production migration057
  was correctly applied. Assertions failed before finishing historical-row/reopen checks.
- Fix: explicitly include the existing051-057/057 migrations and require final version057. Historical receipts,
  full row preservation, foreign keys, pending immutability and no-op reopen assertions remain intact.

### F3. Policy test contradicted the already delivered semantic version contract

- File: `packages/core/src/db/canonical-memory-maintenance-repo.test.ts`.
- Issue: a real semantic policy edit expected the original policyVersion, contradicting the W3 monotonic policy
  rule and the actual delta predecessor CAS requirement.
- Fix: expect exactly one increment while preserving the complete unit/policy/provenance/Source/FTS oracles.
  No policy implementation, mutation receipt or version guard changed.

### F4. Cancellation injection no longer reached the registered provider

- File: `packages/core/src/memory/hindsight/hindsight-foreground-recall-lifetime.test.ts`.
- Issue: the test spied the original provider after `transitionQueuedProvider` copied its methods into the
  coordinator's registered wrapper. The injected abort never ran; the test wrongly diagnosed an admitted Run.
- Fix: interrupt the actual coordinator capability capture after its original result, then assert both invocation
  and an aborted caller before checking `MEMORY_OPERATION_CANCELLED`. The existing production final abort guard
  remains unchanged and is now actually exercised.

### F5. Browser close-during-execution evidence depended on a guessed delay

- Files: `packages/core/src/testing/memory-transition-operator-fixtures.ts`, its index, Desktop
  `ws-client-transitions.test.ts`, `memory-transitions-browser.test.ts`, frontend transition spec.
- Issue: the first full Desktop run failed an immediate second-window `running` assertion. A3500ms bind delay
  could elapse or the observer could still hold its prior frame while the full suite loaded the browser.
- Fix: the owned fixture explicitly holds the actual production binding until the second observer reads
  `running` and the initiator closes, then releases it. WS and browser tests share that control; teardown always
  releases it. Timers, actual transport and production operation services remain real. No product delay/lease changed.

### F6. Context injection would truncate the transition contract

- Files: `.trellis/spec/backend/memory-transitions.md`, `memory-transition-publication.md`, backend index.
- Issue: Trellis reported33379bytes against its32768byte per-file injection limit, truncating the final contract.
- Fix: move the complete synchronous-evidence section verbatim to the existing publication spec, already present
  in both context manifests, and link it from the durable protocol. Resulting sizes31752/15336bytes; validation
  passes without warnings. No contract content was dropped and no injection limit was relaxed.

### Additional required coverage

`transition-operator-overview.test.ts` now executes both bind failure and lost Native resolution reply through the
actual owner: selected nonterminal obligation blocks a new transition, original recovery completes, then a fresh
reentry and return both complete. The original unknown SQL row remains exactly unchanged; historical recovery is
settled and the superseded target is not advertised as current. This confirmed the existing implementation; it
did not require a production gate repair.

## Verification

All commands below returned0 unless an explicitly retained first-run failure is described. Vitest package suites
ran sequentially with at most2workers. Counts are individual executions, not additive unique coverage.

| Final check | Result / evidence |
| --- | --- |
| `pnpm --filter @taki/shared exec vitest run --maxWorkers=2` |64files/555tests PASS,17.08s; `w8-shared-tests.log` |
| `pnpm --filter @taki/core exec vitest run --maxWorkers=2` |490files/3784passed/1skipped,622.57s; `w8-core-final-tests.log` |
| `pnpm --filter @taki/desktop exec vitest run --maxWorkers=2` |119files/675tests PASS,64.94s; `w8-desktop-final-tests.log` |
| `pnpm typecheck` |All5workspace typechecks PASS, including E2E; `w8-typecheck-final.log` |
| `pnpm lint` |PASS; `w8-lint-final.log`; approved exact-path cohesive60/65 allowances preserved, no new suppression |
| `pnpm --filter @taki/desktop build` |PASS; `w8-desktop-build.log`; existing Pet chunk >500kB warning retained |
| `node .../research/w8-boot.mjs` |7actual main.ts boots PASS; `w8-boot-final.log` and runtime result below |
| Native Ruff check / format |7scoped production/test files PASS; `w8-native-static.json` |
| Native `ty check --python H:/hindsight/.venv` |Snapshot, application snapshot and transition restore PASS; explicit existing environment |
| Rust `cargo test --release --locked --offline --test native_result_contract --test transition_contract` |4native-result+1transition wire cases PASS; `w8-rust-contracts.log` |
| Both repositories `git diff --check` and `git diff --cached --check` |PASS; `w8-validation-final.json` |
| Trellis `task.py validate 09-29-hindsight-transitions-emergency` |43implement/52check entries PASS, no final truncation warning |
| New/changed source encoding and module indexes/headers |610source paths checked; no UTF-8/BOM/header/index failure; `w8-source-audit.json` |
| W8 helper checks |Ruff E/F/I120 and format PASS for source auditor; native Node syntax check and actual execution PASS for boot helper |

The only Core skip is the pre-existing environment-gated real archive fixture in `characters/zst-archive.test.ts`.
The final Core suite precedes the last test-only operator fixture change: that fixture is imported only by the
Desktop WS/browser tests, which were rerun in full afterwards. Final root types/lint cover that exact final source.
No dependency of that Core test suite was changed after its final full pass.

Preserved first-run evidence: Core `w8-core-tests.log` contains10failures/3774passes/1skip in490files,612.74s.
The seven repaired files then passed71tests in12.06s (`w8-core-repair-tests.log`) before the complete rerun.
The new operator regression group passed7tests in22.53s. Desktop `w8-desktop-tests.log` retains its one browser
failure/674passes. No failing historical result was overwritten or called successful.

The first standalone boot helper failed because the unit harness persisted abbreviated B3 compatibility while
supplying its full shape through a fake setup reader. The final helper materializes the same synthetic manifest
through the actual compatibility projector before seeding transitions; product code was unchanged. Initial Native
ty invocation omitted `--python` and could not resolve asyncpg; the exact existing Native environment passes.
Historical full-Native Windows/MLX/Unix and optional-UUID diagnostics are not reclassified as globally green.

## Actual main.ts and browser evidence

New boot root: `.trellis/.runtime/w8-boot/85bda41f-239d-4b68-a8c0-33a61a910ddc`.
Its result SHA256 is `95d102b2207dfbc6f049fdbee895f3580c3e2cee4cf5aa26595776c790b4495c`.
Native Node type stripping imports actual main.ts with an allowlisted environment, private data and non-default
loopback ports; ordinary start/dev and `.env.local` are not used. Legacy and genuinely B2-activated Local each
boot/reopen twice; a committed Hindsight target is visible while unavailable; committed emergency Local boots,
recovers through authenticated preview/submit/status/overview, and restarts again. Every child exits0 through
SIGINT, each listener is explicitly refused afterwards, all reopened SQLite files pass integrity and version057,
and the trap records0model calls. Synthetic Native proof is disclosed, not represented as PostgreSQL acceptance.

Original emergency transition `30ead54d-cf5b-43f6-90fd-40f2487f26ee`, unknown operation
`a77ec3d1-b704-47d3-819f-f0659163f504`, receipt
`69a7bea447ca328401e78fdcd28bd4214e21f373bc9f87c3f48f6b8f9c54fb27` remain intact. A new recovery operation
`0c1e375d-7d64-43ca-b25b-333e7ac6a27e` completes the original transition. Reentry remains foreign-branch refused.

Final browser root: `.trellis/.runtime/w7-browser-artifacts/1f98e5f5-aaa3-476e-9b82-6543ffa33cd4`.
Result SHA256: `ae9a5cdfe543bdaca7644161ce45f13e177dccbb3a45bde9f5157b5df4ce3543`.
The inherited W7 helper prints `W7_BROWSER_PASS`; this is a new W8 execution. It uses actual authenticated WS,
production W5/W6 owner/runtime/publication and disposable UI controllers. Native transport is deterministic.
Exactly3explicit submits cover healthy return/reentry and separate emergency. The first ACK exceeds the1000ms
client test deadline; the browser observes truthful unknown, closes the initiator while the producer is held
running, and the second observer sees the same operation `f7400130-8f02-4269-957d-e7dc626b815d` complete.
Reconnect does not resubmit. Keyboard focus/Escape, double activation, separate confirmations, corrected copy,
Chinese Native phases and0page errors pass. The reviewer inspected `final.png`. Emergency adds0Native calls.

## Final integration and retained real evidence

Core's identity-only marker/epoch/receipt projection only opens previews. Complete candidate/source/Bank evidence,
current configuration, lease, capability, final publication and selected-runtime validation remain independently
required by preview/admission/COMMIT. Recovery/cancel/foreign/quarantine/exclusive predicates were traced against
actual storage and driver paths; React does not derive admission. Emergency remains a separate service/action.
Terminal historical unknown operations remain immutable; selected nonterminal obligations alone block fresh work.
Commit, runtime availability, historical supersession, Native release and per-intent outcomes are distinct facts.

Use the final actual reports, not earlier pending handoffs:

- [W5 final healthy result](w5-healthy-final-result-2026-10-06.md):2Banks,722unchanged Sources/mappings,1275units,
  89invalidated=21prior+68receipt-backed Local expiry changes. Both Native activation outcomes, exact original
  transition/receipt, ready runtime and terminal resolution are proved. The old driver's exit1/false flag remains;
  accepted preservation/delta/retention audits explain its overly strict zero-upsert/timestamp assertions.
  Finalization made0model calls;551cumulative submissions are historical, not new W8 usage.
- [W6 final emergency/restart/D91 result](w6-final-result-2026-10-06.md): original transition
  `0faf660d-9d8c-4215-ae5f-954f9f574734` and receipt
  `5da1b2448bcc7ccaf0a41d5cbfa50fc9ea5e6f77e3610082300c7ea9477eed31` survive actual recovery/restart.
  All3older unknown rows remain unchanged;2Banks/722Sources/1275records/89invalidated,0new retention/Native/model
  calls. Bind178.172s and settlement256.554s are not submit-ACK duration measurements.
- Actual D91 restores the preserved W5 Hindsight pair, **not** the emergency Local database: genuine
  capture -> Native restore -> owned PG stop -> admit/seal -> immutable pre-writer validation. All56tables and
  guard modes match. Backup `b4157111-fe4c-4acb-a3fb-a853d73925f6` uses an owned encrypted fixture catalog;
  user/DPAPI or cross-machine credential portability is not proved. Existing original partial-effect cases remain
  deterministic evidence; no unfinished effect was manufactured in the corpus.

W8 did not read/start a corpus database or rerun any paid journey. It independently rehashed current dependency
sources against predecessor manifests and both actual W6/D91 full source inventories, supplementing the112path
preflight overlay. Real-data preservation facts above retain the parent-owned actual result provenance.

## T01-T18 and PRD mapping

`R1`-`R10` refer to the PRD requirements. Final full suites include the existing named regressions; retained Native
and real-corpus counts are not added as new W8 executions. Detailed predecessor references remain in
[W8 evidence preparation](w8-evidence-preparation.md), whose old W6/W7-pending statements are superseded here.

| Case / PRD | New final verification and retained prerequisite evidence |
| --- | --- |
| T01 / R8,R9 |Full Core replica-request/manual-sync attribution and operation tests; W0 exact failed claim remains historical truth. |
| T02 / R6,R9 |Core backup-history/emergency disclosure and Desktop refused/no-backup states; no cursor-equality or zero-loss inference. |
| T03 / R1,R3 |Final Core scope/lifecycle/custody tests and main.ts binding; complete admission inventory remains mandatory. |
| T04 / R7,R9 |Core pair/cursor-reset tests plus actual D91 matched pair; no Native-only rollback authority. |
| T05 / R4,R5,R8 |Core admission, owner, methods, lease/config/quarantine/cancel tests; consumed UI request and3explicit browser submits. |
| T06 / R1,R3 |Full healthy/maintenance/final-boundary regressions; unchanged Native W2/W5 proof/renewal and actual W5 final certificates. |
| T07 / R3,R7 |Full Core runtime/writer retirement; source-identical Native engine/API/MCP/worker fences and owned-PG renewal evidence. |
| T08 / R1,R2 |Full multi-cycle/Local mutation/policy/lifecycle/Source tests; new recovered-terminal next cycle; actual W5 complete preservation. |
| T09 / R1,R2 |Full candidate/unused-scope/stable mapping/SourceSet regressions; retained Native unused-scope HTTP proof. |
| T10 / R2,R7 |Actual Core foreign/baseline/capability/config refusals, separate emergency and corrected closed UI guidance. |
| T11 / R4,R8 |Full queue/cutoff/ordered CAS/real caller tests; UI independently shows commit/runtime/intent settlement. Actual corpus queues were empty. |
| T12 / R4,R7,R8 |Full effect-before-ACK/receipt recovery plus real WS/browser late ACK/close/second observer/reconnect with no replay. |
| T13 / R3,R7 |Full primary custody/source-disposition/late-finalize/unknown-held tests; actual cancel predicate and no stale Run rebinding. |
| T14 / R3,R7 |Full boot/publication/bind/terminal tests and7new actual main.ts boots including committed unavailable and original emergency recovery. |
| T15 / R6,R9 |Full offline/seal/incident/refusal tests, new separate browser emergency with0Native calls, retained actual W6 original seal/recovery. |
| T16 / R6,R7 |Full emergency process/foreign-return tests; new original-receipt main.ts restart and retained actual W6 full-row unknown preservation. |
| T17 / R7,R9 |Full paired Core process tests, scoped Native restore types, unchanged Native restore/partial-effect regressions and actual56table D91 drill. |
| T18 / R5,R6,R8 |Final119file Desktop suite includes real production WS/browser; one healthy confirmation, separate emergency, exact request and observer identities. |

All six PRD automated product outlines have the above evidence: repeated preservation(T06-T10), fenced writes and
late custody(T03,T07,T11-T13), uncertain reply/crash/lease/bind recovery(T05,T12,T14,T16,T18), offline uncertainty/
restart/isolation(T02,T15-T17), closed initiator/second observer(T18), and complete isolated end-to-end gates.
The leader records acceptance; manual/original-environment confirmation remains separately open. R10 scope holds:
C07/C08 and relevant C03/C09/C10/PR01-PR04 are covered without closing Stage5/6 or D23/D79-D83/D81 work.

## Source identity, generated contracts and release limits

`w8-source-audit.json` records67source manifests,8015matching current dependency hashes,21explicit W8 changes,
0missing dependencies and0unexplained drift. It also checks610changed source files for encoding and module indexes.
All Native source changes retain their exact accepted predecessor identities;525client paths,811API paths and
15control-plane paths match. Existing canonical OpenAPI/SDK/wrapper generation results are reused by their own
per-file hashes; these different exported artifacts are not asserted to share one digest. The only changed Rust
scope is the already delivered client contract test; its5related cases were rerun. Tauri/Rust Shell is unchanged.

The current files initially absent from smaller wave manifests (main, Utility Slot, held primary ingestion,
document/recovery/representation and queue executor/mapping/wrapper) all exactly match the successful full W6 and
D91 inventories. Their final code/diffs were inspected in W8; older provenance alone was not called independent
review. Actual W6 source inventory SHA is
`8bfbd9e575ed534fdef780d66fbe283384bbbf8d966d5dc1a192e4c8cfae9049`; D91 inventory SHA is
`6edf1055addb49fa283e1f846114fe7a3c626be4ef1fc0480f5eedd844f591c9`.

New `w8-source-ownership.json` pins21source/spec/test files plus2new W8 helpers. SHA256:
`44ff445f2e455016709b5ebc634cce3fca0a127c99a286ea1d799787d054c7e9`.
Audit SHA256: `2328f029077fe4a8a6b52c29389ea1e59ff3d9fd2dfefaadadfa9f5bd42b41be`.
`w8-final-evidence.json` pins this report and final result/log artifacts without a self-hash cycle. Historical
manifests, failed attempts and parent supervisors remain unchanged; W7's old42file manifest requires the W8 overlay.

Release prerequisites remain current schema057, compatible Native e30/e40/public contracts, exact baseline/pair/
credential custody and explicit operator preview/admission. Restore only a validated pair through the current
runbook before writers. Configuration reversal, schema downgrade and reviving an old authority are not rollback.
Unknown operations recover their original receipt/identity; emergency foreign branches never auto-merge.

## Findings (not fixed)

None within the approved implementation scope. Production long-RPC defaults remain120seconds: real corpus work
may outlast them, so truthful unknown and durable reattachment are the supported behavior, proven above. This is
not a performance SLA. Packaged WebView2/CSP, original-user/DPAPI recovery, remote-Core merge, deferred Stage5/6 and
owner/manual acceptance were not performed or marked passed. The pre-existing large Pet chunk and environment-
gated archive fixture remain documented limits, not hidden green results.
