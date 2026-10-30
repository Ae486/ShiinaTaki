# Follow-up Intentions and initiative acceptance — implementation plan

## Entry

Children 1-3 must pass and the integrated Memory runtime/authority baseline must be verified.

Review and activate this child through the native-session Trellis workflow before production edits. Recheck cwd/branch/worktrees/task source and read the parent/child artifacts plus all relevant specs named by the injected indexes. Do not change legacy/global task pointers.

## Ordered work

- [x] Reconfirm the integrated provider/source contracts and implement Intention schema/state with finite/source-key tests.
- [x] Expose the narrow primary Intention operation and due adapter over the existing Run/Wake service; no extra model pass.
- [x] Add bounded relevant-memory context/explicit pull and the fresh post-expiry follow-up scenario.
- [x] Connect qualified feedback to conservative backoff and inspect actual policy/Monitor evidence after restart.
- [x] Add and run initiative-recovery process scenarios plus the full parent migration/privacy/delivery/UI regression matrix.
- [x] Perform real native and authorized model trials where available, record subjective owner checks separately, and fix demonstrated implementation gaps.
- [x] Complete formal check and spec synchronization; report parent readiness without automatic commit, push, finish or archive.

These boxes record engineering execution, not owner acceptance. The completed gate, exact initial failures and
targeted corrections, AC01-AC19 mapping and source/rollout limits are in
[implementation evidence](research/implementation-evidence-2026-09-28.md). The
[owner checklist](research/owner-manual-acceptance.md) remains pending, including the verified production Shell
staging limitation. The child and parent remain `in_progress`.

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
python .trellis/scripts/task.py validate .trellis/tasks/09-11-initiative-intentions-acceptance
```

Run the scoped process/E2E and applicable Rust/native checks from the parent plan. Use isolated data/ports and a local scripted provider for deterministic execution; label separate real-provider and owner trials honestly.

## Evidence and rollback

Record changed responsibilities, exact commands/results, exercised source/schema versions, unresolved limitations and parent AC coverage in a child implementation evidence file. Do not mark checks passed from source inspection.

Use the parent rollback boundary: disable new admission/presentation/reporting while retaining compatible readers and durable history. Do not undo executed effects, erase Timeline/Memory, rewind revisions or downgrade a database past written event versions.

After the implementer, dispatch the scoped formal check and synchronize executable specs. Commit, push and finish/archive remain separately authorized. The next child starts only after the documented prerequisite gate passes.
