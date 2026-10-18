# Stage 5B resumed execution and review cadence

The owner approved continuing implementation and delegated review frequency, dimensions and staffing.
This supersedes the earlier B1 stop for the active B task. Complete independent B1 review before B2, then
B2's runtime/policy review before B3's UI/backup integration and final whole-5B review. No C implementation,
original-data/service/model use, dependency addition or Git lifecycle is included in this continuation.

## Verified entry state

The existing session-bound task remains in_progress. Taki main HEAD is
`2e244d0fdee49fb2c582a4333a9ef1573fa9112a`; Native main HEAD is
`eb6413a7f58c4f3f0adb88a33a99516f8707fef7`. Root rechecked 101 Taki/201 Native source identities,
25 released Core files, three Shared consumers and all 906 generated artifacts: zero source changes since
B1 release. The sole evidence difference is the explicitly recorded leader-owned B1 handoff update.

Read `b1-implementation.md`, `b1-composition-implementation.md`, `b1-final-source.json`,
`b1-root-handoff-verification.json` and `review-plan.md`; inspect actual source/tests rather than treating
implementation reports as independent review. Historical failed runs and platform limits remain factual.

## Independent B1 work allocation

- `stage5b_b1_native_check`: Native/Shared contracts, hashing, authenticated read-only snapshots/results,
  atomic mutation, concurrency/replay, definition-only initialization, Sync/Worker claim/result ownership,
  compatibility/generation and the B1 Core compatibility adapters outside template-lifecycle. It may directly
  fix verified findings in those scopes after reading their specs. Shared wire changes require coordination
  with the Core checker before mutation. It owns no Core composition/storage files.
- `stage5b_b1_core_check`: the 25-file Core composition/storage/058/registry slice and its evidence.
  Independently inspect preservation, ownership/enrollment, precise preview/deletion/refresh consequences,
  receipt/current-definition separation, immutable/CAS/default publication and rollback/reopen/migrations.
  It may directly fix verified findings in this assigned scope. Shared contracts and Native source are read-only.
- Both agents are already checkers and must not spawn nested agents. They are not alone in the repositories;
  preserve the other checker's work and all W9/5A/unrelated edits. Root owns task status, acceptance and scheduling.

Source review may run in parallel. Core initially owns the heavy-check slot, then releases it to Native.
Do not overlap heavy tests, builds or generation. Vitest uses at most two workers. Static source reading and
small lint/type checks may be planned around that slot without checking a concurrently mutating interface.
Reuse passing evidence when source identities still match; add focused adversarial regressions for actual
holes/findings rather than repeating every suite. Native PostgreSQL/auth/claim/rollback evidence must use the
existing isolated runner and real fake-provider execution paths. No direct pytest against a real .env.

Each checker writes a distinct `b1-independent-<native|core>-check.md` report with scoped verdict, source findings,
fixes, exact commands/exits, evidence reused, retained failures, changed hashes and fixture/process teardown.
Neither partial verdict accepts whole B1. Root reconciles both reports and any cross-contract changes before B2.

Current independent findings: Native/Shared structural-value and nested Trigger checks diverge; Core receipt
verification admits some revision rollback/payload inconsistency and incorrect original journal deltas.
Both checkers own focused fixes/regressions. Core must continue separating original receipt evidence from
later current-definition proof: legitimate later revision/journal growth remains allowed.
Native retains existing authoritative croniter semantics; Shared does not grow a cron interpreter or a narrower
public grammar. The structural/semantic boundary is now explicit in design.md and review-plan.md.
The Core initially reserved heavy slot may be lent to Native while Core edits; every handoff is explicit.

Core review additionally found stale final-head/upgrade-tail expectations in four existing full-registry tests:
`packages/core/src/db/migrations/041-canonical-memory-maintenance.test.ts`,
`packages/core/src/db/migrations/053-memory-transition-candidates.test.ts`,
`packages/core/src/db/migrations/054-memory-transition-publication.test.ts` and
`packages/core/src/db/migrations/lineage-reopen-matrix.test.ts`. Their test-only fix ownership is transferred
to the Core checker, with scoped failures retained before correction and actual 058 table/reopen verification.
Historical fixed-version cases and all old migration source stay unchanged.

Native review additionally owns the narrow optional task-local provider guard in `engine/llm_wrapper.py`
and a template-provider-guard helper. Reuse actual attempt/concurrency context; recheck each template attempt
after its permit wait, including child tasks, retry/tool-loop attempts and optional non-attempt dispatch.
Keep ordinary requests isolated, reset context after exceptions and retain embedding/final transaction guards.
This does not change retry policy or authorize real provider use. It also owns the three existing B1 receipt,
child and refresh-result tables in `admin/cli.py` backup/FK order and necessary maintenance tests. B3 still owns
the separate paired managed-template equality producer and restore admission.

## Subsequent implementation cadence

B2 is a substantive state-machine and cross-layer milestone, so it has its own independent review. Reuse the
released Native and Core implementers with nonoverlapping file ownership after B1 closes: Native structured-label
producer/invalidation/strict transport and Core durable executor/hold/rollout/runtime/policy consumption.
Freeze new Shared/operation interfaces and migration ownership before concurrent edits. Group small related
adapters and tests into those batches; do not run an independent review after each helper.

B3 starts after B2's gate. Home and paired-backup work may use separate owners once runtime contracts freeze;
the final independent gate covers all B1-B3 behavior, actual operator/WS/UI reconnect paths, physical paired
restore equality, compatibility, generated SDKs, package checks and relevant isolated startup/build evidence.
Review dimensions remain the executable contract in `review-plan.md`. Existing/manual/platform acceptance
is reported separately, and no whole-5B criterion is checked merely from implementation progress.
