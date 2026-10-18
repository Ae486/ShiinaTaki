# B3 canonical generation and SDK gate

Status: **completed for the assigned Native-only batch on 2026-10-10**. Two focused schema regressions, scoped
Ruff/format and changed-module Linux ty passed. Two actual same-source canonical exports and guarded clean
client generations produced 958 byte-identical entries, unchanged again after all SDK checks/builds and the
77-case Native affected batch. Python 109, TypeScript 46, Rust 14 and ten top-level Go contracts passed within
their named scopes. Full evidence and failure accounting are in `b3-native-implementation.md`.

`openapi-01` and `schema-diagnostic-01` remain retained failures. The diagnostic disproved the initial null
hypothesis and found duplicate manual-vs-route Input graphs. The final hook reuses the actual route roots and
adds only hidden proof/response/archive roots, retaining meaningful-collision refusal and full references.
The Native source producer, joint Core/Native gate and canonical client gate retain separate verdicts.

The owner now requires completion of this existing Native-only batch and necessary fixes, followed by a stop.
Do not begin `joint-03`, independent review or another workstream from this grant. The earlier temporary slot
releases during static diagnosis are retained in the handoff; the final batch ran under Root's renewed sole grant.

## Inputs and generated ownership

- Use the exact existing 7.10.0 JAR, SHA256
  `615e014705af34861e789e0b2a11075d3c80db134f881e937265479a4a83996e`, the existing installed JRE/Go/Node toolchain,
  locked offline Rust and existing offline Go/npm caches. No new dependency or original service is used.
- `hindsight-clients/template-backup-v2-fixture.json` is a byte-identical copy of the Shared wire fixture,
  SHA256 `acc74518e6f7ff7da0de00842c0f5d642a38a0daab7bf195670b96c560694e43`. It remains wire-only evidence.
  The Native contract test and `pin-b3-generated.py` check exact parity. Actual producer acceptance is the
  separate real PG/HTTP/CLI/Core test, never these deterministic codec vectors.
- The canonical input is `H:/hindsight/hindsight-docs/static/openapi.json`. The generation module's CLI
  default is a different root file, so always pass the canonical destination explicitly.
- `run-b3-native-clients.py` verifies resolved deletion paths stay inside the Native clients tree before
  invoking the existing Bash generator. It protects the same 12 maintained inputs as B2 in the scheduled
  owned TEMP and restores exact bytes if generation alters or loses one, while retaining a failed verdict.
  `TMPDIR` points into that owned TEMP; existing fixed-name legacy Bash wrapper/README staging files cause a
  refusal instead of being overwritten. The generator's maintained source is not modified for this guard.
  Generator-owned Rust target, Python low-level tree/metadata, TypeScript generated/legacy trees and Go
  generated files are the known mutation scope. Neither wrappers nor module manifests are new feature changes.

## Scheduled sequence

All commands below are wrapped by `research/run-b3-native-check.py` with a unique evidence name. It retains
the exact command, source SHA256 before/after, output, exit code and owned TEMP cleanup. Run one at a time.
First run scoped Ruff/format on the new Python contract test and task-local generator helpers, `rustfmt` on
the new Rust test and `gofmt` on the new Go test. Do this before the initial byte snapshot so formatting cannot
be confused with a generator or SDK-check mutation. Native generated files remain generator-owned.

1. `pin-b3-generated.py pre-generation`: retain current canonical/SDK and maintained input identities.
2. Native cwd `H:/hindsight`: `H:/hindsight/.venv/Scripts/python.exe
   hindsight-dev/hindsight_dev/generate_openapi.py hindsight-docs/static/openapi.json`.
3. Inspect the actual canonical route, all new named components, old lifecycle/label routes and references
   before the SDK generator runs. The generator uses the canonical file, never a private task fixture.
4. Native cwd: `H:/hindsight/.venv/Scripts/python.exe
   H:/TakiAgent/.trellis/tasks/10-07-hindsight-template-lifecycle/research/run-b3-native-clients.py clients-01`.
   This invokes `G:/Git/bin/bash.exe scripts/generate-clients.sh` in the guarded workspace.
5. `pin-b3-generated.py generated-01`: assert strict route/components, exact fixture parity and all maintained
   identities. Before SDK checks/builds, repeat the same-source canonical export and clean guarded generation
   with fresh run suffixes, then compare `generated-02` against `generated-01`. This is the required actual
   reproducibility gate, not a comparison of an untouched directory with itself.
6. Run the new SDK round-trip/transport tests plus affected existing offline lifecycle/application/transition/
   configuration contracts. Build the TS client and check the Rust/Go generated surface with existing commands
   and pinned dependency state. `pin-b3-generated.py tested-01 generated-02` proves checks/build did not mutate generated source
   or maintained inputs. Repeat clean generation when a schema/generator correction requires it; keep every
   earlier failed run and use a new evidence suffix.

Python, TypeScript, Rust and Go each have a new `template_backup` contract test. They preserve the complete
original selected Apply request, explicitly unselected null, nested versioned proof and observation wrapper.
Python/Rust also reject a legacy version in the v2 request model; the TypeScript case calls the actual generated
observation function and checks method/path/header/body/response through a deterministic fetch transport.

This sequence does not run the full Native lint script because that script synchronizes dependencies and
auto-fixes unrelated packages. Use the established scoped Ruff and Linux-target `ty` mode; retain its existing
full-Windows/optional-ML limitations and Root's separate final full-scope review obligations.

## Exact SDK selectors

These extend the already executed B2 offline selectors with the new B3 contracts. All rows passed under the
`sdk-python-01`, `sdk-typescript-01`, `sdk-typescript-build-01`, `sdk-rust-01` and `sdk-go-01` recorders respectively.

| Native working directory | Command after the recorder |
| --- | --- |
| `hindsight-clients/python` | `H:/hindsight/.venv/Scripts/python.exe -m pytest tests --ignore=tests/test_main_operations.py -n 0 -p g1_fixture_network_guard -q --tb=short` |
| `hindsight-clients/typescript` | `C:/Program Files/nodejs/npm.cmd test -- --runInBand --testPathIgnorePatterns=main_operations.test.ts` |
| `hindsight-clients/typescript` | `C:/Program Files/nodejs/npm.cmd run build` |
| `hindsight-clients/rust` | `C:/Users/55473/.cargo/bin/cargo.exe test --release --locked --offline --test native_result_contract --test current_state_contract --test transition_contract --test configuration_observation_contract --test template_lifecycle_contract --test template_backup_contract` |
| `hindsight-clients/go` | `H:/TakiAgent/.trellis/.runtime/g1-toolchain/go/go/bin/go.exe test ./... -count=1 -v -run ^(TestDispositionTraitsCompatibility\|TestNativeResultNullableStatus\|TestNativeReferenceNullableDocument\|TestCurrentState.*\|TestTransitionNullableArtifactContract\|TestConfigurationObservationProfiles\|TestTemplateLifecyclePresence\|TestTemplateBackupV2PreservesExactWire)$` |

The Go pattern is a single argv element; its pipes are not shell operators. Markdown escapes shown in the table
are display-only. Service-backed SDK tests remain outside these fake-provider/offline gates.

## Native-only affected contract regression

Executed as `affected-01`: 77 passed, with owned PostgreSQL and TEMP cleanup confirmed, using:

`run_isolated_hindsight.py -- tests/test_taki_template_backup_contract.py tests/test_taki_extension_contract.py
tests/native_results/test_template_label_recovery.py -q --tb=short`

The first file covers current v2 wire/byte limits and exact SDK fixture parity. The second runs actual authenticated
SQL/HTTP compatibility and the newly advertised optional backup capability. The third reruns B2's real default
ConfigResolver/frozen-plan behavior: tenant/Bank fallback or malformed data remains useful but neutral, valid
empty inheritance remains valid, and a later successful resolver cannot upgrade the original retained plan.
Only B3 opts into `_strict`; these unchanged-default-path regressions complement the already passed strict
observer tests and Native physical-preservation tests. They do not need a Core source freeze or HTTP listener.
