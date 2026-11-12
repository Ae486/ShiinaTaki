# Frozen Schema Convergence: Independent Advice

- Date: 2026-11-11. Scope: original PRD/design, persistence reports, exact source and stopped-backup metadata. No migration, service, installation, credential access or Git mutation.
- Workspace checked: `G:/TakiAgent-integration`, branch `integration/main-t4-20261111`; `task.py current --source` resolves this task through the current session.
- Recommendation: recognize the exact frozen historical input, converge its source-phase CHECK with a six-table lossless rebuild, and retain the historical Timeline declaration through local exact variants. No owner-level data mapping choice is presently required. Implementation gates below remain open.

## Independently verified facts

The original PRD requires preserved data/receipts, complete final constraints, unknown-shape refusal and actual COMMIT rollback. The approved design keeps main's canonical 001-063 history and adds guarded 073+ convergence; it does not authorize original-profile rollout.

Compared all 340 frozen non-NULL-SQL schema objects against generated `T4_SCHEMA`, using the runner's token normalization semantics: identical names/types, no missing/extra objects, exactly two differing SQL definitions:

1. `memory_migration_sources.phase` is `TEXT NOT NULL` in the freeze, whereas current 021 adds `CHECK(phase IN ('snapshotted','normalized','staged','verified','failed'))` (`021-memory-legacy-migration.ts:27`; inventory:1432). The source set has **five** values. `activated` belongs to the separate Run phase set at 021:13 and must not be added here. Attempts' unconstrained phase declaration at 021:34 stays unchanged.
2. Timeline uses unquoted `presentation TEXT`, whereas generated T4 SQL uses `"presentation" TEXT` (inventory:1750). Historical 035:10 actually issued the unquoted ALTER; 036:11 supports this ordinary nullable bare-TEXT column. This is evidenced identifier spelling, not an invitation to normalize arbitrary quoted tokens or CHECK/default literals.

Read-only Python SQLite 3.45.3 connection: `file:///G:/taki-t4-freeze-20261110/data/core-profile/taki.db?mode=ro&immutable=1`. Queried only schema/FK metadata, row counts and phase aggregates. SHA-256 before/after equals inventory hash `973f100874a9f80716d71be96e2b8064e0aa7bf6c40d2e60ec02ff5a6304c023`. `PRAGMA foreign_key_check` returned zero violations. Sources contain 718 rows, all `verified`; attempts 718, results 716, exclusions 0, import operations 0. These are frozen-copy facts, not live-profile claims.

## The rebuild closure is six tables

Direct incoming composite FKs from attempts, results, exclusions and `hindsight_import_operations` all target `(run_id,source_id)` with `ON DELETE CASCADE`. There is also a second-level cascade: `hindsight_import_facts` -> `hindsight_import_operations` (`023-hindsight-initial-cutover.ts:69,84`). The complete transitive incoming closure is:

- `memory_migration_sources`
- `memory_migration_attempts`
- `memory_migration_results`
- `memory_migration_exclusions`
- `hindsight_import_operations`
- `hindsight_import_facts`

Metadata establishes no further incoming FK and no referencing view/trigger in this freeze. The only explicit indexes on the closure are `idx_hindsight_import_operations_status` and `idx_hindsight_import_facts_source` (023:73,86); PK/UNIQUE autoindexes must also be recreated through the unchanged declarations. All six tables use ordinary rowids, not AUTOINCREMENT. The outgoing source FK to `memory_migration_runs` remains intact.

**Ordering matters:** generated actual MAIN/UNION schemas also contain incoming `memory_migration_block_plans` and `memory_migration_source_proofs`. The frozen repair must run **before `MAIN_MISSING_SQL`**, while those tables are precisely absent under the input guard. Repairing after main creation requires an eight-table closure instead and is not this minimal path.

Backing up only the parent or only its four direct children is insufficient. Empty native import tables in this particular freeze do not justify omitting facts from a declared reusable branch or its nonempty tests.

## Minimal implementation path

1. Add a frozen constant derived from the complete evidenced 340-object signature, with only those two exact declaration differences. Do not obtain production constants from a profile at runtime. Keep immutable 021/035 exports and all historical receipts unchanged. Avoid a Cartesian family of unobserved phase/Timeline combinations; add only a shape evidenced here or by a separate verified fixture.
2. In its 073 branch, perform the phase repair first, then the existing main-feature creation, in the **same** migration transaction. Add all six closure tables to `replacedTables`, alongside existing actually rebuilt main tables. The runner then refuses unknown incoming FKs on either the parent or any child. Complete branch signatures already protect attached indexes/triggers (`migration-runner.ts:86-116`). Declare backup names absent; never reuse a pre-existing backup object.
3. With FK enforcement still ON, snapshot all six tables using explicit `rowid AS original_rowid` plus every original column. Drop leaf facts first, then import operations and direct children, then sources. Recreate/copy sources first, children/import operations next, facts last. Copy explicit rowids and explicit column lists. Recreate each exact original constraint/index, changing only the source phase CHECK. Do not rename the old parent in place, toggle FK enforcement, use `writable_schema`, cast/remap phases, synthesize identities or reseed clocks. Current checked-copy INSERT must refuse every value outside the five allowed strings and roll back; never drop or relabel invalid rows.
4. Preserve Timeline without a spelling-only rebuild, including seq, presentation/content bytes and `sqlite_sequence`. **073 alone is insufficient:** generated group 074 owns Timeline (56 objects), and 076 owns it again (19 objects). Add precise quoted/unquoted variants for the applicable current/pre-primary Timeline signatures in those guards; phase repair should leave one checked source shape. 075/077 do not own either affected table. Keep the runner's global normalization unchanged (`migration-runner.ts:98-102`). Ensure every branch matches exactly once and explicitly test the state immediately after 073 before continuing.

## Retention versus CHECK convergence

Retaining the exact unchecked historical source shape would avoid the six-table DDL, but leaves weaker durable validation than fresh/current databases and requires permanent recognition of two source constraint regimes. That misses the approved full-constraint convergence contract unless its meaning is explicitly changed. The current values need no mapping, and the precise FK closure is known, so actual CHECK convergence is the supported engineering choice. Its cost is one bounded transactional rebuild and focused failure/preservation tests. Timeline's spelling variants have equal column behavior and can remain narrowly recognized without carrying a second constraint regime.

## Blockers before declaring the database gate passed

- Implement the six-table closure and local 074/076 Timeline variants; verify post-073 and every later restart boundary. The current 073 guard correctly refuses the frozen input and must not be weakened globally to make it pass.
- Test nonempty **every** closure member, including import operations/facts/exclusions, with deliberately nonsequential rowids and exact original payload/digest/timestamp bytes. Assert old migration `(version,applied_at)` rows unchanged, new receipts only 073+, full CHECK/PK/UNIQUE/FK/index definitions, no backup leftovers, zero FK violations and no clock reseeding. After convergence, invalid source phases such as `activated`, an unknown string and case variants must reject; each of the five allowed source values must retain its meaning.
- For this concrete rebuild, inject SQL failure after destructive DDL/copy, receipt rejection and a **real deferred-FK COMMIT failure** after the callback returns. Assert original unchecked SQL, all six tables' rowids/bytes, indexes and old receipts restored; no 073 receipt; same connection usable and file reopen unchanged. Existing examples are `migration-runner.test.ts:277,290` and `sqlite.test.ts:107`; source coverage is evidence of a pattern, not a claim this new migration has passed. Earlier committed migration groups remain committed under the documented per-migration contract.
- Refuse altered phase/default/CHECK declarations, changed child/FK/index definitions, partial groups, unknown attached contracts, unknown external incoming FK/view/trigger on **any of the six** tables, and conflicting backup objects. Invalid phase data must fail without mapping or loss. Distinguish unsupported input from a successful empty result.
- Replay the actual stopped COPY using the production wrapper/registry with snapshots taken before opening, then reopen idempotently. Preserve the original frozen hash and do not launch the copied profile or query credential/config payload. Static/read-only findings in this report establish a repair path; they do not establish migration execution success or real-data rollout acceptance.

No contradictory product semantics or unmappable historical values were found. If the checked copy rejects an unexpected value in a separately evidenced profile, report that concrete value/domain issue and stop that isolated upgrade rather than inventing an owner decision.
