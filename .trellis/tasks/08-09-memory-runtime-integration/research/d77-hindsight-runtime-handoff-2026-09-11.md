# D77/B6 Hindsight Runtime Handoff

## Latest owner direction (2026-09-13)

The owner approved scoped B6 closeout, then the existing B7 design/grill and implementation, before D79-D83 additions.
Read [the final bounded closeout](b6-closeout-validation-2026-09-13.md) before the historical checkpoints below.
The observation experiment is removed; direct own-policy admission and required-pin rebinding protection remain.
The native empty mood-disclosure defect found during review is corrected. Final Core 3,055/373 files, all workspace
types, lint, scoped native checks and actual HTTP/Core reconstruction passed. The final real run recovered both
original Recall targets, automatic Recall and completed grounded Reflect with ordinary observations admitted.
Curator continuation applied eight new assessments and resolved the four original journal items, while the three
original memory policies remain failed/retryable rather than falsely assessed. Complete eventual assessment is unproven.
All owned services stopped; source/original/prior-acceptance hashes matched. D81 hidden-derived content remains a
known failure. B7 is still `planning`; owner/manual acceptance and original activation remain separate and open.
Use [the B7 operations inventory](b7-existing-operations-foundation-2026-09-13.md) for its required design/grill.

Date: 2026-09-11. Implementation and the final automated gate are complete. No manual/live activation, real-model
quality acceptance, B7 operation, Git publication or task archival was performed. The task remains `in_progress`
for owner disposition. The earlier gap research remains historical; this document describes the assembled result.

Current status, 2026-09-12: the authorized [actual-data/model acceptance](d77-owner-acceptance-validation-2026-09-12.md)
has been executed. All original fields, empty-database reconstruction, lost-response recovery, policy/CAS guards and
two-Bank pre-retirement recovery passed. Exact-text native recall, useful default automatic recall, 120-second real
reflection and a complete 60-second curator pass did not pass. Cold-read deadline/cache/binding fixes passed 2,957
Core tests, all workspace types and lint. All owned services are stopped; original storage and the prior target are
byte-unchanged. Resolve these recorded quality/performance gates before activation, then resume the separate B7 grill.

## Exact Recovery Anchors

- Workspace: `H:/TakiAgent`, branch `main`, task `.trellis/tasks/08-09-memory-runtime-integration`.
- Native companion: `H:/hindsight`, branch `main`; use it only for the explicitly assigned native companion scope.
- Root session: `codex_01a07553-c738-75f0-93c4-bd8a7cd0b014`. `task.py current --source` resolves this session task even
  when the global `.current-task` is empty. A stale `no_task` hint does not authorize creating a replacement task.
- Original baselines: Taki `3c63a8080c92ffbb3ee8257dc2d979c2ba4ed711`; native `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`.
- Do not access other worktrees, original user database/backups/environment credentials, retained private D78 targets
  or real models as incidental recovery. Do not commit/push/reset/rebase or finish/archive without current authorization.
- The owner's later acceptance authorization specifically covered a read-only snapshot of `C:/Users/55473/.takiagent/taki.db`,
  the stopped D78 target `654131f0175a`, configured model calls and new isolated target `9e41c8d27fa0`. See the linked
  execution boundary before resuming; this exception does not authorize unrelated data, worktrees or original activation.
- The owner requires every future dispatch/resume to name the exact workspace, branch, Trellis task, owned files and
  forbidden targets. Verify those anchors before work and after context recovery. A mismatch means stop and report;
  never search another task/worktree. Both check agents that violated this rule were stopped, and root finished locally.

## Result and Decision Authority

The accepted [policy-readiness ruling](../grill.md) is implemented: a verified valid native unit with known Bank
ownership can be used immediately under durable neutral policy while detailed classification runs later. Existing
policy remains authoritative. Native factual completion, application policy readiness, assessment and Pending state
are independent. Unknown/corrupt evidence is not permission to invent a neutral association.

The runtime consumes actual D77 application-state persistence alongside the existing B5/G1 recovery machinery.
Original Canonical/Source/Block bodies survive provider-only reconstruction, with exact native/artifact CAS and paired
checkpoints. Local remains independently usable and does not reproduce Hindsight semantic algorithms.

Primary references:

- [Implementation contract](d77-implementation-contract-2026-09-11.md).
- [Executable runtime spec](../../../spec/backend/hindsight-application-runtime.md).
- [Final validation and limits](d77-runtime-validation-2026-09-11.md).
- [Native review](d77-native-review-2026-09-11.md).
- [Canonical SDK parity and baselines](d77-sdk-validation-2026-09-11.md).
- [Historical Local/raw-read gate](local-runtime-validation-2026-09-11.md).
- Native patch ledger: `H:/hindsight/TAKI_PATCHES.md`, `TAKI-HS-012`.

## Runtime Entry Points

Let `C = packages/core/src`, `M = C/memory`, `H = M/hindsight`, `D = C/db`, `S = packages/shared/src`.

| Entry | Implemented role |
| --- | --- |
| `S/hindsight-application-*-schema.ts`, `hindsight-application-{json,json-reader,encoding}.ts` | Independent typed wire, iterative lossless body handling and scoped tagged-binary64 hashes |
| `S/memory-policy-assessment-schema.ts`, `S/hindsight-memory-consumer-schema.ts` | Policy readiness and lossless provider-selected results; Local/G1 schemas keep their meaning |
| `H/hindsight-application-{client,body-transfer,bundle,bundle-loader}.ts` | Actual authenticated multipart/snapshot/event transfer and complete proof closure |
| `D/hindsight-application-replica-repo.ts` | Atomic original evidence, native heads, canonical/FTS/Block projection and native/application checkpoint pair |
| `H/hindsight-application-{binding-runner,source-write,source-binding}.ts` | Original Source before native dispatch, exact G1 association and neutral/restriction-preserving native rebinding |
| `H/hindsight-application-writer.ts` and command runner/repo | Immutable original app commands, historical ACK recovery and actual local-application proof |
| `H/hindsight-memory-writes.ts` and `D/hindsight-memory-write-repo.ts` | Parent intent combining independent native and policy effects, stable full-reference results and supersession |
| `H/hindsight-memory-{provider,recall,reflect}.ts` | Native candidate hydration, policy eligibility, verified degraded reads/Pending and separately negotiated guarded reflect |
| `H/hindsight-ingestion.ts` | Exact committed Primary source witnesses, one gate, 20-message cadence and real per-Bank retirement coverage |
| `H/hindsight-policy-curator.ts` | Narrow Taki policy/Block work in the shared Utility Slot, durable claims/results/retries and actual effect counts |
| `H/hindsight-runtime-{connection,state,bank-service,view,consumers}.ts` | B3 identity/routing, assembled stores, serialized Bank recovery, required-pin completeness and complete foreground lifetime |
| `H/hindsight-memory-{runtime,subsystem}.ts`, `M/runtime-{selector,composition}.ts`, `C/main.ts` | Real selected provider composition, immutable Run/tool/recall capture, background wiring and stop before SQLite close |

Migrations 042–047 are registered after the earlier 041 Local maintenance migration. They add independent application,
source-ingestion, command, curator, capability and parent-write storage. Native migration `d77a4f8c2e10` follows D78's
`d78c3e6f8b12`. No old G1/D78 receipt, certificate, native cursor or hash definition was relabeled.

## Important Verified Boundaries

- Recall hydration explicitly requests the Bank native head and at most 255 Memory heads per request. Native
  hydration does not implicitly supply unrequested native heads merely because Bank artifacts are in its closure.
- Same-generation replay-floor rebuilding preserves the real native `snapshotId` and `snapshotManifestDigest`;
  current projection `manifestDigest` can change with policy, and D77 snapshot identity is separate.
- A native ACK or completed G1 child is not a completed combined policy write. Parent completion requires the real
  locally published requested policy. A newer same-layer restriction or native revision supersedes the old request.
- G1 does not expose a historical document revision. Retain saves the actual source revision observed at its first
  confirming application checkpoint. Source provenance requires its own exact witness; no revision 1 is guessed.
- In-flight/queued work observes owner cancellation and deadlines. The normalized B5 availability code remains
  availability after becoming a plain Error, preserving durable Pending output across ACK loss.
- An active, unexpired known pin that needs native rebinding blocks a new Run during outage; neither stale pin text
  nor unbound replacement text is rendered. Invalidated/deleted/expired records do not block.
- Shutdown tracks complete captured tool/automatic-recall/admission calls, not only provider network promises.
  Held consumers refuse before coordinator DB access after stop. Tool wrappers preserve non-enumerable Effect metadata.
- Core `TAKI_HINDSIGHT_POLICY_TIMEOUT_MS` (60000) and `TAKI_HINDSIGHT_POLICY_PROMPT` (empty additive text) are read
  from ConfigSource for each curator pass. Missing usage/producers never become invented zero metrics.

## Final Evidence

- Core: 2941 tests /366 files passed; Shared 505, CLI 47 and Desktop 548 passed in the unchanged-package workspace gate.
- All five workspace typechecks, final Core types, root lint and the external task HTTP fixture's explicit typecheck passed.
- Real Node strip-only Legacy/Local startup reached WebSocket readiness with migrations 1..47 and no model/provider calls.
- Actual native HTTP/PostgreSQL + Core SQLite scenario `2f49fea894dc` passed: neutral/hidden/guarded reflect, lost ACK,
  reopen, typed Source metadata, pure/compound writes, two Banks, user Block and provider-only reconstruction. The
  owned database/listeners were stopped and the owned PG data/registry removed.
- SDK: 683 files byte-identical across two full generations; Python 96, TypeScript 38, Go 6, Rust 8 plus one doctest gates passed.
- Native independent review:24 tests passed after three binding/retirement fixes; earlier broader native and Local
  Rust gates remain documented, with precise skipped/baseline limitations.

See the validation report for exact commands, log paths, initial failures and corrections. Do not rerun unchanged
expensive suites solely to reconstruct this handoff; rerun when code, environment or a concrete concern warrants it.

## Remaining Boundaries

The literal native auto-fixing whole-repository lint hook was not run. Read-only equivalents and owned-source checks
passed; known API ty 27 Windows/MLX, embed ty 3 termios and unchanged formatting warnings remain explicitly documented.
No assertion of a green failed whole-native command is made.

Real-model quality, operator/manual acceptance and original-data activation require their actual inputs/authorization.
Do not automatically activate the built runtime or reinterpret the earlier completed D78 evidence as this acceptance.
B7 must have a separate grill before planned switch-back, re-entry or Emergency Local Takeover implementation.

For deployment, use the compatible native D77 build and its migration, then the matching Core/Shared artifacts with
normal SQLite migration and existing verified B3 secret/Bank configuration. This is a reviewable deployment sequence,
not authorization to execute it on the user's current data. Nonempty native downgrade refuses; preserve complete
backups and application receipts instead of deleting storage or running an older writer that misses publication.
