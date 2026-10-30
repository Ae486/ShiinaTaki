# C3 deterministic wake policy implementation

Date: 2026-09-28. Workspace: `H:/TakiAgent-worktrees/t4`, branch `task/t4-skills-mcp-productization`.

## Delivered responsibility

The new `packages/core/src/initiative/wake/` adapter matches the seven approved condition atoms and sends one
bounded compatible selection to the existing C1 `InitiativeRuntime`. It does not create another Agent loop,
Character mutex, execution ledger, model charge writer, delivery queue or Intention service.

- `wake-contract.ts`: exact composition ports and captured source/Pattern selections.
- `wake-clock.ts`: User Timezone windows, opening-day attribution across midnight, repeated DST hour identity,
  actual closing instants and quiet hours. Small bounded caches avoid constructing an Intl formatter per sample.
- `wake-matcher.ts`: supported conditions, actual accepted evidence, stable occurrence/revision chance,
  complete conjunct validity and known completion provenance.
- `wake-policy-repo.ts`: source occurrence tombstones, canonical Run idempotency reconciliation, Pattern judgment
  cooldown reads and bounded policy diagnostics.
- `wake-budget.ts`: read-only early gates over C1's actual model reservations/charges and delivery charges.
- `wake-eligibility.ts`: current Pattern, target, policy, primary, timezone and Sampling fences, including optional
  accepted observation context. C1 remains the final transactional quota authority.
- `wake-engine.ts`: one pending selection, independent bounded busy deadline, at most four compatible candidates,
  unref/coalesced timer, source invalidation and existing-Run delivery resume.

Shared adds strict source envelopes and `InitiativeWakePolicyStatusSchema`, read/change contracts and method names.
`initiative-wake-config.ts` provides the validated effective scalar settings. Migration 053 adds only source claims,
bounded diagnostic rows and daily reason counters; existing Run/Effect/Timeline schemas and receipts are untouched.

## Composition contract

`createInitiativeWakeEngine(deps)` returns `start()`, `notify('source' | 'policy' | 'release')`,
`evaluate(): Promise<void>`, `read(characterId): InitiativeWakePolicyStatus`, and `close(): Promise<void>`.

`deps` receives the existing database, `patterns.listActive`, `snapshot`, `policy`, `wakePolicy`,
`prepareContext`, `runtime`, read-only `busy`, optional `contextIsCurrent`, `invalidate`, `onChanged`, `onError` and injected `now`.
The exact types are in `wake-contract.ts`.

Root integration owns Shared exports, migration/config registry entries, thin-context construction, actual source
composition, method/subscription registration, and final process/E2E evidence. The Pattern/source owner supplies
accepted Perception and direct-input-return producers. No wire report or aggregate-presence heuristic is a substitute.

Important integration details:

1. `foreground.meaningful` is false for the first sample after source/start/privacy/gap retirement. Stable occurrence
   identity comes from the accepted continuous source owner, never a timer tick or application label alone.
2. A return requires current real input after at least ten minutes of known inactivity on the same continuous source.
   `presence === 'present'` alone is only a condition filter and creates no candidate.
3. Completion facts must identify an actual current successful relevant scheduled/subagent/webhook Run. Heartbeat,
   primary, maintenance and already published Class A completion cascades are refused.
4. Optional accepted activity/screen context is only included when the captured accepted foreground source is fresh
   and unpaused. The context manifest expiry must be no later than that sample's `observedAt + 60_000`.
5. `invalidate(characterId)` must target owned Heartbeat work; it cannot indiscriminately cancel a primary Run.
6. C1 already holds the Character lane while it calls `deliveryGate`; the gate cannot classify its own Run as busy.
   A new primary arrival invalidates the captured `primaryVersion` instead.
7. The independent busy deadline is at most 90 seconds and never slides. It does not become a timer that interrupts
   an admitted model/tool chain. Selection validity is bounded by source/Pattern expiry and the configured output TTL.
8. Root must enforce admitted Pattern `allowedOutcomes` in the actual C1 decision validator, not only in prompt text.
9. `contextIsCurrent(selection)` retains the thin-input assembler's original Memory authority binding before the
   separate C1 admission capture. Every retained opportunity/delivery validity check consults that same callback.

## Accounting and recovery

Before context/model work, the adapter reads the actual C1 model-capacity and utterance-charge tables. Model cadence
and jitter are stable from the last charged canonical opportunity. Target/timezone changes never reset counters.
The daily utterance gate preserves C1's conservative original-zone/24-hour carry, including long DST civil days.

A source occurrence is claimed before asynchronous preparation. Canonical admission uses the exact existing
`initiative:sha256(characterId + '\n' + opportunityId)` identity. Settle and startup reconciliation query that key
in `runs`, closing the claim/admit/link crash cuts without a second Run. An unlinked lost process-local context
becomes a minimal retired source tombstone and is not recaptured. No charge is invented for such a refusal.

Diagnostics retain at most 100 recent dispositions per target. Repeated unchanged dispositions coalesce; counters
therefore count policy transitions, not timer evaluations. Seven UTC calendar buckets, including today, are retained;
the response's `since` exposes their actual UTC midnight boundary. These are pre-admission producer facts and never
become fake Runs. Both synchronous/asynchronous observer failures and failures of the diagnostic error reporter
are isolated from admission.

## Validation

- `pnpm --filter @taki/shared exec vitest run src/initiative-wake-schema.test.ts`: 3 tests passed.
- `pnpm --filter @taki/core exec vitest run src/initiative/wake src/db/migrations/053-initiative-wake-policy.test.ts`:
  34 tests passed in the final combined regression run, 3 wake/migration test files.
- Scoped ESLint for all added wake/config/Shared/migration source and tests: passed.
- Shared and Core typechecks: passed; Core passed again after the scoped implementation was complete.
- Scoped `git diff --check`: passed for tracked changes; new source files were additionally covered by scoped ESLint.

Tests cover two data-only behaviors through the same matcher; real C1 Run/Effect model charging and silence;
compatible max-four selection; missing/stale/null/quiet/busy/privacy/budget/chance zero-model paths; real versus unknown
returns; completion-cascade exclusion; stable chance/source identity; finite busy deadlines; Pattern cooldown across
revision changes; canonical admission crash cuts; actual file-backed reopen and tombstones; additive migration
rollback; cross-target/timezone model and utterance budget preservation; observer isolation; bounded diagnostics;
and timer coalescing/no sleep catch-up backlog.

The currentness fence follows the accepted effective revision and runnable state. Creating a separate unconfirmed
candidate can increment Pattern CAS version without invalidating its unchanged active rule; a regression covers this.

## Provider-neutral selected Memory capture

Production `CapturedMemoryRun` now exposes the compatible optional
`assembleInitiative({ global: boolean, character: boolean }): { text, sources }` seam. Its types and pure assembly
implementation live in `memory/initiative-memory-assembly.ts`.

- Canonical Local and Hindsight capture Global/Character sections through their existing structured Block renderers
  and actual Bank references. The new assembly path never creates a Bank or changes its authority.
- Legacy captures the same existing Block store using registry ownership. Its existing retirement fence applies
  both while capturing the closure and when a previously captured closure is invoked.
- Stable assistant layer and Character Persona are always included intact. Only selected approved Memory Blocks/index
  are added. Pinned/relationship rows, the Legacy Intention picker and automatic Recall are not called by this method.
- Source identities are internal and each revision is the digest of the actual selected rendered content. Missing
  sections produce no fabricated source. Existing owning Block budgets are preserved, and the final instructions
  obey the existing 32,000-character Shared bound by refusal rather than Persona truncation.
- Provider/authority, original Hindsight endpoint/Bank routes, Legacy retirement and runtime shutdown remain current
  through all wrappers. Primary/default `assemble(currentMessage)` behavior is unchanged.

Changed owning modules: `canonical-memory-run.ts`, `canonical-local-runtime.ts`, `assembler.ts`, `memory-engine.ts`,
`runtime-composition.ts`, `hindsight/hindsight-memory-runtime.ts`, `hindsight/hindsight-runtime-consumers.ts`,
`legacy-migration/fenced-memory-engine.ts`, their directory indexes and the selected-initiative section in
`.trellis/spec/backend/canonical-local-memory-runtime.md`.

Additional validation:

- Combined wake/migration and Memory assembly/capture/production composition command: **106 passed across 9 files**.
- `legacy-migration/fenced-memory-engine.test.ts` additionally passed **4 tests**, including captured-assembly
  retirement. Its companion final Wake engine rerun also passed, for **26 tests across those 2 files**.
- Scope matrix tests exercise neither, Global only, Character only and both for Local, Legacy and Hindsight; preserve
  exact Persona, exclude other Character content, freeze revisions, leave missing data absent, refuse authority/endpoint
  drift and shutdown, preserve primary assembly, and prove no assembly-triggered provider or Utility-model calls.
- Scoped Memory/Wake ESLint and Core typecheck passed. Scoped tracked-file whitespace check passed.

## Remaining integration and acceptance boundary

This report does not claim native source, complete Skill/authoring UI, real provider, Monitor process trace or owner
acceptance. Root must run the combined C3 process/E2E and package checks after integrating all concurrent owners.
The Intention port is intentionally empty in C3; C4 must supply its real authority/claim lifecycle before use.
No external model, real user database, new dependency, commit, push, reset, rebase or archive was used.

## Context/queue/outcome integration follow-up

The delegated production context builder now uses `core/time.renderWallClock` with captured User Timezone and
reports only actual included sources. Accepted optional Activity/screen fragments are frozen before the awaited
Memory capture; missing screen text does not fabricate an observation source or shorten validity. Matched source
occurrences and explicit Presence projection content are represented in the manifest alongside Pattern/Memory/time.

The builder exposes `prepare`, `isCurrent`, `cancel(characterId)` and `close`. Its Memory capture port receives the
existing optional `AbortSignal`. The original source/context deadline bounds preparation; cancellation and close
settle even when an injected port ignores abort, and late completion cannot replace a retired captured bundle.
Root composition forwards the signal, calls cancel on invalidation and closes the builder before waiting on wake
shutdown. A captured bundle without an affirmative current-authority check is refused.

TurnQueue now publishes true availability when an unready primary reservation is cancelled through its original
AbortController. It does not report a false gap during handoff or preempt a running owner. Repeated primary acquire
returns one wrapped release; duplicate release/cancel cannot multiply notifications. Async and sync availability
observer failures are isolated from lane state.

The C1 outcome integration is covered by real Run/Effect tests: each selected Pattern must allow the requested
outcome; an unselected restrictive Pattern cannot veto another selected Pattern; explicit silence remains valid;
a denied outcome leaves the decision missing/failing instead of becoming successful silence. Collector-level tests
also prove a refused control does not stop the model loop and a later valid silence can settle.

`wake.notify` remains inert until `start`, including policy/release notifications during boot/recovery. Explicit
`evaluate` stays available as the isolated test seam.

Follow-up validation:

- Context builder + queue availability/base queue + response collector + C1 runtime: **46 passed across 5 files**.
- Latest standalone Wake engine regression: **23 passed**, including the explicit startup barrier.
- Scoped ESLint for all follow-up source/tests passed.
- The latest follow-up Core typecheck passed after concurrent integration fixes.
- Scoped tracked-file whitespace checks passed. Full repository/process gates remain root-owned.
