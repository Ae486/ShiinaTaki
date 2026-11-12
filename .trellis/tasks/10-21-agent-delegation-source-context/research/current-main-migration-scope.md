# Current-main migration scope review

Date: 2026-10-22. Independent, bounded read-only review; the reviewer did not implement S1/S4 migrations. The only change made by this review is this document. No database was opened, no source or migration was changed, and no Git mutation or model call was performed.

## Recommendation

Continue the authorized feature implementation and isolated T4 validation against its current lineage. Do not import unrelated main schema families or implement a whole-branch convergence as an incidental fix in this task. Record the current migrations as **T4-only; not merge-ready or release-ready against current main**. A dependency-ordered, higher guarded convergence is a blocking prerequisite when integration with main is actually requested, and before any merged build touches an existing database from either lineage.

This is a staging boundary, not a waiver of migration compatibility. The migration spec requires target-branch comparison before version assignment; the current 056/057 allocation does not satisfy current-main numbering compatibility. Local storage checks must therefore be described as T4-lineage evidence, not as a passed main-upgrade gate. `base_branch: main` identifies the intended integration target; it does not authorize importing other product changes, merging, deploying, or opening real-user databases now.

## Verified facts

| Evidence | Finding |
| --- | --- |
| `Get-Location`, `git branch --show-current`, `git worktree list` | Work is in `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`, HEAD `06a8090`. The separate main worktree is at `e260ff4`. No command executed in that other worktree. |
| `git rev-parse main`; `git show main:packages/core/src/db/migrations/index-list.ts` | Main is `e260ff4b0bf663b5faa0187bc6ec701fd2f007cd`. Its 049 is local onboarding; 050 reviewed deployment mode; 051 replica requests; 052-057 Memory transitions/candidates/publication/drivers/verification/emergency; 058-059 Hindsight templates. |
| Current `packages/core/src/db/migrations/index-list.ts:55-63,114-122` | T4 049-055 are initiative delivery/model opportunities/feedback/patterns/wake policy/intentions/backoff. The current task adds 056 Subagent conversations and 057 source context. Both registries are individually ascending; their version meanings diverge from 049 onward. |
| Runtime S1 `research/s1/working-status-before.txt:603,615`; `research/s1/s1-working-baseline.diff:1655-1670`; `research/s1/preimages.json:97-105` | The 049-055 files and registry tail existed in the captured working baseline before S1; 056 did not. This is pre-existing dirty-working-tree history, not history inferred from HEAD: HEAD's own registry ends at the older Timeline-presentation 035. |
| All five `10-21-*` task JSON files | Parent, SDK, Runtime, source, and acceptance tasks have `base_branch: main` and the explicit T4 feature branch/worktree. |
| `packages/core/src/db/migration-runner.ts:39-54` | The runner reads `max(version)` and skips every migration at or below that value. Receipts record version and applied timestamp, not the schema family. It does not detect missing lower-version work by table inspection. |
| `packages/core/src/db/migrations/036-memory-timeline-convergence.ts`; `040-hindsight-cutover-convergence.ts` | Existing higher convergence preserves the two 035 meanings; 040 recognizes exact historical/current shapes and refuses unsupported or unmappable imports. Neither bridge covers the later 049+ split. |
| Runtime S1 `research/s1/boot-reviewed/boot.json`; source S4 `research/s4/boot/boot.json`; `057-source-context.test.ts` | The recorded boot paths are task-owned isolated directories, with zero model requests, and migration tests use memory/temporary fixture databases. These support the reported synthetic-validation scope; this review did not audit or mutate any user's database. |

The original parent PRD authorizes bounded T4 implementation and isolated real-model E2E, preserves the dirty tree, and excludes production publication, Git commit/push, real-user Memory mutation and unrelated initiative/Memory/extension redesign (`prd.md:7,42-44`). It does not request a main integration or deployment.

## Why renumbering only 056/057 to 060/061 is insufficient

1. A main database already at 059 would skip T4's 049-055. In particular, T4 049 creates `run_deliveries` (`049-initiative-delivery.ts:3-16`), while source 057 expects that table when adding its sidecar (`057-source-context.ts:10-19`). `git grep` found no `CREATE TABLE ... run_deliveries` in main's migration modules. Advancing the two new numbers does not supply this missing dependency.
2. A T4 database already at 055/056/057 would skip overlapping main migrations. Its missing onboarding/replica/Memory-transition schemas would not appear merely because the merged registry retained main's lower numbers. Main 058/059 may also depend on that skipped lineage; their successful application must not be assumed.
3. An already applied T4 056 contains the Subagent tables and receipt. Re-executing the current non-idempotent `CREATE TABLE` body under 060 would fail on those tables; deleting or rewriting receipt 056 would falsify history. Test-owned fixtures make controlled future fixture replacement possible, but do not authorize touching unknown developer/user histories or solve 049-055.
4. Renumbering before a migration has run anywhere is explicitly allowed by the spec. That is a different condition from this case: local task fixtures already exercised 056/057, and the broader 049+ histories are independently established. Preserve retained evidence and decide canonical numbering together with the real convergence sequence; do not advertise a number-only change as compatibility.

## Alternatives and required integration gate

| Option | Benefit | Cost and disposition |
| --- | --- | --- |
| Import current main's 049-059 and implement union convergence now | Could establish one specific combined schema if accompanied by complete lineage tests and dependency validation. | Expands this feature task into onboarding, replica/Memory-transition and template integration, without the corresponding runtime integration or release request. It also competes with active S2/S4 owners. Not necessary for isolated T4 feature correctness; do not undertake implicitly. |
| Keep T4-local lineage with an explicit integration blocker | Preserves authorized scope, existing working state, fixture evidence and ongoing functional validation. | Current T4 cannot be presented as safe for a main 059 database. Compatibility remains unfinished and must be enforced at the integration/release boundary. Recommended now. |

When integration is requested, one migration owner must compare the then-current target and every supported historical branch, select one canonical forward sequence, and append guarded convergence after the relevant historical maxima. The sequence must create every skipped required object in dependency order before dependent guards/DDL run. Existing constraints, foreign keys, triggers, data, sequence watermarks and receipt bytes must survive; unknown shapes or unproven data mappings must refuse rather than receive guessed defaults. `IF NOT EXISTS` alone is not proof that an existing object's constraints are compatible.

Required evidence then includes fresh canonical install; main 059 lineage; T4 055, applied-056 and applied-057 lineages; relevant older 035/036/040 cases; repeat reopen; exact schema/data/receipt preservation; failure rollback; full applicable Core checks and an isolated combined Core boot. A unique ascending registry is necessary but does not establish this upgrade matrix. Do not feed current main/user databases to the present T4 build as a test shortcut.

## Decision and limits

No new substantive user decision is needed to continue the currently authorized isolated feature work. The coordinator can record this explicit boundary and keep S2-S7/S8 moving under their existing gates. The eventual integration request must establish the desired combined product scope and supported database histories; an unsupported nonempty historical shape or irreversible mapping would need a concrete evidence-backed proposal before any real-data action. A metadata `base_branch` value is not that request.

This review establishes the scope and the code-level incompatibility mechanism. It does not certify S4 completion, repeat S1 functional tests, claim a merged migration passes, or prove the absence of every historical real database. Existing S1 pass statements remain valid only for their recorded T4 fixtures and covered behaviors. The incomplete current-main migration gate must stay visible through final feature handoff until an actual reviewed convergence closes it.

References: `.trellis/spec/backend/sqlite-migration-lineage.md:5-10,22-39,52-58,69-73`; parent `prd.md`; actual registries and runner above.
