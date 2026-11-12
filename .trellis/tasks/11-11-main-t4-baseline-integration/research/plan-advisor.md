# Independent Integration Planning Challenge

- Date: 2026-11-11
- Scope: Original owner requirements, task PRD/design/implementation plan, current main/T4 source contracts and completed research. Planning only.
- Sources: main `G:/TakiAgent-integration` at leader-verified `9b98794`; frozen T4 `H:/TakiAgent-worktrees/t4` at leader-verified `63faf81`.
- Ownership: This report only. No source/spec edits, Git mutations, installation, test/service launch, original-profile or Credential Manager access.

## Verdict

The direction satisfies the original request: an independent G: integration repository, both accepted feature sets and histories, T4 startup/configuration precedence, isolated database validation, and alignment only after verification. No confirmed mutually exclusive product requirement or owner-level architecture choice was found. Ordinary file resolution, canonical numbering and local dependency aliases remain engineering decisions.

The leader subsequently incorporated the completed persistence/runtime research into `design.md` and `implement.md`: main 001-063 plus 073+ dependency groups, union governance 4 with evidenced history, retained T4 trigger recognition, explicit per-migration atomicity and resumability, and persisted-setting launch isolation. I reread those amendments. No remaining engineering planning blocker to activation was found. The obligations below remain implementation/test gates, not requests to repeat the owner's general authorization. Source research alone does not establish a passing merged baseline.

## Required Amendments and Verification

### 1. Make the convergence sequence explicit without altering historical exports

The runner reads the maximum receipt once and skips lower versions (`packages/core/src/db/migration-runner.ts:39-54`). The persistence research supports retaining main 001-063 as the fresh canonical prefix and adding recognized convergence groups starting at 073, while retaining T4's colliding historical exports for fixtures/provenance. Missing numeric receipts 064-072 in a fresh/main database are legitimate; do not fabricate T4 historical receipts to make the sequence look contiguous.

Before persistence edits, record the exact group dependencies, supported source shapes, final schema and per-group no-op/transform behavior. Validate complete constraints, indexes, triggers and meaningful rows, not merely table names and final max. Common current definitions through 048 being byte-equivalent does not remove the supported early-schema fixtures or historical Timeline 035 bridge.

### 2. Account for trigger recognition and per-group commit semantics

`MigrationSchemaObject` currently permits only `table | index` (`migration-runner.ts:22-26`), while branch recognition includes attached triggers and requires the owned object count to match (`:86-95`). Incoming-reference protection also refuses referencing triggers/views (`:105-117`). Existing machinery therefore cannot be assumed to recognize every already-current or rebuilt convergence shape without a narrowly justified extension or a different exact guard that retains these protections.

This matters concretely for main's waiting-request and quarantine tables: migration 063 rebuilds both tables and recreates their immutable/admission triggers (`db/migrations/063-hindsight-replica-waiting.ts:11-66`). T4 already extends the recognized object type to include `trigger` (`migration-runner.ts:22-26`); retain that extension alongside main's transaction/reference protections. A current main group must be verified and skipped rather than replayed destructively. Unknown attached objects or incoming references must still refuse.

The runner commits each migration independently (`migration-runner.ts:44-47`, `:57-64`). A multi-group convergence can have earlier committed groups when a later group fails. State this accurately: either define and test safe resumable partial progress, or use a cohesive transaction where whole-upgrade atomicity is required. Do not report every individual migration's rollback as proof that the entire multi-group sequence leaves the original database unchanged.

### 3. Treat historical registry 1 as evidenced additive snapshots

The exported registry history and persistence report show several additive snapshots labeled revision 1. Their rememberable cell/classifier/disclosure semantics are reportedly unchanged, while later additions are once-only Core capabilities. Historical lookup must reflect that evidence rather than claim byte-identical whole registries or alias an unrecognized revision to the current union.

Approval's default resolver recognizes only the current revision (`approval/approval-decision-service.ts:48-53`); nonempty old snapshots fail without historical resolution (`:119-130`). Binding validation checks identity, descriptor/classifier revisions, rememberable status, disclosure and scope digest (`approval/approval-binding.ts:105-131`). Test unchanged decision bytes, valid/inert behavior and generation accounting across every evidenced rememberable snapshot. Unknown revision 2 has no supplied source definition and must not be invented.

A union revision 4 is defensible because current main 3 lacks T4's additions. Update the complete Shared/Core/Host contract together. Main Rust Host hardcodes projection revision 3 and validates descriptor/classifier identity (`apps/desktop/src-tauri/src/host_session.rs:303-305`); changing TS alone cannot fix native acceptance. Preserve future-version refusal, legal old overrides and valid bindings.

### 4. Isolated-copy launches must account for stored configuration precedence

T4's actual configuration order is stored application values > eligible environment fallback > default (`packages/core/src/config/config-source.ts:76-92`; tests `config-source.test.ts:38-59`). `TAKI_DATA_DIR` remains env-only. An isolated data root prevents writing the original profile, but environment overrides alone cannot neutralize stored endpoints, ports, scheduling or model-profile state in a copied database.

The historical-copy harness must inventory effective side-effect-bearing configuration and grouped model profiles before launch. Prepare controlled throwaway execution copies or supported test bindings explicitly, preserving the untouched source backup and recording intentional test overrides separately from historical preservation assertions. Prevent accidental external-provider, original Native deployment or Credential Manager use. Prove effective configuration, not only supplied environment text.

### 5. Preserve readiness and consumer-specific live application

T4 `config/agent-runtime-config.ts:22-59` prepares immutable per-Run bindings and keeps last-good policy where allowed; `config/config-application.ts:70-92` fences delayed completion by per-key revision. Verify no-model refusal before Memory/Run admission, configuration recovery without inappropriate restart, active-Run binding preservation, failed apply keeping prior usable state, and superseded async completion not overwriting a newer observation.

The runtime researcher notes T4's frozen Hindsight replacement placeholders. Those placeholders do not supersede main's separately implemented Hindsight lifecycle/transition contracts. Resolve the actual dedicated Hindsight owner into T4's application-observation plane rather than imposing blanket restart behavior or using construction defaults as dispatch authority.

### 6. Keep rollout and evidence boundaries concrete

Before original worktree alignment, verify both tips remain unchanged and clean, and inspect exact Core/Desktop watchers and launchers. A watcher can restart new code against the original real profile even if the Git update itself is reversible. A tested fast-forward is appropriate only after that operational boundary is clear; unexpected user divergence must not be reset.

The final gate must cover both original test inventories and the changed production paths, including real Node strip-only startup, Shared/Host projection parity, migration copies, main connected memory journeys and T4 deterministic delegation/configuration/Tidy/QQ/Avatar paths. Static/mock/connected-service/provider/owner results remain distinct. Do not convert the earlier filesystem-hash count into a memory-source or large-library acceptance claim.

## Actual Owner Choices

None are presently required for the reviewed integration direction. If an isolated upgrade finds nonempty unrecognized historical rows with no proven identity mapping, stop that dependent upgrade and present concrete preservation/mapping options. If effective copied configuration demands paid provider calls or real resource changes, separate that authorization rather than infer it from baseline testing.

## Limits

This review verifies the planning premises and identifies source-grounded obligations. It does not execute the proposed convergence, prove historical decision usability, assess rendered UI, certify the merged branch or establish current live-profile state. The leader owns incorporation of amendments, activation authority, implementation and the full final verification gate.
