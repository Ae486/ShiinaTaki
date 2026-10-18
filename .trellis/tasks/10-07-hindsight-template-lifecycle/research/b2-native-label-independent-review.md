# B2 Native and trusted-label independent review

## Scope and status

Status: **PASS for the independently reviewed Native and seven-file trusted-label scope**. Both concrete
findings were fixed and verified on the frozen source. Core's separate independent review and root's
current-source reconciliation remain required for the combined B2 gate. No B3 or whole-5B acceptance is implied.

Final reviewed baseline: `b2-independent-native-source-reviewed-final-01.json`.
Result/log/source/teardown inventory: `b2-independent-native-label-evidence-01.json`.

The reviewed scope is the Native B2 delta from accepted B1, the seven released Core trusted-label and
HTTP fixture files, and `.trellis/spec/backend/hindsight-template-lifecycle.md`. Root explicitly extended
the Native scope to the shared raw JSON parser, the existing provider raw-text decoding seams and their
necessary regressions for N2. The Core lifecycle/runtime/Shared/operator implementation is a separate
review scope. This report cannot accept the combined B2 milestone or start B3.

The entry heads remain Taki `2e244d0fdee49fb2c582a4333a9ef1573fa9112a` and Native
`eb6413a7f58c4f3f0adb88a33a99516f8707fef7`, both on `main`. The original release inventories are
`b2-native-source-final-01.json`, `b2-label-source.json` and `b2-generated-tested.json`; accepted B1 is
`b1-reviewed-source.json`. Existing W9, 5A and B1 work was preserved. No commit, push, reset, rebase,
dependency installation, original data/service/provider use, finish or archive was performed.

## Findings (fixed)

### N1: Failed Bank configuration resolution could issue trusted classification

- File: Native `hindsight-api-slim/hindsight_api/config_resolver.py:143` (status type at line 36;
  Bank loader at line 286) and `hindsight-api-slim/tests/native_results/test_template_label_recovery.py`.
- Issue: the invocation-local resolution marker covered the tenant fetch but not the Bank read.
  `_load_bank_config()` deliberately recovered from SQL/JSON errors and falsey malformed values using
  inherited defaults. If that inherited group happened to equal the materialized Bank group, genuine
  retain and the evidence endpoint still returned a positive proof after a failed configuration resolution.
- Fix: share `_ConfigResolutionStatus` with the Bank loader and revoke success on read/decode/type failures.
  Missing rows, SQL null, empty objects and encoded empty objects remain legal inheritance. The original
  frozen plan retains this same success/fallback distinction; a later healthy resolution cannot upgrade it.
- Evidence: `b2-independent-bank-fallback-red-01` failed all three actual SQL-failure, JSON-failure and
  malformed-falsey cases on positive `TemplateLabelEvidence` values. The first corrected full Native run,
  `b2-independent-native-labels-green-01`, passed 36 tests including legal-empty and frozen-replay coverage.
  That 36-test run predates N2. The final current-source Native run passes all 46 cases, including the N1
  failure/empty/replay branches; its separate evidence is recorded below.

### N2: Decoding or repairing provider JSON could manufacture single-field authority

- File: Native `hindsight-api-slim/hindsight_api/engine/llm_wrapper.py:206`,
  `hindsight-api-slim/hindsight_api/engine/retain/template_label_origin.py:149`, the ordinary/Batch capture
  in `retain/fact_extraction.py` at lines 1551 and 2348, six existing raw-text provider adapters and the parser/extraction fixtures.
- Issue: ordinary `json.loads` discarded repeated `facts`, `labels` and `taki-layer` fields before provenance
  capture. Equal or conflicting duplicates could therefore look like one eligible scalar. Repaired JSON
  and already-decoded provider/SDK dictionaries also lacked evidence of original field uniqueness but
  could still receive positive authority. The default ordinary OpenAI path bypassed the shared repair parser.
- Fix: strict raw-text parsing preserves duplicate-field occurrence information in a private dictionary
  subclass, while ordinary JSON values and last-value semantics stay unchanged. Capture requires unique
  original `facts`, `labels` and exact `taki-layer` fields and the existing successful configuration proof.
  Repair, control-character scrub, reasoning-content rewrite and SDK/tool dictionaries carry no field proof.
  Caller-visible quality markers cannot replace that private state. Positive test fixtures parse controlled
  original text instead of receiving a production exception for test dictionaries.
- Evidence: `b2-independent-raw-json-red-01` failed all nine original repro cases because real retain/read
  paths returned excess or false positive proofs. These exercise actual `LiteLLMLLM.call`, default
  `OpenAICompatibleLLM.call` and the Batch parser with fake provider completions, plus a plain provider dict.
  Useful fact counts and one provider completion were preserved in each repro. A tenth case additionally
  covers OpenAI reasoning cleanup changing a JSON scalar. The corrected parser/provider batch passes 141 cases:
  131 cases in eight parser/provider files and all 10 actual N2 regressions. The 46-case final Native batch
  independently repeats the 10 N2 cases within the complete label/storage/backup/HTTP paths. Parser regressions
  cover escaped duplicate keys, private-state serialization, selecting containers, repair/control scrub and
  strict syntax behavior. Existing provider retry/repair and typed-tool tests also pass.

The fix does not retry duplicate JSON, alter provider retry/repair policy, change fact retention behavior,
modify a public label DTO, add a schema migration, or change the frozen Native payload hash domain.

## Provider boundary

| Path | Original-field evidence |
| --- | --- |
| OpenAI-compatible ordinary and native Ollama; OpenAI Responses | Strict parse of provider text; any reasoning cleanup that rewrites content withholds evidence. |
| LiteLLM and adapters inheriting it | Strict successful raw parse; existing exhausted-retry repair keeps facts without proof. |
| Anthropic text and strict-tool raw-text fallback | Strict parse; already-decoded tool input remains neutral. |
| Codex text | Strict parse; invalid-escape repair and typed tool arguments remain neutral. |
| Claude Code text | Strict parse of returned text; existing retry behavior unchanged. |
| Gemini and ordinary Batch response parser | Existing shared parser now preserves strict original fields; repair/scrub remains neutral. |
| Mock or any provider returning an unproven plain dict | Useful legal facts remain neutral, even with caller-supplied quality-marker keys. |

The boundary is conservative when a provider SDK no longer exposes original field occurrences. No real
provider was contacted to extend that boundary, and typed tool input is not re-encoded to invent evidence.

## Source review coverage

- Followed ordinary and Batch extraction through configuration resolution, frozen G1 plan replay,
  `Fact`/`ExtractedFact`/`ProcessedFact`, filtering and actual returned database IDs to final payload publication.
  Verbatim/chunks and caller entities/tags/metadata cannot supply the private origin.
- Checked exact group/scope/Bank/version/hash publication and readback, the outer append invalidation boundary
  with application capture disabled, and consolidation's locked complete prior payload/head renewal.
  Ordinary same-version append, edits/imports/reverts/deletion cannot regain authority from retained history.
- Checked actual authenticated label route, Bank/action/field permissions and exception refusal, bounded
  requests/responses, read-only repeatable-read, and absence of identity creation/provider work on reads.
- Checked e62 migration history, actual trigger/function detection, backup FK order and physical restore,
  transition auxiliary completeness, and explicit portable operational-table inventory parity.
- Independently read all seven Core label files and the two consumer test files (69 cases total). Verified first-provider-binding
  preload, exact identity/group/registry guards around awaits, no Native I/O inside SQLite writer preparation,
  persistent intent replay, original/curated precedence and neutral pinned/mood/disclosure handling.
- Checked the actual HTTP fixture's Native extraction/consolidation producer, authenticated wire exchange,
  Core replica/application-command/Canonical path and physical SQLite reopen. Final-run artifacts are recorded
  below separately from the implementation's earlier fixture.
- Synchronized the lifecycle spec's N1/N2 contract and the Core owner's actual `memory.templates.derived`
  schema/implementation: explicit one-child read, fresh `observedAt`, non-observed states without cached result,
  historical `rollout_record`, service cancellation and preview guard capture before the first await.
  Core production writes and independent runtime acceptance remain with the Core scope.

## Verification

All test/build/generation/lint/type workloads use root's single explicitly handed-over slot. Native pytest
uses `run_isolated_hindsight.py` from Taki through `run-b2-check.py`; only the real owned HTTP test receives
`--allow-http-fixture`. No direct pytest loads the Native `.env`. Vitest uses at most two workers.
Each `b2-<name>-result.json` retains exact argv, cwd, real exit, duration and its corresponding log.

| Check | Result and evidence |
| --- | --- |
| N1 red | 3 failed; `b2-independent-bank-fallback-red-01-result.json`, log and source manifest. |
| N1 corrected before N2 | 36 passed, 2 deprecation warnings; `b2-independent-native-labels-green-01-result.json`. |
| N2 red | 9 failed; `b2-independent-raw-json-red-01-result.json`, log and source manifest. |
| Current scoped Ruff / format | PASS, exit 0; 33 paths. `b2-independent-native-lint-03-result.json` and `b2-independent-native-format-check-01-result.json`. |
| Current scoped Native types | PASS, exit 0; 24 production modules, Linux-target ty. `b2-independent-native-types-02-result.json`. |
| Current parser/provider and N2 regressions | PASS, exit 0; 141 passed in 168.74s (215.147s including fixture lifecycle). `b2-independent-raw-json-green-01-result.json`. |
| Current Native label/storage/backup/HTTP | PASS, exit 0; 46 passed, 2 uvicorn/websockets deprecation warnings, 319.08s (364.643s including fixture lifecycle). `b2-independent-native-labels-green-02-result.json`. |
| Current Core seven-file lint | PASS, exit 0; `b2-independent-label-lint-01-result.json`. |
| Current Core consumer | PASS, exit 0; 69 tests in two files (56 loader, 13 binding), at most two workers. `b2-independent-label-consumer-01-result.json`. |
| Shared/Core types | Reused PASS: Core owner's `b2-core-shared-typecheck-read-01.json` and `b2-core-typecheck-read-02.json`, both exit 0. Final independent source capture rehashes all 1549 input-03 files with zero changes; Shared inputs are identical between 02 and 03. |
| Generated/client identity | PASS readback: all 912 files match the already tested generation inventory in the final reviewed baseline. |

The first post-fix Ruff run, `b2-independent-native-lint-02`, reported one unsorted import in
`template_label_helpers.py`. The import was ordered and the complete 33-file check passed. Scoped format
normalized 11 edited files; the final format check reports all 33 already formatted. These failures/format
results remain retained and are not hidden behind the passing rerun.

No repeated test runs are added together as one suite total. The 10 N2 cases appear in both the 141-case and
46-case runs. Historical failed runs, including implementation fixture/expectation failures, remain in
`b2-native-implementation.md` and `b2-label-implementation.md`.

## Reused evidence and source identity

The final `b2-independent-native-source-reviewed-final-01.json` SHA-256 is
`96bfcd500d5b29230bb248dbf5ce3996f85a399d3bb131764ed66125127ec284`.
It captures 242 Native source files, the seven unchanged Core label files, eight parser/provider regression
inputs, the lifecycle spec and current Shared/Core type inputs, and verifies all 912 generated/maintained
artifacts against `b2-generated-tested.json`. Fifteen Native paths changed since implementation release for
the two findings; the complete Native B2 delta from accepted B1 is 40 paths. No Core label file changed.

The final Native, label and lifecycle-spec records exactly equal their post-format test input in
`b2-independent-native-source-prevalidation-02.json` (SHA-256
`2c814bef173a7cd07e04a298414a016568430c83a5de05e96c3710a684dd2796`).
The evidence inventory asserts this equality and hashes the real checks/logs, five PostgreSQL teardowns,
HTTP artifacts, failed repro source manifests and reusable generation/B1 inventories. Its SHA-256 is
`e828ee2c98da695841bac964c62da203b1c93ec80be0650a4c32817918cfedf2`.
The earlier pre-format source snapshot is retained separately and is not presented as the tested final tree.

N1/N2 do not change any canonical API/schema input. Canonical OpenAPI remains
`bf3cabf4ab6477e2a27e2504e3c1633632fb8468d175593c6d75a9b6794e4a71`.
The Rust inventory alias `rust-build/hindsight_client_generated.rs` is resolved to the actual unique
Cargo `target/release/build/hindsight-client-*/out/hindsight_client_generated.rs`; it is not omitted.

With the final unchanged-input comparison above, generation/client evidence is reused:
two clean canonical generation runs, 912-file determinism, Python 103 tests, TypeScript 45 tests across
12 suites plus CJS/ESM/DTS build, Rust 12 tests across five targets and Go nine top-level contracts.
The original migration-shape/auxiliary run passed 217 tests with 107 non-applicable shape skips; its unchanged
migration and inventory inputs support reuse, while physical label/backup paths run again in this review.
These are explicitly reused implementation checks, not newly executed independent test counts.

## Fixture teardown and retained artifacts

| Owned PostgreSQL fixture | Run | Teardown |
| --- | --- | --- |
| `taki-hindsight-g1-2e1476d31d4a` | N1 red | Stopped/DataRemoved/RegistryRemoved all true. |
| `taki-hindsight-g1-13244e200dfa` | N1 corrected, before N2 | All three true. |
| `taki-hindsight-g1-e57eeee0752a` | N2 red | All three true. |
| `taki-hindsight-g1-2b82a8c0127a` | Current parser/provider and N2, 141 passed | All three true. |
| `taki-hindsight-g1-8ce59fbd6436` | Current Native full scope, 46 passed | All three true. |

The final HTTP artifact ID is `4d674d27fd5f4b0e8353a553c56e693f`, with
`b2-native-http-4d674d27fd5f4b0e8353a553c56e693f.log` and its `-exchanges.jsonl`.
The exchange SHA-256 is `d4adccac3adcd0ffe183c6281ec98e21d038f2dab3bf74661d09687b50adac0b`.
`b2-independent-http-audit-01.json` independently verifies all 200 unique/complete request ordinals,
every raw request/response body hash, seven exact label requests, two consolidated revision-2 proofs
(`activity`/Global and `episodes`/Character), five neutral responses and eleven real application commits.
All responses succeeded (196 HTTP 200 and four HTTP 201); no Authorization headers are recorded.

The actual Node consumer proves two Banks/seven units, two registry policies/five neutral policies,
Native I/O outside SQLite transactions, and physical SQLite close/reopen without another label read or
application commit. The Node process exited 0; the fixture awaited uvicorn shutdown and PostgreSQL cleanup.
Pytest retains the owned seed/SQLite under
`G:/Temp/pytest-of-unknown/pytest-62/test_real_native_labels_reach_0` for review; PostgreSQL `DataRemoved`
does not imply those files were deleted. Earlier HTTP runs are not substituted for this final evidence.

## Findings (not fixed) and acceptance limits

No concrete defect remains unfixed in this scope after current-source verification.
The existing whole-Native Windows/optional-ML dependency limits are retained. Scoped Linux-target ty is
not a passing Windows/full-package typecheck, and the root lint hook was not used because it installs
dependencies and concurrently auto-fixes unrelated packages.

Core runtime/hold/executor/operator independent review and root's final current-source reconciliation are
required for B2. B3 Home/paired managed-backup equality, 5C deployment and manual/original-data acceptance
remain outside this report. No manual acceptance checkbox is set by these automated checks.

All Native/label check processes have ended. The unique heavy-check slot was explicitly returned to root
after the final 69-case consumer run, so Core can finish its already assigned work. Native source, the seven
Core label files and the lifecycle spec are frozen at the reviewed baseline; this checker releases ownership
and stops after handing over these artifacts.
