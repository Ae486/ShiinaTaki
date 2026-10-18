# B2 Native structured-label implementation

Status: Native implementation and scoped self-checks complete; source, generated clients and the lifecycle spec
are released to root for independent Native/label review. This is not the independent or combined B2 gate.
Owner: `stage5a_implement`, continuing the accepted Native ownership. No nested agents.

## Baseline and scope

- Native: `H:/hindsight`, main, HEAD `eb6413a7f58c4f3f0adb88a33a99516f8707fef7`.
- Accepted input: `b1-reviewed-source.json`. `b2-native-start-source.json` verified all 215 Native source files
  before B2 edits; it is not a new acceptance baseline. Core main remains separately owned.
- Additive Native migration `e62a3d0b9c54` follows `e51c2f9a8b43`. Recorded migrations are unchanged.
- No original data/services/credentials, paid models, new dependencies, deployment, commit/push/reset/rebase,
  Trellis finish/archive or manual-acceptance claim. All Native SQL runs use the existing clean isolated runner.
- One heavy test/build/generation workload at a time; ownership is explicitly exchanged with Core/label owners.

## Source implementation

The `retain/template_label_origin.py` private resolution record belongs to the same ConfigResolver invocation
that supplies extraction. Tenant exceptions and malformed return values cannot supply positive provenance.
`receipt_context.py` saves an optional private setting in the existing server-owned prepared plan and its
unchanged hash algorithm. Old/fallback settings remain neutral across a later successful resolution; public
request fields and metadata do not populate this private record.

Both extraction paths capture one exact raw scalar before Native's permissive parser or caller entity merge.
Fact/ExtractedFact/ProcessedFact carry the private origin through filtering and real returned unit IDs.
Collapsed/chunks output is neutral. The full supplied group is validated and hashed without expanding omitted
fields or changing array order. Native accepts its exact encoded Global identity or lowercase Character grammar;
Core separately owns full canonical binding, taxonomy, pinned and mood guards.

`template_label_publication.py` runs at the outer logical append even when application capture is off.
`template_label_store.py` binds immutable proof history and current heads to the final canonical unit payload,
current target incarnation and actual materialized group under the writer transaction. Ordinary upsert/tombstone,
including a same-UUID/revision/hash append, invalidates the head. Consolidation captures the complete prior
payload/head before its real UPDATE and may reprove only revision +1 and consolidated/failed marker changes.
All writes and logical changes roll back together.

`template_label_evidence.py` serves the actual POST `/ext/taki-memory/template/label-evidence` through the
existing bounded route class. It validates Bearer/tenant/Bank restrictions, both GET_MEMORY_UNIT and
GET_BANK_CONFIG, and the existing `entity_labels` permission filter; hook exceptions refuse. No 5A grant is
needed. It reads target, current payload and sidecars in one SELECT-only repeatable-read transaction and returns
a bounded proven subset. Capability support checks installed tables and real enabled trigger identities.

`admin/cli.py` includes proofs before heads; `transition_snapshot.py` witnesses both exact table contents while
keeping older all-absent pairs compatible and rejecting partial availability. The optional pair is independent
of the three earlier B1 tables. Portable transfer omits these authorities and all explicitly enumerated Native
operational tables.

## Findings and retained failed evidence

1. `native-labels-red-01`: 2 failed because the initial fixture incorrectly submitted the server-only
   `retain_extract_causal_links` as a Bank override. Corrected the fixture; this is not a product defect repro.
2. `native-labels-red-02`: 2 failed on actual missing tables (`0 != 2`) and route 404 after real retain created
   three facts. Raw log: `.trellis/.runtime/g1-validation/taki-hindsight-g1-27ed452ce6b2/pytest.log`.
3. Source inspection found `_OPERATIONAL_TABLES` still classified only six early tables while BACKUP_TABLES
   already included Native receipts, D77, transitions and B1 lifecycle evidence. Explicitly classified every
   observed instance-owned table; did not compute a residual set or weaken unknown-table parity. This is a B2
   discovery and new check, not retroactive B1 portable-transfer acceptance.
4. `native-labels-boundaries-01`: 10 passed, 4 new recovery parameter cases failed because a one-slice input was
   already sealed/pruned at the injected interruption; reading `prepared` then returned None. The fixture now
   requires real multiple slices, retains the private original plan after the first slice and replays only
   missing slices. A fifth malformed-tenant-return case was added.
5. `native-labels-boundaries-02`: 13 passed, 2 failed. The successful-resolution recovery assertion still expected
   one unit although the real first slice held ten independently proven units; it now checks the exact ID set.
   The earlier B1 downgrade test hard-coded e51 even though transactional rollback correctly preserved the new
   e62 head; updated that current-head expectation without editing a recorded migration. Both focused reruns
   passed in `native-labels-boundaries-03` (2 passed, exit 0). Fallback/malformed/legacy/drift recovery,
   physical label and B1 backup, schema parity,
   historical upgrade/partial-pair rejection, portable delete/recreate, delta and the real HTTP case passed.
6. `native-format-final-01` passed lint but the separate format check found mixed LF/CRLF in the newly expanded
   portable operational-table list. Scoped Ruff normalized only that file; `native-format-fix-01` explicitly
   asserted identical decoded text before/after. The final 25-file format check and 17-module typecheck passed.

## Executed checks

| Evidence prefix | Actual result | Meaning |
| --- | --- | --- |
| `b2-native-labels-green-01` | exit 0; 3 passed | Real scalar-only origin/caller-spoof exclusion, table/read-only endpoint and exact portable table parity. |
| `b2-native-labels-boundaries-01` | exit 1; 10 passed / 4 failed | Ordinary and Batch API parsers, invalid/case/list/multiple/filtering paths, real consolidation reproof, ordinary invalidation, rollback, read coherence and auth/bounds passed; recovery fixture failure above remains retained. |
| `b2-native-labels-boundaries-02` | exit 1; 13 passed / 2 failed | Four neutral frozen-plan cases, public injection, storage/backup/portable/actual HTTP and changed routes passed; two test-only expectations above were corrected and rerun separately. |
| `b2-native-labels-boundaries-03` | exit 0; 2 passed | Exact successful-resolution recovered fact IDs and B1 failed-downgrade rollback to the current e62 head. |
| `b2-native-label-storage-final-01` | exit 0; 217 passed / 107 skipped | Real immutable proof UPDATE, disabled/wrong-function triggers and same-revision payload drift; both B1 auxiliary regressions; full migration-shape matrix. Skips are the matrix's non-applicable concurrent-DDL cases. |
| `b2-native-label-types-01` | exit 0 | Seventeen modified production paths, same scoped Linux-target ty mode as B1. This is not a Windows/full-package typecheck claim. |
| `b2-native-openapi-01` / `b2-openapi-compatibility-01` | exit 0 | Fresh canonical export; B1-relative change is exactly one added label-evidence route, with no changed/removed route or schema. HEAD-relative routes are additive; the two existing compatibility-manifest schema changes predate B2. |
| `b2-native-clients-01` / `b2-native-clients-02` | exit 0 | Two clean canonical Rust release generation/build, Python, TypeScript and Go generation/build runs. |
| `b2-generated-comparison-01` | exit 0; 912 files identical | All canonical/generated outputs and included maintained files are byte-stable; all 12 explicitly protected wrapper/config/module inputs remain unchanged. |
| `b2-sdk-python-01` | exit 0; 103 passed | Offline generated/model/wrapper suite with the network guard; one expected warning for ignored sync-retain operation IDs. Service-backed main-operation tests were explicitly excluded. |
| `b2-sdk-rust-01` | exit 0; 12 passed across 5 test targets | Actual locked/offline release contract compilation and serde tests on the current generated client. |
| `b2-sdk-typescript-01` / `b2-sdk-typescript-build-01` | exit 0; 45 passed across 12 suites; CJS/ESM/DTS build passed | Existing offline transport/wrapper/model contracts; service-backed main-operation tests excluded. |
| `b2-sdk-go-01` | exit 0; 9 top-level contracts plus subcases passed | Current generated package tests; `./test` compiled successfully but had no cases selected by the bounded regex. Both canonical generation runs also passed `go build ./...`. |
| `b2-native-lint-final-01` / `b2-native-format-final-02` | exit 0; 25 paths each | All modified Native Python source and tests, including untracked new modules. |
| `b2-native-types-final-01` | exit 0; 17 modules | Current scoped Linux-target ty, preserving the B1 platform boundary. |
| `b2-native-diff-check-01` / `b2-native-cached-diff-check-01` / `b2-native-source-hygiene-01` | exit 0 | Both Git whitespace views plus direct UTF-8/no-BOM/trailing-whitespace inspection of all 33 changed source/generated/spec paths, including untracked files. No staging action was performed. |
| `b2-generated-tested-comparison-01` | exit 0; 912 files still identical | The SDK tests/build did not alter the frozen generated source or maintained inputs. |

Initial focused Ruff found one unsorted new test import; corrected it and formatted only this owner's Native
paths. The whole-repository `scripts/hooks/lint.sh` was not run: it synchronizes dependencies and concurrently
auto-fixes unrelated packages. This scoped batch follows B1's retained lint/type mode and preserves other owners'
source. Existing B1 Windows/optional-ML full-package limitations are not relabeled as passing.

Owned SQL fixture cleanup:

- red-01 `taki-hindsight-g1-e6878550097f`: Stopped/DataRemoved/RegistryRemoved all true.
- red-02 `taki-hindsight-g1-27ed452ce6b2`: all true.
- green-01 `taki-hindsight-g1-abf57c679bcc`: all true.
- boundaries-01 `taki-hindsight-g1-af55690d1ba5`: all true.
- boundaries-02 `taki-hindsight-g1-e5ef9b4d8341`: all true.
- boundaries-03 `taki-hindsight-g1-cc04747638d5`: all true.
- storage-final-01 `taki-hindsight-g1-2bd4e39be3ff`: all true.

See each `*-result.json` for exact argv/cwd/duration and its `.log`; raw pytest logs remain in the corresponding
owned fixture directory. Failed runs are not included in a passing aggregate.

Generation used the existing local OpenAPI Generator 7.10.0 JAR (SHA256
`615e014705af34861e789e0b2a11075d3c80db134f881e937265479a4a83996e`), pinned installed Node tooling,
locked/offline Rust and the existing offline Go cache. The canonical OpenAPI SHA256 is
`bf3cabf4ab6477e2a27e2504e3c1633632fb8468d175593c6d75a9b6794e4a71`.
Compared with the B1 generation input, only seven recorded outputs changed: canonical JSON, Go's bundled YAML
and compatibility API, Python's compatibility API, TypeScript's SDK/types, and Rust's build-generated source.
No generated model, maintained wrapper, dependency manifest or generator source changed.

## Real HTTP integration contract

`test_template_label_runtime_consumer.py` produces real extracted/consolidated Global and Character facts and
reads their final Native versions and original materialized group. The agreed Node entry is
`packages/core/src/testing/hindsight-template-native-consumer.fixture.ts` with `--endpoint`, `--seed`, `--sqlite`
and `TAKI_TEMPLATE_LABEL_HTTP_FIXTURE=1`. The seed matches its actual schema (canonicalIdentity, text and snake
unit-version fields), with an initially absent `owned.sqlite` in the same directory.

The seven-unit fixture includes two genuine classifications plus caller-only, list and conflicting-caller
neutral cases. Core uses real authenticated client/replica/binding/application-command writes and Canonical
projection, then physically reopens SQLite without repeating binding commands. Both owners reviewed the shape.
The actual HTTP case passed in boundaries-02 (the overall run remains exit 1 for the two separate tests).

Retained evidence: `b2-native-http-dd7e6dfe82504d7e9c521dd64ac8dd0b.log` and
`b2-native-http-dd7e6dfe82504d7e9c521dd64ac8dd0b-exchanges.jsonl`; exchange SHA256
`a09db13ea041d04722bd3d392a8ddda8c49f0916cd598e9b701c2c28f667f345`. Actual counters:
2 Banks, 7 units, 2 registry policies, 5 neutral policies, 2 consolidated proven units, 200 HTTP requests,
7 label-evidence reads and 11 application commits. SQLite reopen repeated neither label reads nor binding
commits; the transport asserts no remote I/O entered a SQLite transaction. No auth headers are recorded.

The Node child exited 0, uvicorn's serving task was awaited after shutdown, and owned PostgreSQL cleanup
completed. Pytest retains the temporary seed/SQLite under
`G:/Temp/pytest-of-unknown/pytest-60/test_real_native_labels_reach_0`; PG DataRemoved does not mean every
temporary test artifact was deleted. Project research separately preserves the raw process and exchange evidence.

## Source release and remaining joint gate

- Final Native/source checkpoint: `b2-native-source-final-01.json`; generated/maintained checkpoint:
  `b2-generated-tested.json`. The source checkpoint includes the 5 actual Core consumer/integration files and
  `.trellis/spec/backend/hindsight-template-lifecycle.md`. The latter is part of the released review ownership;
  any later Core amendment must be coordinated through root and the checker.
- No Native self-check process remains active. The heavy-check slot returns to root for the scheduled independent
  Native/label review. Released files must not be edited concurrently by this implementer.
- Independent Native/label review, Core runtime/hold/executor completion and independent review, followed by the
  combined current-source B2 reconciliation remain open. Home and paired managed-state equality are B3.

No B2/whole-5B acceptance checkbox is set by this implementation report.
