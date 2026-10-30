# D78 Actual-Data Validation — 2026-09-09

Status (2026-09-10): the third complete actual-data/model run passed. Both Banks have native certificates, complete
Taki evidence and raw replicas, and B4 readiness passed again after SQLite reopen. The consumer and supervisor exited
0; every owned service stopped without forced process termination. All three actual targets and their evidence are
retained. The first two failed runs remain failure evidence. Original user storage and active authority were not
changed; production activation and D77/B6/B7/manual acceptance remain outside this result. The owner approved isolated
actual Local-copy validation, the configured real models and correction/retest of demonstrated failures.
See [execution boundary](d78-real-data-execution.md).

## Input and target

- Source: the resolved current Core database, opened read-only with `query_only=ON`; SQLite's online backup API
  captured committed WAL state into the private run directory. No original database migration or authority change.
- Private runtime: `.trellis/.runtime/d78-real-data/06acadec47e7/`. The directory ACL allows the current Windows
  user and SYSTEM. The untouched snapshot and mutable `validation.sqlite` were byte-identical before migration:
  SHA-256 `e0347289db3004be5778be7d0805177e2e596930c248a6547173de6b915e3977`.
- Input: 35 migration receipts; active Canonical Local authority; 2 Banks; 722 sources and 722 units;
  718 historical B2 sources and 716 B2 results. B2 history is not a substitute for the complete current set.
- Actual Local coverage reader: 2,893 witnesses; Global 160 sources/160 units, Character 562 sources/562 units;
  701 valid and 21 invalidated units, all `experience`; 2 Blocks; no derived records or unit-source edges.
  Largest unit text is 1,092 UTF-8 bytes; largest unit metadata is 138 bytes. No records were filtered.
- Real providers: configured OpenAI-compatible `deepseek-v4-flash` at `https://api.deepseek.com/v1`;
  local `BAAI/bge-small-en-v1.5` embeddings and `cross-encoder/ms-marco-MiniLM-L-6-v2` reranker.
  Local models loaded from the existing cache and produced finite outputs; embeddings have 384 dimensions.
- Independent native PostgreSQL: `taki-d78-real-06acadec47e7`, with verified data directory inside this run.
  HTTP and database credentials are new per-run values, persisted only with user-scoped Windows DPAPI.
  The server uses ordinary native model implementations, broker and worker poller. No fixture outputs or model stubs.

## Findings and corrections

### Applied 023 schema differs from current 023

The copy applied 036–039 successfully, then the first B4 capture failed with `ERR_SQLITE_ERROR` because
`hindsight_cutover_runs` did not exist. A schema-only comparison with a fresh current database identified:

- Seven absent B4 run, staging, raw-replica and authority-receipt tables, plus two indexes.
- The old authority marker allows only `legacy-markdown` and `canonical-local`, and lacks native lineage/checkpoint fields.
- Old import operations have `content_hash`, without current content identity, provider hash or lease fence.
  Old import fact hashes have a weaker constraint. Both historical import tables are empty in this actual database.
- Receipt 23 contains only `version` and `applied_at` (`2026-08-21T15:26:11.434Z`), so the version number cannot prove
  which schema was applied. SQLite quick check passed and foreign-key check returned zero violations.

The focused migration-entry regression reproduced `no such table: hindsight_cutover_runs` before the fix.
Append-only 040 now selects exactly one recognized schema branch, normalizes the old empty import tables and marker,
and supplies the missing B4 schema in one transaction. Already-current 023 stays unchanged. Unknown/partial schemas,
unknown references or populated incompatible legacy imports fail without fabricated identities. Original 001–039
definitions and historical receipt bytes remain fixed.

Verification: 189 tests across 27 focused DB files; Core typecheck and scoped lint passed. The same actual copy then
applied only 040 and passed production capture/preflight: 722 sources, 722 units, 2,893 witnesses, 1,449 retained Taki
artifacts and 746 catch-up entries, with zero prerequisite gaps. B2, Canonical and original authority-column digests
remain exactly equal to the initial copy; the new native marker fields remain NULL.

Preflight Bank envelopes: Character 1,125 native records / 1,825,692 bytes of Canonical payload;
Global 321 records / 504,976 bytes. Exact wire-envelope checks still run after authenticated B3 baseline capture.

### Windows model probe environment

The first clean-process model probe failed because the inherited allowlist omitted `USERNAME`. Torch's cache
initialization called `getpass.getuser()`, which fell back to the unavailable Unix `pwd` module. Restoring the
non-secret Windows username and placing the Torch cache inside the owned runtime fixed the actual model probe.
No package installation or model replacement was needed.

The first native startup then encountered three automatic connection attempts through a Windows registry proxy,
which the test's network guard refused. Clearing environment proxy variables alone did not prevent registry lookup.
The task process now uses direct access to the already-reviewed provider and owned loopback endpoints. An anonymous
network probe reached the provider (401), then the genuine authenticated startup call returned 200 with the configured
model and 87 prompt / 14 completion tokens. Owned services were stopped and restarted with the same retained target.

### Harness interruption and privacy checks

The task runner now preserves stopped-owner evidence across preflight and repairs only interrupted B3 attempts to
`failed` using revision CAS before actual revalidation; Bank operation IDs and D78 identities stay intact. Stdin abort,
EOF and closure cancel the actual request signal. Twelve focused TS tests, strict types and scoped lint passed.

The Python supervisor takes an OS exclusive lock before any target access, rejects junction escapes, drains only its
owned child, and always attempts identity-verified target shutdown. PostgreSQL credential recovery tries the durable
DPAPI password first, including interruption after rotation but before metadata update. Native logs contain bounded
logger/location/error-type events rather than formatting memory-bearing messages or exceptions; direct third-party
output is counted without retaining its content. Usage-observer storage failures produce a separate incomplete marker
without changing HTTP results or inducing provider retries. Six focused harness regressions and Python lint passed.

## Evidence currently available

- `source-copy-summary.json`: consistent-copy metadata and source hash.
- `current-cutover-real-data-state.json` / `-events.jsonl`: current-source digests, stable operation identities and progress.
- `local-model-preflight.log`: original failed probe; `model-preflight.json` and `model-probe-process.log`: successful probe.
- `native/ownership.json`, `http-owner.json`, `native.log`, `native-process.log`: owned runtime identity/startup.
- `model-usage.jsonl`: actual provider HTTP statuses and available token counts; absent usage remains unknown.

All runtime artifacts are ignored/private. They may contain memory content in database or native diagnostics and
must not be committed. This report includes only counts, hashes, public model identity and error/schema facts.
The first full import succeeded, but maintenance/verification did not complete. No successful actual-data acceptance
is claimed at this stage.

## Earlier actual runs and native maintenance correction

The [retained first/second-run record](d78-real-data-prior-runs-2026-09-09.md) preserves the complete chronology,
cursor evidence, failed and passing regression rounds, tool paths and quality-hook limitations. It is separate so
the current result and operating constraints fit the task context-injection limit without truncation.

The first full-source run imported both Banks but correctly refused Global's certificate when ordinary consolidation
wrote an observation outside D78's action receipts. The periodic scheduler also admitted work for the waiting Character
Bank. Durable import-to-seal maintenance ownership now coordinates ordinary admission, worker/final writers and the
finite verifier with exact namespace/transfer/attempt fences and bounded cohort renewal. Models still execute normally;
unreceipted changes are not deleted, retrospectively certified or excused.

The corrected second run again imported both full Banks and recovered a lost import ACK without redispatch. Its consumer
failed about 306 seconds into a long verification HTTP request. Global eventually produced a genuine certificate, but
the supervisor and operator monitoring did not stop the target promptly. Character's waiting lease expired and ordinary
maintenance wrote uncertified derived data. The old outcome marker incorrectly said the result was known; that file and
both stopped targets remain preserved. This was a failed full run, not a completed all-Bank acceptance.

The native correction passed 186 full native-results cases and 252 affected ordinary/backup/migration cases. The 102
conditional skips solely concern migrations without concurrent DDL. Focused gates covered lease admission, actual-PG
migration/MVCC, queue/late-writer fences and one bounded retry of SQL stages affected by the real heartbeat. Model calls
and committed actions stay outside those retries. Independent review closed the source and fixture findings.
The required whole-native hook retained its same 27 API and 3 embed Windows type diagnostics with zero new diagnostics;
all other hook tasks passed and incidental formatter changes were restored. Canonical OpenAPI regenerated byte-identically.
The historical HTTP fixture's asyncpg teardown diagnostic remains recorded without a graceful-shutdown claim.

### Generalized correction and retest criteria

The owner's 2026-09-10 direction requires correction by failure mechanism, followed by verification across input and
lifecycle classes. Do not tune the implementation to the 722-source snapshot or merely move a hidden timeout.

- Reproduce header/body delays with a real loopback HTTP server. Distinguish transport limits, the captured total
  application deadline, caller cancellation and server disconnect. Keep finite deadlines and no automatic mutation
  replay; a lost response is not evidence that the remote operation failed or never committed.
- Resolve the production client's contract as well as the task runner's configuration. Verify explicit timeout
  behavior with more than one delay and with GET/POST, split response bodies, errors, cancellation and disconnect.
- Supervise consumer exit, task exceptions, server exit and metadata failures. Every terminal failure must trigger
  bounded shutdown of the owned services, preserve identities/evidence and classify uncertain remote outcomes honestly.
- Retain durable same-ID recovery and completed-action deduplication. Existing stale-source, ownership, full-coverage,
  hash and snapshot guards remain authoritative; no reduced dataset or skipped proof may turn a failure into a pass.
- Run focused deterministic regressions and independent review before another configured-model run. Use a fresh,
  byte-identical frozen source copy and new isolated target for the complete import/maintenance/certificate/raw
  reconciliation test. Observe consumer state and native progress together throughout that run.

The native `/verify` request currently performs a finite full candidate synchronously; its duration depends on the
required native work. Its public request contains only `expected_revision`, with no bounded-step execution field.
Durable status reads and receipt-backed recovery already exist. Passing one dataset does not establish a latency
guarantee for every Bank up to the transfer-size limit; timeout safety and full-envelope performance are distinct claims.

### Transport and observer correction gates

The controlled HTTP experiment reproduced separate header/body timeouts while the outer application deadline remained
active. A 2,200 ms response delay failed with `UND_ERR_HEADERS_TIMEOUT` / `UND_ERR_BODY_TIMEOUT` under a 100 ms phase
budget and a 5,000 ms outer budget; a 4,000 ms phase budget accepted the same response. The old client normalized that
transport cause to `HINDSIGHT_UNREACHABLE`. This proves the defect class, while the original second-run exception cause
was not retained and cannot be reconstructed retrospectively.

The production default client now uses a single HTTP/HTTPS request whose captured signal bounds connection, headers,
body and decompression. It preserves typed refusal schemas, TLS verification, decoded UTF-8 byte limits, and no
redirect/replay behavior. The first abort cause remains stable even for an injected transport that settles after both
signals fire; Node's lazy unobserved composite-signal behavior was separately reproduced. Bodyless replies and malformed
gzip/deflate/Brotli have their own response semantics. The real-data runner reuses this production delegate and gives
only this explicit validation a three-hour request budget.

Observer fault injection also demonstrated that a huge JSON usage integer could overflow `math.isfinite` and replace
a successful provider response. The repair isolates metadata validation, serialization and storage from the original
send result. It preserves the exact Response/exception and never consumes an unread stream. Invalid/missing metrics
remain unknown. `observation_status` separately records `write_errors`, `metadata_errors` and `serialization_errors`;
actual instrumentation failure leaves incomplete evidence without inducing a provider retry.

| Gate | Observed result | Evidence |
| --- | --- | --- |
| Initial full Core after default transport replacement | 2,298 passed / 9 failed; old global-fetch mocks did not reach the new default transport | `d78-validation/transport-1148d8aa2e21/` |
| Full Core after replacing those mocks with owned HTTP servers | 2,316 passed / 1 failed; a new test helper was incorrectly placed in the production-tree sweep | `d78-validation/transport-final-564595dbaac6/` |
| Final six-file transport/contract/privacy regression group | 97 passed; original budget, early-stop, UTF-8 and refusal assertions retained | Core colocated tests and `testing/hindsight-http-test-fixture.ts` |
| Final full Core | 319 files, 2,317 passed, zero failed/skipped; 54.752 seconds | `d78-validation/transport-reviewed-37a45ba5f51d/core-full-tests.json` |
| Final workspace types / root lint | Five typechecks passed; zero lint errors and the prior `run-repo.ts:6` warning | Same directory, `project-typecheck.log` / `root-lint.log` |
| Final isolated strip-only startup | Passed; migrations 1–40, zero FK violations/provider requests/activation; owned PID/listeners stopped; zero non-loopback attempts across the gate | Same directory, `boot-smoke-result.json` |
| Task consumer and completion receipt | 23 passed, zero skipped; strict standalone TS6 check passed | `current-cutover-real-data.test.ts` / `-completion.test.ts` |
| Native HTTP to Taki SQLite with the production delegate | One passed in 24.70 seconds; real lost-ACK/reopen/full proof/raw readiness and subsequent Local-drift refusal | `g1-validation/taki-hindsight-g1-55764c11f519/pytest.log` |
| Observer faults, independently rerun by root | 53 passed in 36.63 seconds; scoped Ruff and actual-venv typecheck also passed | `test_real_hindsight_observer.py` |

Runtime evidence paths above are relative to `.trellis/.runtime/`. The test helper was moved to the established
`core/src/testing` directory; the privacy writer guard itself was not changed. A previously false-green undeclared
503 test now proves that its real HTTP request occurred. The native integration fixture was stopped and its data and
registry removed, independently read back. It emitted two websockets deprecation warnings and native warnings about
ignored redundant namespace query parameters on `/verify`. These checks do not establish actual-model acceptance.

### Supervisor and process-tree correction gates

The supervisor now treats every consumer/server terminal outcome as a shutdown trigger. Only a zero consumer exit
plus the exact invocation-bound completion receipt and successful resource cleanup can establish success. Failures,
cancellation, metadata/observer faults, missing proof and forced process termination keep the outcome unknown. The
outer launcher contains its newly created process tree before admitting startup and retains the original process and
thread handles; it never identifies a kill target by rediscovering a PID. The earlier 72 harness plus 53 observer cases
passed together in 119.90 seconds, with scoped Ruff and actual-venv typecheck passing.

The first empty-PG Job probe, `g1-validation/taki-hindsight-g1-8e5e391df587/`, ran PostgreSQL 18.1 with `vector` and
`pg_trgm`, directly observed PG as a member of its owned Job, and completed the original guard with exit 0. Its owned
data and registry were removed. Immediate final Job cleanup nevertheless used forced termination, with all members
gone and the handle closed; the additional strict no-force probe therefore returned 1. This is retained as a failed
normal-exit gate, not reclassified as a fully passed run.

One additional diagnostic, `g1-validation/taki-hindsight-g1-68b61f227122/`, again proved actual PG membership and clean
database removal. At the original launcher's confirmed exit, one Job member was still unsignaled; it exited naturally
31 ms later. Waiting for that event made final cleanup non-forced. The diagnostic established an OS process-tree
timing boundary; its extra wait alone was not evidence that the unchanged production path handled it.

The formal path now spends at most the first half of its existing five-second Job cleanup budget on natural drain,
and only after the original launcher handle has confirmed exit. It reserves the remainder for forced termination and
exit confirmation without restarting the deadline. Persistent members and query failures still force cleanup and fail
the run; an earlier failure cause remains intact. The original 18 plus four new actual-process regressions passed in
9.69 seconds. They cover delayed natural exit, persistent descendants, query failure and budget exhaustion. Independent
review found no remaining issue in this increment; scoped Ruff/type/UTF-8/syntax/diff checks passed. The final complete
harness passed all 76 cases in 50.39 seconds. The unchanged observer retains its independently verified 53-case gate.
No third empty-PG probe was run.

The third full-source input is `.trellis/.runtime/d78-real-data/654131f0175a/`. Its private ACL contains only the current
Windows user and SYSTEM. Both initial copies matched the original frozen SHA; preflight applied 036–040 and again
retained every source/unit: 722/722, 2,893 witnesses, 1,449 artifacts, 746 catch-up entries and zero gaps. B2, Canonical,
source-audit and Local-authority digests remain unchanged. The supervisor/Job gates and independent review closed before
the final source manifest froze 950 Taki and 324 native files.

### Third actual HTTP run

The fresh target became ready at `http://127.0.0.1:4658` with owned PostgreSQL on port 5432. Control identity
`real-run-3` was issued at `2026-09-10T10:24:25.7817641Z`. Both complete Banks were imported: Global 321 mappings in
three pages and Character 1,125 mappings in nine pages. The committed Global import ACK was deliberately lost,
then recovered after SQLite reopen without redispatch. Exactly two transfer dispatches served the two Banks.

Consumer and native progress were observed together. The read-only private monitor was adjusted to recognize the
supervisor's new `running` state as well as
`ready`; it writes separate `native-status-running.json` and `monitor-running-progress.jsonl` evidence. Production
and frozen task-runner sources were not changed. The older monitor remains read-only and exits on the terminal server
state; its empty native projection during `running` is not used as evidence of zero native work.

The complete consumer finished at `2026-09-10T11:32:10.281Z`, 67 minutes 44.5 seconds after the control request. Its
supervisor finished at `11:32:15.430242Z`. Both exit codes are 0. The final receipt contains exactly the four required
fields for run `654131f0175a` and consumer `real-run-3`. The supervisor records all five service groups stopped,
`forced: false`, `all_exited: true`, `remaining: 0`, a closed Job handle and no cleanup errors. Both read-only monitor
processes also exited 0. Subsequent OS checks found no owned launcher/worker/consumer PID, no owned listener on 4658
or 5432, and no `postmaster.pid`; the actual database directory and ownership registry remain retained.

| Verified result | Global | Character |
| --- | ---: | ---: |
| Imported sources / units | 160 / 160 | 562 / 562 |
| Preserved invalidated units | 3 | 18 |
| Valid source requirements completed | 157 | 544 |
| Completed consolidation batches | 20 | 69 |
| Completed mental-model steps | 1 | 1 |
| Native action receipts | 329 | 1,084 |
| Complete evidence input records read by Taki | 19,324 | 72,118 |
| Retained raw snapshot records | 428 | 1,516 |
| Snapshot checkpoint cursor | 634 | 2,168 |

The native source rows show all 701 valid experiences consolidated and zero consolidation failures; all 21 prior
invalidated experiences remain invalidated. Native derived observations number 105 Global and 389 Character. The
ordinary queue contains only the two completed B3 refresh operations, with zero retries. These are actual producer
counts from the retained read-only `native-verification-complete-status.json`, not inferred completion counters.

Both deliberately lost responses recovered after SQLite reopen: the import ACK did not redispatch a transfer, and
the completed verification ACK did not advance or redo Global model work. Final counters are two transfer dispatches,
two verification advances and three SQLite reopens. Production B4 verification returned `eligible: true`, no blocking
codes, two imported/verified Banks, 1,446 object mappings and 722 unit mappings. The complete reconciled raw snapshots
contain 1,944 records. Checkpoint-set digest: `117d4f0a5e9cd57fe4b0f02d19bd8c978f0809adcde6d09ca75fa623f5f72e38`.

The final production source audit retained source digest
`f50c3c26d869af1ce39664d781479663f917d2cad0710eb3299918034d28f0a4`, B2 digest
`234ca6e0242bc34664dd537edc87f6514507896c617abc1fe30373868cf543f5` and Canonical digest
`a86e1aaa0c27b5ce19b11e9c4e86e394057522bbc4d57ce0f22d3d5b704bbf85`. Authority remains Canonical Local epoch
`b5d0b188-8b10-4847-b51a-41149f5b9dd2`; no activation receipt was created. The validation copy has continuous migrations
1–40, passes SQLite quick check, and has zero foreign-key violations. The post-run source manifest verifies all
950 Taki and 324 native files and both Git heads unchanged from the pre-run freeze.

Final actual-provider observations: 110 returned attempts, all HTTP 200; 932,904 prompt tokens and 413,360 completion
tokens, totaling 1,346,264 reported tokens. None of these returned attempts lacks total usage. The observer reports
complete evidence and zero metadata, serialization or write errors. These are reported token counts, not a monetary
cost calculation. Existing configured real models were used throughout; no fixture model outputs were substituted.

The frozen-source full run therefore passes this isolated actual-data acceptance gate. The corrections address
recognized schema lineage, durable maintenance ownership, bounded SQL-conflict recovery, complete HTTP request
deadlines, non-interfering instrumentation and owned-resource lifecycle. They do not key behavior to this snapshot's
IDs, record texts or count. The original source-drift, complete-coverage, hash, invalidation and readiness guards remain
in place. This run does not establish manual semantic quality, production activation, D77/B6/B7 readiness, every Bank's
maximum-envelope latency, or a clean whole-native Windows typecheck: its previously recorded 30 baseline diagnostics
remain. Character certificate completion to validated evidence took about 6 minutes 34 seconds; the final B4/reopen
checks took another 3 minutes 49 seconds. Those measured validation costs are retained rather than hidden by the pass.

Final private evidence also includes `actual-result-summary.json`, `consumer-real-run-3-complete.json`,
`supervisor-result.json`, `runtime-sources-verification.json`, `final-delivery-audit.json` and the unchanged logs.
The final delivery audit passed for 155 changed Taki text files and 277 changed native text files: valid UTF-8 without
BOM, clean diff whitespace and valid task context. Both main-branch heads and empty Git indexes stayed unchanged;
the protected native CLI hash and all three frozen input hashes match their original values. This audit did not open
original user storage, and no commit, push or task archival was performed.

## Complete Taki gate after 040

The isolated gate at `.trellis/.runtime/d78-real-data/040-checks-353ba00d3019/checks-ownedsubdir/` passed:

- Full Core: 318 files / 2,259 tests, 70.13 seconds.
- Five workspace typechecks; root lint has zero errors and one pre-existing unused-disable warning at `run-repo.ts:6`.
- Actual strip-only `main.ts` boot into a new isolated directory: continuous migrations 1–40, quick check OK, zero FK
  violations, `legacy-markdown` authority and zero Pending/cutover/activation rows. No model requests.
- The boot process and its two owned listeners were stopped; network guards observed zero non-loopback attempts.
  SIGTERM exit does not establish graceful-shutdown acceptance.

## Recovery scope deviation

During a sub-agent context recovery on 2026-09-10, reads crossed the stated worktree boundary: the T4 task pointer,
`09-03-avatar-presentation-lab/prd.md` and its `implement.jsonl` were read, task filenames were enumerated, and a
nonexistent `info.md` was existence-checked. No T4 files were modified. The deviation was reported to the owner,
the exact B4/native locations were restored, and subsequent work was restricted to the assigned files. These reads
must not be described as part of the authorized actual-data validation or as evidence that its scope was fully observed.

A second sub-agent recovery later on 2026-09-10 repeated the same class of deviation before the final Job-grace change:
it read T4 location/branch/worktree/pointer/status and the lab PRD/context manifests. No T4 write or experiment occurred.
The main agent disclosed this recurrence and resent the exact B4 file ownership and remaining change. When recovery
context is missing, the agent must first request the handoff from the main agent or assigned reviewer; an empty task
pointer or generic historical T4 memory does not authorize discovery in another worktree.
