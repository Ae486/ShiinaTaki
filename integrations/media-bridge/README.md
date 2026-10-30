# Independent media service MCP bridge

This package exposes the configured BiliNote B3 HTTP contract and optional
OpenBili recommendation/profile/feedback operations through standard MCP. It
starts no native service, imports no native/Agent internals, and owns no job
database, queue, polling loop or result-retention policy. BiliNote has six tools
and a complete-result resource. Explicit OpenBili configuration adds four tools.

The HTTP contracts and official SDK interoperability have passed the scoped
checks in the isolated Windows environment. Real native/model results are
recorded separately in `../../docs/MEDIA-LIVE-VALIDATION-2026-10-13.md`.

## Isolated dependency setup

`requirements-windows-py311.lock` is the approved 31-package SDK closure
with wheel hashes, derived from an existing repository lock. It was installed
in the dedicated bridge venv after approval; version/hash verification, SDK
import and `pip check` passed. The selected SDK is `mcp==1.26.0`,
with `httpx==0.28.1` and `jsonschema==4.26.0` declared directly. The source
provenance is in `../../.runtime/media-implementation-20261013/bridge-research/`.
The matching SDK wheel also appears in OpenBili's existing lock; no OpenBili or
Claude Agent SDK package is part of this dependency closure.

The lock's candidate-only header describes its initial export, before the
approved installation. The subsequent installation evidence is
`../../.runtime/media-implementation-20261013/bridge/sdk-installed-verification.json`.
The retained `pyjwt[crypto]` extra makes pip's hashed dependency resolution
explicit without changing the approved 31 packages, versions or wheel hashes;
`sdk-lock-verification.json` records the final lock hash.

For another installation, use a new CPython 3.11 Windows amd64 venv;
never update BiliNote/OpenBili's current environments. From this package directory,
the reviewed installation shape is:

```powershell
<isolated-python> -m pip install --dry-run --require-hashes --only-binary=:all: --no-cache-dir -r requirements-windows-py311.lock
<isolated-python> -m pip install --require-hashes --only-binary=:all: --no-cache-dir -r requirements-windows-py311.lock
<isolated-python> -m pip check
```

Inspect the dry-run/metadata result before installation. Do not silently resolve
different versions or install additional dependencies if the candidate conflicts.
For this initial source launch, set the MCP process cwd to this package's `src`
directory and run `<isolated-python> -m media_service_bridge --config <absolute-config>`.
No local distribution install/build is required. The optional setuptools build
backend is pinned to `80.9.0`; this source launch does not invoke it. The isolated
venv retains its seeded setuptools `65.5.0`; no build-tool upgrade or wheel
publishing was performed.

## Configuration and access boundary

Copy `config.example.json` to an operator-owned path and select the actual native
service UUID, provider ID and model. The example contains placeholders. The
authorized model selection is `deepseek-flash`; the bridge never discovers or
reads secret-bearing native provider/Cookie settings. Configuration is captured
at startup. Changing it means a normal MCP generation replacement, not silently
switching a job to another endpoint or native service instance.

The endpoint is fixed configuration, never a tool input. This slice accepts
loopback HTTP and remote HTTPS, disables redirects and inherited proxy settings,
and only constructs known API routes. A remote BiliNote origin requires separately
protected ingress and valid TLS. B3 UUIDs, CORS and a successful response are not
authentication. Setting an optional `auth_token_env` merely adds the resolved
Bearer header; it does not prove that the selected ingress verifies it. Taki's
operator MCP environment/header settings continue to use existing secret-ref
catalog entries. Never place a token value in this JSON, command arguments,
source, logs or tool responses. OpenBili credentials and origin stay separate.

The bridge has only stdio transport: stdout is protocol traffic; there is no
remote MCP listener or operator HTTP API. The executable and cwd must exist on
the intended execution Host; a local checkout path is not cross-Host deployment.

## Tools and recovery

- `bilinote_get_instance`: inspect the configured native identity/contract.
- `bilinote_probe_media`: one instance-bound GET checks the exact direct Bilibili
  part using native authentication and a validated MP4 byte range. It returns
  `bilinote.media-access.v1`, never a job or a readiness promise. Native limits
  are 15 seconds total, 3 seconds per socket operation, zero retries, at most
  16 requests including redirects (3 per request), 2 MiB per metadata response
  and 1024 video bytes. Disconnect/deadline cancels network IO before draining
  the extractor worker. Cookies remain in memory and signed CDN URLs stay native.
  `checked_at` is UTC epoch milliseconds; `duration_seconds` is known exact-part
  metadata or null, not a duration inferred from the byte sample.
- `bilinote_submit_analysis`: exactly one POST under a caller-retained UUID,
  operator profile and native normalized input digest. The caller must retain
  the UUID before dispatch. New admission is 202; exact reuse is 200.
- `bilinote_lookup_request`: reconcile the same UUID without submitting.
- `bilinote_get_status`: one read under original request/job identity.
- `bilinote_read_result`: verify the full safe result, return an explicitly
  incomplete preview/resource descriptor by default, or complete JSON when
  `include_complete=true`.

An ambiguous POST returns `submission_outcome_unknown` with the original request
UUID. It never generates a replacement key or automatically retries. Lookup 404
does not authorize a resubmission. Native interrupted/failed states are retained.
Stopping this process only closes bridge HTTP/MCP transports; it does not cancel
or kill shared native jobs. Existing generic Agent/Harness owners remain
responsible for accepted purpose, waiting, completion facts and publication.

## Optional OpenBili recommendation tools

Add `--openbili-config <absolute-path>` to the stdio command only when the
operator wants this integration. `openbili-config.example.json` is an independent
non-secret configuration: fixed origin, required token environment-variable name,
15-second total deadline (configurable up to 120) and 256 KiB decompressed body cap
(configurable up to 1 MiB). The example uses this repository's isolated Docker
deployment at `127.0.0.1:18420`; change the origin for another native instance.
Service lifecycle is separate; see [the deployment guide](../openbili-deployment/README.md).

Without that argument the original six-tool discovery remains unchanged. An
unreadable/invalid optional configuration or missing token makes only OpenBili
tools return `openbili_not_configured`; BiliNote remains available. Resolve the
OpenBili token through the existing MCP secret catalog. The bridge never falls
back to BiliNote credentials, browser cookies, ambient proxies or native config.
Only loopback HTTP or remote HTTPS origins are accepted; no URL path, embedded
credentials, query, fragment or redirect can change the destination. Configuration
is captured for this MCP generation and requires ordinary replacement to change.

| Tool | Native behavior | MCP posture |
| --- | --- | --- |
| `openbili_peek_recommendations` | Read the existing eligible recommendation view; empty never triggers generation. `limit` is 1-20. `total` counts this native view (at most 20), not pool inventory/history. | Read-only, idempotent |
| `openbili_read_recommendations` | Ordinary GET may top up stored recommendations and serve pool items. The bridge display limit does not limit those native effects. No display/click fact is invented. | Side-effecting, non-idempotent |
| `openbili_read_profile` | Selected interests/style/speculation and supporting native evidence, with source and read time. Explicitly incomplete and inferred; manual overrides can be mixed in. | Read-only, idempotent |
| `openbili_submit_feedback` | Native `like`, `dislike`, `comment`, `dismiss`; retained request key and exact retry/conflict semantics. `processing=queued` does not confirm profile learning. | Side-effecting, idempotent for the exact retained payload; potentially removes a recommendation |

These hints describe behavior and do not grant Governance permission. All new
input fields are required, bounds are in the schema, finite choices use enums,
and unknown fields are rejected. Tool discovery stays ordinary MCP; describe
the exact current extension to disclose its schema, rather than injecting every
media tool permanently. The portable `../taki-media-recommendations/` Skill
explains selection, profile attribution and feedback; its selected-video
preparation control reuses the installed Taki task owner.

The native source must include `/api/recommendations/peek` from the reviewed
OpenBili recommendation worktree. An older release image without that route
returns unavailable; the bridge must not fall back to side-effecting browsing.
Neither list operation refreshes/initializes the native engine through another
route. Direct viewing, Co-Watching acceptance and deferring are task choices,
not recommendation feedback. Native feedback is not a platform like/favorite.

Unknown feedback outcome retains `request_id`; an explicit exact-payload retry
can recover the original native event. There is no automatic retry or bridge
ledger. A request conflict is never hidden by generating a new key. Other native
error text is replaced with fixed messages; unknown fields are omitted from
content projections. An uninitialized profile response can also mean native
profile read failure, so it never proves a user has no interests.

### OpenBili verification (2026-10-18)

- Full bridge Python fixture suite: 41 tests passed, including 14 new OpenBili
  contract/lifecycle checks. Tests use synthetic HTTP transport, no native engine,
  network, model or database initialization.
- Actual Taki `defaultConnect` / official Python MCP stdio: ten tools, strict
  schemas, truthful annotations, queued feedback/retry/conflict and independent
  BiliNote access passed. Actual serialized provider requests using offline
  responses contain no OpenBili schemas initially; exact describe exposes only
  peek on the next step. This is SDK/provider-wire evidence, not a paid model run.
- Original six-tool BiliNote stdio regression passed. Cooperative EOF with both
  clients proved both HTTP clients sealed/cleaned and the interpreter exited.
  The existing termination-oriented client also exited without an orphan.
- Changed `.mjs` fixture lint passed. Evidence lives under
  `../../.runtime/media-continuation-20261018/openbili-bridge-tests/`.

Run the Python suite with the package `src` on `PYTHONPATH` and the existing
isolated interpreter. From the repository root, run the following SDK fixture
with explicit interpreter and evidence paths:

```text
node --experimental-strip-types integrations/media-bridge/tests/taki-openbili-compat.mjs <isolated-python> <evidence-directory>
node integrations/media-bridge/tests/mcp-cooperative-eof.mjs <isolated-python> <evidence-directory> --with-openbili
```

Native service deployment/authentication, real profile/recommendation data,
ordinary browser UI and owner acceptance remain separate gates. This package
does not enable scheduled/Heartbeat preparation or automatic invitation timing.

Later lookup/status/result calls prove the configured service and retained native
request/job binding. They do not independently recover the caller's originally
selected URL/profile. Results expose native media identity; the caller compares
that identity with its own selected source. No bridge ledger is added to infer it.

## Complete result integrity and limits

The resource URI is
`bilinote://<service UUID>/<request UUID>/<job UUID>/<SHA-256>`.
It is an identifier for a fixed native route, not a URL or filesystem capability.
Every resource read repeats native lookup/status/result verification; an expired
or changed artifact fails explicitly and never causes re-analysis.

The native status descriptor's SHA-256 and length are checked against the exact
decompressed UTF-8 JSON bytes, with ETag agreement where supplied. They are not
hashes of the MCP wrapper, reserialized JSON or private native full envelope.
The bundled v1 JSON Schema validates nested wire fields; additional finite/time
and identity checks reject inconsistent transport content. Native acquisition
and model-evidence semantics remain native facts, not a second bridge inference.

Default engineering limits are a 30-second total operation deadline, 128 KiB
control responses and a 16 MiB complete result. They are configurable caps, not
measured SLAs. Oversized results fail; previews explicitly say `complete=false`
and never masquerade as the complete transcript/analysis. Unverified legacy
identity is not promoted into a keyed exact-media result.

The deadline also rejects success after synchronous JSON/schema/hash work has
crossed the limit. This check does not preempt CPU work: that work can finish
late before the caller receives the timeout failure.

## Verification

| Gate | Recorded result | Producer and boundary |
| --- | --- | --- |
| HTTP contract/lifecycle suite | 21 passed in each of the existing native and isolated SDK environments | Synthetic HTTP transport responses; no actual native HTTP service or model call. |
| Native contract integration | Four passed using disposable SQLite and actual native routes through ASGI transport | Fixture generator/readiness and Markdown output; no real media acquisition or structured model result. This historical native source snapshot predates the separate optional-format compatibility patch. |
| Existing Taki `defaultConnect` and official MCP SDK | Initialize, five tools/annotations, submit/lookup/status, complete resource bytes/hash, full tool view and bounded errors passed | Real stdio framing with `httpx.MockTransport`/`NativeStub` replacing native HTTP. Node 24.18.0, `@ai-sdk/mcp` 2.0.10, Python MCP 1.26.0, protocol `2025-11-25`. |
| Cooperative stdin EOF | HTTP client sealed, transport cleanup completed, cleanup task completed and interpreter exited | Separate standard JSON-RPC client closes stdin; synthetic native transport only. |

Taki's existing abort-style close ended the actual interpreter without an orphan,
but produced no Python `finally` evidence. It does not prove cooperative cleanup.
The separate stdin-EOF gate establishes that stronger lifespan result only for
cooperative EOF. The original gate with the failed graceful-close assertion
remains preserved in `bridge-review/sdk-compat/`.

Source and result hashes are recorded under
`../../.runtime/media-implementation-20261013/bridge/` and the sibling
`bridge-review/`. The final complete package snapshot, manifest and new-files
patch are in the sibling `bridge-final/`; its continuity report distinguishes
unchanged bridge production bytes from historical fixture/dependency/native
source differences. Passing suites were not repeated solely to refresh packaging.

Real native HTTP/model analysis and any subsequent read through this bridge are
tracked separately in `../../docs/MEDIA-LIVE-VALIDATION-2026-10-13.md`. The package
gates above do not establish that full pipeline. Protected remote ingress, real
execution-Host deployment, browser/source binding, output-quality acceptance,
full Co-Watching and real Heartbeat scheduling/delivery remain separate work.
