# Isolated Hindsight Validation

Run with the already installed Hindsight interpreter from either repository:

```powershell
& 'H:/hindsight/.venv/Scripts/python.exe' 'H:/TakiAgent/.trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py' --probe
& 'H:/hindsight/.venv/Scripts/python.exe' 'H:/TakiAgent/.trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py' --allow-http-fixture -- tests/native_results -q --tb=short
```

The second command runs the routine G1 native matrix, including its owned HTTP-to-SQLite fixture. The harness:

- Starts one uniquely named bundled PostgreSQL 18.1 instance and verifies vector/pg_trgm in its own database.
- Uses a clean child environment, disables dotenv loading, and supplies only its owned database URL and dummy model values.
- Selects nonlocal configuration defaults to avoid importing optional ML stacks; each test still supplies its actual
  deterministic embedding/ranking/extraction implementation, and the dummy endpoint remains network-blocked.
- Runs pytest with one worker process and blocks outbound connections except its own PostgreSQL port. Tests must supply
  deterministic extraction, embedding and Batch API fixtures; the harness does not substitute fake results silently.
- Verifies the exact instance is stopped, then performs path-checked PowerShell cleanup of its data/registry.
- Retains logs/ownership evidence under ignored `.trellis/.runtime/g1-validation/<fixture>/` for the checker.

Use `--noconftest` for tests that intentionally do not use the repository fixtures. Do not run real-LLM test selectors,
start Docker Desktop, point at existing user databases, or weaken the network/cleanup guard to make a test pass.
Report fixture requirements to the leader if another isolated local endpoint is genuinely necessary.

For the real HTTP-to-Taki-to-SQLite fixture, opt in with `--allow-http-fixture` before the `--` separator. The test must
use `g1_fixture_network_guard.owned_http_listener()` and pass its still-bound socket to the in-process server:

```python
with owned_http_listener() as listener:
    fixture_url = f"http://127.0.0.1:{listener.getsockname()[1]}"
    # Run uvicorn.Server.serve(sockets=[listener]) with the existing deterministic engine.
    # Await the owned Node child and server teardown before leaving this context.
```

The guard grants only the exact live IPv4 listener held by this process; it never grants a guessed/released port.
Opt-in denial, the owned socket round trip, foreign/closed-port denial and Windows asyncio self-pipe behavior passed
direct probes. This is fixture-tool verification, not a completed cross-repository recovery test.

## Windows generator tools

The leader prepared isolated tools under `H:/TakiAgent/.trellis/.runtime/g1-toolchain/` on 2026-09-08:

- Eclipse Temurin JRE `17.0.20.1+1`, verified against its official SHA-256 file.
- OpenAPI Generator CLI `7.10.0`, matching `H:/hindsight/scripts/generate-clients.sh`; verified against Maven Central's
  published checksum. Its SHA-256 is `615e014705af34861e789e0b2a11075d3c80db134f881e937265479a4a83996e`.
- Go `1.25.0` for Windows amd64, verified against the official release SHA-256.

`toolchain.json` in that ignored directory records the exact artifact URLs, versions, sizes and checksums. All three
version commands passed. Existing hey-api `0.88.0` and Cargo `1.97.0` are available. These are temporary build tools;
no project dependency or global tool configuration was changed.

At schema freeze, use the canonical `hindsight_dev.generate_openapi.generate_openapi_spec` entry point and the exact
generator options, maintained-file preservation and postprocessors from `scripts/generate-clients.sh`. Run the JAR
with the isolated JRE instead of starting Docker. Python/TypeScript/Go/Rust generation, wrapper parity and builds are
still required; tool availability alone is not generation or compatibility acceptance.

`run_windows_codegen.py` provides explicit Windows steps using those canonical inputs. It stages Python/Go output,
preserves maintained wrappers/module files, executes the original Python and TypeScript postprocessors directly from
the maintained shell script, and refuses a changed generator pin. Its OpenAPI step blocks network connections.
Only select generation steps after the implementer has frozen the public schema and handed off generated-file ownership:

```powershell
& 'H:/hindsight/.venv/Scripts/python.exe' 'H:/TakiAgent/.trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_windows_codegen.py' --openapi --python --typescript --go --rust --docs
```

Steps can be selected separately. Logs and temporary generated output remain in ignored `.trellis/.runtime/g1-codegen/`.
The helper's executed generation, SDK/build, wheel, documentation and repeat-generation results are recorded in
[g1-validation-results.md](../g1-validation-results.md). Use that report for current acceptance and remaining gates;
the commands here are reproducible selections, not evidence that an unlisted live test ran.

## SDK offline selectors

The current SDK trees mix offline mapping/parsing checks and tests that mutate a running default service. After
generation, use the following selections with a clean environment; inspect newly added test modules before broadening them:

| SDK | Offline selection | Separately gated existing tests |
| --- | --- | --- |
| Python | From `hindsight-clients/python`: `python -m pytest tests --ignore=tests/test_main_operations.py -n 0 -p g1_fixture_network_guard`; set the guard's fixture port to `0` and make its module importable. | `tests/test_main_operations.py` explicitly uses a running server, defaulting to `localhost:8888`. |
| TypeScript | From `hindsight-clients/typescript`: `npm test -- --runInBand --testPathIgnorePatterns=main_operations.test.ts`; also build the wrapper/generated client. | `tests/main_operations.test.ts` retains/recalls against a running server. |
| Go | From `hindsight-clients/go`: `go build ./...`, `go test ./... -run '^$'` and `go test ./... -run '^(TestDispositionTraitsCompatibility\|TestNativeResultNullableStatus\|TestNativeReferenceNullableDocument)$'` without integration tags. | Both `TestNullHandling` and `TestTraceResponse` are untagged live-service tests; `integration_test.go` additionally uses the `integration` build tag. Generated `test/` examples skip before API calls and are not behavior evidence. |
| Rust | `cargo build --release --locked --offline` runs the maintained `build.rs` generator; `cargo test --release --locked --offline --test native_result_contract` runs the four generated-model contracts. | The owner-approved actual-source build and four tests passed in `d31d069c8e07`. The existing service lifecycle test remains separately gated; do not run it unfiltered. |

The validation report records which commands and added offline contracts passed. Wrapper mapping/parsing tests do not
establish real model quality, native storage behavior or live activation; the owned native HTTP/SQLite fixture supplies
separate integration evidence.
