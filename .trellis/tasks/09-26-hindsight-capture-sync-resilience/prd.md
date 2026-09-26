# Hindsight capture sync resilience (native smoke defects D1-D3)

Source: `../09-25-hindsight-native-smoke/research/native-smoke-2026-09-25.md` step 6b (reproduced in runs 4, 5, 6 against
the real patched native Hindsight). Engineering defects in the shipped Stage 2 Run path; no owner decision involved.

## Defects

- D1 A native application version conflict during the Run-admission foreground sync escapes `captureRun`
  (`memory/hindsight/hindsight-memory-runtime.ts:82-89` degrades only availability codes; bind loop
  `hindsight-application-sync-runner.ts:127-131`; refusal thrown at `hindsight-application-binding-runner.ts:161-163`
  with `expected_native` from the stale pull at `:86-95`). `chat.send` returns -32603
  `HINDSIGHT_APPLICATION_NATIVE_VERSION_CONFLICT`: no Run, the user's message is dropped.
- D2 `chat.send` acknowledgement latency grows without bound with the number of new native units (one artifact commit
  per unit plus an incremental pull; foreground mode has no deadline and queues behind earlier work on the Bank,
  `hindsight-runtime-bank-service.ts:68-73,106-117`). Observed 28.3 s with 41 serial commits; 60 s without an ack.
- D3 `server/method-registry.ts:97-103` turns an unexpected throw into -32603 without logging it.

## Requirements

- R1 A chat turn is never lost to memory synchronization: any foreground-sync failure that is not an integrity or
  cancellation failure degrades the Run (the existing `partial` / memory-unavailable paths) instead of throwing.
  Integrity failures keep failing closed, but still as a structured, logged refusal.
- R2 A version conflict first re-pulls and retries the bind a bounded number of times (the conflict is a normal race with
  native consolidation), then degrades per R1; the background sync converges later without a lost effect.
- R3 The Run-admission foreground sync has a bounded budget (derived from the connection timeout, not a new knob unless
  research shows one is needed). On expiry the Run proceeds with the already-readable replica as `partial`, while the
  remaining binding work continues in the background, unabandoned and without a duplicate effect.
- R4 Unexpected method failures are logged once with the method name and error code, never bodies or secrets.

## Acceptance Criteria

- [ ] Unit/integration tests with the transport double reproduce D1 (conflict during foreground bind) and prove R1/R2.
- [ ] A test with many pending native units proves the R3 budget bound and later background convergence.
- [ ] R4 test on the method registry.
- [ ] Native smoke rerun (`node .trellis/tasks/09-25-hindsight-native-smoke/research/native-smoke.mjs`) passes steps 1-8
      and 6b, with bounded ack latency recorded.
- [ ] Gates: typecheck, lint, Shared/Core/Desktop tests, `git diff --check`, isolated boot.

## Sequencing

Starts after Stage 3 W2 is committed (W2 edits the same Hindsight subsystem composition); runs before Stage 3 W3.
