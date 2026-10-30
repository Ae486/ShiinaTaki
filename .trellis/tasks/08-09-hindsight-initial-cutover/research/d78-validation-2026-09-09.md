# D78 Implementation and Validation Record

Status: implementation, independent review and scoped offline delivery complete, with the pre-existing native Windows
typecheck limitations below. Final file/manifest and preservation audits passed.
This is a continuation of B4, not full B4/runtime/live acceptance. The task remains `in_progress`.

## Authority and baseline

- Taki checkout: `H:/TakiAgent`, `main`, baseline `dd2e15b98b6661a01b1f951cfb85f718f2aea75d`, with the already verified
  036-038 first slice retained. Native checkout: `H:/hindsight`, `main`, baseline
  `8ab65b4c2ea238223eeef84cbdcc012ca7601e86` (Hindsight 0.9.0 and the G1 checkpoint).
- The owner authorized the clear next implementation route and subsequently requested recovery after interruption.
  The existing task/session binding was recovered; no replacement Trellis task was created.
- The binding implementation contract is [d78-execution-contract.md](d78-execution-contract.md), with
  [native preflight](d78-native-preflight.md) and the executable
  [current-state specification](../../../spec/backend/memory-current-state-cutover.md).
- All service/storage tests use owned PostgreSQL/HTTP/SQLite fixtures and deterministic model implementations. No
  existing user database, `.env`, protected B2 backup, real provider/model call or actual authority activation is used.
  No Git staging/commit/push/rebase/reset, dependency addition, finish or archive is part of this slice.

## Delivered behavior

1. Migration 039 and the current-state repositories freeze the complete current Local Bank, including edited B2
   records, nullable source text, invalidated/standalone units, source links, chunks, native derived resources and
   original Taki policy/provenance/lineage/Block artifacts. Every record has an explicit disposition. Blocks and
   Taki-only policy artifacts are retained evidence rather than invented native facts.
2. Native `current_state_transfer: 1.0.0` imports an atomic Bank of at most 10,000 records / 16 MiB without extraction.
   Admission verifies the exact B3 Bank/model/directive baseline, namespace and complete owned supersession set under
   the native Bank writer lock. Unknown objects, drift or pending accepted native writes are refused. Final lifecycle,
   indexes, journal and full source-to-native mappings commit together; replay returns the original immutable result.
3. Independent `cutover_verification: 1.0.0` enumerates the complete current source/scope/model requirement set and
   records actual native consolidation and model inputs, actions/no-ops, partial committed outcomes and attempt CAS.
   Real reflect/tool/prompt assembly and final delta truncation produce consumption evidence. Model definitions,
   authored content, policy/tracking, lifecycle and historical scope exits remain distinct. Queue emptiness, timestamps
   or diagnostic traces cannot discharge missing proof. The current-input window has no timestamp lower/upper bound.
4. Completed proof binds a sealed native logical snapshot and complete ordered evidence stream. Snapshot pages are
   retained in the sealing transaction. The additional tagged `snapshot_records_hash` binds every ordered record;
   existing G1/C1/snapshot hash encodings stay unchanged. A complete certificate permits historical snapshot reads
   beyond the ordinary TTL; a boolean alone does not. New verification refuses known generation/relevant-state drift.
5. Taki validates all identities, pages, mappings, hashes, source/model coverage and snapshot binding before one SQLite
   writer transaction persists evidence and publishes the actual B4 raw logical replica/checkpoint. Old certificates
   cannot overwrite a newer cursor; validated evidence can rebuild missing raw staging. Durable invalidation survives
   restart. Network/timeout/503/parse failures do not fabricate native drift.
6. The existing B4 readiness, verification and promotion guards require current import and maintenance proof for every
   bound Bank, including empty Banks, plus the final Local writer reservation/epoch/fence/digest checks. Status counts
   come from persisted selected evidence. The owned HTTP fixture reaches readiness and then proves refusal after a
   real Local edit while preserving Local authority and B2 history.

Build identity: `taki-memory-hindsight-0.9.0-d78-v1`. New contracts are independently advertised from actual schema,
storage and authentication probes. Routine `native_results: 1.0.0` still confirms factual writes independently of
later automatic maintenance. The native inventory and upgrade obligations live in `H:/hindsight/TAKI_PATCHES.md`,
patch `TAKI-HS-010`; this report does not maintain a second provider patch ledger.

## Verification evidence

Logs below are task-owned paths under `H:/TakiAgent/.trellis/.runtime/`. Counts across rows overlap and must not be summed.

| Gate | Observed result | Log / command |
| --- | --- | --- |
| Taki full recursive tests | 3239 passed: Shared 414, CLI 47, Desktop 548, Core 2230 | `pnpm -r --workspace-concurrency=1 test` |
| Taki types and lint | Five project typechecks passed; root lint passed with one pre-existing unused-disable warning | `pnpm -r typecheck`; `pnpm lint` |
| Strip-only Core startup | Actual `main.ts`, migrations 1..39, no external provider requests/Pending/activation; owned children and files cleaned | `d78-validation/8840c97e500a` |
| Native result aggregate | 138 passed in 294.05 s; two existing websockets deprecation warnings | `g1-validation/taki-hindsight-g1-aef11db788c3` |
| Native current-state admission/ownership | 29 passed in 49.04 s after per-input G1 ownership corrections; independently reviewed | `g1-validation/taki-hindsight-g1-3ccf0f81ea93` |
| Native proof and ordinary maintenance/reflect regressions | 133 passed in 118.55 s; subsequent lifecycle/scope-exit correction 10 passed in 25.55 s; both independently reviewed | `g1-validation/taki-hindsight-g1-89f71b548aec`, `...-f67010962eee` |
| Real two-Bank HTTP to Taki SQLite | 1 passed in 23.46 s, also included in the aggregate: two committed-response-loss restarts, full proof/raw replica, B3 models, typed metadata, readiness then real stale-Local refusal | `g1-validation/taki-hindsight-g1-b54d4d3a8729` |
| Nonempty native backup/restore and capability/auth | Six private proof tables and retained snapshot rows survive actual admin restore; all nine capability/auth cases passed, included in aggregate | `g1-validation/taki-hindsight-g1-58aa28125ed9`, final aggregate |
| Existing snapshot/consolidation/observation/extension/backup/migration suites | 258 passed, 101 conditional migration skips; one snapshot test proxy lacked `fetchval`. After correcting only the proxy, the entire snapshot file passed 16 tests in 28.79 s; all observed failures are closed | `g1-validation/taki-hindsight-g1-9d6f75e54877`, `...-70d38141346a` |
| Canonical schema, actual native SDK fixtures and migration DAG | 22 passed in 17.55 s, network guard enabled, no database | `g1-codegen/6be40e90a2ab` |
| Actual fresh Rust generation and serde contracts | Release/locked/offline build passed; eight G1/D78 contracts passed, including every evidence variant and nullable scope union | `g1-codegen/dab1d5998a4a` |
| Final canonical generation and documentation | OpenAPI, Python, TypeScript, Go tidy/build, actual Rust generation/build and documentation build passed | `g1-codegen/a8cf04c4d03b` |
| Final SDK offline behavior and builds | Python 96 passed, one expected sync-operation warning; TypeScript 38 passed/build passed; Go all-test compilation plus six contract tests/twelve subcases passed; Rust eight serde contracts passed | `g1-codegen/d4b4016a0510`, `abe4057ff93e`, `411a3c37e4bc` |
| Actual Python wheel and OpenAPI backwards compatibility | Offline wheel build/import of both packaged modules passed D78 request and old G1 omitted/null PATCH cases; maintained backwards checker passed, no removed components (194 to 272) | `g1-codegen/e32574aa37af` |
| Exact repeated canonical generation | 528 files, including actual current Rust generated source, byte-identical; eight maintained manifest/lock/protected files unchanged | `g1-codegen/31a8e0af0dae` |
| Full native lint and Windows ty comparison | Required final hook executed, exit 1 solely on 27 unchanged API and three unchanged Embed Windows diagnostics; other hook tasks passed. Compared diagnostics: zero added/removed | `d78-validation/cc63303ff4084c92a23a354de39508f8` |
| Changed native source/codegen ty | All 33 affected API sources and OpenAPI/Go helpers passed. API diagnostic baseline's seven files and Embed `cli.py` are unchanged from HEAD | `d78-validation/33e40d91314f4a0c98eb67866eda5f9c` |
| Final file/manifest audit | Both checkout diffs passed whitespace checks; 121 Taki and 261 native changed/new text files are UTF-8 without BOM. Task manifests passed with 20 implement / 19 check entries. Both HEADs/branches/staging states stayed unchanged | `d78-validation/audit-1a187d454f7b` |
| Canonical shell and final resource check | Git Bash syntax check of `scripts/generate-clients.sh` passed; all nine explicitly audited completed/interrupted native fixtures are stopped with data/registry removed | `d78-validation/audit-1a187d454f7b/resource-summary.json` |

Native invocations use the existing
[`run_isolated_hindsight.py`](../../09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py)
with the explicit reviewed selectors. The full result matrix uses `--allow-http-fixture -- tests/native_results -q
--tb=short`. Existing native tests use `-p g1_mechanical_fixtures` and only the source-reviewed file allowlist. The
Windows generator runs the canonical source entry, pinned tools/options and maintained postprocessors; it does not
start Docker. SDK live-service test modules are deliberately excluded from offline selections.

The canonical OpenAPI artifact is 665,488 bytes with SHA-256
`cf999d5b9fd8bcdfe1b19ece108a6183a6a82c8545a574c1d0b87340b36e1419`. Repeated generation uses the current source and the
same pinned tools, rather than a copied target cache. The OpenAPI checker is supplemented by real generated-model and
request/response tests; it is not a proof of arbitrary future client compatibility. Go's new int64 public types and
metadata JSON value widening are explicit source compatibility considerations.

## Defects found and corrected

- Exact native ownership now uses each G1 input's cursor/reference manifest and public/durable result equality.
  A parent aggregate cursor could conceal document drift in multi-input supersession. Corrupt G1 evidence becomes
  typed `receipt_corrupt` instead of leaking a 500. The real PostgreSQL failing case and passing correction are retained.
- Maintenance review corrected Bank operation authorization, effective B3/global policy identity, original model ID
  versus human labels, post-completion drift checks, lifecycle/scope-exit history and actual post-truncation inputs.
  Scope exit uses retained historical text; it never places out-of-scope current text into the model prompt or invents
  a previous revision/cursor for a candidate-only event.
- Consumer review corrected HTTP failure classification, literal JSON keys such as `__proto__`, durable known-drift
  invalidation, retained-snapshot validation, newer-cursor refusal and same-evidence raw staging reconstruction.
- Go generation now preserves declared evidence discriminators and required nullable arrays, and uses int64 for JSON
  integers instead of truncating safe integers to int32. Generated callers must adapt former int32 parameter/helpers.
  Maintained manifests and wrappers stay intact; no generated file is used as a source fix.
- The canonical OpenAPI walker translates schema `const` into equivalent one-value enums without modifying property
  names, defaults or example data. Multi-arm nullable properties have separately named non-null value components so
  Rust does not generate duplicate recursive types. Alias conflicts and repeated generation have explicit tests.
- A copied Rust target cache watched an obsolete absolute schema path. `build.rs` now watches its relative current
  schema and itself. Earlier exit-zero builds without current D78 types are superseded by actual current generated
  DTO compilation and serde tests. A new reverse-expansion test initially expanded an unchanged source `$ref`; fixing
  that test's scope preserves the original referenced model instead of altering production schemas.
- The legacy concurrent snapshot test's pausing connection proxy required a delegating `fetchval` for the new catalog
  retention probe. The real database query and original concurrency assertions remain intact.
- Independent final generator review replaced the internal discriminator helper's fixed tuple return with a frozen
  dataclass to match native code standards. Scoped Ruff/ty and exact repeated output parity passed afterward.
- Final documentation review corrected the provider ledger's relative source-path prefixes and verified its 19 local
  Markdown links. The Windows audit runner uses explicit UTF-8 decoding for captured task-validator output.

The Shared public index exceeded the generic 360-line cap. Unused new exports were removed, and its reviewed exact
file exception allows 420 lines with AST enforcement permitting only source-bearing named exports. Implementation,
imports, local exports, wildcard exports and side effects remain rejected; negative checks and root lint passed.

## Interruption and preservation

- The user interrupted the old mechanical run `6d900278702a`; it stopped partway through collection/execution and is
  not acceptance evidence. Its exact ownership record/data path and stopped state were verified, then its data and
  registry were removed with the guarded PowerShell helper. The completed 22-test schema/DAG log survived.
- Completed owned PostgreSQL runs were stopped and their data/registry removed. No existing service was stopped.
- During earlier agent context recovery, a peer mistakenly read unrelated T4 task/status pointers. Those reads were
  disclosed; no other-worktree files were changed. This report does not claim that no such read occurred.
- Both full lint invocations completed under clean offline environments with path-checked temporary roots. Incidental
  formatter changes were restored with before/after hash checks; the final run left all 4143 checked files identical
  to its frozen inputs. All 120 dependency manifests/locks stayed byte-identical. The unrelated native CLI SHA-256 is
  `ce3ccd97b3759b2a0848221a9487de67178ce640d1ddc324a3043f7507655ef2`. Old G1/B2 evidence/identities are retained.
  User data and protected backup contents are not traversed for the final audit.
- After final generation, the independent preservation audit again matched all 120 native dependency manifests/locks
  and the protected CLI hash. Taki's 035 migration, Pending intent schema and legacy hash source match HEAD after EOL
  normalization. Both checkouts remain on their original `main` HEADs with no staged files.

## Remaining acceptance and rollout boundary

These tests prove mechanics with deterministic models, not extraction/consolidation/model quality. Actual deployment,
Host behavior, user-data import and owner-observed activation remain unrun. Core boot was terminated with SIGTERM;
it is not evidence of graceful shutdown. No manual B4 acceptance checkbox is discharged by these tests.

D78 raw staging is not B5 Canonical derived-policy projection. D77 still owns provider-only recovery of original
Taki provenance/policy/Blocks and rebinding after arbitrary later native edits. B6 owns projection/runtime/provider
readiness, and B7/healthy return to Local retain separate gates. No policy defaults are fabricated for new native
observations. A historical certificate does not freeze future remote writes.

An eventual separately authorized rollout must deploy the D78 provider source/build, apply the two forward native
migrations and Taki 039, verify authenticated capabilities, then run preparation/import/verification under actual B3
bindings before the existing fenced activation gate. No new environment variable or dependency is required. On failure
before activation, preserve Local authority and all evidence. Disable new D78 admissions before rollback; do not drop
proof tables/pinned snapshots while consumers depend on them. Native downgrade refuses nullable/large values that
the older schema cannot represent; it never substitutes data. PostgreSQL SQL-row storage is the supported backend.
