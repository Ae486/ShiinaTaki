# Maintenance Monitor follow-up

Owner request: expose memory tidy and conversation compaction in Run Monitor as separate background chains. Their
model calls must not contribute to normal cache rate, latest-primary input occupancy or normal Run aggregates.

## Contracts

- Reuse memory_operations(kind=tidy), conversation_compaction_operations/events and auxiliary_model_calls. Do not
  create synthetic Runs, replay work on read, or infer associations from nearby timestamps.
- Add immutable optional operation correlation to future auxiliary calls, captured at the actual model boundary.
  One tidy operation includes all of its Utility batches; compaction retries retain their own operation identity.
  Older unlinked calls remain unknown. Never use tidy outcome.usage as operation usage: it is process cumulative.
- Add an operator-only bounded background snapshot/subscription in Monitor with separate list and selected call
  details. Use first immutable compaction started-event time for stable pagination; its mutable attempt start is not
  a cursor. UI follows existing mode, reconnect and hidden-page rules and does not poll.
- Exclude utility labels tidy/compact from the normal cache population only. Preserve other existing contributions,
  successful primary-summary reset semantics, actual spending records and latest-primary request attribution.
- Migration 068 adds call association and explicitly versions/rebuilds derived cache baselines. Historical population
  reconstruction uses strict-before timestamps and the current cache-presence pairing rule. Included same-time/null
  completion is unavailable until a new summary; excluded maintenance ties do not contaminate the normal window.
- Background details show actual lifecycle/progress and model-call input/output usage. No raw prompts, content,
  invented tools, fabricated compression rate or inferred context occupancy. beforeTokens and outputChars have
  different units and cannot form a compression ratio.

## Validation

Mixed normal/tidy/compact calls must leave normal ratios and latest-primary occupancy unchanged; weighted pairing,
same-ms/reset/rollback/reopen and migration history tests remain. Exercise actual owner -> Utility -> SDK -> SQLite
association, queued multi-batch continuity, failed/interrupted operations, bounded pagination, post-commit push,
hidden/reconnect/mode-disable behavior and rendered Monitor tabs/details. No paid model is needed for this follow-up.

Implementation is in progress. No live database mutation, deployment, commit, push or archive is requested.
