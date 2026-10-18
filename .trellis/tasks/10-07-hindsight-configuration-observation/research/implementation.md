# Stage 5A implementation and validation

Date: 2026-10-07. Scope: administrator-opt-in, read-only API runtime configuration observation.
Taki baseline `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`; Native baseline
`eb6413a7f58c4f3f0adb88a33a99516f8707fef7`. Both remain on `main`; no commit, push, reset or archive.

## Delivered boundary

Native owns a default-deny exact authenticated namespace/Bank grant and observes the already constructed engine's
default/retain/reflect/consolidation providers. A narrow GET returns bounded aliases, fixed partial coverage,
the actual existing lineage/Bank generation, nonce and engine-session UUID. Routed/custom profiles and
embedding/reranker/workers remain unknown. The route never probes LLM health, calls models, changes a Bank or
initializes a missing store. Both the preceding compatibility GET and observation use `peek_memories()`; normal
engine startup retains initialization ownership. Ordinary configuration and health disclosure stay unchanged.

Shared owns the strict wire and operator schemas. Core supplies authenticated operator dispatch, actual setup,
configuration and authority/checkpoint identity, one total deadline, a 16 KiB body bound and a 60-second monotonic
evidence lifetime. It coalesces matching requests and withdraws obsolete, failed, expired and replaced-runtime
evidence. A process-local successful-write configuration generation and internal Secret Catalog publication
revision close ABA races without changing persisted connection fingerprints or public secret APIs.

The new finite build is `taki-memory-hindsight-0.9.0-config-observation-v1`; the optional contract is 1.0.0.
Mandatory application/result/transition/source admission remains intact. Whole-manifest changes invalidate old
previews, while fresh actual healthy transition proof succeeds. Observation denial never becomes an authority gate.

Home is delivered by its separate implementer: desired values, observed API profiles and explicit unknown coverage,
manual refresh, stale/failure/denial/mismatch states and disposable Core-backed evidence. See
[Home implementation](home-implementation.md) for its real Chromium/WS test and visual inspection.

## Files and ownership

[Final source identities](implementation-source-identities.json) contains **59 Taki and 66 Native changed paths**,
with exact SHA-256 and byte size. It includes Home's released files. The **10 Taki and 9 Native pre-5A dirty source
paths remain byte-identical** in its preserved-baseline section; W9 was not rewritten. Planning/task-state files
remain parent-owned and are excluded from this implementation manifest.

- Native: new collector/models/route/grant parser, tenant hook, startup session, installed-store read, compatibility
  contract/build, deployment examples/documentation and focused/SQL/legacy-contract tests.
- Generation: canonical shell entry plus explicit pinned-JAR backend and selection tests; generated Python/TS/Go
  output, Rust build-generated types, one shared fixture and four language-specific contracts.
- Taki: Shared schema/public exports, Core client/context/comparison/service/methods/boot, configuration write
  revision, internal Secret Catalog publication revision, finite compatibility consumers, tests and matching indexes/specs.
- The pure named-export Shared entry uses a documented exact-path cap of 550 instead of 540 (544 effective lines).
  The prohibition on imports, declarations, export-star and side effects remains enforced; no implementation cap changes.

## Independent findings corrected during implementation

1. **Real secret ABA:** public presence/key-version/millisecond metadata can repeat for a same-millisecond key
   replacement or restore. The actual file-backed catalog regression froze Date, started a real observation through
   the bounded client, changed/restored the key and observed the old response incorrectly publish before the fix
   ([red](core-secret-red-01.log), 2 failed). The internal revision now advances only after successful set/nonempty
   clear/restore/rotation publication. Failed writes and absent clear do not advance. Only 5A context consumes it;
   the old connection marker and persisted fingerprints remain unchanged. The final affected gate passes 78 tests.
   Catalog health is fixed after construction; new Core/catalog boot has no old observation cache. Future live
   lock/reload APIs must also invalidate this revision, as recorded in the spec.
2. **Full-chain initialization:** the new route used a noninitializing store read, but its preceding compatibility GET
   still called lazy `get_memories()`. The real `create_app` version-to-observation test failed its extension-constructor
   trap before correction ([red](native-chain-red-01.log), missing-store failed, installed-store passed). The compatibility
   read now also uses `peek_memories()`. Normal startup still initializes; missing state returns existing unsupported
   support metadata. The final 43-case Native matrix includes both full HTTP-chain cases and initialized legacy contracts.

## Completed checks

All commands below ran against owned fixtures/local generated data. A pass is an actual process exit 0, not just an
invocation. Retained exits for asynchronous checks are also in [process results](gate-process-results.json).

| Gate | Actual command / scope | Result |
| --- | --- | --- |
| Shared | `pnpm --filter @taki/shared exec vitest run --maxWorkers=2` | **65 files / 557 passed**, [log](shared-suite-01.log) |
| Core frozen full suite | `pnpm --filter @taki/core exec vitest run --maxWorkers=2` | **495 files / 3817 passed / 1 existing skipped**, 945.15 s, [log](core-suite-01.log) |
| Final secret/context correction | `pnpm --filter @taki/core exec vitest run src/memory/hindsight/hindsight-configuration-secret.test.ts src/memory/hindsight/hindsight-configuration-context.test.ts src/secrets src/memory/hindsight/hindsight-secret-refs.test.ts src/memory/hindsight/hindsight-configuration-service.test.ts src/boot/hindsight-setup-boot.test.ts src/server/methods/secret-methods.test.ts --maxWorkers=2` | **11 files / 78 passed**, [log](core-secret-green-01.log) |
| Desktop | `pnpm --filter @taki/desktop exec vitest run --maxWorkers=2` | **123 files / 694 passed**, 95.68 s, [log](desktop-suite-01.log) |
| Desktop build | `pnpm --filter @taki/desktop build` | **PASS**, existing chunk-size warning; [log](desktop-build-01.log) |
| Final TypeScript types | `pnpm -r typecheck` | **all 5 workspaces passed**, [log](typecheck-03.log) |
| Final root lint | `pnpm lint` | **PASS**, [log](lint-02.log) |
| Actual final Core boot | `node .trellis/tasks/10-07-hindsight-configuration-observation/research/boot-smoke.mjs` | **PASS**, fresh owned SQLite, real main/authenticated WS status+observe, 0 prohibited model/network attempts, normal SIGTERM; [log](boot-smoke-02.log), [result](boot-smoke-result.json) |
| Native route/SQL/legacy contracts | Owned runner and selectors below | **43 passed**, 64.47 s; [log](native-final-pg-01.log) |
| Native lint | Ruff over all 10 touched production modules, including MemoryEngine | **PASS**, [log](native-lint-final.log) |
| Native types | `ty check --python ../.venv/Scripts/python.exe` over 9 boundary modules (collector/models/route/grants/memories/manifest/tenant interfaces/builtins) | **PASS**, [log](native-ty-final-02.log) |
| Python SDK | `python -m pytest tests --ignore=tests/test_main_operations.py -n 0 -p g1_fixture_network_guard -q` from Python SDK, guard port 0, dotenv disabled | **102 passed**, [log](sdk-python-01.log) |
| TypeScript SDK | `npm run build`; `npm test -- --runInBand --testPathIgnorePatterns=main_operations.test.ts` | **build PASS; 11 suites / 44 tests**, [build](sdk-typescript-build-01.log), [tests](sdk-typescript-01.log) |
| Go SDK | `go test ./... -run '^$'`; scoped regex below; canonical `go build ./...` | **compile/build PASS; 8 top-level offline cases**, [compile](sdk-go-compile-01.log), [tests](sdk-go-01.log) |
| Rust SDK | `cargo test --release --locked --offline --test native_result_contract --test current_state_contract --test transition_contract --test configuration_observation_contract` | **11 passed across 4 binaries**, [log](sdk-rust-01.log) |
| Generator backend | `python scripts/test-openapi-generator-backend.py` with installed JRE on PATH | **3 passed**, missing explicit JAR / wrong version refusal / pinned installed version; [log](generator-backend-tests-02.log) |
| Repeat canonical generation | Canonical script twice with same pinned backend; exact inputs below | **both exit 0; 809 files byte-identical**, [first](native-clients-02.log), [repeat](native-clients-03.log), [comparison](generated-comparison.log) |
| Native docs | `npm run build` from `H:/hindsight/hindsight-docs` | **PASS**, code/template parity checks and static production build; [log](native-docs-01.log) |
| Both repositories' whitespace | `git diff --check` | **PASS**, [Taki](taki-whitespace.log), [Native](native-whitespace.log); final changed files strict UTF-8/no BOM verified by identity script |

The full Core gate was deliberately not rerun after the small Secret Catalog correction. Its complete pre-correction
**1298-file** source identity is retained in [Core gate source identities](core-suite-source-identities.json), and the
final delta is covered by the 78-case affected run plus final all-workspace types/lint and real boot. The full suite's
single skip is `hindsight-backup-store.test.ts:123`, the existing POSIX mode-bits check guarded on Windows. The real
ZST archive test's local fixture existed and that case ran. Focused counts overlap and are not summed as distinct cases.

## Reproducible Native isolation and generation

From `H:/TakiAgent`, the final Native command was:

```powershell
H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py -- tests/test_configuration_observation.py tests/native_results/test_configuration_observation_pg.py tests/native_results/test_configuration_observation_compatibility.py tests/native_results/test_cutover_compatibility.py tests/test_taki_admin_backup.py::test_proof_reads_live_banks_cursors_application_and_receipt_membership -q --tb=short
```

The existing runner's `clean_environment()` whitelists only required platform variables, explicitly sets
`PYTHON_DOTENV_DISABLED=1`, and supplies its owned PostgreSQL URL and network-guard port. Native's normal dotenv
`override=True` cannot load repository credentials or replace that fixture target. No actual `.env` was inspected.
The actual PostgreSQL 18.1 fixture validates migrated schema and read-only transactions. All four recorded runs
(`f4abc29ffa79`, `f8a417d38e88`, `29f8b2a7bb56`, final `c2b0f54f4c1a`) report Stopped/DataRemoved/RegistryRemoved true;
the earlier failed fixture `d7fa4944175e` was also stopped and removed. Logs remain under the runner's ignored runtime
directory. No external HTTP listener opt-in was needed for these ASGI tests.

The final Go offline selector was
`^(TestDispositionTraitsCompatibility|TestNativeResultNullableStatus|TestNativeReferenceNullableDocument|TestCurrentState.*|TestTransitionNullableArtifactContract|TestConfigurationObservationProfiles)$`.
Live Python/TS main-operation tests, untagged Go `TestNullHandling`/`TestTraceResponse`, and Rust service lifecycle tests
were excluded; they contact a running service and are not this gate.

Docker was unavailable and was not started. The parent approved a maintained optional canonical backend:
`HINDSIGHT_OPENAPI_GENERATOR_JAR=H:/hindsight/hindsight-clients/go/openapi-generator-cli.jar`, verified exact 7.10.0
before any generator output cleanup. SHA-256 is
`615e014705af34861e789e0b2a11075d3c80db134f881e937265479a4a83996e`.
`HINDSIGHT_GENERATOR_PYTHON=H:/hindsight/.venv/Scripts/python.exe`, `PYTHONIOENCODING=utf-8`, and the previously installed
JRE/Go toolchain under `H:/TakiAgent/.trellis/.runtime/g1-toolchain` were used; invocation was
`G:/Git/bin/bash.exe scripts/generate-clients.sh` from `H:/hindsight`. Default Docker behavior remains available.
All original generator arguments, maintained wrappers, module/lock files, Python supplied-field postprocessing,
TypeScript Deno patch and Go discriminator handling remain in the canonical path. No generated file was hand-edited.

[Before](generated-before.json) and [after](generated-after.json) record 809 generated/preserved paths including
Rust's build-generated client. Native `client.gen.ts` keeps the pre-5A hash
`af4e40b6f3dcc7d853e9a214ba90a6d25ca21b1f5188c941c347a78aa28cac7f`.
Both environment examples are byte-identical at
`af87d3985ad0afbebee4a0a9ca77ec485a67ac64795644fa6683c025ba1ef2c17`.

## Preserved failures and bounded corrections

- `native-openapi-01`: generated output existed, but Windows GBK failed to print the success glyph; UTF-8 output fixed
  the invocation. `native-openapi-04` completed successfully.
- `native-clients-01` / `native-rust-02`: generic union enum titles collided in Rust, then mixed inherited 401 error
  schema violated Progenitor's one-error-type requirement. Source-qualified schema titles and an explicit narrow 401
  refusal fixed generation. `native-rust-03` and both later canonical runs passed; generated files were not patched.
- `native-pg-01`: deleting the test's existing Bank state violated a journal FK after the actual read-only assertions;
  the test now inserts a distinct uninitialized Bank instead. `native-pg-02` passed 29 cases, and final 43 cases passed.
- `core-context-01`: the reused legacy transition fixture had an incomplete setup projection. Only the new test setup
  now writes the production projection of its real manifest; production strict parsing is retained. Rerun passed.
- `typecheck-01`: test-only deferred/WS fixture target errors; corrected without widening target/compiler rules.
  `typecheck-02`, then final `typecheck-03`, passed all five workspaces.
- `lint-01`: 544-line pure Shared public export list exceeded its old 540 limit. The reviewed documented exact-path
  allowance is now 550; root `lint-02` passes, with named-export-only enforcement retained.
- `native-compatibility-pg-01`: 11/12 passed; the reused legacy whole-contract assertion additionally lacked the existing
  `transition_source_evidence` entry. Its explicit expected dictionary now includes that and the new optional contract;
  no contract or assertion was removed. Final initialized legacy checks pass.
- `native-chain-red-01` and `core-secret-red-01` are deliberate pre-fix regressions for the two independent findings.
- `native-ty-final`: ty selected the unrelated default Anaconda environment. The exact installed interpreter was supplied
  with `--python` in `native-ty-final-02`; no dependency installation or type-rule suppression was used.
- Home's earlier invocation/test-syntax corrections remain documented in its separate report.

## Remaining boundaries

The final independent checker owns acceptance. Original-instance deployment/grants, real model calls, standalone
workers/fleet coverage, installed Tauri/WebView2/CSP, original data/credentials and owner/manual acceptance were not
performed. There are no dependency, database-schema or ordinary model/configuration-application changes. The Desktop
build's existing large-chunk warning is retained; performance work remains deferred. Subsequent Stage 5 template and
deployment work must use its own reviewed scope. This slice alone does not establish complete setup or Stage 6 acceptance.

Native docs build also retains the old 0.5.5 blog page's two broken-anchor warnings and an outdated Browserslist-data
notice. The changed configuration documentation builds successfully; unrelated historical articles/dependencies were
not modified. All implementation checks and generators have exited; source, generated artifacts and test ownership
are released to the independent checker. Only implementation evidence/report files remain authored by this agent.
