# W5 isolated genuine HTTP diagnostic implementation

Date: 2026-10-05. Status: implemented for independent review and one parent-owned actual-model run.
This delivery does not execute that run, replace application authority, release the working pair, or complete W5.

## Scope and files

The new `w5-http-diagnostic.py`, `w5_http_composition.py`, `w5-http-client.mjs`, and
`w5_http_inventory.py` compose the frozen clone/migration/model lifecycle with genuine HTTP. The two new
`test_w5_http_*` files exercise the bounded wiring and failure contract. New dependency/source inventories,
this report, and `w5-http-checks/` contain the implementation evidence.

The complete 404-entry head-prefetch predecessor remains unchanged at
`ca275f841f3f5a66620be833a692b33117b9256b735f1cf10f4c17f6522647fb`. There are zero production,
existing helper, spec, predecessor report, or predecessor manifest replacements. No dependency installation,
real-corpus conversion, working-pair operation, model/cache change, commit, push, or archive is part of this delivery.

## Genuine path and limits

The Python child uses the original actual `LocalSTEmbeddings` initializer and passes that object directly into
the real `MemoryEngine` constructor. It does not call the old synthetic-placeholder `prepare_interceptor`.
Normal local reranker and query analyzer initialization remain enabled. Readiness records the loaded reranker's
actual transformer config commit hash; missing local readiness fails closed without download or substitution.

Before construction/initialization, the exact approved task-only environment disables workers, startup LLM
verification, consolidation reconciliation, mental-model refresh, audit/LLM-trace recording and retention, and
operation retention. Real SQL-store, cross-store recovery and `MaintenanceLoop._any_job_enabled()` checks run
before initialization. Task-only LLM, maintenance and dispatch guards record and refuse accidental calls.
The genuine engine `_transition_service` derives the authenticated actor, which must equal the persisted clone
actor before normal claim. Actor identity is never adopted from the stored value.

`create_app(real_engine, initialize_memory=False)` runs under actual uvicorn on an exclusively bound owned
loopback socket, using the genuine auth, router, request/response schema and engine/service methods. The outer
ASGI observer and method wrappers delegate unmodified behavior and retain sanitized timing/size information.
The listener closes and delegates restore even if app/server construction fails. Shutdown uses the approved
20-second graceful bound and 25-second outer wait. Missing/malformed Node results still permit the post-drain
SQL audit; any late delta is outcome evidence, never HTTP success or permission to retry.

Node imports the real Core public client, transition proof and HTTP transport only after its built-in source/
launch validation and parent admission. Setup performs health, compatibility, status and one normal claim.
Only the claimed executor replaces the immutable prepared request's executor; the original delta hash must
still match actual signing. Exactly one public `applyTransitionDelta` call uses `timeoutMs: 60000`, with no
POST retry. Its full method interval includes the genuine conditional capability GET, input parsing/signing,
serialization, bounded transport/body, response schema and proof validation. A successful return taking
60000 ms or longer is refused before lookup. One subsequent exact GET must equal the complete apply result.
The allowed transport paths/origin are explicit; the real transport retains response limits and typed refusals.

The original V2 direct Python worker and the new Node client are siblings held by the parent through their
original Popen handles. Parent checks executable/creation identity and child reports before admission. Node
handshake/admission remains bounded at 10 seconds. No process-name or reconstructed PID termination is used.
One continuous 180-second initialization anchor spans model imports through complete engine/server readiness;
the old model initializer's intermediate phase cannot restart it. The 900-second overall watchdog remains.
Node cleanup is in the parent supervision `finally`, including Python/watchdog failure.

Final `http-result.json` requires all six before/after source reports, original model/worker success,
persisted embedding and watchdog agreement, Node launch/self/held/admission/exit agreement, successful drain,
port release, engine close, preserved maintenance and original/source/Core/input custody. Missing or malformed
reports refuse success. Even failure to read the original result digest produces a failed final HTTP report.

## Approved socketpair exception

The parent-approved Windows exception is restricted to the standard library's internal `socketpair` call
on the current thread. It supports asyncio wakeup sockets when genuine engine initialization starts an event
loop in a worker thread. The exception clears in `finally`; other threads and ordinary sockets cannot use it.
Ordinary Python outbound connections remain restricted to the owned PostgreSQL address. The established
`09-07-hindsight-recovery-evidence/research/validation/g1_fixture_network_guard.py` reference is pinned in the
new dependency inventory. Tests cover actual threaded socketpair/event-loop creation, failure cleanup, denied
ordinary loopback/provider traffic, and another thread trying to connect while socketpair is in progress.

## Fixed dependency and source union

`w5-http-dependencies.json` fixes 4693 paths (183725203 bytes), including 30 identical predecessor entries.
Its SHA256 is `15540ca2b6a078fc0e0a4de91c08643900abe7f536e47732186ba60b4863810d`, embedded independently
in both new verifiers. Discovery uses actual Node Core import hooks, the successful fixture's 226 Native
source imports, actual app/uvicorn import closure, HTTP distribution source/data files and installed metadata
for the imported distributions. Node executable, workspace exports/package/lock inputs and the approved guard
reference are explicit. No model cache or arbitrary whole-environment directory is inventoried.

The dependency file separately declares the exact 17 new artifact paths, including `fixture-wiring.json`.
The final source union is predecessor + fixed dependencies + declared additions, with duplicates, omissions,
extra files, self-declared addition expansion and predecessor/dependency replacement refused. Python and Node
both hash every file before and after execution. Runtime verification does not glob or expand the dependency
set. The source manifest does not hash itself; its final SHA is supplied in the handoff, avoiding a digest cycle.

The complete union contains 5084 files. A pre-seal verification over that same fixed union passed in both
languages: Python 15.250s, Node 5.210s, and Node process startup plus verification 5.390s. The Node process
completed under an unchanged 10s external timeout, leaving 4.610s of measured handshake margin. These are
local observations, not a relaxation or guarantee of the hard runtime admission bound. Updating this report
and the quality evidence is followed by final resealing and another same-identity verification.

## Executed verification

| Evidence | Actual result and limits |
| --- | --- |
| `w5-http-checks/python.json` | Full offline suite: 35 PASS / 1 owned-PG skip in 81.13s; final additive fixed-union regression: 1 PASS in 8.96s; final affected persisted-report cases: 54 PASS in 8.21s. Later targeted runs used explicit 60s process bounds. |
| `w5-http-checks/node.json` | 6 PASS using actual Core imports and real loopback sockets; explicit 30s process bound. |
| `w5-http-checks/owned-pg.json` | One owned PostgreSQL + genuine engine/uvicorn + actual Core client fixture: 1 PASS in 70.14s. Two installed websockets deprecation warnings. |
| `w5-http-checks/fixture-wiring.json` | Sanitized server/transport/public timings, original method delegation and 226 actual Native imported source paths from that fixture. |
| `w5-http-checks/quality.json` | Ruff check and format, `ty` on the three Python implementation modules, Node syntax on both JS files, and explicit scoped ESLint recommended rules: all exit 0. Repository ESLint excludes `.trellis`, so the exact isolated lint configuration is recorded. |

The owned fixture is `taki-hindsight-g1-1675ed916239`; its saved cleanup reports Stopped, DataRemoved and
RegistryRemoved all true. Its deterministic embeddings and fixture reranker establish wiring/authentication,
normal claim, one apply, exact lookup, method telemetry and cleanup only. They do not establish real model
readiness, corpus timing or HTTP acceptance. The successful PG fixture was not repeated after the later
offline failure-boundary and inventory work.

The actual apply socket regression includes a 120ms delay in its second compatibility GET and proves that
delay is inside the public duration. Separate iterations delay the apply POST body past the actual Core
deadline and corrupt a schema-valid response proof. Both fail without retry or lookup. Other cases cover
oversized/invalid JSON, typed refusal, wrong parent/job/executable and fixed inventory corruption. Initial
socket fixture admission failed because re-entry lacked its required baseline; the fixture was corrected to
use the production acquire schema's baseline fields, without relaxing production validation.

Exact commands and captured outputs are in the named JSON evidence. The final targeted Python commands use
`-k fixed_inventory_union` and `-k 'reports or report_digest or prelaunch_inventory'` with `--noconftest -o addopts=`.
No full repository suite or unrelated package check was run.

## Parent continuation

After independent review verifies this final source union, the parent may execute exactly one approved clone:

```powershell
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w5-http-diagnostic.py --run-reviewed-clone
```

The default invocation is inert. Real model readiness and complete actual-model HTTP timing remain unproven
until that run. Its result must distinguish initialization, full public duration, transport/server intervals,
exact lookup, late receipt evidence, preservation and cleanup. The existing 49.318s direct Native result is
not HTTP acceptance. Maintenance, same-transition working-pair recovery, W5 acceptance and W6-W8 remain later gates.
