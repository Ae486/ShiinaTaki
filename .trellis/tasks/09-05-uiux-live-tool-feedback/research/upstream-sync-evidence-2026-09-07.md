# Checked upstream integration before live feedback

The T4 branch integrates checked main `c3f8bc4d0c061f67ac998cac0cd1b95a3e91f7fb` on top of
D68 delivery `1f76ce966663ea700a37cc9f73131655b674edd0`. This removes the source prerequisite
for the approved Chat/Pet implementation. The merge commit containing this record is the integration
checkpoint; use its Git parents rather than an inferred current-main hash.

## Preserved contracts

- Incoming Memory Replica Waves 0-2 are the already checked offline implementation. Their 67
  non-overlapping paths retain the exact incoming blobs; this integration does not activate Memory,
  change authority, replay Pending Memory, or certify real-provider behavior.
- The governed wrapper retains D68's shared closed outcome classifier and exact captured invocation
  behavior. Main's redundant local classifier/import were removed; nested Memory cancellation and
  unknown-outcome cases from main remain covered. No execution input, policy, Approval binding,
  Effect ownership or once-only dispatch behavior changed.
- The Core governance tests retain both branches' cases. Shared's 979 named re-exports are the exact
  union of both branches, without a missing source/type binding or duplicate entry. Folder/spec
  indexes preserve D68's presentation-only boundary and add the Memory modules.
- Migrations 001-032 are unchanged. Incoming 033/034 and the registry remain identical to checked
  main, with contiguous unique versions 1-34. The next nullable Timeline presentation migration must
  be allocated after 034; committed migration history must not be renumbered.

One independent `gpt-6-astra/xhigh` review covered the five conflict/intersection seams and found
no remaining blocker. Its read-only source review is distinct from the root-owned execution gates.
The report is retained at `target/uiux-upstream-sync-20260907/merge-review.md`.

## Merged-tree verification

All commands ran in `H:/TakiAgent-worktrees/t4`. Evidence is retained in
`target/uiux-upstream-sync-20260907/`.

| Gate | Result | Evidence |
| --- | --- | --- |
| Shared full suite | 45 files; 433 passed | `shared-full.log` |
| Core focused governance/Memory/migration suite | 8 files; 77 passed | `core-focused.log` |
| Core full suite | 306 files; 2,036 passed, one existing conditional skip | `core-full.log` |
| Desktop full suite | 120 files; 690 passed, including 10 external Lab tests | `desktop-full.log` |
| CLI full suite | 8 files; 50 passed | `cli-full.log` |
| Workspace TypeCheck | All five projects passed | `workspace-typecheck.log` |
| Root lint | Passed; one existing unused-disable warning in `run-repo.ts:6` | `workspace-lint.log` |
| Desktop build | Passed; existing large Pet chunk advisory | `desktop-build.log` |
| Native Core startup/storage/reopen | All three modes passed; zero provider requests; graceful exit 0 | `core-boot.log`, `core-boot-result.json` |
| Whitespace / merge paths | Passed; no unmerged paths | Git readback and independent review |

The native Node 24.18.0 harness starts the actual Core entry in `DISABLED`, `FEEDBACK_ONLY` and
`FULL_LOCAL`, each with a unique local data directory/port and an explicit minimal environment. It
authenticates an operator, verifies the mode contract and empty Monitor list, and checks the disabled
trajectory refusal. A local provider sentinel received no request. Each database contains migrations
1-34 and both scheduler/cache tables, preserves `legacy-markdown` with a null active authority epoch,
and reopens idempotently through the production database wrapper. All three children exited without
forced termination; subsequent process/listener checks found no remaining owned Core process or port.

All 43 previously protected foreign files retain their byte hashes. Avatar Lab, OpenBiliClaw,
Desktop lab configuration, unrelated task metadata, the exported conversation and D71-D74 document
changes remain outside scoped staging. No main/Hindsight worktree, real database or provider was used.

## Limits and next step

This gate validates the semantic merge and downstream compatibility. D68's earlier real WebView2
24/24 acceptance remains separately dated evidence; no new owner inspection, native Rust/Host
acceptance or real Memory-provider acceptance is claimed. Activate the existing live-feedback child
only after the checked local merge commit, then implement its reviewed L1-L3 plan and combined gate.
