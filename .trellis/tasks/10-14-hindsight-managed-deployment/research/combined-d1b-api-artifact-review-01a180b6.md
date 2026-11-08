# Combined artifact, D1-B and API/PG source independent review

## Initial checkpoint

- Status: `IN_PROGRESS`; no combined verdict issued.
- Root session `01a180b6-1dac-7fc2-b365-15fcb34dd4b4`; reviewer `/root/relay_review_recovered`.
- Workspace readback: `H:/TakiAgent`, `refs/heads/main`, exact head `e260ff4b0bf663b5faa0187bc6ec701fd2f007cd`; existing global task pointer remains empty. Root's explicit C2b assignment defines this batch.
- One combined review covers the actual application artifact and original evidence; D1-B contracts/domain/storage/operation/UI wiring; and the new Native API/PG source. No new child agents or repeated completed runtime/check suites.
- Load the original C2b plan/topology plus D1 PRD/design/implementation and relevant contracts; then verify real paths, preserved failures, final source hashes and validation logs. Treat later explicitly unimplemented runtime wiring as an acceptance boundary, not a fabricated defect.
- Exclusive writes: this report and matching evidence directory only. Root owns source corrections/integration and the heavy slot. All production source, packets, archives, earlier failures and task metadata remain read-only.
- No Docker/WSL/services/models/original data/dependencies/Git/test reruns or heavy checks. Report concrete blocking findings promptly with current paths/lines and the smallest correction.

## Checkpoint 2 - source review and original evidence reconstruction

- Status remains `IN_PROGRESS`; no blocking finding confirmed or combined verdict issued.
- Read the complete D1 PRD/design/implementation and candidate contract, candidate schema/domain/service/SQL, migration060 and the candidate operation handler/tests. Read all seven Native API modules, existing supervision and the nine-test deterministic file. Remaining focused reads cover central registry/boot/schema wiring and final source/check identity joins.
- Independently rehashed every one of the 24 application archive entries: byte counts and SHA-256 all match. `integrity.json` remains `ffca88ea834c0db1880f73e198492943b213e633fbe1a3111c6c1d6ed463cbd6`.
- Raw build commands show exactly one `buildx build`, exit 0, against the unchanged base image. The next command fails on the omitted empty `Config.Cmd`. Recovery contains only inspections; the original image ID/tag/token and all 21 base layers match. The original failure and executed script are retained.
- Runtime checker stdout matches the parsed checker record. Read its actual source and installer: complete application/bootstrap trees, all 221 METADATA files, full virtualenv/Python equality, pre-import wrong-build/missing-cache/corrupt-cache refusals, then actual tiktoken 0.12.0/cl100k_base load and generated roundtrip. Image/container retain the artifact-checker scope and `deploymentReady=false`.
- Raw create/start/inspection/remove/absence records join the same original container ID, no network, no mounts, no TTY/stdin, read-only root and bounded resources. All command children closed. The check/cleanup took 26,703 ms. All seven projected fields of each of the original eight workload IDs are unchanged; list ordering is not treated as an identity change.
- Rehashed Native source/check manifest and all eight current source files: exact match. Manifest `2312c406be9e6d35742da5f8dcf5703b821bc6c9f0adbd82470626eef6feba09`; final check `419577db9d911342d4fcc7eb57f1475cc79e5ca2fd55384348bdf291e45d86a0`. Retained logs show scoped Ruff, Linux/Python 3.11 ty, nine substituted-process/real-marker tests and eight AST parses passing. They do not establish API/PG runtime acceptance.
- Read Root's final D1 lint/type/test results and preserved failures. Initial combined selection: 20 failed / 117 passed across 23 files. Corrected five-file selection: 35 passed; final migration060 fixture: two passed. Shared operation schema: five passed. Shared domain's two-test record and final D1 source/check hashes remain to be joined. No reviewer check rerun occurred.

## Confirmed finding sent to Root - pending correction

- File: `H:/hindsight/docker/standalone/managed_bootstrap/api_child.py:97-101` and `api_server.py:106-109`.
- Issue: fallible observation publication can bypass owned cleanup. The child places `observation.publish(marker)` and `database.checked_stop()` in one try; a marker write error skips PostgreSQL stop. The server sets `shutdown_started` then calls fallible `withdraw()` before its protected stock-shutdown path; publication failure skips API/lifespan closure and subsequent shutdown calls return immediately. The real marker writer preserves an interrupted `.pending` file and can throw, so this is a reachable local storage failure. PostgreSQL can be detached into a separate process group; the API OwnedChild group is not a substitute for its stop. This is earlier than the explicitly accepted hard-deadline fallback.
- Required correction: retain observation failure while always attempting API closure and PostgreSQL checked stop under the existing first-stop deadline. Do not turn failed evidence publication into graceful acceptance. Add a deterministic marker-write-failure cleanup regression. Root owns the source change/check slot; the reviewer does not mutate source.

## Completed combined review

Status: `CHANGES_REQUIRED` for the single Native lifecycle finding above. The application artifact
prerequisite and D1-B source/integration scope have no blocking finding. Root acknowledged the
cleanup finding and owns its correction and affected validation. This review is complete and its
write ownership is released; it does not introduce another independent-review round.

### Findings (fixed)

No production fixes were made by this reviewer because the assignment reserves production source
to Root. Already completed Root corrections were verified in the retained evidence: optional Docker
map access recovers the original successful build without replay; historical fixtures explicitly
create/reopen the admitted head059 profile; migration060's Config fixture uses its scalar JSON string.
Their original failed records remain intact.

### Findings (not fixed)

One blocking source correction remains assigned to Root: marker-publication failures must not skip
API/lifespan closure or the owned PostgreSQL stop attempt. Exact locations and correction are recorded
above. The nine existing Native tests cover launch/privacy/identity/budgets and marker IO, but do not
cover cleanup after marker-publication failure. No other blocking finding was confirmed.

### Verified behavior and scope

- Application artifact: all 24 archived files match their recorded bytes/hashes; raw build, recovery,
  image/tag/base-layer joins, installed tree/metadata/environment checks, actual offline tokenizer,
  exact container cleanup and unchanged workload projections support the stated prerequisite.
  The archive is an artifact-checker run, not an API producer run. Its consumed build/check token and
  original G: snapshots remain immutable; later Native source belongs in a new producer image.
- D1-B: Shared request/producer/result/error unions and narrow package export reach the registered
  prepare/inspect/resume handler. Admission and candidate association share the Memory Operation
  transaction; domain storage retains immutable facts, original Effect dispatch fences and exact
  observation receipts. Generic lifecycle/terminal state stays in Memory Operations. Inspection
  cannot dispatch, uncertain effects do not replay, and explicit continuation captures fresh currency.
  Driver scopes are revoked after completion. The actual service always supplies the local-only boot
  receipt classifier before generic foreign-boot reconciliation, even without a candidate driver.
- D1 lineage: controlling-Core migration060 is registered and additive; it does not silently upgrade
  the immutable archived-Core reader or widen D1-A admission to source060. Tests preserve populated
  head059 config/receipts, immutable-reader bytes, reopen behavior and migration-receipt rollback.
  The three Home labels and affected source indexes/contracts are present. No platform/template
  generation change is required for those operation labels or the new Shared subpath.
- Native source: fixed CONNECTION-only mapping, no-model profile, immutable pre-import build/cache
  gate, original-grant launch ACK and one-dispatch fencing are represented in source and deterministic
  tests. The API child owns the stock ASGI path plus separately identified PG lifecycle; real PG/API
  operation is still unexecuted in this evidence. The single cleanup finding prevents unconditional
  source acceptance until Root corrects it.

### Verification

All verification below is an independent readback of retained execution and source identities, not a
reviewer rerun. Source/check hashes describe the handoff before Root's pending lifecycle correction.

- Lint: PASS for D1 final scoped ESLint (`lint-a2`) and Native scoped Ruff (`checks-final-2.json`).
- TypeCheck: PASS for final Shared/Core/Desktop (`shared-a1`, `core-a2`, `desktop-a1`) and Native ty
  targeting Linux/Python 3.11. The earlier Core scalar-Config type failure is retained.
- Tests: PASS for corrected D1 five-file regression selection (35), final migration060 selection (2),
  Shared domain schema (2), Shared operation schema (5), and Native deterministic selection (9).
  The original Core 23-file selection remains recorded as 20 failed / 117 passed; its 18 passing
  files were retained, then its five failing files were corrected and rerun. These are separate
  evidence records and their passing test counts must not be added as disjoint totals.
- D1 final source checkpoint: all 30 source entries and 15 preserved check-result entries match.
  `d1b-root-validation-01a180b6/source-checkpoint.json` SHA-256 is
  `e2a77c25b0694b11fdd4b9461545423b27c33238a339edfeea0115f4e00452be`.
- Native handoff: all eight source files and four check/runner files match their manifest; original
  formatting/static-path failures and final passing results remain preserved. The pending cleanup
  correction requires Root to record its changed-source checks rather than reusing these old hashes.
- Specs: current candidate spec documents transaction ownership, no replay, driverless receipt reads,
  head059/archive versus controlling060 lineage and frozen migration SQL. Managed deployment spec
  documents safe optional Docker-map inspection and recovery without rebuilding.

### Remaining acceptance boundaries

Actual API/PG initialization, ordinary migrations, authenticated manifest, listener/relay provenance,
engine/pool closure, checked PG shutdown, explicit same-volume restart, installed Host receipt/setup,
and D1-C/D restore/verifier acceptance remain open. D1-B source, generated deterministic records and
the tokenizer artifact do not establish them. `deploymentReady=false` remains correct.

No Docker/WSL/service/model/dependency/Git action, source mutation, test rerun, archive mutation or
cleanup was performed by this reviewer. Only this combined report was changed.
