# AI SDK upgrade and regression baseline

## Goal

Establish a reproducible current-state baseline and upgrade the existing AI SDK packages coherently, preserving current Runtime behavior and the worktree's unrelated changes.

## Requirements

- Inherit parent R01-R02 and AC01; the owner's conditional start instruction is satisfied by global-rule validation and independent readiness review.
- Keep Core model/tool governance, streaming, cancellation, structured output, MCP disclosure and Effect recording compatible.
- Identify existing failures before attributing them to the upgrade; verify actual installed and locked versions.
- Preserve the already modified lockfile and all unrelated changes; limit source adaptations to demonstrated SDK incompatibilities.
- Keep optional Harness/Workflow adoption separate from this package upgrade.

## Acceptance criteria

- [ ] Recorded pre-upgrade environment, package resolutions and meaningful baseline checks are reproducible.
- [ ] The exact approved same-major target set resolves coherently and produces a focused manifest/lock diff.
- [ ] Provider/message, model-effect, MCP/tool, cancel/stream and structured-output regressions are checked through existing relevant tests.
- [ ] Isolated real Node Core startup works on both baseline and target; evidence is separate from Vitest transpilation and live-model acceptance.
- [ ] Required broader checks pass or each pre-existing failure is explicitly evidenced and separated; introduced failures are resolved.
- [ ] A scoped rollback can restore the captured pre-upgrade state without losing earlier or concurrent work.

## Dependencies and constraints

This is the first execution child. The owner has authorized development after preparation; global validation and independent readiness review are complete. Follow the [parent requirements](../10-21-agent-delegation-source-context/prd.md). No new runtime dependency, provider migration, unrelated dependency refresh, commit or deployment is included.

## Definition of done

Exact package delta, necessary compatibility changes, verification evidence and rollback instructions are reviewed. This does not imply completion of delegation or source semantics.
