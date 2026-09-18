# D77 canonical OpenAPI and maintained SDK validation

Status: the bounded OpenAPI/SDK generation task is complete. This is not whole-D77/B6, live-authority, real-model, or manual acceptance.

The only Hindsight worktree used was `H:/hindsight`, branch `main`, HEAD `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`. No original user database/data, environment files, credentials, real models, new dependency declarations, Git staging/commit/push/reset/rebase, or other worktree was used.

## Canonical generation and exact parity

Authoritative command, run with the existing pinned toolchain:

```text
H:/hindsight/.venv/Scripts/python.exe H:/TakiAgent/.trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_windows_codegen.py --openapi --python --typescript --go --rust --docs
```

- Final complete runs: `0c39286fdaf9` and `ac99e73c1585`, with all selected steps successful. Their detailed logs are under `H:/TakiAgent/.trellis/.runtime/g1-codegen/<run>/`.
- **683 generated files are byte-identical between the two runs**, including canonical OpenAPI, Python code/metadata, TypeScript generated code, Go code/embedded OpenAPI, Rust generated source, and the documentation build's OpenAPI copy.
- Canonical OpenAPI SHA-256: `582b83b3d8f85b783420546011bfb4431395f2c6e79e25d47b7cce7603dbb4f2`.
- The Go embedded specification is identical to the actual pinned generator's staged output. The built documentation's OpenAPI is identical to the canonical input.
- The final documentation-mirror change modified only `hindsight-clients/go/api/openapi.yaml`; all SDK source hashes remain identical to the earlier successfully tested run `b13ca216b2fc`. Tests were not repeated unnecessarily after that documentation-only change.
- The OpenAPI Generator 7.10.0 JAR's SHA-256 was verified against the existing toolchain record: `615e014705af34861e789e0b2a11075d3c80db134f881e937265479a4a83996e`.

Evidence: `generation-parity.json`, `generated-generation-4.json`, `generated-generation-5.json`, and `generated-pre-doc-mirror.json`.

## Producer and generator repairs

All of these narrow changes were explicitly approved by the parent during execution:

1. `hindsight-api-slim/hindsight_api/api/taki_application_state.py`: D77 operations inherit the existing parent `Taki Memory Compatibility` tag exactly once. The previous additional child tag made OpenAPI Generator 7.10.0 declare each Go request struct twice.
2. `hindsight-api-slim/hindsight_api/api/taki_application_schema.py`: only `TakiApplication*` enum/const schema titles receive deterministic owner/field-path qualification. Typify had reused generic `Kind`, `State`, `Command`, and other titles across incompatible enums, causing invalid defaults and potentially wrong variants. Normalization traverses schema positions, preserves literal defaults/examples, and validates candidate collisions before updating the public map.
3. `hindsight-api-slim/tests/native_results/test_application_openapi.py`: three new offline regressions cover single-tag composition, enum-title isolation, and native-schema/literal preservation. The enum regressions failed before the repair and passed afterward.
4. `scripts/generate-clients.sh`: the existing TypeScript postprocessor writes explicit UTF-8 LF, avoiding a Windows-only generated formatting difference.
5. The existing Windows generator wrapper now mirrors the generator-owned Go `api` directory after validating the exact resolved `H:/hindsight/hindsight-clients/go/api` target. Its tracked embedded schema had remained stale at 70 paths/188 schemas; the actual generated documentation now has 96 paths/423 generator-normalized schemas.

The source-level enum repair changed **63 title annotations and nothing else** in the canonical schema. Defaults, constraints, references, and wire fields are identical to the pre-repair schema. No generated file was hand-patched. No Rust build script, maintained SDK wrapper/test/README/config, Go module manifest, or dependency lock was altered.

Scoped source review found no remaining must-fix issue in these changes: the application wire/validation/authorization behavior is unchanged, normalization preserves literal data and detects component conflicts, and the mirrored Go directory is checked before any replacement. Whole-repository baseline findings remain listed below.

Evidence: `enum-title-only-diff.json`, `windows-wrapper-change.json`, `rust-schema-probe-results.json`, `native-enum-title-red.log`, and the native OpenAPI final gate logs.

## Compatibility and regression gates

| Gate | Result |
| --- | --- |
| Old canonical paths | All 81 unchanged; 15 D77 paths / 16 operations added |
| Old canonical components | All 272 names retained; 135 application components added, for 407 total |
| Authorized old-component additions | `TakiCompatibilityContracts` requires `application_state` / `application_reflect`; `TakiCompatibilitySupport.reason` adds the corresponding two unavailable reasons |
| Multipart body schemas | All 10 versioned body models and references published |
| Python source compatibility | 3,368 old public symbols/signatures retained |
| TypeScript source compatibility | 923 old public exports retained |
| Go source compatibility | 8,740 old public symbols/signatures retained, except the explicitly authorized two added capability arguments of `NewTakiCompatibilityContracts` |
| Rust source compatibility | 451 old public generated types and 98 old async methods retained; compared with the same compiled build script generating from HEAD's canonical schema |
| Python | 331 generated modules import; wheel builds from the existing offline uv cache using the already-declared hatchling 1.32.0 backend; 96 offline tests pass |
| TypeScript | `tsc --noEmit`, `tsup` build, 9 suites / 38 offline tests pass |
| Go | `-mod=readonly` build, all-package test compilation, generated placeholder test package, and 6 top-level native/G1/D78 compatibility regressions pass |
| Rust | Locked release build, 8 locked offline G1/D78 tests, and 1 compile-only doctest pass |
| Rust application consumer | An external task-owned `rustc` consumer links the real release SDK, validates 58 application enum types / 181 declared wire values and rejects unknown variants, and references all 10 body models |
| Native schema fixes | 4 pure offline tests pass, 1 prior PG-dependent schema test deselected; touched files pass Ruff, formatting and strict scoped ty |
| Generator syntax | `G:/Git/bin/bash.exe -n scripts/generate-clients.sh` passes |
| Generated TypeScript formatting | Exact repository Prettier check passes |
| Documentation | Full build passes; two existing changelog anchor warnings remain |

The source comparison permits only the stated capability additions. All other old schemas, including G1/D78 request/receipt/certificate domains and native public model names, remain unchanged. No service-backed SDK lifecycle test or previously completed native PostgreSQL suite was repeated.

Evidence: `openapi-compatibility.json`, `source-compatibility.json`, `rust-source-compatibility.json`, all `python-*`, `typescript-*`, `go-*`, `rust-*`, and `native-openapi-final-*` logs. `run_sdk_gates.py` records exact commands and exit codes in adjacent JSON files.

## Preservation and text audit

- Original 127-file preservation manifest: **122 byte-identical**, **5 explicitly approved changes**, **zero unexpected drift**. The five exceptions are the three native schema/router/test files, canonical shell generator, and Go generated OpenAPI document. The external Windows-wrapper change has its own before/after hash record.
- All maintained SDK wrappers, tests, README/config files, `go.mod`, `go.sum`, Cargo/Node/Python locks, and unrelated native DB/Supabase/conftest/control-plane edits retain their initial bytes.
- Of the native implementation owner's 36 hashed files, only the three approved schema/router/test files changed. Updated hashes are recorded in `native-source-sha256-after-sdk.json`; the original handoff hash manifest was not overwritten.
- Full text audit: **687 files**, including **153 untracked files**, with zero invalid UTF-8, BOM, mixed-line-ending, introduced trailing-whitespace or excess-EOF-blank-line defects. `git diff --check` passes. No files were staged.
- Two unchanged upstream generated Python scaffolds retain HEAD's eight trailing-whitespace lines: `configuration.py:177` and `exceptions.py:107,108,109,135,136,137,138`. These are reported, not silently formatted outside the canonical API/model normalization scope.
- The canonical JSON exporter and its identical built-docs copy retain their established lack of a terminal newline. This is recorded separately from source-code whitespace defects.
- Changed Hindsight inventory: 166 files (13 tracked changes and 153 untracked files in scope); Python 81, TypeScript 2, Go 78, canonical docs 1, native source/test 3, shell generator 1. Some native files were already untracked when ownership transferred. Rust generation lives in its ignored build output. The Windows wrapper is the additional Taki-side source change.

Evidence: `preservation-before.json`, `preservation-final.json`, `generated-text-audit.json`, `changed-files.json`, `git-diff-check.log`.

## Exact remaining full-lint boundary

`scripts/hooks/lint.sh` was **not** run: it executes `uv sync --frozen --quiet` and auto-fixes/formats unrelated trees and maintained SDK files. Read-only equivalents were run using the existing installed tools:

- Pass: control-plane ESLint; API Ruff; dev Ruff/format/ty; embed Ruff/format.
- Existing failures: API ty has 27 Windows/MLX diagnostics; API format identifies only untouched `tests/test_taki_replication_curation.py`; embed ty has 3 Windows `termios` diagnostics.
- Exact Prettier reports 154 control-plane and 12 all-npm files due only to existing CRLF; both pass with `endOfLine:auto`.
- TypeScript has 16 unchanged maintained-file exact-format differences. With `endOfLine:auto`, only the already-existing formatting difference in `tests/native_result_mapping.test.ts` remains. Its original hash is preserved. Generated TypeScript passes exact formatting after the canonical LF fix.
- Two documentation warnings remain for anchors on `/blog/2026/04/28/version-0-5-5`.

The literal whole-repository lint hook and its baseline/platform issues remain a root integration requirement before claiming that gate green. This SDK handoff neither suppresses those diagnostics nor authorizes dependency sync, broad formatting, live activation, commit, push, or task archival.
