# Healthy Transition Drivers and Historical Recovery

## Renewal racing a terminal decision

Native correctly rejects renewal once a Bank has a terminal outcome. An original retire/activate decision can
complete while an earlier heartbeat request is still pending. The Native session coordinates that exact request:
only typed `executor_lost` may join the same Bank's already dispatched decision, including response validation and
durable observation. It may be superseded only by a strictly newer terminal observation with the same acquire
request, executor and proof, matching the stored decision. No new status request, retry, claim or deadline extension
is introduced. A failed decision, absent/mismatched terminal, different refusal or transport error remains a failure.
Test both response orders and complete healthy-driver binding/settlement, preserving ownership/lease refusals.

## Synchronous work and failure diagnostics

The 30-second heartbeat cannot execute while synchronous SQLite/corpus validation holds the event loop. Use the
boundary-local native evidence contract in `memory-transitions.md`; preserve the existing finite Core lease and
Native TTL. Measure candidate, proof, publication and reconstruction separately on a new isolated corpus copy,
including elapsed-clock ownership guards, before resuming a real operation.

Owned execution failures log only a closed internal code and a closed execution-stage label. Preserve the original
abort/unknown-outcome logic; no exception alone proves absence of an effect. Heartbeat, primary execution, abort
and service fallback diagnostics must never serialize arbitrary error names/messages, stacks, payloads or provider
bodies. Diagnostic sink failure cannot change settlement or trigger another provider call. Historical failures
whose bare catch lost the exception remain inferred from reproduction; new instrumentation cannot recover an old
stack retroactively.

Healthy boot readiness first uses `hasPublishedBinding(provider)` only to return false when no subsystem is published.
That presence-only read uses the existing binding's `current()`; it neither verifies authority nor admits reads/writes.
Absent, failed, retired and stopped bindings must not load a snapshot or rebuild committed corpus evidence on each
status poll. Operation preview/admission/execution keep the independent full snapshot/receipt and lifetime/epoch
checks. Status uses detached binding publication state and `readCurrentMemoryAuthorityIdentity(db)`, including
current marker shape and active provider/lineage checks, without reconstructing historical publication evidence.
See `memory-authority-validation.md` for the current-identity/full-proof boundary. No authority, candidate,
publication or readiness verdict cache is permitted. Regression tests must call the actual boot-composed status
path for current-identity damage and replaced bindings, and full verification for historical evidence damage.

Default already-bound boot does not create or prime a historical observer. A green status deadline replay alone
does not establish complete driver responsiveness: actual heartbeat, native finalization, bind, full ready, intent
execution and final release must be measured together. Do not change deadlines, skip validators or remove polling
to hide long uninterrupted synchronous validation chains.

Finalization yields with a real event-loop primitive between completed independent synchronous boundaries, never
inside SQLite transactions: before Native finalization, after each persisted outcome, after full bind, after full
readiness, after complete queued-intent validation and after native release. Each boundary joins the existing
serialized heartbeat through its current tail, then rechecks abort signal, live Core lease/CAS and configuration.
The 30s interval, 300s lease and native request deadlines are unchanged. Microtask-only yields are insufficient.
Before successful terminal resolution, stop new interval ticks and join the existing chain before rechecking and
committing the resolution. Expired/replaced leases must fail; renewal must never revive them. Complete queue
validation still runs when no intents exist. Every Native activation outcome precedes Hindsight binding/effects.

A Native renewal response first validates the exact dispatched Bank/transition/original request/executor and its
non-regressing revision and sealed proof. Only then may it update the existing active entry. A newer observation,
terminal outcome or claimed generation wins over an older response; the latter cannot revive the old executor or
erase a proof/outcome. Same-revision divergent phase/identity/proof/outcome refuses. Lease expiry never regresses.
Tests must deliver an old proven renewal after normal session finalization and after real claim/observation, reject
incompatible replies even when current state advanced, and cover retire/activate, cancellation/configuration drift,
expired/replaced lease, pending heartbeat failure and terminal timer cleanup. Fixture terminal responses model the
Native producer's real revision increment. Final release needs the full actual driver corpus replay, not only units.

The diagnostic code set also accepts exact `HindsightErrorCodeSchema` values (including timeout/cancelled/invalid
response) from the sanitized error message. Prefix matches, arbitrary messages, names, stacks and provider bodies
remain excluded; throwing metadata getters and sinks must not alter execution or settlement.

The B3 template-history driver fixture must retain independent template receipt/result auxiliary rows when its
synthetic delta rebuilds the final W2 snapshot; reseal only before Native proof observation, never after Core
persists an association. An ordinary native/application fixture does not imply complete template auxiliary state.
`transition-template-healthy.test.ts` keeps all exact history, scope, publication and rollback assertions. Its
scoped test budgets follow the work performed: selected RETURN uses 60 seconds and selected two-direction cases
use 180 seconds; removed RETURN uses 240 seconds and removed two-direction cases use 360 seconds. Preserved
whole-run measurements reached 164.274 seconds for removed RETURN and 279.016 seconds for a removed roundtrip.
A test timeout can leave its asynchronous body running into fake-Date teardown, so diagnose an overrun in an
isolated case before treating its later lease error as a separate producer defect. These are test-only budgets;
Core/Native leases, runtime deadlines, preview TTLs and global test defaults remain unchanged. The drift matrix
requires a non-null failed result and complete `source-aborted` resolution when RETURN proves factual abort;
prepared REENTRY and final lease-expiry cases retain `outcome_unknown` after full publication rollback.

## Native delta validation reads and derived-link cleanup

`TransitionDeltaService._admit`, after its existing Bank lock, executor and exact retired-proof guards, enables
invocation-local body-byte reuse for its baseline. Both apply transactions independently reload and validate the
complete baseline. Each baseline reader is disposed before preflight/embedding/writes and never returned, attached
to a connection/backend, or reused by ordinary D77 snapshots, unused-scope capture or final proof.

Within that same locked, write-free baseline segment, the private application bundler may reuse the freshly loaded
logical source and its freshly parsed exact SQL-keyed heads. It still checks complete native/head membership and
the canonical current-payload hash before independently reading and validating every immutable native body and
document Source evidence. Python model equality is not a hash proof. Invalidated-memory rows always use the
ordinary point reader because archive entity ordering/deduplication differs; duplicate native/head keys and a
head envelope under the wrong SQL key also fall back. No serialization semantics change. Both admissions and all
ordinary snapshot/hydration paths remain independent; source/index lifetime ends when the bundler returns.
Tests compare complete baseline/component hashes and auxiliary rows, cover Unicode/duplicate archive IDs,
all native kinds, original Source/Block/policy bodies, head corruption and changed original document evidence.

Both ordinary `heads()` and the locked SQL-keyed head enumeration use the protected `_heads_from_rows` parser.
The transition reader overrides that hook to register the same non-null body references in original order before
artifact enumeration. Do not parse borrowed heads outside this hook, issue a second head SELECT or mutate another
reader's pending state: an artifact-only staged batch otherwise forces later heads and Source dependencies into
ordinary point body reads. A regression must use the actual bundler and reader with complete bodies across batch
boundaries, comparing body-query structure as well as results; parser-only or private-queue assertions are insufficient.

Raw prefetch transports at most 128 body descriptors, 8 MiB of actual descriptor/part bytes and 1024 part rows per
batch. SQL checks actual storage lengths in the materializing statement; declared descriptor size is not a resource
bound. Only bytes that passed the original sealed-state, descriptor, part count/order/size/digest, whole-byte and
semantic-digest checks enter the 64 MiB / 8192-entry LRU. Oversized bodies and exhausted/evicted entries use the
ordinary fully validated one-body path. These are optimization budgets, not provider acceptance limits.

Each cache key includes the complete descriptor and provider lineage, Bank ID and generation; the reader also
retains its original connection/table scope. Every read still freshly decodes and schema-validates the model and
rechecks Source-evidence closure and historical references. Returned mutable models are never cached. Reject
descriptor aliases, duplicate/foreign raw keys, corrupt/missing/extra/out-of-order parts and dependency cycles.
Success, failure and cancellation clear all staged raw rows, verified bytes and active dependency identities.

A complete-descriptor cache hit also consumes that body's pending identifier and staged metadata/parts. A later
artifact listing can requeue an already validated Bank; leaving its raw row staged after the hit would prevent the
next prefetch batch forever. Clear only that body's transport bookkeeping after scope/full-identity validation,
never other staged bodies or descriptor-alias checks. Actual final Bank-first tests must cross a batch boundary and
prove later bodies still use prefetch; also cover staged hits, conflicting aliases and fresh-reader corruption.

Each of the two `_predecessors` calls creates another fresh `_TransitionValidationReader` wholly within that
read-only pass. The second call follows native writes and cannot reuse either baseline or the first predecessor's
bytes. A fifth independent reader performs the final Bank/current-artifact validation after all application writes;
retain Bank-first failure order and every scope/provenance/Source closure check. It is disposed before publication.
The ordinary `ApplicationStateStore` exclusively handles commands, writes and `publish_event`. No reader or cached
view crosses a validation/write boundary, even inside the same transaction.

`preserve_transition_units` keeps per-row restore, revision, update, temporary cleanup and entity handling intact.
Collect only the existing/restored targets that previously received derived-link deletion, then delete their exact
incident temporal/semantic edge union in batches of at most 128 target UUIDs on the same Bank/connection/transaction.
Complete these batches before `_write_units` recreates retrieval links. Preserve causal/other types, unrelated and
foreign-Bank edges; new targets are not added to the deletion set. Failures roll back rows, edges and receipts together.

Required proof includes ordinary/optimized full-hash equivalence, immutable-byte/model isolation, bounded fallback,
and a real second `_admit` refusing storage corruption introduced between the two transactions without committing
delta/native/application effects. Performance measurements use a fresh pre-apply corpus clone; an already committed
receipt cannot establish apply latency. Preserve production timeout/TTL/lease and normal recovery identities.
Additional tests must cover exact edge-set equivalence, mixed live/new/restored targets, cross-batch edges and rollback;
five non-overlapping disposed reader lifetimes; written-body visibility and corruption refusal in the final view;
ordinary-store command/publication ownership; and failure/cancellation cleanup at all three artifact read boundaries.

## Scope and entrypoints

`composeMemoryTransitions` wires the actual healthy service into the existing Core operation owner and shutdown.
`memory.transitions.preview` and `memory.transitions.status` are authenticated operator reads; execution remains
`memory.operations.submit` with `transition.return-local` or `transition.reenter-hindsight` and one confirmed preview.
The emergency producer and Home action surface have separate ownership. No constructor starts a transition.

## Durable control and native requests

### Transaction-local admission verification

Healthy operation admission creates a fresh independent `TransitionEvidenceContext` inside the synchronous SQLite
transaction. A local derived handler context threads it through both complete plans, the operation epoch stamp and
the actual Local/Hindsight readiness snapshots. The long-lived operation context is never mutated; it carries no
admission context into notifications, async execution, another transaction or restart. Preview and later execution
start independent validation. Nontransition handlers retain their existing context and behavior.

Only byte-verified immutable native artifacts and complete-key pure Bank projections are reused. All authority,
receipt/candidate/baseline/attempt, source/configuration/inventory, custody, queue, checkpoint and runtime binding
joins still execute on every call. Never reuse a selected authority, readiness boolean, passed plan or mutable SQL
result. Foreign or closed contexts and asynchronous/thenable callbacks fail closed; no observer-context mode exists.

Both plan calls retain real-clock entry expiry, exact actor/request/preview and current-identity checks. Each plan
also rereads the preview and real clock after expensive validation, so work crossing the normal 120-second TTL
refuses before persistence. Do not freeze the clock or enlarge TTLs/leases/timeouts to hide corpus cost. Regressions
cover expensive verification, expiry during the first plan and between plans, current configuration/Block/binding
changes at the second plan, exact duplicate admission and rollback/no-dispatch. An actual copied corpus must pass
full default readiness and both plans within the original TTL; a synthetic cost test alone is insufficient.

Task-only renewal of a positively unadmitted expired request is a separate explicit procedure: preserve original
bytes/history, prove exact absence in operations/intents/recoveries, validate the actual RETURN and already-applied
Local mutations, then append new preview/request IDs with an approved supersession link before submit. Never renew
an admitted/unknown request, overwrite old expiry or silently renew an expired replacement.

- Preview captures the reviewed connection, complete Bank setup hash, separately discovered Character coverage,
  source/custody identity and negotiated transition/source-evidence capabilities. Admission rechecks synchronously;
  asynchronous probes and native requests stay outside SQLite transactions.
- Migration055 owns immutable previews, the complete admitted Bank registry, original acquire/claim/decision and
  application-snapshot commands, dispatch evidence, observations, no-dispatch seals and per-operation failures.
- Register every Bank before constructing the native client. A constructor failure can release untouched Banks only
  through positive complete non-dispatch evidence, with no invented native outcomes.
- Persist each command before dispatch; read original native history before repeating I/O. Loss of an acknowledgement
  does not prove absence. Executor takeover preserves the original logical transition and sealed final proof.
- A source runtime already durably fenced is not drained again. Renewals retain the phase CAS revision. All I/O uses
  the composite shutdown/lease signal, and stopping the service joins its active producer promises.
- Reentry with prepared deltas never fabricates an abort. Exact preparation/upload/delta history owns recovery.
  Final Hindsight activation for every Bank precedes binding and queued target effects.
- A physical snapshot API has no caller request ID; its read-only materialization is distinct from persisted
  application-snapshot requests. Neither materialization establishes maintenance or publication completion.

## Expired unused inventory and immutable evidence reuse

Unused-Bank application inventory is an ordinary TTL-bound snapshot, unlike the snapshots retained by a final native
transition proof. After a lost materialization reply, replaying the same request may positively return the native
`HindsightApplicationRefusal` with `code=snapshot_expired`; an expired page load has the same meaning.

- Reuse migration055's immutable `application-snapshot` journal. The original slot remains `unused-inventory`.
  A positive expiry may append `unused-inventory:expired:<predecessor-command-id>` with a new request ID and the same
  namespace/600-second TTL. Never edit/delete the original command, weaken Native TTL, or replace any transition,
  preparation, delta operation or final-proof identity.
- Read the durable successor chain before dispatch and persist/mark the leaf before I/O. A lost renewed response
  resumes that exact leaf after physical reopen; it does not first resend an expired ancestor or mint another ID.
- Allow at most one new snapshot renewal per Bank per producer invocation. If that replacement also expires, retain
  uncertainty and its original request for explicit recovery. Timeout, missing snapshot, request conflict, namespace
  refusal, body read failure or an untyped error with similar text never authorize renewal.
- Before renewal and before returning the loaded inventory, recheck the original acquire request, current Native
  unused-Bank fence/liveness/zero writers/zero accepted operations, admitted Bank/lineage/namespace, and the current
  Core lease/source/configuration. A prepared delta is no longer a replaceable inventory capture. Partial old pages
  are discarded; the final complete native/application closure still passes W3's existing hash/cursor/unused checks.
- Inventory loading may reclaim a Native executor. Re-read the current fence before delta dispatch, replacing only
  its executor capability. Keep the immutable prepared operation ID, request hash and all delta contents unchanged.
- Reconstructing a proven Bank after executor expiry changes live status, not its sealed proof or retained bytes.
  Reuse its previously verified immutable native-evidence document only when the current original request and entire
  sealed proof match exactly, the Bank/transition match, and the current status remains proven with zero writers,
  zero accepted operations and no terminal outcome. Divergent proof/request refuses; never overwrite the old slot or
  weaken its identity/CAS checks. The final candidate/COMMIT gates remain unchanged.

Required complete-driver regressions: earlier Bank preparation followed by an unused-Bank snapshot reply loss,
601-second expiry and physical Core reconstruction; proven executor takeover with still-valid inventory; combined
full expiry plus renewed-response loss and another reopen; application-page expiry and repeated expiry bounded per
invocation; missing/conflicting/foreign/untyped refusals with no renewal; changed stored namespace, lost Native claim,
new writers and stale Core configuration; mid-inventory executor takeover with Native's exact dispatch guard; and
rehashed but divergent final proof. Original commands, preparations,
evidence and terminal operation outcomes must remain byte-identical, and earlier delta applies must not repeat.

## Verification and partial maintenance

### Optional template-aware W2 associations

A template-capable healthy identity commits the complete Core selection/default/history and durable-hold state.
Each Bank's separately versioned association joins that state to the original immutable W2 evidence ID and proof
hash. Independently validate every scoped Apply receipt in the W2 auxiliary inventory and its database-only
definition projection; a matching selected receipt alone is insufficient.

Construct the observation request with only that exact Bank incarnation's verified receipt IDs and the terminal
semantic refresh-result IDs Core has durably observed. Derive refresh ownership from the already verified receipt
children. Pending, unknown and ordinary worker failures without a persisted semantic result are not terminal
membership. The authenticated observation must acknowledge the exact list with zero missing IDs. Independently
validate each requested W2 `memory_template_refresh_results` SQL row against its original receipt target, request,
child, model and definition, allowed terminal state and coherent result revision/hash. An intact Apply inventory
does not prove a missing or corrupt child marker. Do not substitute requested membership for the complete inventory.

Before reusing either a saved W2 document or a saved final candidate in a live healthy recovery, obtain a fresh
authenticated template observation outside SQLite transactions. Reuse the exact original request, require a new
nonce and the same schema and per-Bank authenticated source context, then compare the complete inventory, selected
anchor, database facet, inherited configuration and full definition projection against the original association.
Recheck current Core template/default/hold state after the asynchronous observation. A compatible service/transport
restart may change incidental process identity or observation ID; it must not invalidate the stable authenticated
context. Different Banks need not have identical context hashes.

The original W2 proof, evidence ID, association bytes and candidate remain immutable; a fresh observation is only a
current-target comparison, never a replacement historical document. A previously finalized candidate uses current
fence/status reads without repeating Native maintenance. Historical evidence verification and W6 emergency remain
offline, and historical W2 documents without this optional extension retain their original serialized meaning.

Migration056 is additive after recorded055; never edit055 to retrofit a real database. Its immutable
`memory_transition_native_verifications` records the exact native executor before a **new** verify dispatch.
An old055 database has no such rows; absence cannot be treated as historical non-dispatch.

The first failing verify retains uncertainty and does not immediately start another maintenance attempt while
handling its error. Explicit recovery can resume the same finite native plan. For old055 history, an actual native
`native_maintenance_incomplete` refusal supplies the positive continuation requirement; record the new dispatch
at the current time, without fabricating past dispatch. Already completed steps/actions and sealed proofs are reused.

A pre-proof abort command has `proof_hash=null`. After maintenance completes, native abort requires the exact final
proof. Retain the original refused command and persist a separate proof-qualified abort slot only after observing
that final proof with no terminal outcome. Lost replies read either exact saved decision; neither command is edited.
Seal never-dispatched Banks only after every sent acquisition has a positive terminal abort outcome.

The native provider maps factual HTTP402 to `ProviderBillingError`, with a sanitized message. Both compatible-provider
retry loops and consolidation's outer retry must propagate this type immediately. Do not reinterpret it as a failed
content batch and subdivide it. Existing401/403and retryable429/5xx behavior stays intact. Transition maintenance's
existing failure boundary preserves actions, marks its plan incomplete and leaves the native fence recoverable.

## Truthful status and validation

Native proof, Core COMMIT, target runtime availability, queue settlement and native release are separate facts.
Operation completion requires the selected runtime and terminal dispositions for all admitted intents, including
visible conflicts/refusals. A failed recovery gets its own immutable unknown result; original operation results remain
unchanged. Status reads work under Local and a committed-but-unbound target and never dispatch native/model work.

Required checks include complete production-driver cycles, constructor failure, exact lost acquire/delta/verify/resolve
replies, takeover before/after proof, physical SQLite reopen,055-to056 partial-plan continuation, immutable guards and
COMMIT rollback. Exercise real tools/coordinators for queue ACK/capacity/cutoff, ordered CAS conflicts, effect-before-ACK,
positive source abort and primary custody during drain/COMMIT/unbound/reopen. Reject stale scope coverage and invalid
native/body evidence before publication. Synthetic envelopes prove Core joins only; actual owned native maintenance,
the preserved-corpus journey and manual product acceptance retain separate evidence and cannot be inferred passed.

Complete-driver regressions also cover new Character and empty Banks, actual Local copy/reinforce with repeated
multiversion Source references, edits/policy/lifecycle/expiry across cycles, sealed multipart Source ACK loss,
manual-sync admission in both orders, and new Core/runtime/operation owners over a physically reopened SQLite file.
Status reads and ordinary Legacy/Local process boot must cause no unexpected native/model dispatch.
The complete multipart Source fixture keeps its original 100,000-character multibyte body, all reply-loss,
immutable-byte and full roundtrip assertions, and an explicit two-part assertion. Its scoped timeout is 60 seconds:
the unchanged pre-repair producer also exceeded the former 30-second envelope, and a timed diagnostic completed all
assertions in 30.573 seconds. This measured, reviewed test budget does not change runtime deadlines or global tests.

Historical055 recovery must cover both an already recorded abort and an interruption with no abort intent.
For the latter, physically reopen through056, reconstruct all Core owners with the unresolved source unavailable,
and continue the same return. Preserve every original command/migration receipt and completed native step; only
new verification dispatches receive056 rows. Absence of an abort cannot be replaced with a synthetic old decision.
The real operator method registry must also cover preview/status role refusal, same-request lookup after reply loss,
and a second authenticated observer's explicit recovery without rewriting the original terminal operation.
