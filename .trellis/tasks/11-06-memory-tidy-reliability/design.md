# Memory tidy reliability design

## Decision and boundaries

Extend the existing memory operation owner with one tidy kind. Keep Local tidy as the producer of candidate selection, transactional memory edits, review progress, and retry eligibility. Do not add a second operation service, external queue, agent framework, or replace the memory engine.

Alternatives considered: more sticky-error exceptions leave restart/coverage/queue failures unresolved; a dedicated tidy attempt service duplicates the existing durable owner; a workflow framework introduces a deployment and dependency burden disproportionate to this local feature. The existing operation owner plus a small producer checkpoint is the selected approach.

## Entry and lifecycle

- Add a tidy request/result/producer arm to the Shared memory operation contract. Reuse submit/status/list/subscribe/changed and the existing family uniqueness index.
- A narrow runtime dispatch binding is installed after operation-service construction and before serving user work. Automatic Local triggers check eligibility, then submit or join this owner. The tidy kind executes raw runNow, never maybeRun, so the route cannot recurse.
- The old memory.tidy endpoint remains a compatibility adapter that submits/joins and awaits the same operation. Home uses immediate admission plus status/push recovery, so an RPC deadline cannot invite an unobserved duplicate run.
- One tidy family covers the selected memory scope that shares Global blocks. Different Characters must not run simultaneously against shared Global state. Capture the actual review only when the Utility Slot starts the work.
- Store a bounded content-free tidy progress summary in the existing producer JSON; persist committed edit progress in the same SQLite transaction as a Local mutation. Preserve that evidence if boot recovery marks the operation outcome_unknown.
- Provider changes and shutdown reject new admission. Queued work revalidates the originally selected authority before mutation. Closing Home does not cancel work; a fresh read obtains Core truth.

## Correction and tool contract

- Treat known rejected/no-write calls separately from uncertain repository failures or authority changes. Keep structured safe issue identities, tool, code, and actionable correction guidance.
- Explicit completion must account for rejected calls by issue identity: correctedBy references a later successful tool call, or a bounded non-content not-needed reason explains why the rejected request is no longer required. Only known no-write errors qualify; unknown, authority, and request-identity failures remain blocking. Do not infer completion merely because a later unrelated tool succeeded.
- Prefer short pass-local model references and explicit current-record refresh after a conflict where safe; do not silently retarget a stale edit or remove CAS/ownership checks.
- Use sequential SDK tool execution for dependent memory mutations. Preserve transactional compound replacement and replay-safe actual effect counts.
- Use the installed SDK's built-in total/step timeout and cancellation path against the compatible HTTP transport. Step limits do not bound elapsed time; cooperative abort behavior must be tested. No arbitrary catch-and-retry of unknown writes.

## Candidate coverage and bounded work

- A timestamp represents a successful review boundary, not proof that every candidate before it was shown.
- Add a small Local producer checkpoint keyed by epoch, Character, Bank and memory, with reviewed revision and time. Only candidates actually presented and accepted at completion are checkpointed; unseen rows remain eligible across step limits, failures, retries, and restart. Record the examined revision and own successful resulting revision, never substitute a newer external revision. A remaining tail bypasses the usual forty-write admission threshold; unchanged no-op rows do not recur every pass, while time-dependent stale review may become due later.
- Reuse the report's existing bounded sections. Include all evidence needed for duplicate judgments without falsely claiming unrelated rows were reviewed. Keep time-dependent stale review and Block duties explicit.
- Progress/result exposes reviewed and remaining work; completing a bounded batch must not be presented as completion of omitted work. Drain the admitted stable-identity backlog with independent per-batch limits and queue yielding, preserving accepted checkpoints. See research/backlog-optimization.md for the owner-authorized follow-up and measurements.
- Automatic failures use a bounded persistent retry schedule/stop state. New foreground turns cannot cause an unbounded paid retry loop. An explicit operator request may retry from fresh state without replaying an uncertain historical operation.

## Operator feedback

- Show waiting/running, completed, partial, failed, or interrupted state from the Core-owned operation, with committed progress, safe reason, and next action.
- Reconnect/remount installs the existing subscription before its baseline read; no automatic mutation replay or polling.
- Distinguish new/possibly stale/possibly duplicate candidates from proven errors. A rejected call is not by itself proof that a desired memory change remains incomplete.
- No raw memory content, arguments, credentials, or free-form provider exceptions enter public diagnostics.

## Compatibility and deployment

- Existing provider authority, memory content, provenance, native receipts, source ingestion, and compaction remain authoritative.
- Legacy/Hindsight raw tidy completion semantics remain compatible; the new Local producer checkpoint must not relabel their state.
- Migration is additive and must be tested on fresh, pre-change, and reopened databases. Historical success markers do not fabricate missing per-candidate coverage; first new review may legitimately revisit old data.
- Before a live update, retain a consistent database backup. Rolling code back after new tidy operation rows requires compatibility assessment because the older closed operation schema does not understand the new kind; document this rather than promise blind binary rollback.

## Review status

The independent advisor reviewed the operation-owner reuse, callback wiring, correction ledger, timeout boundary and revision-based coverage. Its recommendations above are accepted; detailed evidence is recorded in research/advisor.md. The owner already authorized development, so no additional planning permission is required.

## Background Run Monitor integration

The final contract is in `research/maintenance-monitor-plan.md`, the independent challenge in
`research/maintenance-monitor-advisor.md`, and executable contracts in `backend/observability-projection.md`.
Existing operation ledgers and auxiliary calls supply one independent, read-only projection; no new execution owner.
Migration068 adds optional operation association and cache population metadata. Old ambiguous cache boundaries stay
unavailable until the next valid summary. Never use an old all-call baseline against newly filtered totals.

Utility task IDs remain per-dispatch; explicit immutable operation references associate actual calls across batches
and retries. Both Local and Legacy automatic tidy retain their existing trigger but admit through the same durable
owner. Legacy unmeasured review counts stay unknown. Total operation duration includes waits/retries; only recorded
call usage is shown, with coverage. Legacy pre-summary flush and other auxiliary work retain their original treatment.

Desktop separates normal and background tabs and subscriptions. Final normal input remains the exact latest primary
request receipt. The monitoring module issues no execution commands. Rollback should retain an isolated pre-upgrade DB:
older code cannot interpret the new normal cache population, so blind mixed-version metric compatibility is not promised.
