# Healthy Transition Drivers and Historical Recovery

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
checks. Status uses a separate verified observer: detached binding publication state plus the original publication
reader's current DB queries and joins, with only byte-matched native verification and pure Bank projections reused.
See `memory-transition-publication.md` for its bounded lifetime. No authority, candidate, publication or readiness
verdict cache is permitted. Regression tests must call the actual boot-composed status path and cover corrupt
evidence, replaced bindings and historical epochs with a newer binding.

Default already-bound boot primes the observer before native dispatch. A green warm-observer deadline replay alone
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

## Scope and entrypoints

`composeMemoryTransitions` wires the actual healthy service into the existing Core operation owner and shutdown.
`memory.transitions.preview` and `memory.transitions.status` are authenticated operator reads; execution remains
`memory.operations.submit` with `transition.return-local` or `transition.reenter-hindsight` and one confirmed preview.
The emergency producer and Home action surface have separate ownership. No constructor starts a transition.

## Durable control and native requests

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
