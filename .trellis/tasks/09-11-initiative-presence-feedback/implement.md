# User presence and presentation feedback — implementation plan

## Entry

Child 1 must have passed its shared delivery identity, reporting, timezone and Monitor compatibility gate.

Review and activate this child through the native-session Trellis workflow before production edits. Recheck cwd/branch/worktrees/task source and read the parent/child artifacts plus all relevant specs named by the injected indexes. Do not change legacy/global task pointers.

## Ordered work

- [x] Confirm child-1 report/delivery/timezone contracts and read the domain/presence research plus frontend recovery/feedback specs.
- [x] Implement nullable accepted evidence and post-await consent/Host fencing before using activity as a presence source.
- [x] Implement Shared reports, Core source leases/aggregation and bounded response-opportunity state with injected-clock tests.
- [x] Add Desktop reporters at actual lifecycle/rendering owners and User Timezone device/settings integration.
- [x] Add Monitor facts, multi-client fixtures and real native-window validation; document any occlusion/association limits honestly.
- [x] Run scoped Shared/Core/Desktop and applicable Rust checks, formal review and spec updates before child 3 consumes the evidence.

Automated child gate verified on 2026-09-28; see [implementation evidence](research/implementation-evidence-2026-09-28.md).
The independent QQMM script lint/lock limitations remain explicit. Native fixture coverage does not check off owner
acceptance, and child 3 has not been activated.

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
python .trellis/scripts/task.py validate .trellis/tasks/09-11-initiative-presence-feedback
```

Run the scoped process/E2E and applicable Rust/native checks from the parent plan. Use isolated data/ports and a local scripted provider for deterministic execution; label separate real-provider and owner trials honestly.

## Evidence and rollback

Record changed responsibilities, exact commands/results, exercised source/schema versions, unresolved limitations and parent AC coverage in a child implementation evidence file. Do not mark checks passed from source inspection.

Use the parent rollback boundary: disable new admission/presentation/reporting while retaining compatible readers and durable history. Do not undo executed effects, erase Timeline/Memory, rewind revisions or downgrade a database past written event versions.

After the implementer, dispatch the scoped formal check and synchronize executable specs. Commit, push and finish/archive remain separately authorized. The next child starts only after the documented prerequisite gate passes.
