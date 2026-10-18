# C1 independent readiness excerpt 3

Source: `.trellis/tasks/10-07-hindsight-template-lifecycle/research/stage5c-c1-readiness-review.md`; SHA-256 `7589003217c782fa3904e6a097c14212edbb48c73d351e057dd8c51aabeb3562`.
This is source/design evidence, not code or installed-platform acceptance.

### 7. C1 and C2 ownership; bootstrap evidence cannot be deferred invisibly

Current Native source facts are detailed in `stage5c-custody-design.md`: `config.py:25-41` enables dotenv override; the lock and inspected python-dotenv 1.2.2 source support `PYTHON_DOTENV_DISABLED=true`; `start-all.sh:170-222` has the shutdown/cleanup behavior and `:228-245` directly starts Native. A new PID1 bootstrap changes those process and log relationships and therefore needs execution proof.

| Checkpoint | Owner and deliverable | Acceptance boundary |
| --- | --- | --- |
| C1a | One cohesive implementation owner: pure codec, compiled install tree, actual Windows/Ubuntu Host invocation, private snapshot + accepted-evidence seam, registered release Host lifetime. | Independent custody/provenance/installation review before bootstrap integration or C2 consumption. Supported-OS checks stay explicitly unverified where no fixture exists. |
| C1b | Same owner after Native source handoff: Python bootstrap/submitter protocol and fake-secret process fixture; prototype restart observer interface with a fake resource adapter. | Prove private framing, signal/reaping, bounded logs, fresh startup identity and failure states. C1 may close source/process deliverables while explicitly blocking deployment readiness on missing real-Docker evidence. Update C1 AC wording accordingly; do not mark the original full Docker AC passed from process evidence. |
| C2a | Managed-resource owner: durable non-secret owned-resource registry, exact-container observer/supervisor adapter, startup maintenance authorization, inspect/reconcile/create behavior. | An actual isolated Docker fake-sentinel test must prove inspect/config/log/file behavior, full container restart, tmpfs freshness, helper death and daemon restart before this mechanism can deliver real credentials or mint trusted deployment receipts. |
| C2b | Core consumes accepted deployment ledger references; supervisor binds actual resource generation/readiness. | Lost replies are inspected by original IDs, never replayed. Missing Core/helper/key leaves Native unstarted. C3 model readiness remains separate. |

C1 supplies the release Host's lifetime and restart state-machine contract now, including Home closure independence. C2 owns the real persistent deployment list and Docker event/polling adapter. Do not leave both tasks waiting for the other to define the observer. Windows custody is available in the logged-in registered user's session; pre-login unattended custody is not promised by the existing account model. Ubuntu uses the explicitly installed service. A fake adapter verifies transition logic, not actual Docker behavior.

The bootstrap candidate remains: PID1 waits without secrets, generates fresh `startupId`, creates a protected tmpfs socket, accepts one exact-startup private frame via fixed no-TTY `docker exec -i` submitter, and starts the existing wrapper with child-only in-memory credentials. It must discard/bound raw output before Docker logs, disable dotenv, preserve process-group termination and wait/reaping, and reject old ACKs. The database shutdown window must allow the existing wrapper's graceful work rather than immediately killing it at a short adapter timeout. A container administrator or same-UID malicious in-container process remains trusted; mode bits do not isolate it.

No current environment action occurred. If the isolated Docker/Ubuntu fixture is unavailable, preserve a named unsupported/unverified gate and proceed with other source work. Do not silently start the owner's stopped daemon, use real keys/providers, or substitute `--env-file` / `docker exec -e` when the private-channel experiment fails. Revise the mechanism based on evidence instead.

### 8. Bounded independent validation matrix

Evidence levels: **S** = source/design; **U** = unit/contract; **P** = actual child process; **W/L** = supported Windows/Linux OS; **D** = actual isolated Docker. Only S was gathered by this review. Run focused checks after each cohesive checkpoint, then one integrated C1 check; do not combine this custody boundary with unrelated template work. Heavy tests remain serialized and Vitest uses at most two workers.

| Cases | Required assertion | Evidence needed / gate |
| --- | --- | --- |
| Known TSC1 fixture; wrong key/store/AAD/magic/version/final tag/truncation | Existing codec behavior preserved; no catalog/key writes or partial value output. | U; C1a |
| Installed empty-cwd run, unavailable checkout/store, missing sodium asset, modified package export, injected preload | Complete compiled closure works; unsafe or incomplete closure refuses. | P plus W/L; C1a |
| Copied operator receipt/status; forged helper trust fields; wrong Host/control/input/attempt; duplicate terminal | No successful accepted evidence/receipt; ordinary capabilities and existing-instance setup still work. | U plus real in-process broker/Host integration; C1a |
| Core attempt differs from broker operation/Host attempt; response arrives immediately at notify | Correct map exists before execution and is retained through acceptance. | U; C1a |
| Fixed Date set/clear; A-B-restore-A; rotation mismatch; failed publication; externally replaced envelope | Private owner revision/digest identify current state; stale attempts fail even when old bytes/timestamps return. Failed publication does not advance owner state. | U plus file integration; C1a |
| Rename after helper open; replacement during final read; Core restart or policy/config/Host change before acceptance | Old descriptor/prepared output cannot become current; final guard occurs after asynchronous boundaries. | P plus W/L; C1a |
| Reparse/unsafe parent/DACL/owner; replacing runtime/module/adapter between verification and use | Actual objects remain protected or refusal occurs; no alternate path/key/account fallback. | W, not mocks alone; C1a |
| Wrong service UID; stale other-service credential directory; symlink credential; wrong role/token; unattended ask | Correct service-local source and role=node gate; unavailable rather than bypass. | U plus L; C1a |
| Oversize/partial/trailing/duplicate frame, wrong startup, EOF timeout, raw secret-bearing error | Bounded allocation/lifetime; no sentinel in WS/argv/stdout/stderr/status/fixture files. | U/P; C1b |
| Helper/Core loss before delivery; lost ACK after delivery; restarted bootstrap; changed custody | Native remains unstarted or original startup is inspected; no blind injection/create replay. | P plus fake observer U; C1b; D at C2a |
| Stop signal during bootstrap and running wrapper | Signal reaches owned process group, children are reaped, graceful DB shutdown is actually observed where a DB fixture exists. | P; DB/D proof at C2a |
| Actual no-TTY exec delivery, inspect/config/log/file scan, full container/daemon restart, tmpfs reset | No fake sentinel in persisted surfaces; fresh startup requires fresh authorization; old ACK refuses. | D; blocking C2a gate before real delivery/receipt |

Record command, source/artifact identity, actual exit result and exercised platform for every eventual check. Fake model adapters must fail on an unexpected external call. Secret sentinel scans should test failure output and crash paths as well as success. None of these checks was run by this reviewer.

## Files found and related specs

| Path | Role in the review |
| --- | --- |
| `.trellis/tasks/10-07-hindsight-managed-host-custody/{prd,design,implement}.md` | Current C1 planning artifacts; major recommendations already acknowledged, exact contracts still open. |
| `.trellis/tasks/10-07-hindsight-configuration-observation/research/stage5c-host-boundary-research.md` | Prior current-source Host/model boundary inventory. |
| Same directory, `stage5c-custody-design.md` | Decoder/bootstrap proposal and Native/library source references. |
| `.trellis/tasks/08-09-memory-operations-ui/research/stage5-execution-map-2026-10-07.md` | Stage sequencing and producer dependencies. |
| `packages/core/src/capabilities/{capability-broker,capability-response,route-capability,capability-challenge}.ts` | Actual issued identity, terminal acceptance, route mapping and permission challenges. |
| `packages/core/src/server/methods/{capability-respond,connect}.ts` | Authenticated Host provenance and node enrollment. |
| `packages/core/src/secrets/{secret-catalog-service,secret-catalog-envelope,catalog-publication,master-key}.ts` | Owner state/revision, TSC1 codec, atomic publication and existing key adapter. |
| `packages/core/src/memory/hindsight/{hindsight-setup-service,hindsight-configuration-context}.ts` | Current raw managed receipt consumer and private observation identity. |
| `packages/shared/src/{hindsight-setup-schema,secret-catalog-schema}.ts` | Existing JSON receipts and public secret limits/projections. |
| `apps/desktop/src-tauri/src/{capabilities_impl,secrets}.rs`, `src/bin/{taki-secret-key,taki-node}.rs` | Executor context gap, actual token SID, get framing and debug-only node limit. |
| `packages/shared/package.json`, root `tsconfig.base.json:13`, `pnpm-lock.yaml` | Source exports, extension rewriting and pinned build/runtime closure. |
| `.trellis/spec/backend/secret-catalog.md` | One writer, private revision, public no-value projections and locked semantics. |
| `.trellis/spec/backend/host-operation-lifecycle.md` | Original Host/input/generation ownership and unknown outcomes without reconnect replay. |
| `.trellis/spec/backend/permission-authorization.md` | Core canonical governance and stricter-only Host execution. |
| `docs/adr/0006-mcp-processes-vs-no-os-invariant.md` | Narrow key-bootstrap exception is not a Core deployment-spawn authorization. |

## External references and versions

No network research or new dependency selection. The supplied custody report records Node 24, locked libsodium-wrappers/libsodium 0.8.4, Native Python 3.11 base and python-dotenv 1.2.2 source. Its Native `config.py`, `start-all.sh`, Dockerfile and installed dotenv references support the proposed spike, not an installed-image attestation. Exact release OS/runtime/image hashes are intentionally not invented and must come from the later trusted artifact/fixture.

## Caveats / Not Found

- This is a readiness review, not code verification. No tests, services, processes under test, Docker, network, Git, dependency installs, real credentials or original data were used.
- The legacy `.trellis/.current-task` file was empty on the read after compaction. The leader explicitly supplied the active B task/output location; no task binding or state was changed by this reviewer.
- Only this research report was written. C1 remains planning-only and B1 retains its assigned production files. Source line numbers describe the observed snapshot and may move with B1 changes.
- No current installed custody helper, Ubuntu release Host, accepted managed-deployment producer or verified Docker secret bootstrap was established by this review. Their absence is not repaired by strict JSON schemas.
- The helper shares the trusted local credential owner's access and transiently decrypts the whole catalog. This does not provide per-entry cryptographic isolation, reliable JavaScript secure erasure, protection against the owning OS/Docker administrator, or instantaneous revocation of a running Native process.
- The proposed protocol caps are new helper safety limits. The existing TSC1 catalog has no aggregate size guarantee; imported/restored entries need explicit checks. Fail safely and document unsupported size rather than silently changing storage format.
- Supported-platform installation and real Docker evidence must remain named gates. They cannot be claimed from source review, mocks or a successful Windows-only build, and cannot all be postponed to Stage 6 while enabling real managed delivery in C2.
