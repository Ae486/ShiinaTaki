# Isolated OpenBili backend deployment

This operator deployment runs the native `0.3.205` backend with the reviewed
recommendation-peek source overlay. It is separate from Taki Core, BiliNote,
the browser attachment, and existing Docker services.

## Current deployment

- Origin: `http://127.0.0.1:18420`; container port `8420`.
- Compose project/container: `taki-openbili` / `taki-openbili-backend`.
- Image: `taki-openbili-backend:0.3.205-peek-20261018`.
- Verified upstream amd64 digest:
  `sha256:89e6d66f7fa1d3a3acfd1052b801d1177e1dd9ccbc19398c6da6da3eb1baebdf`.
- Upstream multi-platform index digest for tag `0.3.205`:
  `sha256:58a532199f79b9f4f47961522aa2ef2610967de028fb65834458542e28dc6a48`.
- Final local image ID:
  `sha256:f24e8519df02cee288cada771654064d8f133894ab2648fb0da1513d1238a7e6`.
- Source: `../../.worktrees/openbili-recommendations/src`, based on native commit
  `a49af31248b5e88639593d04406828a8ea7f3138`, branch
  `feat/taki-recommendation-peek`, with uncommitted reviewed peek changes.
- Source manifest: 294 files, aggregate SHA-256
  `1cdd7c916faa24a09977eabf5a514d424363ab152d29aacecd5f07e2c1782c3b`.

Windows reserves TCP ports `8389..8488` on this machine, including native port
8420. The first bind was refused; the approved host mapping is therefore
**127.0.0.1:18420 only**, without changing Windows port reservations.

The thin image reuses upstream dependencies and copies only source plus these
deployment scripts. The first build context was 10.48 MB; it excludes virtual
environments, runtime state, credentials and extension assets. No dependency
resolution, Ollama sidecar, embedding model download or account initialization
is part of the build or bootstrap.

## State and storage

| Named volume | Container path | Purpose |
| --- | --- | --- |
| `taki-openbili-runtime` | `/app/runtime` | Native config and deployment access token |
| `taki-openbili-data` | `/app/runtime/data` | Native SQLite, profile and future result state |
| `taki-openbili-logs` | `/app/runtime/logs` | Native logs |

These volumes use the existing Linux Docker Engine, whose live data VHDX was
verified at `G:/DockerDesktopData/DockerDesktopWSL/disk/docker_data.vhdx`.
They are not bind mounts into H:. The checked VHDX size was 39,292,239,872 bytes;
this is the entire Docker data disk, not this service's exclusive usage.
The final image reports 131,407,388 bytes. Existing `redis` and `arboris-app`
containers remain unchanged; no prune or volume removal was performed.

On first start, `bootstrap.py` creates native config with authentication enabled,
loopback bypass disabled, all platform sources disabled, no model instances,
and scheduling/source increments/profile consolidation/updates disabled.
Existing config is preserved on restart. Native startup creates empty storage;
it is distinct from the separately authorized account initialization.

The approved provider is configured through native `PUT /api/config`: instance
`campaign-flash`, model `deepseek-flash`, OpenAI-compatible chat completions.
All four native routes inherit that instance. Embedding remains explicitly
disabled; native init does not require it in that configuration. Scheduling,
source increments, profile consolidation and updates remain disabled.
Provider URL/key were read only from the two approved campaign environment
fields and compared by private readback without printing them. Model metadata
discovery confirmed the exact model without performing generation.

The deployment-generated native Bearer token is retained at
`/app/runtime/bridge-token` with mode `0600`. The generated operator password is
also retained with mode `0600` at `/app/runtime/operator-password`.
The native signing secret remains
in the runtime volume. Token values are never printed or stored in this source
directory. Import the token into the existing operator secret-ref mechanism
when configuring the separate media bridge; do not paste it into model context,
compose environment values, command arguments or tracked files.

## Verification and readiness

`verification.json` and `deployment-evidence.json` retain the historical
unconfigured bootstrap checks, including the earlier image identity.
`configured-before-restart.json` and `configured-after-restart.json` record
the later provider configuration and restart checks. All 294 source files were
compared with `source-manifest.json`;
Python actually loads `/opt/taki-openbili/src/openbiliclaw/`.

- Container running and Docker liveness healthy; `/api/ping` returns HTTP 200.
- Anonymous peek returns HTTP 401 `auth_required`.
- Authenticated peek returns HTTP 200 with a real empty list; profile returns
  HTTP 200 with `initialized=false`.
- Invalid recommendation feedback returns HTTP 404 and creates no feedback.
- These configured checks recorded zero recommendation/event/content-cache/LLM
  usage rows and precede the authorized QR login and initialization.
- Native password login and `/setup/` passed. The bridge token remained valid
  after restart without password/signing-secret/epoch rotation.

**Current account/profile/candidate readiness is verified.**
`initialization-completed.json` records the completed authorized run and the
same-response QR cookie evidence. `initialized-after-restart.json` verifies
persistence with the original bridge token after the final backend restart:

- Official Bilibili account `382115755` authenticated and stored natively.
- Exactly 200 history events imported; favorites/follows were skipped.
- Full profile is initialized; 20 native candidates are currently serviceable.
- Recommendation history is still 0, and authenticated peek truthfully returns
  an empty current list. Peek does not consume these 20 candidates. The ordinary
  user browsing route owns serving; it was not invoked for acceptance.
- The single CLI run exited 0 after 330 seconds with 15 available candidates.
  A remaining native `recommendation.write_expression` operation then completed
  the other 5 before the final restart. Final initialization-window usage is
  22 successful calls, 209,532 prompt + 54,854 completion = 264,386 tokens.
  Native estimated cost is CNY 0.33531; actual billed cost is unknown.
- API auth, scheduler and network configuration were compared before/after and
  remained unchanged. Scheduling, source increments and profile consolidation
  remain disabled. Only Bilibili is enabled.
- Container raw response/key/QR copies were removed after evidence projection;
  the extra candidate was removed on successful native storage. All 5 local QR
  images were removed (`qr-artifact-cleanup.json`). Native cookie/config/profile,
  bridge token and operator password were retained.

The separate Taki bridge acceptance also passed through the real default
connector, Python MCP and Docker backend, with all 4 selected tools connected.
Profile was initialized/available (bounded truncation is part of its contract),
peek was empty, and native counts/usage were unchanged before/after the reads.
Its operator evidence is
`../../.runtime/media-continuation-20261018/openbili-initialized-live-read.json`.

The earlier native `llm_registry_unavailable` guard was resolved by real model
configuration. Source-route behavior passed 42 separate native offline tests
(real FastAPI/auth/SQLite, inert background/provider ports). Full native Ruff and
changed-file formatting passed. Windows MyPy retains 15 POSIX-symbol errors in
five unchanged files; no changed API file reported a type error.

## Operator commands

Run from the T4 repository root:

```powershell
docker compose -f integrations/openbili-deployment/compose.yaml up -d --no-build backend
docker compose -f integrations/openbili-deployment/compose.yaml stop backend
```

`configure-provider.py` applies only the two approved campaign provider fields.
`verify-configured.py --models --output configured-before-restart.json` checks
the configured, uninitialized state; omit `--models` for the restart readback.
Run these host scripts with the existing locked Python environment. Do not
rerun the provider writer as an ordinary health check.

The image's `verify.py` checks the initial **unconfigured** bootstrap state and
must not be used after configuring a model. `verify-configured.py` also requires
empty pre-initialization data, so neither is a post-initialization acceptance
test. Both avoid printing credentials. The bootstrap verifier uses a
read-only SQLite connection for auth epoch/counts and native token signing;
it does not run storage migrations or change provider/account configuration.

For current post-initialization evidence, copy `initialize.py` and
`live-readiness.py` into `/tmp` in the container and run
`python /tmp/live-readiness.py`. This projects only safe facts and reads native
peek/profile without serving. `--cleanup-login-temp` additionally retires only
the named operator QR/candidate/raw-response artifacts after successful init.

Rebuild with the same compose file's `build backend` command only after updating
the source manifest for reviewed source changes. Its aggregate hash is SHA-256
of compact, sorted-key JSON mapping relative source paths to per-file SHA-256;
Python cache files are excluded. Bootstrap changes require rebuilding the image;
existing native config is intentionally not overwritten by that operation.

Stopping this compose service leaves all native data intact. Recreate it with
the retained image and named volumes to restore it. No production migration or
cleanup policy is added by this deployment.

## Account initialization and visual capability

`bili-qr-login.py` is an explicit operator helper for the installed
`bilibili-api-python==17.4.2` official web QR login. It runs inside the container,
exports only the QR PNG for the owner to scan, and passes fresh credentials to
native `/api/bilibili/cookie` for mandatory official validation and storage.
Its safe status contains only state/account ID. QR files belong in ignored
scratch directories and must never be committed. It does not rotate API auth.
The installed SDK's QR parser reads credentials only from the JSON redirect
URL. The helper captures the **same** HTTP response before that envelope is
discarded and merges actual response cookies and the SDK session cookie jar.
It never polls a completed QR a second time to retrieve lost credentials.
`test_bili_qr_login.py` exercises the real SDK parser with a Set-Cookie-only
response and verifies native structural acceptance plus mode-0600 capture.
If native validation rejects the fresh login, the helper retains the candidate
only at `/tmp/operator-bili-candidate.json` with mode `0600`. Safe status adds
the native error code and three required-field presence flags. Use
`--retry-candidate` after diagnosing the rejection; never print the file.
Successful native storage removes this extra candidate. `--recover` is limited
to the original QR session from `/tmp/operator-qr-recovery-url`; it takes only
the key and polls the SDK's fixed official endpoint, never the decoded URL.

The bounded first-run plan selects Bilibili only: history limit 200, favorites 0,
follows 0, native initial pool target 15. A history limit of 0 means *all history*
and must never be used to mean skip. Native Docker initialization uses the CLI;
the web init endpoint intentionally reports `unsupported_runtime`.

`initialize.py` launched that native CLI exactly once behind an exclusive marker
in `/app/runtime/operator-init-state.json`. `--status` reports only stage/counts
and native token-usage totals. Raw CLI output stays in a protected runtime log,
and the marker is retained on failure or client disconnect. Do not remove it or
retry blindly: first inspect native progress and persistent state. The native
CLI does not populate the web init coordinator, so this operator projection is
the evidence for this Docker run. API auth, scheduler and network configuration
are compared privately before/after the command.

Native pricing has no exact `deepseek-flash` rate. Its cost ledger can use a
provider fallback estimate; this is not verified billing. Actual billed cost
remains unknown while token/call counts are recorded from real usage rows.

The QR failure was confirmed against a real successful response: all three
login cookies were present in HTTP `Set-Cookie`, and absent from the JSON
redirect query consumed by SDK 17.4.2. Capturing that same response fixed native
validation; no weaker validation gate or native source change was introduced.

Native `LLMService.supports_image_input` infers capability from model-name
markers and currently reports false for `deepseek-flash`. This deployment does
not add an override or rename the model. Selected-video visual analysis belongs
to BiliNote in the current integration. Revisit a generic capability override
only if OpenBili image input or visual evaluation becomes explicitly required.
