# Research: Main/T4 persistence lineages and governance history

- Query: Which recorded migrations, actual frozen schemas and governance definitions must converge without rewriting history?
- Scope: Internal; planning-only source comparison and read-only stopped-backup schema inspection.
- Date: 2026-11-11
- Source roots: main `G:/TakiAgent-integration` / `H:/TakiAgent` at parent-verified `9b98794`; T4 `H:/TakiAgent-worktrees/t4` at parent-verified `63faf81`.
- Write ownership: this report and the two schema/source inventories in this research directory. No Git command, migration, service, test, dependency installation or live profile access was performed.

## Findings

### 1. The shared production migration definitions through 048 agree

A direct filename/content comparison, normalizing CRLF to LF, found no differing same-named production migration module through 048. Only `041-canonical-memory-maintenance.test.ts` and `048-memory-operations.test.ts` differ. T4 additionally retains historical `035-timeline-presentation.ts`; its active registry selects common `035-pending-memory.ts` and common `036-memory-timeline-convergence.ts`. The latter explicitly converges both real 035 histories and protects the nullable Timeline column (`036-memory-timeline-convergence.ts:11`). Historical early schemas before 048 still exist and the common 040/041 guards remain relevant; byte-equivalent current definitions do not prove every historical database has current shapes.

Both runners read `max(version)` once and skip every migration at or below that value (`db/migration-runner.ts:40-59`). Lower-version definitions added by a merge cannot repair T4's recorded head 72. Neither a unique active registry nor textual merge success proves migration compatibility.

### 2. Actual divergence begins at 049 and T4 has no active 059

| Range | Main recorded meaning | T4 recorded meaning |
| --- | --- | --- |
| 049 | Local onboarding/candidate and primary-memory custody | Initiative delivery and User Timezone authority metadata |
| 050 | Checked reviewed deployment mode column | Initiative model opportunities |
| 051 | Durable manual replica requests | Initiative feedback |
| 052-055 | Memory transition/queue/candidate/publication/driver evidence | Interaction patterns, wake policy, intentions, backoff |
| 056-058 | Verification dispatch, emergency/quarantine, template overlays | Subagent conversations, source context, agent inbox |
| 059 | Template execution/config clock | No active migration or frozen receipt |
| 060-063 | Hindsight candidates, runtime identity, review schedule, replica waiting | Conversation order, presentation, inbox resume, subagent progress |
| 064-072 | No active main entries | Primary conversation sources, auxiliary/cache usage, Tidy reviews, maintenance monitor, delegation convergence, model profiles/secrets, search projection policy |

The immutable definition inventories are in `migration-tail-inventory.json`. This is static pattern extraction, not execution; generated SQL portions remain governed by their source modules.

### 3. The stopped frozen backup is a T4 SQLite feature lineage with independently newer governance metadata

Read only `G:/taki-t4-freeze-20261110/data/core-profile/taki.db`, using Python SQLite URI `mode=ro&immutable=1`. The backup API file has no WAL dependency. SHA-256 before and after inspection was exactly `973f100874a9f80716d71be96e2b8064e0aa7bf6c40d2e60ec02ff5a6304c023`; no backup bytes were written. The safe metadata/schema inventory is `frozen-schema-inventory.json` (340 non-NULL-SQL schema objects; receipts 1 through 72 except 59). No config/model/credential payload was queried or exported.

The backup contains T4's initiative, delegation, model-profile, Tidy and search-policy tables. It lacks main's post-048 `memory_migration_candidates`, `primary_memory_groups`, `hindsight_replica_manual_requests`, `memory_transition_*`, `hindsight_template_*`, `hindsight_runtime_identity_clock` and `hindsight_policy_review_schedule` objects. `hindsight_connection_state` lacks `reviewed_deployment_mode`; `memory_authority_selection` is the recognized pre-054 shape, has no `transition_receipt_id`, and currently selects `canonical-local`. A stored governance revision 3 does not mean main migrations 049-063 ran.

Read-only counters corroborate the freeze receipt: governance registry 3 / policy generation 61 / relaxed level; Approval registry 1 / disclosure revision 1 / generation 8 / seven decisions. These are backup observations, not current live-profile claims. Decision content and credentials were not read. Whether each decision remains usable must be checked through production Approval validation on an isolated copy.

### 4. Concrete canonical/convergence recommendation

Keep main's active canonical fresh sequence 001-063 and its original historical exports unchanged. Do not register T4's colliding 049-063 exports in that sequence. Append guarded convergence versions starting at 073; 064-072 may remain absent from the canonical sequence because their numbers already mean T4 history and need not be manufactured on main/fresh installs. Keep the T4 historical exports identifiable for fixtures/provenance rather than mutating their `version` fields.

Use a small ordered sequence of feature-group convergence migrations above 072, following actual dependencies. Each group declares recognized missing/current/historical schema branches and its exact absent objects. The group creates missing final canonical objects and performs only the explicitly required guarded transformations. On fresh/main databases the T4 groups create missing final state. On T4 databases the main groups create missing main state. Current groups are verified no-ops. Do not blindly replay the old T4 chain: 058 rebuilds its 056 tables and 069 backfills only provable frontier facts; neither should replay against already-current T4 tables.

Practical group order: (1) common-baseline schema recognition, (2) main onboarding and checked connection column, (3) main transition/publication/emergency and final waiting-request schema, (4) main template/candidate/runtime-clock/review schema, (5) T4 initiative and checked Timezone columns, (6) T4 delegation/current private tables and recognized early 058/060 convergence, (7) primary conversation sources and usage/maintenance observations, (8) Tidy/model profiles/search metadata. Number these groups 073+ only when implementation has fixed the actual dependency grouping. Avoid inventing a final tail before that review.

The existing runner provides one transaction per migration, including schema selection, DDL, data copy, receipt and COMMIT. A later group failing does not roll back earlier committed groups; document this existing contract explicitly and validate restart/retry. If whole-upgrade atomicity is required, combine the convergence in one higher migration using an evidence-backed complete branch set. Do not claim that separate migrations provide a whole-upgrade transaction.

An alternate canonical T4 001-072 registry plus main 073+ bridges can work, but it changes the base canonical registry and uses T4's history as fresh default without eliminating either direction's schema guards. The main 001-063 choice preserves the just-verified main registry and makes the integration-specific additive boundary easy to inspect. This is an engineering choice, not an unresolved owner preference.

### 5. Exact guards and preservation hazards

- Main 050 (`050-hindsight-reviewed-deployment-mode.ts:16`) adds a nullable TEXT column **with a CHECK**. Existing `ensureNullableTextColumns` deliberately accepts only unconstrained bare TEXT. Do not use that helper for this column. Recognize the complete missing/pre-column and exact current checked shape before an ALTER/no-op.
- Main 054 (`054-memory-transition-publication.ts:12`) rebuilds `memory_authority_selection`. Pre-054-to-current must preserve every original column byte and add NULL `transition_receipt_id`. Current post-054 branch must no-op. Unknown attached indexes/triggers/incoming references must refuse. No historical transition receipt may be synthesized.
- Main 057 replaces two named admission triggers (`057-memory-transition-emergency.ts`); Main 063 rebuilds manual requests plus their referencing quarantine table (`063-hindsight-replica-waiting.ts:12`). Missing T4 groups can create the final waiting-capable schema directly. Existing main/current rows, rowids, immutable JSON and exact quarantine references must remain intact; a recognized pre-waiting variant needs a guarded parent/child rebuild with failure rollback.
- Main 059/061 seed new clocks and their triggers (`059-hindsight-template-execution.ts:26`; `061-hindsight-runtime-identity.ts`). Creating a missing clock is valid; resetting an existing clock or stamp fabricates continuity. Confirm exact existing trigger definitions and retain existing state on current branches.
- T4 049 adds constrained non-NULL/default Timezone columns. T4 064 adds a Timeline FK column, T4 066 adds a checked INTEGER observation column. These also cannot be represented by the bare-TEXT helper.
- T4 058 preserves private Run-message sequencing while rebuilding tables and relaxing `work_expires_at`; T4 069 recognizes four early/current context/frontier combinations and backfills only exact producer boundaries (`069-delegation-schema-convergence.ts:44-61`). Preserve its factual backfill semantics and unknown frontiers rather than treating every event as step zero.
- T4 068 changes derived cache-baseline population and computes proven historical boundaries (`068-maintenance-monitor.ts:8-42`). Preserve raw usage and regular-call semantics. Do not mark historical Tidy review coverage, tokenizer policy or Native outcomes as known simply because new tables exist.
- T4 runner adds `MigrationSchemaObject.type = "trigger"` (`db/migration-runner.ts:25`), necessary for its exact 058/069 branches. Retain this supported extension and main's transaction/failure isolation when resolving the runner.

### 6. Governance and Approval require a new union revision and truthful historical lookup

Main current registry is 3 (`shared/governance-registry.ts:13`) and has three Hindsight capabilities; T4 current registry is 1 and adds initiative/delegation/co-watching Core capabilities. Parent exported exact public historical snapshots to `governance-history/` with commit sources in `sources.json`: original v1, scheduled-task v1, current T4 v1 and main v3.

Direct snapshot comparison shows v1 was extended several times without a registry-revision increment. The observed additions are **once-only, immutable Core cells**, while the rememberable descriptors and their binding/classifier/disclosure properties are unchanged. Main v3 adds once-only Hindsight cells. A new canonical union revision 4 is therefore a defensible design, with unmodified descriptor revisions/classifier bindings and explicit frozen historical v1/v3 resolution. Validate that all observed v1 snapshots have the same rememberable approval semantics; do not present one snapshot as evidence of byte-identical whole registries. No committed registry module at revision 2 appears in the parent-provided history. Do not fabricate revision 2 definitions; an unknown nonempty historical Approval revision remains a supported refusal until actual evidence supplies its semantics.

Core policy reconciliation currently rejects stored registry newer than code, retains only legal exact override identities, then advances registry/generation (`governance-policy-repo.ts:138-154`; `governance-policy-service.ts:145-158`). Keep the newer-revision guard. Since union additions preserve existing cells, legal existing overrides should remain; test this rather than deleting them to boot.

Approval boot currently resolves only the current revision by default (`approval/approval-decision-service.ts:48-53`). A nonempty stored revision 1 under new code throws unless frozen historical lookup is supplied (`approval-decision-service.ts:119-130`). Reconciliation checks original stored binding digests, compares old/new usability, and updates Approval revision/generation without rewriting decision bytes (`approval-decision-service.ts:100-113`). `approval-binding.ts:105-131` verifies identity, descriptor/classifier revision, rememberable status, disclosure and scope digest. Preserve all those checks, the seven durable rows and original decision timestamps/digests; no forced approval or retargeting.

Rust Host independently compares projection revision exactly (`host_session.rs:303` main, `:305` T4), descriptor/classifier revision, canonical complete sorted cell keys. Both sides also have distinct factory entries in `gate/governance.rs`. Union Shared/TS revision, Host validator/cell inventory and protocol fixtures must change together. A TS-only bump will still fail Host authorization.

## Required implementation validation

1. Exact immutable source fixtures for main 063, T4 072, historical Timeline 035 and supported early 023/040/041 plus early/current T4 058/060 groups; retain old version/applied_at receipts.
2. Fresh install; main upgrade; pure T4 upgrade; actual frozen stopped-copy upgrade; recognized partial/current combinations. Check full final schema/constraints/triggers/FKs, not only table names or max version.
3. Nonempty rows: Timeline/presentation/private sequencing, authority marker, meaningful Local memory, primary custody, manual request/quarantine, legal policy overrides, Approval decisions, profiles, usage and derived observation metadata. Check original row/receipt/JSON bytes with intentional transformation fields separately recorded.
4. SQL, receipt and real COMMIT failure injection for each guarded rebuild/group. Unknown attached objects, incoming references, malformed checked-column shapes and unproven identity mappings must refuse atomically. Retry/reopen must be idempotent.
5. Governance 1 and 3 to union; every observed v1 rememberable descriptor has unchanged semantics; unknown/future policy revisions still refuse. Approval v1/v3 lookup, unchanged valid bindings, deliberately incompatible/inert bindings, corruption refusal and generation behavior. Do not invent v2 tests asserting successful upgrade without source evidence.
6. Rust Host accepts complete union projections for old shared and new Hindsight cells; rejects stale/future revision, incomplete/misordered keys, mismatched classifier, stronger-policy violations. Retain both native factory tables.
7. Real Core startup on fresh and historical **isolated copies**, including no model/provider configuration and typed feature not-ready behavior. No ordinary entry against the original profile.

## External references and related specs

No external library claim required research in this scope. Applicable executable contracts: `.trellis/spec/backend/sqlite-migration-lineage.md`, `sqlite-transaction-isolation.md`, `permission-authorization.md`; current `docs/T4-FREEZE-HANDOFF.md`. Parent owns final plan review and actual commands/tests.

## Caveats / Not Found

- This report does not verify production migration execution, decision usability, Native behavior, UI, or current live-profile state. Those remain integration gates.
- Revision 2 governance history is not evidenced by supplied snapshots; unknown nonempty revision 2 must not be aliased to another revision.
- The frozen SQLite schema is T4-shaped beyond 048 with newer governance metadata. Additional mixed schema permutations need declared fixtures and evidence; this observation does not grant permission to accept arbitrary partial schema.
- No genuine owner-level product choice was identified in persistence alone. If implementation encounters nonempty unrecognized rows whose identity mapping cannot be proven, refuse the isolated upgrade and present the concrete mapping/data options to the owner.
