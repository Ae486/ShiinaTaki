# B2 trusted label consumer implementation

## Status and ownership

Implementation, focused verification and the real Native HTTP integration are complete. The seven owned
source files are released to root for independent review with `b2-label-source.json` as their frozen
identity. This report is implementation evidence, not the independent B2 acceptance gate. Existing W9,
Stage 5A and reviewed B1 changes remain intact.

Owned source files:

- `packages/core/src/memory/hindsight/hindsight-template-label-evidence.ts`
- `packages/core/src/memory/hindsight/hindsight-template-label-evidence.test.ts`
- `packages/core/src/memory/hindsight/hindsight-template-binding.test.ts`
- `packages/core/src/memory/hindsight/hindsight-application-binding-runner.ts`
- `packages/core/src/memory/hindsight/hindsight-application-binding-context.ts`
- `packages/core/src/testing/hindsight-template-exchange-fixture.ts`
- `packages/core/src/testing/hindsight-template-native-consumer.fixture.ts`

The Core lifecycle owner supplies the selected-group getter, runtime admission, strict template JSON
transport and folder indexes. The Native owner supplies extraction/proof producers, the authenticated
HTTP pytest fixture and lifecycle-spec amendments. `hindsight-application-policy.ts` is unchanged.

## Consumer and binding behavior

The loader accepts an existing verified policy context and asks the authenticated template client for
one exact unit UUID, revision and payload hash. Both response targets, lineage, generation, complete
canonical Bank identity, scope, producer and selected group hash must match. Exactly one result row and
one matching canonical reserved tag are required. Missing, duplicate, unsolicited or mismatched evidence
cannot confer a registry policy.

The selected complete group is validated without filling omitted fields or reordering its arrays.
Native-compatible legacy type inference is preserved; a valid `taki-layer` value group with `tag: true`
does not have to declare `optional` or an `unclassified` enum. Registry ownership is checked for the
actual selected value. The unchanged policy resolver enforces original/curated precedence, pinned
restrictions and mood disclosure. The new evidence never supplies disclosure.

Only first provider-derived memory policy binding loads evidence. Original records, already-bound
artifacts and later rebinding use their existing paths. A persistent binding command reuses its first
command/body without a new evidence request. Evidence awaits finish before the synchronous body factory,
writer preparation and SQLite transaction. Request lifetime and current selection are checked around
the await and again before preparation/publication.

Absent/unsupported or label-only malformed evidence keeps the existing neutral policy. Authentication,
cancellation, timeout and explicit identity failures retain their existing refusal paths. The Core owner
added strict raw JSON decoding to template methods after the consumer audit identified duplicate-key
collapse in the generic client. Three focused tests exercise duplicate outer, nested target and value keys.

## Real integration fixture boundary

The Node entry accepts only the fixture environment marker, a loopback HTTP origin, a seed file and a
fresh same-directory `owned.sqlite`. The Native seed contains real materialized groups and actual extracted,
consolidated unit revisions/hashes. It supplies fixture authority/selection, not application bodies or
label/command responses.

The fixture uses `createHindsightClient`, `hindsightHttpTransport`, actual replica/sync/binding/writer/command
owners and real SQLite. Its transport permits only the sync, evidence and application-command routes,
checks that every HTTP call occurs outside SQLite transactions and records request/response bodies and
SHA-256 values in `http-exchanges.jsonl` without Authorization headers. Assertions inspect Canonical policy,
assessment, provenance, exact Native revision/hash and the synchronized materialized group. A physical close
and reopen then prove unchanged command rows and no repeated label read or application commit.

Native's `test_template_label_runtime_consumer.py` passed the actual cross-process invocation. It proves
positive and neutral policies, including real caller-only and ambiguous/conflicting inputs after actual
consolidation. No Core model is constructed, and the output does not invent a Core model-call counter.
Full operation/default/hold/runtime workflow coverage belongs to the Core lifecycle owner's tests.

Actual result:

| Observation | Result |
| --- | --- |
| Canonical Banks and units | 2 Banks, 7 units |
| Policies | 2 registry (`activity`, `episodes`), 5 neutral |
| Positive evidence after consolidation | 2 exact consolidated unit proofs |
| Recorded HTTP requests | 200, including 7 label reads and 11 application commits |
| Physical SQLite reopen | Verified; command rows unchanged, no new label read or application commit |
| Remote I/O | Verified outside SQLite transactions |
| Node child exit | 0 |

The raw Node stdout is `b2-native-http-dd7e6dfe82504d7e9c521dd64ac8dd0b.log`; the corresponding
`b2-native-http-dd7e6dfe82504d7e9c521dd64ac8dd0b-exchanges.jsonl` SHA-256 is
`a09db13ea041d04722bd3d392a8ddda8c49f0916cd598e9b701c2c28f667f345`.
The consumer owner independently read the retained stdout and verified every request/response body hash,
all 200 unique request ordinals, seven exact evidence requests, the two exact proof rows and five empty
evidence responses. This is a read-only evidence audit, not an additional runtime test count.

The audit's first attempt incorrectly required request ordinals to follow log line order. Parallel HTTP
responses are appended in completion order, so that audit assumption failed while the fixture was correct.
`b2-label-validation/http-exchange-audit-01.json` preserves that diagnostic; `http-exchange-audit-02.json`
records the corrected complete/unique ordinal and body-hash audit. No source file changed for this diagnostic.

The HTTP test passed within `b2-native-labels-boundaries-02`, whose complete pytest command exited 1 with
13 passed and 2 failed. The failures are the successful tracked-retain recovery expectation and a pre-B2
independent-backup downgrade expectation; they remain the Native owner's follow-up. This report does not
claim that the complete Native batch passed. Its exact argv is retained in `b2-native-labels-boundaries-02-result.json`:

```text
H:/hindsight/.venv/Scripts/python.exe
.trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py
--allow-http-fixture --
tests/native_results/test_template_label_recovery.py
tests/native_results/test_template_label_storage.py
tests/native_results/test_template_independent_backup.py
tests/native_results/test_template_label_lifecycle.py::test_real_delta_replacement_invalidates_old_units_and_binds_new_extraction
tests/native_results/test_template_label_lifecycle.py::test_label_route_auth_actions_fields_hooks_and_bounds_fail_closed
tests/native_results/test_template_label_runtime_consumer.py
-q --tb=short
```

The Node process exited after closing SQLite; uvicorn's serving task was awaited after shutdown. The owned
PostgreSQL fixture reported stopped/data removed/registry removed. Pytest intentionally retains the seed and
SQLite at `G:/Temp/pytest-of-unknown/pytest-60/test_real_native_labels_reach_0` for review; PostgreSQL cleanup
does not mean those retained fixture artifacts were deleted. Project research separately retains stdout and
all exchange bytes. No actual provider, original service, real credential or original data was used.

## Validation record

All heavy checks use the explicitly assigned single shared slot; Vitest has at most two workers.
Artifacts below are relative to this task's `research/` directory. Earlier failures remain preserved.

| Artifact | Command and actual result |
| --- | --- |
| `b2-label-validation/consumer-01.log` and `.json` | `pnpm --filter @taki/core exec vitest run src/memory/hindsight/hindsight-template-label-evidence.test.ts src/memory/hindsight/hindsight-template-binding.test.ts --maxWorkers 2`; exit 1, 65 passed / 1 failed, 66 total. |
| `b2-label-validation/binding-02.log` and `.json` | `pnpm --filter @taki/core exec vitest run src/memory/hindsight/hindsight-template-binding.test.ts --maxWorkers 2`; exit 0, 13 passed. |
| `b2-label-validation/lint-01.json` | `pnpm exec eslint` with the seven owned paths listed below; exit 0 before the final test additions/type fixes. No separate output log was retained for this run. |
| `b2-core-typecheck-wiring.log` | Core owner's shared `pnpm --filter @taki/core typecheck`; exit 2 on test-only circular inference and widened response literals. The later current typecheck verifies the fixes. |
| `b2-label-validation/consumer-03.log` and `.json` | The same two-file Vitest command as `consumer-01`; exit 0, 69 passed / 0 failed across two files, including the three new raw-JSON checks. |
| `b2-label-validation/lint-02.log` and `.json` | The same full seven-file ESLint argv below; exit 0 after all current test additions/type fixes. Empty stdout is retained as an empty log, and metadata records every argv element. |
| `b2-core-shared-typecheck-current.log`, `b2-core-typecheck-current.log` | Core owner's latest `pnpm --filter @taki/shared typecheck` and `pnpm --filter @taki/core typecheck`; both reported exit 0. Logs were read back; no duplicate package typecheck was run by this owner. |

The initial binding failure came from a test original record whose reserved tag claimed `profile` while its
curated policy claimed `activity`. The fixture now consistently declares `activity`; production policy guards
were not weakened. The first loader run passed 53 tests. The later binding rerun passed 13 tests; these are
66 unique tests, not a cumulative 78. The final run passes 69 unique tests after adding three strict-JSON cases
(56 loader and 13 binding tests); repeated runs are not added to the count.

The test type fixes replace the recursive cleanup-list type with `Array<{ close(): Promise<void> }>` and
construct both typed responses with `HindsightTemplateLabelEvidenceResultSchema.parse`, preserving literal
contract types without coercion; the current unified Core typecheck passes these changes. A Node syntax check on the entry and a whitespace diff check on both existing
binding files also exited 0 before this report.

The exact `lint-01` argv, supplementing its preserved placeholder metadata, was:

```text
pnpm exec eslint
packages/core/src/memory/hindsight/hindsight-template-label-evidence.ts
packages/core/src/memory/hindsight/hindsight-template-label-evidence.test.ts
packages/core/src/memory/hindsight/hindsight-template-binding.test.ts
packages/core/src/memory/hindsight/hindsight-application-binding-runner.ts
packages/core/src/memory/hindsight/hindsight-application-binding-context.ts
packages/core/src/testing/hindsight-template-exchange-fixture.ts
packages/core/src/testing/hindsight-template-native-consumer.fixture.ts
```

## Remaining work and limits

- `b2-label-source.json` records the actual SHA-256 and byte length of every owned source file on Taki HEAD
  `2e244d0fdee49fb2c582a4333a9ef1573fa9112a`. Final UTF-8/no-BOM and trailing-whitespace checks pass for all seven
  files; tracked `git diff --check` passes and the existing policy file is unchanged from HEAD. No consumer source
  changed after the passing focused tests, lint, typecheck or real HTTP fixture.
- Root receives the seven-file source identity for independent label review. Shared folder indexes remain the
  Core lifecycle owner's responsibility; all three new non-test files were sent to that owner for indexing.
- The Native owner finishes its remaining recovery/backup expectations and canonical generation; the real HTTP
  consumer case already passed on the unchanged seven-file consumer source.
- Independent B2 review remains required. B3 Home/managed backup equality, original data, installed/manual
  acceptance, real providers and Stage 5C+ remain outside this report. No commit, push, finish or archive is performed.
