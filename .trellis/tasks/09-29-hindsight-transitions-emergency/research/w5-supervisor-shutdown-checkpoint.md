# W5 supervisor cleanup repair

The real RETURN attempt finished with a Core unknown outcome, then Uvicorn shutdown exceeded30seconds.
The original `finally` stopped at that exception, skipping completed-work comparison and `engine.close()`.
This is a separate helper failure from the Native final-proof/renew contention under investigation.

## Scope

- `w5-reused-native.py`: configure a20second Uvicorn graceful shutdown, then invoke phased cleanup.
- `w5-supervisor-shutdown.py`: stop Node, stop serving, drain cancelled request handlers, close listener,
  audit completed work, close engine, and capture model-observation health. Each async phase has a30second
  envelope and errors are retained by stage/type. An active driver exception is re-raised by its original
  frame; cleanup failures are independently fatal when no primary exception exists. A failed Node exit
  remains recorded. Do not cancel a request again while its original cancellation is rolling back.
- `w5-supervisor-shutdown-test.py`: server timeout/original error preservation, audit mismatch still closing
  the engine, and a real loopback Uvicorn stalled HTTP request whose cancellation completes before audit.
- Preimage: `w5-supervisor-prior-2026-10-03.json`; all earlier source manifests remain untouched.

## Verification

- `H:/hindsight/.venv/Scripts/python.exe .../w5-supervisor-shutdown-test.py`:3tests PASS, exit0, zero models.
- `H:/hindsight/.venv/Scripts/python.exe .../w5-reused-native.py inspect --stage return --submission-cap329`:
  exit0; attempt `df849d06bf984b7ea83e7794386462ce`; started/stopped true, modelRequests0,
  preservedCompletedSteps71, preservedActions600, sourceUnchanged true, complete observation metadata.
  This inspect only enumerates the full source inventory; it does not recompute the remaining maintenance
  plan. The durable completed Character work must not be repeated. Durable count remains276/329.
- Actual installed Uvicorn shutdown behavior was read before the change: it cancels request tasks on
  graceful timeout but does not await their cancellation handlers; the helper now drains them.

Independent review is pending. No production Core/Native behavior was changed by this helper repair.
W5 remains incomplete; no real-model continuation until the Native fix and independent gate pass.
