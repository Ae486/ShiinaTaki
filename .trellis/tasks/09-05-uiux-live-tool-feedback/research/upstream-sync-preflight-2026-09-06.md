# Upstream synchronization before live feedback

Main inspected local Git on 2026-09-06 while D68-B's independent review was active. This is a bounded
integration prerequisite; it does not activate the live-feedback child or claim that synchronization
has completed. Re-read current HEAD/main and the migration registry before implementation.

## Verified upstream checkpoint

`main` at `c3f8bc4` contains three commits missing from T4 at `9704d5c`:

- `69ca779` — checked offline Memory Replica Waves 0-2 implementation.
- `e5d1bb5` — Memory task/document checkpoint and archive records.
- `c3f8bc4` — session record for that checkpoint.

The upstream execution record is
`.trellis/tasks/08-09-memory-replica-sync-recovery/research/waves-0-2-execution-record-2026-09-06.md`
on `main`. It records Shared/Core/full TS verification and an isolated Core boot through migration 034.
These are upstream-reported results; the merged T4 tree still needs its own verification. B5 remains
in progress; Pending Memory, runtime wiring, real-provider activation and live acceptance remain gated.
Synchronizing these commits must not activate a provider, change Memory authority, or run paid calls.

## Integration contracts

| Overlap | Required resolution |
|---|---|
| `governance/governed-tool.ts` | Upstream recognizes canonical nested `error.code` with `MemoryErrorCodeSchema`. D68's review introduces the shared closed outcome classifier for both observations and Effects. Retain that classifier and its payload-exclusion tests, while preserving upstream nested Memory unknown/cancelled behavior. Do not restore the arbitrary top-level code-copy fallback. |
| Shared public entry and source indexes | Keep both Memory result/replica exports and D68 observability exports; preserve both sets of module index entries. |
| Database guidelines | Keep upstream's Memory Replica specification link and D68's prohibition on technical metadata in user-facing Inspector/tooltip/copy/accessibility surfaces. |
| Migration registry | Upstream adds 033 replica sync and 034 replica scheduler. Live feedback appends its nullable Timeline presentation migration after the verified latest migration; do not reuse 033 or 034 or renumber committed history. |
| Memory result schemas | Preserve pending and valid zero-result retain receipts, superseded/not-found mutations and bounded per-Bank progress. Live feedback only projects tool invocation/language facts; it creates no Memory activation or replay authority. |

## Execution and evidence

1. Complete and commit checked D68-B changes first. Keep Avatar Lab, OpenBiliClaw, Desktop lab config,
   unrelated task files and all other contributors' edits outside scoped staging.
2. Verify the latest main drift, then merge the checked upstream commits into the T4 branch. Resolve
   the named overlap semantically, retaining the tests and contracts from both branches. Never edit
   the main or Hindsight worktrees, reset/rebase, or discard dirty unrelated work.
3. Run the focused Memory/governance/schema/migration regressions, T4 package/type/lint gates justified
   by the merged changes, and a real isolated Core boot/reopen through the current migration. Use
   unique local data/ports and a provider sentinel; no production data or authority activation.
4. Record the resulting commit and verification before activating live feedback. Its implementation
   starts from that merged source and reuses the checked D68 invocation/outcome bridge.

No upstream production file was copied or changed while writing this preflight.
