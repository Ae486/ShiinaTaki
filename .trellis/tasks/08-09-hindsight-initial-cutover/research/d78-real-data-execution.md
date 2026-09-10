# D78 Isolated Real-Data Validation

## Authorization and boundary

On 2026-09-09 the owner approved the proposed test with actual data: a consistent copy of the current Local database,
an independent Hindsight target, and the real import/maintenance/certificate/reconciliation path. Continue the existing
B4 task. This supersedes the earlier synthetic-data-only validation boundary for this run, not the completed offline
record. Original user storage and active authority stay unchanged; all migrations and test bindings belong to copies.

Use the existing configured model endpoints for this explicit test once their configuration is established. Do not
silently select a new provider, fabricate credentials/model results, or claim real-model acceptance from injected
decisions. Read secrets only through their applicable configuration/credential source and keep values out of argv,
logs, reports, source files and task manifests. The protected legacy backup, other worktrees and Codex credentials are
outside this test. No Git mutations, new dependencies, deployment of the user service, production cutover or task
closeout is authorized.

## Execution sequence

1. Resolve the actual Core data root from startup code and runtime/config evidence. Use SQLite's online backup API
   through a read-only source connection to create a consistent snapshot, including committed WAL state.
2. Inspect the copy for schema lineage, active authority, Canonical Local Banks/records, B2 history, required artifacts,
   record/byte limits and explicit representation gaps. If the actual source is still legacy, report it and use the
   existing migration path on copied inputs rather than inventing Canonical records.
3. Create one owned D78 runtime directory under `.trellis/.runtime/d78-real-data/`. Retain copies, evidence and outputs
   for owner review. Launch only an owned native PostgreSQL/HTTP instance, using exact target identity/path checks.
4. Add a task-local real-data runner that reuses existing Core/native production functions. It must not call fixture
   seeders, bypass B3 verification, force completed status, skip required Banks or activate actual authority.
5. Execute structured import, replay/resume, actual native maintenance and certificate/raw-snapshot reconciliation.
   Track real model usage/outcomes when available; unknown usage remains unknown. Preserve incomplete evidence on
   failure and fix demonstrated defects with focused regressions before repeating the affected stage.
6. Independently review the runner/fixes, run appropriate checks, stop owned services and record exact data counts,
   results, failure causes, model/target identity and remaining acceptance limits without revealing memory content.

The single-Bank D78 envelope is 10,000 records / 16 MiB. Exceeding it or finding an unsupported representation is a
preflight result, not permission to truncate the actual data. D77/B6/B7 and full production activation retain their
separate gates. The original source and current target Banks must never be used as test output destinations.

## Generalized failure and completion contract

The owner requested root-cause correction on 2026-09-10, with regression coverage across input and lifecycle classes.
The acceptance criterion is not merely that the current data completes: deadlines, cancellation, response validation,
durable recovery and owned-resource termination must retain their meaning for different sizes, delays and failures.

- The production HTTP transport uses one captured finite request deadline through connection, headers and the complete
  bounded response body. Caller cancellation remains distinguishable from that deadline. There is no independent
  hidden stage limit, automatic redirect or mutation replay. A timeout or disconnect leaves the remote outcome unknown
  until durable identity-bound evidence resolves it; it is not a proof of rollback, absence or source drift.
- This task's three-hour request budget is an explicit validation setting, not a default product timeout or a guarantee
  that every Bank at the transfer-size limit finishes within that duration. Native verification currently processes
  the finite candidate synchronously. Durable status and same-ID receipt recovery remain required.
- Each control identity denotes one consumer invocation. Python supplies `TAKI_D78_CONSUMER_ID`. Only after all production
  readiness/raw-reconciliation assertions, final source audit and successful cleanup may the consumer atomically publish
  `consumer-<identity>-complete.json`, containing exactly `schemaVersion: 1`, `runDirectoryId`, `consumerId` and
  `state: "complete"`. The identifiers must match the current invocation. An existing same-name receipt refuses identity
  reuse; never overwrite or delete the prior evidence. An exit code alone is not the complete-run proof.
- Any consumer or supervisor terminal outcome retires readiness and triggers bounded shutdown of owned HTTP, engine,
  consumer and PG resources. Failure, cancellation, missing/malformed/mismatched proof, write failure or cleanup failure
  cannot report success or a known remote result. Cleanup failure remains `stop_incomplete` / cleanup-required rather
  than being hidden by an earlier HTTP stop marker. Never dispatch a second run automatically.
- The Windows validation launcher contains its newly spawned process tree in an unnamed, non-inheritable
  `KILL_ON_JOB_CLOSE` Job without breakaway permission. It assigns the actual held child handle before a stdin gate
  admits resource startup. Assignment/admission refusal stops only that held child. Graceful shutdown remains first;
  forced termination is recorded and does not establish graceful database shutdown or a known remote outcome.
  Once the original launcher handle has exited, a bounded part of the existing cleanup budget allows remaining Job
  members to exit naturally. The deadline is not restarted; persistent members or failed observation still require
  forced cleanup and cannot establish a successful run.
- Outer-launcher recovery uses the same exclusive root ownership and exact PG name/data-directory proof. It never kills
  a rediscovered PID or stops a competing live owner. OS containment and durable evidence do not promise that application
  cleanup code runs after whole-machine or whole-process-tree loss.

The control-flow tests use temporary child processes and, for Job compatibility, an empty owned PG fixture. They are
mechanical regressions, not actual-data/model acceptance. The complete frozen-source retest stays gated on production
transport, supervisor, independent review and appropriate integration checks.
