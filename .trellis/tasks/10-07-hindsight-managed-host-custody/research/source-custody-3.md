# C1 source research excerpt source-custody-3

Source: `.trellis/tasks/10-07-hindsight-configuration-observation/research/stage5c-custody-design.md`. SHA-256: `b9d867a35b1fb41d573d831cf13d21be2e39d848eb9421508e733d458f97fc4a`.
This excerpt preserves the completed source research; it is not implementation or acceptance evidence.

### 6. Docker credential boot: concrete candidate and missing proof

#### 6.1 Current source cannot satisfy the requirement by itself

- `docker/standalone/Dockerfile:183-199,268` copies and runs `start-all.sh` as unprivileged `hindsight`. `start-all.sh:228-245` invokes `hindsight-api` directly and checks `/health`; it has no stdin credential protocol or runtime-secret supervisor.
- Native config reads credentials from process environment (`hindsight_api/config.py:3003-3006`). `server.py:33-59` loads dotenv and constructs the engine before requests.
- `config.py:25-41` explicitly calls `load_dotenv(find_dotenv(usecwd=True), override=True)`. The managed launcher must disable this. The pinned `uv.lock` python-dotenv package is `1.2.2`; installed matching library source `.venv/Lib/site-packages/dotenv/main.py:22-29,409-416` implements `PYTHON_DOTENV_DISABLED=true`. This source evidence supports using that flag; the final image still needs a locked artifact check.
- Existing compose/test scripts pass keys as container environment. There is no source-backed promise that those values avoid Docker configuration/inspection. Neither an env-file nor an inherited `-e KEY` is an acceptable substitute for proving custody.
- Native daemon support detaches with stdin closed and redirects logs to a file (`hindsight_api/daemon.py:63-108`). It is not the proposed private credential bootstrap.

#### 6.2 Proposed minimal bootstrap lifecycle

Use the Python standard library already present in the accepted Linux image; no Docker SDK or extra runtime dependency is required for the design. The following modules/protocol do **not** currently exist:

1. A small PID1 bootstrap starts with only safe non-secret config in Docker `Config.Env`, and a configured tmpfs runtime directory. It creates a fresh `startupId` and a mode-restricted local Unix socket there, then reports `waiting_for_credentials`. It does **not** start Native or expose model operations yet.
2. The host helper addresses the **exact inspected owned container ID** and fixed bootstrap submission program via Docker exec with stdin enabled and **no TTY**. Only non-secret operation/startup/config IDs occur in argv. The framed secret payload is written to that exec process's private stdin; it is not shell-interpolated, sent to Docker `Env`, written to a host file, echoed to stdout or placed in a docker command string.
3. The short-lived Python submitter forwards the frame to the bootstrap's protected Unix socket, verifies the startup challenge, and receives a bounded acknowledgement. Payload fields are the fixed approved slot set plus operation/startup/config identities. The bootstrap rejects extra keys, wrong/old startup IDs, oversize frames and a second conflicting configuration. The container owner/Docker administrator is a trusted boundary; a same-UID malicious process inside the container is not isolated by Unix file mode alone.
4. Bootstrap builds the child's environment in memory, sets `PYTHON_DOTENV_DISABLED=true`, and starts `/app/start-all.sh` (or a reviewed equivalent preserving its shutdown behavior) with a fixed argv. Provider credentials live only in the Native child environment/client memory. Do not use `docker exec -e`, `env KEY=value`, a shell script containing values, or write `.env` inside the container.
5. Bootstrap owns child stdout/stderr pipes and emits only bounded structured state/reason events. Raw Native output must not reach Docker logs or a persistent daemon log by default. This matters because the standalone worker currently prints its database URL (`worker/main.py:246`), and startup verification can log underlying provider exceptions. A future raw diagnostic export needs its own sanitization contract, not incidental passthrough.
6. Bootstrap supervises termination and reaps children. Preserve the existing graceful stop behavior (`start-all.sh:170-222`) and prove signal propagation when it is no longer PID1; forwarding only to the wrapper without its children is insufficient. It records no plaintext credentials on disk. Its acknowledgement binds startupId/config digest and actual child lifecycle; API `/health` and 5A observation remain separate checks.

This avoids deliberately placing provider values in Docker creation/exec environment fields. It does **not yet prove** how Docker daemon/CLI attach streams, logs, container checkpointing, or crash dumps behave on the supported installation. Ordinary process memory remains sensitive; the design does not claim protection against the OS/container administrator.

#### 6.3 Restart contract must be explicit

After Docker restarts the container, the bootstrap has no credentials and a new startupId. It must wait. Restoring a named database volume or setting Docker `restart: always` cannot regenerate the missing values.

A release-safe helper supervisor must inspect registered owned deployments and, for an already admitted unchanged configuration, perform a new generation-bound credential delivery from the current catalog. This is a narrowly authorized restart-maintenance action, not replay of setup/create or an old pending Host request. An uncertain prior effect is inspected first. If configuration, key version, Host policy or resource ownership changed, stop at a visible stale/locked state and require revalidation.

- **Windows:** the observer must survive Home closure and use the same logged-in user's credential scope. Starting it only as a short-lived child of a dialog does not meet the restart requirement. A hidden installed helper supervisor associated with Shell/user session is a candidate; unattended restart before that user's login is not supported by the current Credential Manager account model. A Windows service-account solution is a different installation/custody choice.
- **Ubuntu:** the same Node helper can run as a dedicated release service/CLI with explicit `LoadCredentialEncrypted=` inputs and a persisted non-secret deployment registry. It must never depend on `taki-node`, desktop approval dialogs or a Tauri-linked Linux helper. Required Node/Host token credentials and service authorization are provisioned explicitly at installation.
- **Helper/Core/key source unavailable:** the container remains alive in `waiting_for_credentials` or exits with a typed failure according to the finalized supervisor contract; Native stays unstarted and no `ready` receipt is issued. This is fail-closed recovery, not automatic availability. Existing-instance connections remain usable.

**Mandatory spike before C1/C2 is dispatch-ready for real credentials:** implement a fake-secret bootstrap fixture and validate frame delivery, exact-container/startup binding, no sentinel in Docker inspect/environment/config/logs/host files, abrupt helper death, full container restart with tmpfs reset, daemon restart, host-user session loss, duplicate injection, locked/rotated catalog and graceful database shutdown. It must use fake providers/isolated storage and no paid/model calls. A source review alone cannot mark this path proven; none of those runs occurred here.

### 7. Proposed C1 implementation/check boundary

1. Freeze strict request/result/registration schemas and installation manifest; extract the existing codec without format changes. Add read-only custody helper with Windows get-only and Ubuntu credential-directory adapters. Public output: slot presence, source/key/config identity, refusal category; no values.
2. Add installed-path/digest/user-binding validation and helper invocation behind the canonical Host path. Provide a release-safe Node CLI; define Ubuntu Host registration rather than accepting operator-generated receipt JSON. Keep existing-instance setup independent of helper availability.
3. Implement and test the fake-secret Native bootstrap spike above. Only after that proof select the precise observer/service packaging and permit real credential delivery. If proof fails, revise this mechanism; do not default to Docker env-file storage.
4. Independent check should cover artifact tampering, wrong user/store/Host, generation/digest drift, one-writer behavior, secret sentinels across every boundary, and crash/restart. This warrants its own check before C2 provisioning or C3 model lifecycle work.

The helper's read-only codec is small; its **custody plus restart boundary is not**. One implementation owner can own Shared/codec/helper packaging initially, while Native bootstrap changes wait for the 5A source handoff. Combining C1 with unrelated template work would make its acceptance harder to assess.

### 8. Engineering choices versus owner environment choices

The leader can choose the decoder approach, module/package split, manifest layout, fixed slot protocol, generation/digest checks, stdin framing, hermetic fixtures and check cadence. Those derive from current code and approved scope.

Still unresolved technical proof: packaged dependency resolution outside a checkout, Windows ACL/user provenance, release-safe Ubuntu Host control integration, Docker stdin/attach handling, bootstrap signal/log behavior, and restart observer lifecycle. These should be engineering spikes, not vague product questions.

Actual owner decisions are needed only for selecting/installing a real Docker/Node/system service, granting OS/Docker privileges, choosing the deployment host/state directory, choosing unattended Windows service-account behavior, supplying real provider keys/models, permitting downloads/paid calls, or touching existing data. This research neither performs nor requests those actions.

## Related specs / references

- `.trellis/spec/backend/secret-catalog.md`: encrypted at-rest format, one writer, get/create framing, locked behavior and no-value public results.
- `.trellis/spec/backend/host-operation-lifecycle.md`: exact Host/input/generation ownership and no reconnect replay.
- `.trellis/spec/backend/permission-authorization.md`: canonical Core governance and stricter Host enforcement.
- `docs/adr/0006-mcp-processes-vs-no-os-invariant.md`: key-bootstrap spawn exception does not authorize deployment spawn in Core.
- Prior report `research/stage5c-host-boundary-research.md`: R9/R10, existing managed receipt consumer, Stage 5C milestones and model/data migration limits.
- Local library/version evidence: Node >=24 repository requirement; libsodium-wrappers `0.8.4` already pinned; Native Python base `3.11-slim`; python-dotenv `1.2.2` lock and installed source. No external version or artifact digest was invented and no network research was used.

## Caveats / Not Found

- No private secret broker, read-only installed decoder, deployment helper package/manifest, safe Docker secret bootstrap or production Ubuntu managed Host currently exists in the inspected source.
- The suggested decoder shares the local credential owner's trust and transiently opens the whole catalog. It does not isolate secrets from a compromised same-user helper, promise perfect memory erasure, or revoke an already running provider client instantly.
- Current secret rotation requires coordinated external key provisioning; the mismatch window must fail closed. Current timestamps alone are not a sufficient catalog-generation identifier.
- The recommended Docker mechanism is a concrete candidate with source-grounded required changes, **not a verified solution**. Missing restart/custody proof is named above and must be completed before real deployment claims.
- Only this report was written. No code/spec/task mutation, test/build, process/service start, credential read, dependency installation or original-data access occurred.
