# Stage 1 execution plan

Follow [design.md](design.md) exactly; requirements and acceptance in [prd.md](prd.md); seams in
[research/stage1-seams.md](research/stage1-seams.md). Two internal waves, one implementer run, one final formal check.

## Wave A — Shared + Core (backend)

1. [x] Shared: `memory-operation-schema.ts`, `memory-authority-status-schema.ts` (+ tests), add
       `HINDSIGHT_SETUP_INTERRUPTED` to `HindsightErrorCodeSchema`, named re-exports in `index.ts`, `index.md`.
2. [x] Core db: migration `048-memory-operations.ts` (+ test), `index-list.ts`, `migrations/index.md`, lineage/reopen
       tests updated; `memory-operation-repo.ts` (+ test); `cancelManual` on the scheduler repo (+ test);
       `db/index.md`.
3. [x] Core setup fixes: `hindsight-setup-recovery.ts` (+ test) called from `composeHindsightSetup`; failed validate
       clears `compatibility` (+ test); error-code table entry; existing setup tests must stay unchanged and green.
4. [x] Core operation owner: `memory/operations/{memory-operation-kinds,memory-operation-kind-setup,memory-operation-kind-replica,memory-operation-service,memory-authority-status}.ts`
       (+ tests, `index.md`); scheduler `started()` + `cancelManual()`; `runtime-composition.ts` `operations()` live
       accessor (+ test in `runtime-composition.test.ts`).
5. [x] Core server: `memory-operation-subscriptions.ts`, `methods/memory-operation-methods.ts`,
       `methods/memory-authority-status.ts` (+ tests), `methods/index.md`, `main.ts` wiring and shutdown order.
6. [x] Validation A: Shared 512 passed, Core 3084 passed, `pnpm typecheck` 5/5, `pnpm lint` clean (2026-09-19).

## Wave B — Home minimal slice

7. [x] `lib/ws-client-memory-operations.ts` + route for `memory.operations.changed` (+ tests), `lib/index.md`.
8. [x] `pages/operations/{memory-authority-state,memory-operations-controller,use-memory-operations,memory-authority-card}`
       (+ tests, `memory-authority-fixtures.ts`), mounted above the existing cards in `operations-page.tsx`,
       `pages/operations/index.md`.
9. [x] Validation B: desktop 565 passed (106 files), `pnpm typecheck` 5/5, `pnpm lint` clean (2026-09-19).

## Wave C — integration evidence and closeout

10. [x] Isolated Core boot (2026-09-19): `TAKI_WS_PORT=18974 TAKI_DATA_DIR=<tmp> node --import <sigint-driver> --env-file-if-exists=../../.env.local src/main.ts`
        — migrations applied 1..48, `ws server listening` on 127.0.0.1:18974, `shutting down` on SIGINT, exit code 0,
        port free afterwards; temp dir and driver removed. (Windows delivers no shell SIGINT to node, so the throwaway
        `--import` driver raised `process.emit("SIGINT")` after 20 s — the same handler path as Ctrl+C.)
11. [x] `git diff --check` clean; every new production file carries INPUT/OUTPUT/POS and an `index.md` line; all new
        files <= 153 lines; `ws-client-routes.ts` (307) and `ws-client.ts` (301) sit just over the 300 baseline and under
        the 360 threshold after their helper extractions; `main.ts` (550) and `shared/index.ts` (493) were already
        over/near their limits at HEAD and grew only by the wiring/re-exports this task requires.
12. [ ] Formal `trellis-check` (single, full scope) -> fixes -> re-run affected suites.
13. [ ] `trellis-update-spec`: new `.trellis/spec/backend/memory-operations.md` (contract + matrix), Home card note in
        `frontend/home-window.md`, backend/frontend spec indexes.
14. [ ] Task notes: matrix entries moved (A17, A21, A30, A32, A34; A31 status-only), open items (A16 unwired, claimed-run
        cancel, Stage 2+ scope). Commit (Conventional Commits, scopes `shared`/`core`/`ui`/`docs`), then
        `task.py finish` + `archive` per the owner's 2026-09-19 authorization.

## Validation commands

```bash
pnpm typecheck && pnpm lint
cd packages/shared && npx vitest run
cd packages/core && npx vitest run
cd apps/desktop && npx vitest run
git diff --check
```

## Review gates and rollback points

- Gate 1 after step 6: Wave A green before any Home code. Rollback: revert Wave A files; migration 048 unreferenced.
- Gate 2 after step 9: Home tests green. Rollback: drop Wave B files and the page mount.
- Gate 3 after step 12: formal check pass (or pass-with-fixes recorded). Rollback: fix forward; no partial commit.

## Deviations (recorded by the implementer, 2026-09-19)

- **`MEMORY_OPERATION_REFUSED` added to `ErrorCodeSchema`** (design §4 allowed one code if no better fit). `HINDSIGHT_REFUSED`
  carries `retryable`/`nextAction` semantics that do not apply to operation refusals; the new code rides the closed
  `MemoryOperationRefusalReason` in `error.data.reason` and `activeOperationId` for a busy family. No Rust mirror exists
  for `ErrorCode` (verified: no `.rs` references any operator-only code).
- **Refusal reason `MEMORY_OPERATION_SETTLED` added** beside NOT_FOUND/BUSY/RUNNING/UNSUPPORTED (+ `BANK_UNKNOWN` for the
  design's "INVALID_PARAMS-class" unknown-Bank case). Cancelling a terminal row is neither "running" nor "not found";
  reusing `RUNNING` there would be untruthful.
- **Producer ref is persisted at admission**, not at the running transition. `cancel`/`observe` for `replica.sync` need
  `admittedAt` while the row is still `admitted`; the design's "producerRef(request, ctx)" is therefore `admit()`.
- **`replica.sync` stays `admitted` until the scheduler's claim is observed**; `running` is derived on the next
  `status`/`list` read (or the row settles directly when the awaited tick already finished the run). The service marks
  `running` eagerly only for setup kinds. Reason: the acceptance case "cancel an admitted replica.sync" requires the row
  to remain cancellable until the claim, and B5 exposes no claim callback.
- **`execute()` may resolve `null`** (producer not settled: run still claimed or manual request unclaimed with no
  supervisor error). The row stays open and `observe()` classifies later reads, per design §3 step 3. A row nobody reads
  again becomes `outcome_unknown` on the next boot.
- **Claim detection uses `lastAttemptAt >= admittedAt`** (same-millisecond collisions with a previous attempt resolve
  toward "claimed", which then reports the Bank's current persisted diagnostic — never a fabricated success).
- **Service `stop()` does not abort producers** (neither `HindsightSetupService` nor the scheduler accepts a signal); it
  awaits in-flight settlements. `main.ts` therefore stops the memory runtime first (that settles the scheduler tick an
  operation awaits), then `memoryOperations.stop()`, then `server.close()`.
- **`countPendingHindsightMemoryWrites(db, ref)`** was added to `hindsight-memory-write-repo.ts` as a count-only read
  instead of calling `HindsightMemoryWriteRepo.pending` (which decodes every job and requires the activity guard).
- **`MemoryOperationService.recent(limit)`** added so the composite status can read terminal rows without going through
  `list()`'s combined slicing.
- Test-only doubles live in `memory/operations/memory-operation-fixtures.ts` (same convention as the other `*-fixtures.ts`
  modules; header marks it not in the production path).
- **Home slice split into four files instead of three**: `memory-operations-controller.ts` (framework-free, MCP-controller
  shape: generation guard, serialized submit/cancel, one changed-push subscription per client, coalesced refetch) sits
  between `use-memory-operations.ts` (React state glue only) and `memory-authority-state.ts` (pure view model). Reason:
  the hook rules keep the authority guard node-testable without React; `memory-authority-fixtures.ts` is test support.
- **Home `ws-client` helpers extracted, no behavior change**: `installFanOutRoutes` (config/monitor/memory-operation
  pushes) and `pushRegistrations` (the `onX` sink registrations) were split out of `installRoutes` / `createWsClient`
  because adding the memory-operation route pushed both over the 50-line function limit.
- **The card offers Retry as `replica.sync` with the Bank's `retryKind`** (falls back to `incremental` when the Bank
  reports `explicit_retry_required` without a kind) and Cancel only for an `admitted` `replica.sync`; setup
  validate/apply stay reachable through `memory.hindsight.*` only (Stage 1 card scope).

## Check findings and fixes (2026-09-19)

Formal `trellis-check` over the full uncommitted tree (verdict: pass-with-fixes). Fixes applied directly:

1. **`memory/operations/memory-operation-kind-replica.ts` — classification could adopt a run that was already in flight
   at admission.** `observe()` marked the row `running` and `classify()` could settle it (even `completed`) from a
   previous run whose claim time equalled `admittedAt` to the millisecond, while this operation's manual request was
   still queued. Fix: a non-null `pendingManualKind` now proves the request is unclaimed (claim consumes it and this
   owner is the only `requestManual` producer), so the row stays open (or fails on the supervisor code) until the
   scheduler actually claims it; `running` additionally requires `pendingManualKind === null`. Deviation 6's claim
   "never a fabricated success" now holds.
2. **`memory/operations/memory-operation-fixtures.ts`** — the fake scheduler kept `pendingManualKind` after a failed
   manual-mode run; the real repo clears it at claim regardless of mode. Aligned so the doubles cannot hide item 1.
3. **New `memory/operations/memory-operation-kind-replica.test.ts`** — real B5 scheduler + repos on temporary SQLite
   (only the data-plane runner is injected): the common path settles through the `changed` push right after
   `submit` + one awaited tick with no later `status` read; a run in flight at admission (same millisecond) is never
   reported as this operation's outcome and its Cancel is refused while the Bank is busy; cancel-before-claim with a
   drain held by another Bank clears the durable request and the scheduler never runs it; a drain that throws before
   the claim settles `failed` with the supervisor code. The second test fails against the pre-fix classifier.
4. **`apps/desktop/src/lib/rpc-deadline.ts`** — `memory.authority.status`, `memory.operations.status` and
   `memory.operations.list` were unlisted and therefore fell into the "interactive mutation / outcome unknown" deadline
   class, so a read timeout would have claimed an unknown outcome (`operator-connection-recovery.md` §3). Registered as
   `INTERACTIVE_READ`; submit/cancel/subscribe stay the default mutation class. Policy test extended.
5. **`pages/operations/memory-authority-fixtures.ts`** — the shared setup fixture (`phase: "configured"`, no Banks, no
   compatibility) was rejected by the strict `HindsightSetupSnapshotSchema`; the PRD requires schema-validated fixtures.
   Changed to `compatible`; `memory-authority-state.test.ts` now parses every fixture through
   `MemoryAuthorityStatusSchema` / `MemoryOperationSchema`, and `memory-authority-card.test.tsx` renders the
   unavailable-runtime state (the fifth PRD card state was untested).
6. **`pages/operations/memory-authority-state.ts`** — removed the unused `operationStateLabel` export.
7. **`pages/operations/memory-operations-controller.ts`** — reworded a comment that described the fallback as
   "polling"; nothing polls (reactive-read-models.md §c).

No `main.ts`, boot composition or migration change: the step-10 boot smoke stands.

## Constraints restated for the implementer

- No second scheduler/recovery loop; no UI-written checkpoints; no authority marker writes; no live Hindsight/LLM
  calls in tests; no original user data; no push; no changes to B4/B5 executor semantics beyond `cancelManual` and
  `started()`.
- Unknown stays unknown in every projection; never fabricate `0 pending`, health, lag or completion.
- External library APIs (zod 4, vitest 4, React 19, json-rpc-2.0) are used exactly as the neighboring code uses them;
  do not code from memory when unsure — read the installed types.
