# Interaction Patterns and unified wake policy — implementation plan

## Entry

Children 1 and 2 must pass their execution, delivery, presence, timezone and evidence contracts.

Review and activate this child through the native-session Trellis workflow before production edits. Recheck cwd/branch/worktrees/task source and read the parent/child artifacts plus all relevant specs named by the injected indexes. Do not change legacy/global task pointers.

## Ordered work

- [x] Implement Pattern/revision storage and strict supported-condition validation over the reviewed parent design.
- [x] Implement finite Signal adapters and deterministic candidate/policy state, then connect to the existing child-1 Run adapter.
- [x] Add primary tool and operator methods, with source/CAS/confirmation rules and complete authoring tests.
- [x] Build readable candidate and management UI from existing primitives; add current-state invalidation and useful conflicts.
- [x] Package/install the authoring guidance through the standard Skill lifecycle and explicit setup, including user-package collision tests.
- [x] Expose configuration/policy and decision facts through the same Monitor; enable only reviewed seed data for isolated trials.
- [x] Run the proportional checks, formal review and spec updates; preserve child 4's complete Intention acceptance boundary.

## Verification

Run focused module tests as changes land, then the proportional [parent verification gate](../09-11-companion-initiative-implementation/implement.md#8-verification-commands-and-scenarios). Actual package commands are:

```text
pnpm --filter @taki/shared typecheck
pnpm --filter @taki/core typecheck
pnpm --filter @taki/desktop typecheck
pnpm --filter @taki/shared test
pnpm --filter @taki/core test
pnpm --filter @taki/desktop test
pnpm --filter @taki/desktop build
pnpm lint
git diff --check
python .trellis/scripts/task.py validate .trellis/tasks/09-11-initiative-pattern-authoring
```

Run the scoped process/E2E and applicable Rust/native checks from the parent plan. Use isolated data/ports and a local scripted provider for deterministic execution; label separate real-provider and owner trials honestly.

## Evidence and rollback

Record changed responsibilities, exact commands/results, exercised source/schema versions, unresolved limitations and parent AC coverage in a child implementation evidence file. Do not mark checks passed from source inspection.

Use the parent rollback boundary: disable new admission/presentation/reporting while retaining compatible readers and durable history. Do not undo executed effects, erase Timeline/Memory, rewind revisions or downgrade a database past written event versions.

After the implementer, dispatch the scoped formal check and synchronize executable specs. Commit, push and finish/archive remain separately authorized. The next child starts only after the documented prerequisite gate passes.


## Verified checkpoint (2026-09-28)

The scoped C3 engineering gate passed; see [integrated evidence](research/implementation-evidence-2026-09-28.md).
Owner acceptance remains pending. The task is not archived and C4 has not been started.

## Owner-approved real-model extension (2026-09-28)

- [x] Align file/function size guidance with cohesive production responsibilities and exempt test/fixture line caps.
- [x] Exercise natural-language creation/lifecycle, unsupported-source clarification, one-shot scheduling and actual heartbeat with the configured provider in isolated synthetic data.
- [x] Repair observed timezone authority, object-root tool-schema compatibility and unsaved-candidate explanation defects; retain deterministic regressions.
- [x] Review the observer's content boundary, byte-preserving stream/cleanup and unique Memory/history probes.
- [x] Pass both repaired and final eight-scenario real batches, then read actual replies and record remaining prose issues.
- [x] Refresh five-package typecheck, root lint, Shared full tests and 20 process plus 9 local HTTP regressions.
- [x] Finish the final full Core regression (3,627 passed, one existing skip) and source reconciliation.

See [real-model evidence](research/real-llm-acceptance-2026-09-28.md) for all batches, known usage subtotals and limits.
These checks do not mark owner/manual ACs complete or authorize C4, commit, push or archive.
