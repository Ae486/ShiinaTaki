# Slice 4 formal check evidence

## Status

The Slice 4 boundary is implementation-complete for the provider-neutral Core contract and passes the focused/full
quality gates listed below. This check does not claim provider-specific status/replay integration that is not present in
the current branch.

## Findings fixed

- Added additive migration 028 Run budget limit/usage columns and atomic budget reservation at each target Effect intent.
  Dispatch and settlement now fail closed with bounded `budget_exceeded` evidence; no negative or fabricated usage is
  reported.
- Added durable deadline settlement enforcement and typed `run.deadline_exceeded` / `run.budget_exceeded` events.
- Recovery terminal paths now first persist a `recovery.classified` event with the boot process generation, then settle
  through the existing Run CAS boundary. Repeated scans refresh the generation marker without duplicate evidence.
- Recovery now settles expired/exhausted Runs with unfinished effects as `outcome_unknown` when an effect may already have
  started, and as bounded deadline/budget terminal outcomes only when no uncertain effect intent exists.
- Queue listing now fetches one look-ahead row for correct cursor pagination and clamps age to the shared bound.
- Recovery live publication is observer-isolated.
- Shutdown seals admission, durably requests cancellation for all queued/nonterminal Runs, aborts active turns, waits on
  a bounded TurnRegistry drain, and only then closes WS/MCP/SQLite.

## Deliberate boundaries / residuals

- No provider/Host/MCP/Memory recovery adapters are registered in `main.ts`. The coordinator requires both stored and
  current replay declarations and treats a missing adapter as reconciliation-required; it never replays unsafe work.
  Provider-specific status/replay adapters remain downstream work and are not silently claimed by this slice.
- A queued chat Run stores redaction-safe snapshot/provenance, not a raw prompt. After restart it remains durable and
  cancellable/inspectable; automatic model resume requires a future bounded payload-reference provider. This avoids
  creating a second transcript or persisting prompt content in canonical Run state.
- Core has no claim of cross-repository Memory receipt atomicity; unfinished Memory effects remain reconciliation-required
  or `outcome_unknown` according to the existing Effect contract.

## Verification

- Shared typecheck: pass.
- Core typecheck: pass.
- Root lint: pass.
- Shared full tests: 36 files, 342 passed.
- Core full tests: 270 files, 1,713 passed, 1 skipped.
- Focused Slice 4 Core tests: 6 files, 41 passed.
- Migration lineage/reopen tests: pass; fresh and historical lineages converge through migration 028.
- Task context validation: pass (`implement.jsonl` 12 entries, `check.jsonl` 10 entries).
- `git diff --check`: pass (only existing CRLF normalization warnings).
