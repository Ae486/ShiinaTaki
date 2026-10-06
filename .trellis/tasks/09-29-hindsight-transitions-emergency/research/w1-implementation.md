# W1 implementation: transition protocol and durable owner

Date: 2026-09-29. Workspace: `H:/TakiAgent`, branch `main`, baseline HEAD
`fccfc4fb78958c90efebdb4a5a98b355bcb73a40`. Resumed the interrupted W1 in place under the existing task and explicit
session context `codex_01a0ed15-10d0-7802-90a1-48dc47ee6b41`. The empty legacy task pointer was not used as authority.
W0 changes and migration 051 were preserved. W1 uses the already allocated 052; no duplicate migration was added.

## Delivered scope

- Shared strict direction/identity/intent/attempt/proof/receipt/result/recovery schemas and normalized queued-write
  contracts. Public operation validation applies aggregate transition refinements, including direction and re-entry
  baseline requirements. Existing branch caller IDs remain bounded strings; server replay/target IDs remain UUIDs.
- Migration 052 stores immutable admission, evidence, receipts, original results, queue commands/dispatch identities,
  unknown observations, recovery admissions and resolutions. The attempt is a CAS projection with bounded leases.
  Triggers exclude control-plane and direct manual-sync admission while transition obligations remain open, including
  after the original operation becomes terminal. Existing migration receipts are preserved on upgrade/reopen.
- Existing operation service owns atomic admission, stable request lookup, deferred claim/cancellation, observation,
  explicit recovery and fan-out. Three new kinds share the `memory-transition` exclusive family. Missing driver or
  automatic origin refuses before any operation admission. No actual driver is composed by W1.
- Driver return values cannot independently settle an operation. The adapter observes durable results/resolutions,
  including after a thrown/lost reply; evidence-read failures stay unresolved. Boot observation performs no dispatch.
- UNKNOWN queue outcomes are append-only observations. A later factual result binds the original target request;
  it does not erase the unknown observation or create another effect identity. An explicit new operation claims the
  recovery lease and appends its resolution while preserving original terminal operation/result history.
- Cancelling an unclaimed recovery cancels only that operation; the original fence remains held. Resolutions require
  settled queue entries and source abort/retirement or offline quarantine evidence. Lease expiry alone never releases.
- Desktop received exhaustive read-only operation labels in the interrupted W1; no transition action or confirmation
  flow is exposed. Source indexes and executable backend specs now describe the actual W1 boundary.

## Files owned by W1

| Area | Files |
| --- | --- |
| Shared additions | `packages/shared/src/memory-transition-schema.ts`, `memory-transition-queue-schema.ts`, `memory-transition-schema.test.ts` |
| Shared integration | `memory-operation-schema.ts`, `index.ts`, `index.md` in the same directory |
| Core storage additions | `packages/core/src/db/memory-transition-repo.ts`, `memory-transition-evidence-repo.ts`, `memory-transition-queue-repo.ts`, `memory-transition-recovery-repo.ts`, `memory-transition-fixtures.ts`, `memory-transition-repo.test.ts`, `memory-transition-queue-repo.test.ts` |
| Migration | `packages/core/src/db/migrations/052-memory-transitions.ts`; registry, registry test, historical maintenance/reopen expectations and source indexes |
| Operation additions | `packages/core/src/memory/operations/memory-operation-kind-transition.ts`, `memory-operation-transition-storage.ts`, `memory-operation-kind-transition.test.ts` |
| Operation integration | `memory-operation-contract.ts`, `memory-operation-kinds.ts`, `memory-operation-service.ts`, directory index |
| Desktop compatibility | `apps/desktop/src/windows/home/pages/operations/memory-authority-state.ts` and directory index |
| Specs | `.trellis/spec/backend/memory-transitions.md`, `memory-operations.md`, `index.md` |

Other dirty W0/native/parent ledger and historical-data files were not reset. Some integration files carry both W0
and W1 changes; this inventory does not claim ownership of all their working-tree differences.

## Fresh validation

All Vitest suites ran sequentially with at most two workers. Commands ran from the workspace above against isolated
in-memory or temporary file-backed SQLite fixtures. No historical corpus, user database or native server was touched.

| Command | Result / evidence |
| --- | --- |
| `pnpm --filter @taki/core exec vitest run src/db/memory-transition-repo.test.ts src/db/memory-transition-queue-repo.test.ts src/memory/operations src/db/migrations --maxWorkers=2 --reporter=dot` | **44 files / 234 passed**, exit 0; `w1-core-tests.log` |
| `pnpm --filter @taki/shared exec vitest run --maxWorkers=2 --reporter=dot` | **62 files / 550 passed**, exit 0; `w1-shared-tests.log` |
| `pnpm --filter @taki/desktop exec vitest run src/windows/home/pages/operations --maxWorkers=2 --reporter=dot` | **13 files / 123 passed**, exit 0; `w1-desktop-tests.log` |
| `pnpm typecheck` | **All five packages passed**, exit 0; `w1-typecheck.log` |
| `pnpm lint` | **Passed**, exit 0; `w1-lint.log` |
| `git diff --check` | **Passed**; only existing parent task/deferred-ledger CRLF normalization warnings |
| `python ./.trellis/scripts/task.py validate 09-29-hindsight-transitions-emergency` | **Passed**, 20 implementation entries / 22 check entries |

The resumed baseline's 18 SQLite tests and the initial four new owner tests passed before the broader run. These
overlap the final 234 and must not be added as distinct coverage. The first broader run found four old exclusive-family
tests losing `activeOperationId`: the new catch wrapper rebuilt an existing `MemoryOperationRefusal` using the requested
family instead of preserving the actual conflicting owner. The service now preserves that typed refusal. One new
post-COMMIT test also tried to use a W4 authority reader with a deliberately W1-only publication fixture; the corrected
test proves boot receipt observation and DB exclusion directly. The full 44-file rerun above passed after both changes.

Concrete coverage includes 051 upgrade and second connection/reopen, admission transaction rollback, stale lease and
proof rejection, exact request idempotency, six-family/manual-request exclusion, bounded queue admission and stable
order, authority/receipt rollback, unknown-effect reconciliation under the same target ID, terminal-history immutability,
pre-claim and recovery cancellation, lost producer reply, false unpersisted completion, boot receipt-only observation,
and a new recovery operation resolving the original fence through the existing owner.

## Integration boundaries and remaining gates

1. `MemoryTransitionDriver.plan()` must be side-effect-free and source-backed. Its eventual producer supplies trusted
   actor and current config/Bank proof. W1 compares those facts; it does not create the W3 final source manifest.
2. Native `taki-transition-v1` fields are a required internal proof envelope. W2 must finalize/version and prove the
   actual native writer/fence/delta/maintenance/release protocol before any real driver is made available. The W1 fixture
   certificates, hashes and release receipts are synthetic and certify only storage/ownership behavior.
3. W3 owns complete candidate reconstruction and common-baseline content/mapping evidence. W4 owns the atomic full
   authority/custody publication, runtime readiness, old-reference retirement and actual target receipt recovery.
   W1's receipt insertion must join that outer transaction; it does not perform publication itself.
4. Queue storage currently reserves execution against a committed target receipt. Pre-COMMIT entries can be settled
   with factual refusal/cancellation; executing still-valid commands against the unchanged source needs W4's explicit
   source path. Neither Run closures nor old native mutations may be automatically replayed.
5. W5/W6 must verify release/retirement/quarantine receipts before calling resolution storage, and preserve unresolved
   obligations through failed bindings, foreign history and emergency uncertainty. A lease timeout is never proof.
6. No full Core test suite, standalone Core-process boot, Desktop build, native tests, real authority transition,
   paid model call, original-environment/manual acceptance, commit, push or task archive was performed by W1.
   The release gates in the task plan remain open. Independent W1 checking is the next step.

Default queue limits are explicit conservative server policy (256 intents, 8 MiB total, 256 KiB per intent, 120 seconds),
not values inferred from provider throughput. Adjusting them requires the same bounded protocol and regression checks.
