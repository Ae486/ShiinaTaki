# Approved tidy repair and resumed cost investigation

The owner approved repairing Memory tidy, verifying it, then resuming the original cache/token investigation with new
and old real conversations. The session task remains this directory; HEAD9326955 is the checkpoint. Real-data/paid-call
permission persists. No new commit, push or archive is requested. See tidy-repair-advisor.md for independent challenge.

The actual failed Local pass made four successful model calls, seven disclosure edits, two block updates and one
reversible invalidation. Its first failing tool was not retained. target/tidy-diagnosis-20261101/repro.mjs proves a stale
reference poisons a review even after the exact action succeeds with its updated reference; it does not reconstruct
the lost historical error. Fix recovery and diagnostics without weakening CAS/authority or replaying model work.

Recover only MEMORY_REVISION_MISMATCH on an admitted action. Match verb, stable target identity and complete semantic
payload, omitting only the reference revision. Only a fresh successful execution clears the exact matching error;
different actions/payloads/targets and cached pre-error receipts cannot. Unknown/internal, authority, malformed,
out-of-scope and request-ID conflicts remain unresolved. Keep this in-memory and local; no generic retry/queue system.
Canonical completion requires successful finish and no unresolved errors. A capped/abandoned canonical pass retains
committed work, reports partial/failed and leaves lastTidyAt unchanged. Preserve Legacy's explicitly tested bounded-pass
behavior and Hindsight curator semantics. Safe tool/error logs must not alter operation outcomes.

Keep existing clean/ran result wire schema. Add MemoryTidyFailureDetailsSchema directly in JSON-RPC INTERNAL_ERROR.data:
kind=memory-tidy; status=partial|failed; existing defects/edits/steps/usage; reason=tool-errors|execution-failed|review-stale|unfinished;
issues=max20 closed {toolName,code}; issueCount=total unresolved issues. Partial requires edits>0; failed has none.
TidyRunOutcome adds partial plus optional reason/issues/issueCount for existing adapters. New UI parses cause.data into
separate tidyFailure state, clears stale success at attempt start, shows Chinese reasons/counts and refreshes affected
projections after partial failure. Old clients remain on the truthful error path. No endpoint/migration/version flag.

Parent owns Shared/RPC/specs/integration and live acceptance. Core worker owns Local review/TidyPass/interfaces/tests;
UI worker owns Operations hook/presentation/tests. Verify exact correction versus unrelated success, receipt replay,
unknown/authority failures, partial writes, model failure and compatibility. Use isolated real data and actual Core/WS/UI
before updating the live runtime; never interrupt active user work or claim automated checks are owner acceptance.

After repair gates pass, compare a consistent new snapshot with historical records: ordinary foreground turns separately
from tidy/catch-up/experiments; paired cache denominators, input/output/reasoning and tool repetition. Do not equate cache
percentage with savings or silently disable thinking. Deliver evidence-backed next directions, not speculative prompt rules.
