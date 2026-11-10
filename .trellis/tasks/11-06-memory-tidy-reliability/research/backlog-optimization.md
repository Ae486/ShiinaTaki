# Backlog optimization follow-up

Owner authorization: optimize memory tidy and increase the single-batch time limit. Conversation compaction and dated archives remain separate.

## Measured production baseline

Read-only observation on 2026-11-06: 626 active visible memories, 56,820 content characters, median 56 and mean 90.8 characters; 597 pending. The owner's 120-second attempt completed 11 model calls and cancelled the twelfth: 98,910 known input tokens, 22,764 output tokens including 15,521 reasoning tokens, 30 accepted reviews and 35 committed edits. Cancelled-call usage is unknown.

## Decisions

- Default candidate cap 100, initial input target 24,000 estimated tokens including system instructions, actual tool schemas and report. Keep complete records and duplicate groups; report a useful input-budget failure rather than truncating their evidence.
- Default 600,000 ms and 48 model steps per batch, starting at actual queue dispatch. These are configurable safeguards, not a guarantee every provider completes.
- Keep the existing durable operation running across accepted batches. Release and re-enter the existing Utility Slot per batch; account only that batch's usage. No queue framework or schema migration.
- Capture finite pending stable memory identities at the first dispatch. Inspect their latest revisions when each batch starts; after accepting a visible batch, external changes/new memories remain eligible for later maintenance rather than extending this task indefinitely.
- Preserve transactional effects, exact revision checkpoints, accepted finish, unknown-error stops and existing restart semantics. Shutdown aborts the active tidy request and prevents another batch.
- Larger batches amortize block context and index/user-model maintenance. Do not replace this with an evidence-free final global rewrite. Prompt guidance discourages repeated whole-block edits and meaningless reinforcement.

## Required evidence

Backlog larger than one batch completes under one operation; token-driven splitting retains whole duplicate groups; another Utility task runs between batches; each batch owns its limits and usage; external changes retain correct pending coverage; real transport timeout and shutdown cancellation; input-budget error is actionable; config registry/loaders agree. Use an isolated current-data copy for a bounded real-model throughput observation, never mutate the live database during verification.

## Verification and result

- All five package typechecks, root ESLint and Rust Clippy passed.
- Full suites: Shared 727, CLI 50, Desktop 1,368, Core 4,642 passed (Core 6 skipped).
- Final review deltas: 22 focused producer/shutdown tests and 17 card tests passed after the last boundary fixes.
  These focused results are distinct from the full-suite snapshot, not a claim that every full suite was rerun after
  every final change.
- Independent review reproduced and fixed Legacy shutdown cancellation and a departed pending identity extending
  work through concurrent Block changes. See budget-advisor.md and backlog-final-review.md.
- Real Node 24 strip-only boot: both Legacy and Canonical Local reached WS listening with isolated data and dummy
  loopback credentials. Logs: target/memory-tidy-backlog-quality/boot-1793943083818/.
- Eight real browser/WS scenarios passed: target/memory-tidy-reliability-ui-1793942980820/.
- Context manifests and tracked whitespace checks passed. No dependency, framework or new database migration.

## One authorized real-model backlog observation

The earlier read-only baseline was followed by further owner activity: the consistent isolated snapshot used here
contained 567 pending memories. Verification never wrote to the live database.

- Model: existing main fallback, DeepSeek V4 Flash, unchanged model/provider settings.
- Observation: 2026-11-06T05:25:47.779Z to 05:32:25.816Z, 398.037 seconds.
- Accepted batches: 100, 100, 100, 100, 100, 67. All 567 admitted pending memories were checked under one request.
- Final outcome: ran; remaining 0; 172 committed edits; 23 completed model calls; 6 Utility tasks.
- Known usage: 522,103 input tokens; 77,229 output tokens including 50,172 reasoning tokens; no unknown-call usage.
- One revision mismatch was corrected. Two premature finish calls were refused before accepted completion;
  unresolved final issues: 0. SQLite quick_check: ok.
- Private artifacts: target/memory-tidy-backlog-observation-20261106/isolated.db and observation.json.
  Reproduction driver: observe-backlog-tidy.mjs (dedicated copy plus explicit --paid-once authorization).
- The observation started before the final Legacy/departed-candidate boundary fixes; those were independently
  reproduced and verified by focused tests. No repeated paid run was used to manufacture a green result.

This demonstrates backlog execution and recovery for the observed corpus, not universal semantic accuracy or owner
manual acceptance. Initial input pricing is estimated; later tool history/output still depends on the provider.
Ten minutes is a per-batch safeguard, not a completion guarantee for a stalled provider. Queue fairness is at batch
boundaries; active tidy shutdown is cooperatively cancellable. Dated archives and conversation-compaction changes
remain outside this follow-up. Task stays active; no commit, push, archive or production release was performed.
