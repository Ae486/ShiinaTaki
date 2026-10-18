# B1 implementation evidence

Status: **B1 implementation and self-checks complete; source ownership released.** Independent B1 review remains
pending under the owner's explicit stop boundary. This is not acceptance of all Stage 5B or B2/B3 completion.

The authorized scope is the complete B1 milestone in `implement.md` and `research/review-plan.md`.
Native/Shared/compatibility/generator/spec/test ownership is released by `/root/stage5a_implement`; the separate
Core composition owner already released its 25-file slice. Root owns acceptance and future scheduling.
No B2 orchestration, Home work, original-data actions or deployment/model-provider calls are included.

## Baseline and preservation

`pre-b1-baseline.json` records post-5A Taki/Native HEADs, dirty source identities and the sole Native head e40b1e8a7d32.
Core 058 and a unique additive Native successor are reserved. Existing W9/5A changes and historical migrations remain.
Leader-owned task artifacts and HANDOFF updates are concurrent planning changes, not source-preservation failures.

## Current implementation

- Shared finite definitions and lifecycle snapshot/apply/receipt/refresh/label/backup evidence schemas are implemented.
- Model-ID grammar is grounded in existing Native lowercase/digit/hyphen validation.
- Trigger and label optional fields preserve supplied presence; no defaults are expanded in before-images.
- Native claim/settlement and atomic refresh publication now run through the existing refresh pipeline. Sync obtains
  a durable processing claim; Worker passes its issued owner/time tuple. Pre-provider and final locked guards bind
  full definitions and object revisions/hashes. The semantic marker commits with content/history/logical changes.

## Verification

Shared typecheck: first run exited 2 because the recursive trigger schema pipe exposed an input generic mismatch;
the corrected unknown-input validation pipe preserves the checked output type. The second run exited 0.
- Native first isolated run: exit 1, 2 passed / 4 failed. The failures exposed positional calls to the keyword-only
  `transition_writer_scope`; both call sites were corrected. Fixture `taki-hindsight-g1-9e0fb97426fd` is stopped,
  and its data/registry were removed. Its original pytest log remains under `.trellis/.runtime/g1-validation/`.
- Native second isolated run: exit 0, 8 passed in 87.45 seconds. Covers actual authenticated routes, migration,
  definition-only install, receipt replay, CAS/no-op behavior, transactional rollback, authorization failure,
  genuine pristine proof, durable Sync/Worker claims, stale definitions and crash-after-content recovery.
  Fixture `taki-hindsight-g1-f89640374012` has Stopped/DataRemoved/RegistryRemoved all true.
- Native full-package ty first reported 29 diagnostics: two new nullable-claim accesses were fixed with an explicit
  checked issuance boundary. The rerun exits 1 with 27 existing Windows/optional ML dependency diagnostics only
  (`mlx`, `fcntl`, `signal`, `resource`, `os.uname`); see `b1-native-typecheck-full.log`. Full-package type success
  is not claimed. Scoped affected-module Linux-target verification subsequently passed (see below).
- Core composition final checks: types and affected lint exit 0; 5 files / 40 tests passed. See
  `b1-composition-implementation.md` and its 25-file frozen manifest. No independent B1 check was dispatched.
- Four cross-language golden vectors are frozen in `b1-template-hash-vectors.json`; both repositories have exact
  fixture copies. They cover absence/tombstones, Unicode/prototype-like keys, binary64 and complete trigger fields.
- The third isolated matrix and targeted rerun are complete below. Canonical repeatability, final Go recheck,
  Taki gates and source release are complete. The original failed logs remain; no full Native green rerun is claimed.

### Final Taki and SDK self-checks

Every log below has a matching `*-result.json` with its exact command, cwd and actual child exit 0.
Counts overlap with earlier runs and are not additive. Vitest used at most two workers; heavy processes ran serially.

| Check | Result | Evidence |
| --- | --- | --- |
| Shared full suite | 66 files / 565 passed | `b1-shared-suite-01.log` |
| Core composition/storage/migration and compatibility integration | 9 files / 66 passed, including the 40 released Core cases | `b1-core-affected-01.log` |
| All TypeScript workspaces | All 5 typecheck commands passed | `b1-typecheck-01.log` |
| Root ESLint | Passed | `b1-lint-01.log` |
| Python SDK offline | 103 passed; existing ignored-operation-ID warning | `b1-sdk-python-01.log` |
| TypeScript SDK | Build passed; 12 suites / 45 passed | `b1-sdk-typescript-build-01.log`, `b1-sdk-typescript-01.log` |
| Rust SDK | 12 passed across five contract binaries | `b1-sdk-rust-01.log` |
| Go SDK, final canonical output | Existing offline selectors plus new template presence contract passed with `-count=1` | `b1-sdk-go-final-01.log` |
| Native affected Ruff | 24 production/test modules passed | `b1-native-ruff-01.log` |
| Native affected ty, Linux target | All 19 touched production modules passed | `b1-native-ty-scoped-01.log` |

The typecheck result's roughly ten-hour wall-clock interval crosses an apparent session/machine suspension.
Retain that raw interval; it is not a CPU-time or performance measurement. SDK checks consume the actual new
canonical schema. `b1-generated-tested.json` pins their generated source. Final Python/TS/Rust inputs/outputs match
those hashes exactly; final Go contracts reran after full normalization. The Go postprocessor correction is covered
by its dedicated regression tests.

## Recovery checkpoint

Third isolated run completed: exit 1, **35 passed / 2 failed**, 341.61 seconds. Fixture
`taki-hindsight-g1-f109eb31cc07` reports Stopped/DataRemoved/RegistryRemoved all true. Original pytest log:
`.trellis/.runtime/g1-validation/taki-hindsight-g1-f109eb31cc07/pytest.log`.
The new fault-injection test compared an unquoted schema/table against lifecycle SQL's quoted schema and did not
fire; normalize identifier quotes in the injector. The reused legacy manifest assertion still expected the 5A build
and omitted the newly added optional lifecycle contract; update those exact expectations. These are test-fixture/
expected-contract corrections, not production fixes. The focused rerun exited 0: **3 passed**, 43.60 seconds,
fixture `taki-hindsight-g1-537efb2670f5`, Stopped/DataRemoved/RegistryRemoved all true. It proves all five injected
write/publication boundaries roll back; no production behavior was changed to make this test pass.
Full-package ty still exits 1 with the documented 27 existing Windows/optional-dependency diagnostics; no new
diagnostic remains. Scoped ty over all 19 touched production modules (including MemoryEngine and Worker) with
the actual Native Linux platform target exited 0; see `b1-native-ty-scoped-01-result.json`. This is not a passing
full-package Windows typecheck. The final import sort and five new-file formatting changes are behavior-neutral.
These records precede the completed canonical generation sequence below.

### Generator checkpoint

- `b1-openapi-01`: the script's `__main__` defaults to root `openapi.json`, unlike its callable's canonical default.
  The command exited 0 but wrote that wrong path. `b1-canonical-01` consequently regenerated from the old static
  schema: its child process exited 0, but this is **not** B1 generation acceptance. The wrapper then exited 1 while
  printing a UTF-8 checkmark through Windows GBK. Its result JSON retains the actual child exit independently.
- The task-local runner now configures stdout UTF-8. `b1-openapi-02` explicitly names
  `hindsight-docs/static/openapi.json` and exited 0. Its four new lifecycle routes and `TemplateApplyRequest` were
  checked before rerunning canonical generation. Input SHA-256:
  `8d49efa07c17b9694354259ac9e7795a8c0c824ec6a7b0119947d85f791b012f`.
- The accidental root file was absent from the pre-B1 inventory and untracked; its bytes exactly matched the new
  canonical file. Only this resolved `H:/hindsight/openapi.json` duplicate was removed. No original file was removed.
- `b1-canonical-02` used that verified new schema, passed Rust generation/build and Python/TypeScript generation,
  then exited 1 in Go postprocessing. Pydantic's `TemplateModelDelete-Input` schema name becomes Go
  `TemplateModelDeleteInput`; the previous strict union mapper compared them literally and refused.
  `scripts/postprocess-go-client.py` now normalizes only the known `-Input`/`-Output` suffixes. Wire discriminator
  keys/tags remain exact and arbitrary names are not guessed. Four specific postprocessor regressions passed;
  directly rerunning the canonical postprocessor on that generated tree also passed.
- `b1-generator-regression-01`: 24 passed / 1 failed, exit 1. The failure found `tombstone` in the new SDK fixture
  where the actual DTO requires `null_tombstone`; corrected the fixture, then the actual-Native-DTO check passed
  (`b1-generator-regression-02`, exit 0). The unchanged OpenAPI tests and four suffix tests are among the 24 passes.
- New-schema Python SDK tests passed **103**, exit 0, with external networking blocked. The completed Rust,
  TypeScript and final Go results appear in the self-check table above.
- `b1-canonical-03` passed the entire maintained generator (exit 0, 465.491 seconds), including Rust release build,
  Python/TypeScript generation, strict Go postprocessing and Go build. `b1-generated-before.json` pins 906
  canonical/generated/preserved artifacts under the verified new OpenAPI hash above. All tested Python/TS/Rust
  artifact hashes match. Go artifacts differ after the full canonical format/normalization path, so the offline
  Go contract gate subsequently reran on the final output.
- `b1-canonical-04` passed the full same-input repeat (exit 0, 332.333 seconds).
  `b1-generated-comparison-01` compares `b1-generated-before.json` / `b1-generated-after.json`:
  **906 files, zero byte changes**. The first old-input run and failed new-input run are excluded from that claim.
  Final Go contracts with cache bypass (`-count=1`) exited 0. Canonical Rust/Python/TS/Go builds/outputs and
  maintained wrapper/module bytes are pinned; no generated source was hand-edited.
- Added maintained Python/Rust/Go/TypeScript lifecycle SDK tests using one static serialization fixture. These
  prove missing versus tombstone versus null/empty-list preservation; the TypeScript test exercises real generated
  transport against a fake fetch. Fixture hashes are schema-valid examples, not an actual Native receipt.

Native source now includes strict mirror/codec, schema/action/field fail-closed access, RR read-only snapshot/result,
complete opaque deletion digests, connection-owned definition-only CRUD, single-transaction apply,
the e40 successor e51c2f9a8b43 migration, and distinct definition-installed initialization evidence. Authenticated
snapshot/apply/result/refresh-result routes are connected. Persisted refresh claims, final atomic result publication
and generic Worker settlement exclusion are connected and the first targeted SQL/execution checks passed.

Core ownership has been transferred to `/root/stage5b_composition_implement`: the new
`packages/core/src/memory/hindsight/template-lifecycle/` directory, Core 058 and its registration/index tests.
That owner has completed and released its files with final evidence. Native/Shared/compatibility/generator and
batch integration ownership is now released. B2/runtime/Home work is not started. The owner explicitly requested
stopping after this B1 batch; independent review and further milestones remain future work, never implicit passes.

## Final source, preservation and release

- `b1-final-source.json` freezes the current source and all B1 evidence, compares the original dirty-file baseline,
  rechecks all 25 released Core files and three Shared consumers, and validates source text as UTF-8 without BOM.
  Taki and Native HEADs remain the pre-B1 values; no commit/push/reset/rebase/finish/archive occurred.
- Intentional Taki baseline deltas: exact lifecycle build admission in compatibility/application/transition/recovery/
  5A observation paths; optional Shared capability/reason/public exports; directory/spec registration; Core database
  index; and the documented export-only Shared entry limit. Leader-owned HANDOFF changes are not implementation
  source ownership. Other recorded W9/5A source hashes are preserved.
- Intentional Native baseline deltas: the existing MemoryEngine refresh/update/execution seams, optional manifest
  and built-in router inclusion, exact updated legacy manifest test, patch ledger and canonical SDK/OpenAPI outputs.
  New B1 modules, migration, tests and the Go generator suffix correction are explicit additions. Old migration
  contents and the legacy Core v1 catalog hash are unchanged. The final manifest enumerates precise paths/hashes.
- Both repositories' `git diff --check` passed (`b1-taki-whitespace-01`, `b1-native-whitespace-01`). Existing
  Git CRLF/LF normalization notices remain informational. New files are included in explicit source-encoding checks.
- `b1-fixture-cleanup-final.json` rechecks all four owned Native fixtures: stopped, data removed and registry removed
  are all true. All owned verification/generation processes have returned; original failure logs remain retained.
- Native full-package Windows ty remains **not passed**: 27 existing optional-ML/platform diagnostics, no new
  diagnostics after the claim correction. The 19-module Linux-target type pass is reported separately.
- No real provider calls, credentials, original data, deployment or installed/manual acceptance were exercised.
  Label/backup schemas have no producer yet. Runtime rollout/recovery, trusted per-fact labels, Home and paired
  managed backup equality remain B2/B3. The next authorized continuation must first schedule the independent
  B1 transaction/auth/refresh review using `research/review-plan.md`; no such checker was dispatched in this batch.
