# Main/T4 Baseline Integration and Verification

## Goal

Integrate the accepted main and frozen T4 increments into one verified engineering baseline, then align both working branches to that tested history. Perform integration in an independent repository on G: and preserve the original worktrees and real profiles until the relevant gates pass.

## Requirements

- Preserve both branches' accepted functionality and durable history; resolve ordinary engineering conflicts without handing routine implementation choices back to the owner.
- Owner reaffirmed the original division after plan review: main is authoritative for Hindsight integration; T4 is authoritative for other functionality. Reconcile shared wiring without treating T4's older Hindsight snapshot as a competing product design.
- T4's current startup and live-configuration behavior is authoritative. Core's basic plane must boot without model/provider configuration; affected features must report explicit not-ready or unavailable states and recover through the supported configuration path.
- Preserve main's Hindsight custody, deployment, operations, transitions, waiting and policy-review functionality alongside T4's delegation, configuration, Tidy, QQ and Avatar behavior.
- Reconcile divergent SQLite histories without changing old receipts, inventing data mappings, silently dropping unknown schema objects, or weakening safeguards.
- Resolve the reported `database governance registry 3 is newer than code 1` incompatibility through compatible canonical and historical governance/Approval definitions across Shared, Core and Rust Host.
- Validate fresh, main-history, T4-history and recognized mixed-history databases with nonempty representative data and stopped-copy historical backups.
- Keep original profiles, Credential Manager and real deployments untouched by test launches. Use only isolated G: data and controlled child environments.
- Record reproducible test commands, versions, outcomes, timing, resource observations and remaining limits. Distinguish static, deterministic, connected-service, provider and owner acceptance.
- Maintain the Hindsight parent task's [integration change handoff](../08-09-hindsight-memory-provider/research/main-t4-integration-20261112.md), including reasons, code boundaries, verification and unresolved effects.
- During E2E, record every observed configuration prerequisite that prevents startup in the [startup blocker ledger](../08-09-hindsight-memory-provider/research/startup-configuration-blockers.md). The later product task must support configuration after startup, including embedding/reranking models; an E2E cache workaround does not close that requirement.
- Ask the owner before resolving genuinely ambiguous product/data semantics. Do not push, publish, archive the original task, or perform real-data rollout under this engineering-baseline authorization.

## Acceptance Criteria

- [ ] Integrated history contains exact main `9b98794a673efb561682b9fd451fe1da2db95086` and T4 `63faf8119be1747b685aacf43529d754626ab35c` as ancestors.
- [ ] Both feature inventories remain present and their changed cross-layer wiring is reviewed.
- [ ] A fresh isolated Core boots without model/provider configuration; feature admission gives typed not-ready behavior and supported configuration updates apply with T4's documented semantics.
- [ ] Fresh/main/T4/mixed migration cases converge, reopen idempotently, preserve old receipts and meaningful row values, and roll back atomically on failures. Unknown unsupported schema is refused without data loss.
- [ ] Recognized governance revisions and durable Approval decisions are compatible; future revisions still refuse; Rust Host projections match the canonical definitions.
- [ ] Relevant workspace lint/typechecks/builds and TS/Rust tests pass or have individually evidenced, explicitly reported pre-existing limitations. Prior main failures are re-evaluated rather than permanently waived.
- [ ] Critical main memory journeys and T4 startup/configuration/delegation/Tidy/QQ/Avatar paths are exercised at the appropriate test level; omissions are explicit.
- [ ] Historical stopped-copy replay passes without changing original backup hashes or real profile state.
- [ ] Source identities, test counts, artifacts and memory/duration observations are recorded. No filesystem-hash count is mislabeled as memory-source scale.
- [ ] Both original branches are aligned only after integration gates pass and original clean-state/watchers are rechecked; real-data upgrade remains separate.

## Confirmed Scope and Authority

The owner approved an isolated G: integration repository, verification before alignment, T4's startup/configuration precedence, historical frozen-copy validation, and engineering baseline alignment with real-data rollout separate. On 2026-11-11 the owner explicitly consented to creating this integration task and planning. Planning review precedes activation.

## Out of Scope

External push/release; original-profile migration; paid model invocation without applicable authority; replacing either accepted product scope; claiming full large-library or owner-manual acceptance from deterministic tests.

## References

- Original task: `.trellis/tasks/08-09-memory-operations-ui/` (remains active in the original main session).
- `research/phase2-validation-20261111.md` and `research/baseline-alignment-assessment-20261111.md` in that task.
- T4 `docs/T4-FREEZE-HANDOFF.md`; frozen backup `G:/taki-t4-freeze-20261110`.
- Design and execution details belong in `design.md` and `implement.md`.
