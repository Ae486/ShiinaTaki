# Minimal healthy-finalization scheduling proposal

Status: research only; additional production edits require parent approval. This follows the separately delivered
verified-observation repair. Real services and the real working pair remain stopped; no budget/deadline changes.

## Failure and evidence

`w5-verified-observation-replay-result.json` passes the default positive-binding observation schedule: cold composition
81.921s; warm reads 3.824/3.632s; actual Hindsight client response after three event-loop turns 3.834s, below its
unchanged 60s deadline and the 10s polling period. This does not cover finalization's independent full validators.

`w5-verified-observation-driver-result.json` fails the complete Core recovery on a new committed-corpus copy. The
419.430s driver reaches `settling`, then reports `MEMORY_TRANSITION_LEASE_LOST`. An actual client heartbeat dispatched
at 69.958s receives `HINDSIGHT_CANCELLED` after 349.467s, when `finally` aborts it. It did not report timeout. Native
outcomes are synthesized from retained genuine evidence; this is Core scheduling proof, not real Native acceptance.

The uninterrupted chain after the heartbeat dispatch contains native-outcome checks (27.257 + 7.957s), full binding
(79.592s), full readiness (39.361s), full queued-intent validation (120.201s even with no items), and native-release
verification (34.264s). `await` on already-completed work only queues microtasks; it does not let the queued native
response or due 30s heartbeat execute. No validator or empty-queue path may be skipped to conceal this chain.

## Exact production scope

1. `packages/core/src/memory/transitions/transition-healthy-execution.ts`
   - Keep the existing 30s interval, single serialized heartbeat chain, 300s live Core lease, composite abort signal,
     native request deadlines, and every full validator. Add an execution-owned boundary function using actual
     `node:timers/promises` `setImmediate`, then join the existing heartbeat chain until its current tail is joined.
     A resolved Promise or a microtask yield is insufficient. The function rechecks signal, current Core lease/CAS,
     and current configuration after the join. It neither grants a lease after expiry nor invents another scheduler.
   - Place boundaries outside transactions: on entry to native finalization; after each persisted native outcome;
     after full bind; after independent full readiness; after complete `executeIntents`; and after native release.
     Before each long boundary, any due heartbeat has a real event-loop opportunity and its pending native request
     must finish before another long synchronous boundary begins. After all native outcomes, renew continues the
     Core lease while the native session naturally skips terminal Banks.
   - At the final successful terminal boundary, stop scheduling new interval work, join the already queued chain,
     then recheck live ownership/configuration immediately before the existing synchronous resolution COMMIT. This
     prevents a late timer from attempting to renew an already-terminal Core attempt. Preserve the final shutdown
     join and uncertainty handling on every failure; a heartbeat error must reach the existing failure path.
   - Keep all actual outcome persistence, Hindsight all-Bank activation before bind, full readiness, ordered queued
     effects and native release in their original order. Reentry/pre-COMMIT validator changes are outside this first
     measured repair. If the next exact replay exposes another boundary, report it before widening the production scope.

2. `packages/core/src/memory/transitions/transition-native-session.ts`
   - Keep one `active` map and the original acquisition/request/decision journals. A renewal response must not
     overwrite a status accepted while that request was in flight. Capture the exact request/executor/status when
     dispatching; after the await re-read `active.get(bankId)` before accepting the response.
   - Validate Bank/transition/original request, executor attempt/generation/fence token and non-regressing revision
     against the request and current entry. Reuse existing canonical identity helpers; do not create a second
     executor owner. A response to an old executor cannot resurrect it or erase a current finalized outcome.
   - If another observation replaced the captured status, retain the current entry when it has a terminal outcome
     or newer revision/generation. Same-revision divergent identity/proof is invalid, not a lease refresh. A response
     that is incompatible with its dispatched request must fail even if the active entry advanced. Never merge an
     old status wholesale into the current one. A nonterminal renewal retains phase/proof/outcome authority from
     the newest accepted status; renewal only refreshes liveness for the same exact executor.

Focused tests, the transitions index, and the healthy-driver spec are accompanying scope. No Native/Shared protocol,
DB schema, budget, TTL, timeout, queue shortcut, worker/thread or independent authority cache is proposed.

## Required deterministic regressions

- Run the actual healthy service/operation owner/runtime with a controllable heartbeat interval and a response
  delayed by real event-loop turns. Assert the response is joined before the next long bind/full-readiness/queue
  boundary and that all validators and Bank outcomes actually run in the original order.
- Hold a Native renewal response from the proven state, accept an actual finalized outcome through the normal
  session `resolve/observe`, then deliver the old renewal. Assert the terminal outcome and newest revision remain
  exact; the next heartbeat must not renew that Bank. Cover both retire and activate and the all-Bank binding gate.
- Repeat with executor takeover and delayed old response: generation/fence token cannot regress. Wrong Bank,
  transition, original request, proof or same-revision identity divergence must refuse; no command is rewritten.
- Cancellation, configuration drift and expired/replaced Core lease at each yielded boundary must prevent the next
  effect/COMMIT. An expired lease must not be revived. A heartbeat failure and failure during join remain unknown
  through the current diagnostic path. The terminal resolution must leave no queued renewal after completion.
- Preserve existing lost-response/restart/maintenance/queue/all-Bank driver tests and immutable evidence assertions.

## Decisive replay gate

Clone the stopped committed corpus into a NEW directory and create a separately named copy of the complete-driver
diagnostic. Keep default boot, actual Hindsight client, 60s deadline, production 30s heartbeat, 10s observation polling,
and the same three-event-loop-turn response. Keep every independent full validator including the empty queue's full
validation. Require completed Core resolution, settled queue, correct native-release evidence, no heartbeat loss or
cancelled pending response, and unchanged source SHA256. Record each boundary plus heartbeat timings and zero
network/model calls. Retain the failed diagnostic and its source/result hashes unchanged.

Only after this gate and independent review may the parent resume the real RETURN. A single synchronous validator
that exceeds the live lease would still fail; this proposal cannot prove an unlimited-corpus latency bound and does
not claim to. Real Native finalization and later same-Bank reentry remain separately required acceptance gates.
