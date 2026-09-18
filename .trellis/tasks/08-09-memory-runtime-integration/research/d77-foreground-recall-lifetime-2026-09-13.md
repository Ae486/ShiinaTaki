# Foreground Recall Lifetime Correction

## Evidence and owner requirement

The owner rejected a fixed business deadline for normal memory retrieval. Removing only the outer 1,500 ms default is
insufficient: the first actual SiliconFlow run returned the original targets at rank 2, but complete calls took 14-25
seconds under an explicit 120,000 ms test connection budget. `TAKI_HINDSIGHT_REQUEST_TIMEOUT_MS` is documented as one REST
request and defaults to 10,000 ms; `hindsightProviderCall` currently spends it over the entire Recall operation.

Additional inheritance occurs in `hindsight-runtime-bank-service.ts` (queue plus entire sync), hydration (missing owner
request callback), and `hindsight-memory-runtime.ts` (both Bank synchronizations before `captureRun`). A normal default
configuration therefore still has a business cutoff despite the outer fix. This is a required continuation of the
owner's retrieval requirement, not an embedding migration or B7 authority change.

## Internal contract

- Ordinary foreground Recall and the Run-admission synchronization needed to construct it wait for completion or
  cancellation without a total business timer. Every HTTP request retains its finite configured fault deadline.
- Add an explicit internal foreground synchronization mode. Existing bounded synchronize callers, Reflect's shrinking
  five-minute allowance, pending recovery, writes, curator and scheduled B5 operations keep their current semantics.
- Queue waiting in this foreground mode is abortable without acquiring a future lease after cancellation. Runtime stop
  must also end the waiter and owned work. Do not create giant or infinite HTTP timeout values.
- The lease store may CAS-renew an active lease under the same Bank, run, owner and fence. Only its expiration changes;
  the old expiration must still match and the lease must not have expired or changed ownership. No schema change.
- The foreground owner maintains a finite lease window sufficient for one complete configured request plus the existing
  small safety margin. It renews before a request when necessary, then revalidates current ownership before cache writes
  and publication. A renewal never changes the captured authority, Bank, namespace or expected predecessor checkpoint.
- Sync runner guards obtain the current lease/expiration from that owner. Captured old expiration values must not be
  silently relabeled, and immutable receipts remain immutable. Lease loss/expiry, cancellation and failed HTTP calls stop
  publication. Scheduled B5 and explicit operation deadlines must never renew their way past their original deadline.
- Foreground candidate hydration passes the same caller-owned request callback through all pages, body descriptors and
  body parts. The callback rechecks authority/connection/cancellation and provides a fresh per-request allowance.
- Preserve complete verified closure, cache-without-publication, bounded body concurrency, exact policy/provenance and
  required-pin refusal. No automatic authority fallback, direct replica mutation or schema migration is added.

## Required proof

1. A 10-second per-request configuration completes a real multi-stage Recall lasting longer than 10 seconds when each
   HTTP request progresses within its allowance. The actual `captureRun -> automaticRecall` path is included.
2. A genuinely slow individual HTTP request still fails/degrades truthfully; explicit caller cancellation and runtime
   stop settle queued/running work, including an abort-ignoring transport via the existing client boundary.
3. Long foreground sync renews its owned lease and publishes only complete verified state. Stale/expired/replaced lease
   tokens cannot renew, cache or publish; expected checkpoints remain frozen while expiration changes.
4. Scheduled sync, writes/recovery and Reflect retain their existing finite whole-operation budgets.
5. Repeat the actual API acceptance under the default ordinary request timeout without an extra generous pre-sync.

The first live consumer `api-models-1` is stopped, all owned services ended normally and the Job has zero remaining
members. Its two Reflect scenarios both reached five minutes; these remain failures while native-stage diagnosis proceeds.
Preserve its output and source fingerprint before another attempt. New consumer evidence must be identity-scoped.
