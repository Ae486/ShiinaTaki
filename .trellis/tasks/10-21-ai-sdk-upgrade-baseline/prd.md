# AI SDK upgrade and regression baseline

## Goal

Establish a reproducible current-state baseline and upgrade the existing AI SDK packages coherently, preserving current Runtime behavior and the worktree's unrelated changes.

## Requirements

- Inherit parent R01-R02 and AC01; the owner's conditional start instruction is satisfied by global-rule validation and independent readiness review.
- Keep Core model/tool governance, streaming, cancellation, structured output, MCP disclosure and Effect recording compatible.
- Apply the cancellation-policy clarification explicitly approved by the owner on 2026-10-22: cancelled turns skip the existing post-turn callback bundle, retain exact primary witnesses and accept the SDK's graceful ending. See [decision evidence](research/recovery/cancel-policy-proposal.md).
- Identify existing failures before attributing them to the upgrade; verify actual installed and locked versions.
- Preserve the already modified lockfile and all unrelated changes; limit source adaptations to demonstrated SDK incompatibilities.
- Keep optional Harness/Workflow adoption separate from this package upgrade.

## Acceptance criteria

- [x] Recorded pre-upgrade environment, package resolutions and meaningful baseline checks are reproducible.
- [x] The exact approved same-major target set resolves coherently and produces a focused manifest/lock diff.
- [x] Provider/message, model-effect, MCP/tool, cancel/stream and structured-output regressions are checked through existing relevant tests.
- [x] Isolated real Node Core startup works on both baseline and target; evidence is separate from Vitest transpilation and live-model acceptance.
- [x] Required broader checks pass or each pre-existing failure is explicitly evidenced and separated; introduced failures are resolved.
- [x] A scoped rollback can restore the captured pre-upgrade state without losing earlier or concurrent work.

## Execution evidence

The exact target set and owner-approved cancellation policy are installed. [Implementation and verification](research/implementation-report.md) records the final 15-file source/config/spec delta, preserved baseline, bounded comparison, real HTTP/WebSocket and Node boot evidence, and rehearsed source rollback. Final focused checks (69 tests), workspace typecheck, root lint and all bounded workspace tests (5,968 passed; two existing skips) passed. Clippy and 211 Rust tests passed on the unchanged native fingerprint. The baseline default-concurrency run's 41 failures remain explicitly separate from the matched four-worker comparison.

The independent real-fetch regression led to the [concrete cancellation policy](research/recovery/cancel-policy-proposal.md), explicitly approved by the owner on 2026-10-22 and now applied. Cancelled turns skip the post-turn callback bundle while exact retained primary witnessing remains unchanged; the SDK's graceful ending is accepted. Real authenticated WebSocket regressions verify notification and cancelled Run/Receipt/activity, including one model/tool Effect settlement. [Independent final review](research/final/independent-review.md) passed. SDK compatibility acceptance is complete within this recorded scope; no live-model or owner UI acceptance is claimed.

## Dependencies and constraints

This is the first execution child. The owner has authorized development after preparation; global validation and independent readiness review are complete. Follow the [parent requirements](../10-21-agent-delegation-source-context/prd.md). No new runtime dependency, provider migration, unrelated dependency refresh, commit or deployment is included.

## Definition of done

Exact package delta, necessary compatibility changes, verification evidence and rollback instructions are reviewed. This does not imply completion of delegation or source semantics.
