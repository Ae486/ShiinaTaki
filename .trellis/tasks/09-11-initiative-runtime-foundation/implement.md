# Shared initiative runtime and delivery foundation — implementation plan

## Entry

Reviewed parent design and a verified incoming Memory/schema baseline; no preceding implementation child.

The owner's development and source-snapshot approvals select [pinned main `516e151`](../09-11-companion-initiative-implementation/research/baseline-snapshot-contract-2026-09-19.md), including B6 and Memory operations through migration 048. The parent owns its T4-local integration and verification while preserving main and current Avatar outcome work. Pass that combined-baseline gate before this child's feature dispatch; another task's validation report is not a substitute.

Review and activate this child through the native-session Trellis workflow before production edits. Recheck cwd/branch/worktrees/task source and read the parent/child artifacts plus all relevant specs named by the injected indexes. Do not change legacy/global task pointers.

## Ordered work

- [x] Record baseline heads/working changes and complete the parent's Memory/migration integration gate (2026-09-20 formal review and final source checkpoint).
- [x] Implement strict readers/contracts and inert repositories before any new writer or enabled trigger.
- [x] Extend the existing queue/admission and context/tool/decision interfaces with focused regression tests.
- [x] Implement delivery/continuation/recovery/Timeline accounting together, including the existing Scheduled result consumer.
- [x] Implement User Timezone service and new factual Monitor projection while preserving existing primary/monitor behavior.
- [x] Add e2e/src/initiative-runtime.e2e.test.ts using the existing isolated Core/Node/local-provider harness; keep any arrangement hook test-only.
- [x] Run the scoped gates and formal check, update affected specs, and publish evidence before child 2 starts.

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
python .trellis/scripts/task.py validate .trellis/tasks/09-11-initiative-runtime-foundation
```

Run the scoped process/E2E and applicable Rust/native checks from the parent plan. Use isolated data/ports and a local scripted provider for deterministic execution; label separate real-provider and owner trials honestly.

## Evidence and rollback

The latest recovery state and verification records are linked from the
[September 26 continuation](research/continuation-2026-09-26.md). Earlier checkpoints
remain historical evidence and do not establish the current source's acceptance.

Record changed responsibilities, exact commands/results, exercised source/schema versions, unresolved limitations and parent AC coverage in a child implementation evidence file. Do not mark checks passed from source inspection.

Use the parent rollback boundary: disable new admission/presentation/reporting while retaining compatible readers and durable history. Do not undo executed effects, erase Timeline/Memory, rewind revisions or downgrade a database past written event versions.

After the implementer, dispatch the scoped formal check and synchronize executable specs. Commit, push and finish/archive remain separately authorized. The next child starts only after the documented prerequisite gate passes.
