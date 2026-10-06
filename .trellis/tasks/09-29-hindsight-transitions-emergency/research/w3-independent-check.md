# W3 independent check

Date: 2026-10-02. Checker: `/root/w3_check`. Parent: `session:codex_01a0ed15-10d0-7802-90a1-48c5d50ec0fc`.

## Result

**PASS for the complete W3 scoped gate after fixing F1.** No unresolved W3 functional finding remains.
Root `pnpm lint` actually exits **1** for the single owner-accepted cohesive 51/50-line exception in
`projectTransitionLocalBank`; this is an explicit gate exception, not a claim that raw root lint passed.
Root typecheck, scoped native lint/format/compile/types, independent Shared/Core tests, actual isolated native
PostgreSQL/HTTP tests, and source-preservation checks pass as recorded below.

This approves the W3 candidate, capture, preparation, evidence, Source and final-mapping seams for W4 consumption.
It does not certify W4 authority/custody/queue COMMIT, enabled runtime switching, W5 real-corpus round trips, W6/W8
outage/restore journeys, operator/manual acceptance, or original-environment authority replacement.

## Identity, context and ownership

- Taki: `H:/TakiAgent`, branch `main`, HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
- Native: `H:/hindsight`, branch `main`, HEAD `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`.
- Both roots, branches, HEADs and worktree lists were checked. No T4 checkout was used. The legacy `.current-task`
  file is empty; the parent's explicit task assignment and in-progress task JSON provide the recovery anchor.
- Requirements and review scope come from this task's PRD/design/implementation, curated `check.jsonl`, W0-W2
  independent reports, `w3-check-brief.md`, `w3-implementation.md`, and the real-data reuse plan/preflight.
  Applied the Trellis check and before-dev skills and repository guidelines. Focused source reads supplemented
  context loading; large historical context output was not treated as proof of exhaustive line-by-line review.
- Only the F1 Core producer, its regression, its module index and transition spec were changed by this checker.
  One native regression and task research fixtures/audit/report were added. No native production source was changed.
  No dependencies were installed; no commit/push/reset/rebase, archive or original database/authority write occurred.
- Core migration053 remains additive after052; actual migration/reopen tests pass. Native migration head remains
  `e30a9d7f6c21`; the preserved W2 baseline and the owned fixture's real migrations independently retain this identity.

## Findings (fixed)

### F1 - New Local scopes discarded non-direct SourceSet evidence

**File:** `packages/core/src/memory/transitions/transition-unused-delta.ts`.

**Issue:** `compileTransitionUnusedDelta` emitted either no Source reference or only `record.unit.documentId` for a
Memory. A real `maintenance.copyToBank` into a new Character Bank materializes several Local Sources from exact
historical alias versions and preserves their ordered repeated references. The old unused-scope branch dropped
three of four references in the demonstrated copy: `[physical, fragment-one, fragment-two, fragment-one]` became
`[physical]`. Native accepted this smaller list, so a later projection could silently lose copied Source evidence.

**Fix:** Consume the captured Memory's full SourceSet. Validate each occurrence against an actual Source upsert in
this same delta: local intent, no historical artifact selector, exact Local epoch/Bank and complete original Source
body. Preserve order and duplicates. Reject foreign/unprovable historical selectors. Keep the existing `memory`
wire variant and resolve its Source keys to the native transaction's actual outputs; no capability expansion is needed.

**Regression evidence:**

- `transition-unused-delta.test.ts` uses real SQLite migrations, ordinary Local copy, actual capture, compile and
  persistent preparation read-back. It checks all four ordered references, foreign historical refusal and FK integrity.
- `w3-independent-unused-red2.log`: genuine red, exit1, expected four references but received one.
- `w3-independent-unused-green.log`: exit0, both tests pass. The later complete Core group also passes.
- New native `tests/native_results/test_transition_unused_sources.py` invokes
  `research/validation/w3-unused-sources.fixture.ts` over authenticated owned loopback HTTP. It uses genuine unused
  proof/acquire/fence/snapshots, Core compilation, native delta/history, finite maintenance, complete evidence loading
  and final projection. The oracle compares each actual native Memory artifact reference to the actual Source output
  versions, including repeated entries; final projected SourceSets preserve the same sequence.
- Actual HTTP run `taki-hindsight-g1-2a556ab761de`: **1 passed in29.48s, exit0**, safely stopped and removed.

The first local red attempt (`w3-independent-unused-red.log`) failed because the research test supplied the wrong
Character identity, before reaching the defect. The first HTTP attempt (`w3-independent-unused-http.log`, fixture
`c66dfb0c73df`) failed because the new research fixture omitted the required snapshot `request_id`; it was corrected
to include its request identity/TTL, then rerun successfully. These harness errors remain recorded and are not
counted as product findings or passing evidence. The new native test was formatted with the installed Ruff; final
scoped formatting is green. Index and executable spec now state the complete new-scope SourceSet contract.

## Findings (not fixed)

None within W3. The accepted root lint exception is recorded under verification. Later-wave work below remains
required and was not relabeled as a defect in the deliberately unenabled W3 preparation layer.

## Independent review coverage

| Contract | Actual source paths and verification |
| --- | --- |
| Complete native/application/maintenance/auxiliary closure | `transition-native-loader.ts`, `transition-native-evidence.ts`, candidate repository and D77 bundle/body readers validate exact identities, page/body closure and immutable raw evidence. Core candidate tests cover malformed/foreign/incomplete evidence; real native consumers execute policy, historical and alias modes through the full loader. Native snapshot/store/rebind/preflight integration was inspected. |
| Neutral current Local capture | `memory-transition-local-capture.ts`, coverage/current-capture readers and JSON restoration discover and hydrate under writer reservation, preserve invalidated records, policies, Blocks, maintenance/history and typed JSON. The initial-activation reader retains its initial-epoch guard. Coverage and migration/reopen tests pass. |
| Stable identity, isolated staging and true baselines | Candidate/document/staging repositories plus Local projection verify lineage, original IDs, body/state/mapping hashes, all scopes and genuine receipt-bound history. Source IDs are distinct from native IDs; unselected staging does not publish authority or global Blocks. Candidate/capture/reopen/transaction tests pass. |
| Actual Local mutation and policy semantics | Canonical repo, maintenance mutations, retention, copy, policy-revision and provenance readers retain real lifecycle/source/policy producers. True policy changes advance policyVersion atomically; text-only/no-op cases keep it. The Core group tests these paths and native policy consumer accepts the real delta. |
| Complete reentry and final mappings | Delta rows/application/sources/unused, persistent preparation/result and execution paths preserve reuse/upsert/retire, exact historical lookup before effects and final post-maintenance mapping. Tests cover unchanged revisions, lost replies, durable upload recovery, actual policy-only changes and timestamp causality including clock skew. |
| Deleted historical references | Core historical identities/references and native `transition_delta_history.py` preserve proven retired supporting identities without inventing live units. Actual successive native cycles pass; malformed, missing, foreign and ambiguous historical cases refuse without changing current objects/history. |
| Distinct physical Sources and aliases | Physical projection resolves the original Source CAS address independently of an append alias bound to the native head. Alias-only body changes retain physical bytes; historical physical bindings do not claim current version equality. Real Local copy/evidence/retention tests cover distinct pinned versions, repeated references, actual physical edit and alias retirement. |
| New native Source variants and ordinary consumers | Shared discriminated schemas, new body dependencies, Core D77 body/projection/replica/binding and native snapshot/store/commit/rebind routes handle the complete nested Source evidence. Old variants and hashes remain intact. Actual alias edit test covers ordered old/new/old versions, retirement of a latest head with retained historical selections, native table-byte backup/restore and unchanged physical objects. |
| Capability, authentication and upload fencing | Core capability/client/upload preparation and execution, native `memory_engine.py`, `transition_source_upload.py`, compatibility detection and API routes validate dependencies and exact authenticated executor/Bank/namespace at each stage. Core tests reject old/missing capabilities before dispatch. Actual native stale prepare/part/seal and reference refusal tests pass. |
| Awaiting Sources | Complete latest awaiting artifacts become hashed/reconstructed `pendingSources` with original bytes/operation/document/proof identities, never invented canonical documents or successful native mappings. Core pending tests and actual native final-proof awaiting test pass; W4 must classify original custody before publication. |
| New-scope SourceSet closure | F1 now carries every real copied Local Source reference to same-delta output versions; independent SQLite and real HTTP regression both pass. |

## Verification

Commands ran with installed dependencies. Vitest concurrency was limited to two workers. Native tests used the
previously reviewed owned runner with an isolated PostgreSQL instance, explicit loopback HTTP permission, blocked
external credentials/network/model calls and deterministic fixture models. Original saved real data was not started.

| Check | Actual outcome | Log |
| --- | --- | --- |
| Independent Core transition/migration/coverage/policy/source group | **16 files,82 tests passed**,28.71s, exit0 | `w3-independent-core.log` |
| Independent Shared schemas/encoding/capability group | **4 files,39 tests passed**,1.36s, exit0 | `w3-independent-shared.log` |
| Native historical/alias/refusal/awaiting/HTTP group | **13 passed**,262.64s, exit0; two dependency deprecation warnings | `w3-independent-native.log` |
| New-scope actual HTTP regression | **1 passed**,29.48s, exit0; two dependency deprecation warnings | `w3-independent-unused-http2.log` |
| Root `pnpm typecheck` | **exit0**, all five workspace projects Done | `w3-independent-typecheck.log` |
| Root `pnpm lint` | **exit1**, only `transition-local-projection.ts:52`, `projectTransitionLocalBank`51/50 lines; accepted owner exception | `w3-independent-lint.log` |
| Native Ruff check | **exit0**,24 explicitly owned Python files including the new test | `w3-independent-native-lint.log` |
| Native Ruff format --check | **exit0**,24 files already formatted | `w3-independent-native-format.log` |
| Native compileall | **exit0**, same24 files | `w3-independent-native-compile.log` |
| Native configured ty | **exit0**,18 owned production files from `hindsight-api-slim` | `w3-independent-native-typecheck.log` |
| Trellis context validation | **exit0**,31 implement and34 check entries | `w3-independent-context.log` |
| Independent hashes/encoding/index/diff/generated preservation | **exit0** | `w3-independent-audit.log`, `w3-checker-source-hashes.json` |

Exact test invocations, from `H:/TakiAgent`:

```powershell
pnpm --filter @taki/core exec vitest run src/memory/transitions src/db/canonical-memory-policy-revision.test.ts src/db/migrations/053-memory-transition-candidates.test.ts src/db/migrations/lineage-reopen-matrix.test.ts src/db/migrations/index-list.test.ts src/memory/hindsight/hindsight-source-evidence-replica.test.ts src/memory/hindsight/hindsight-transition-source-client.test.ts src/db/hindsight-local-coverage-repo.test.ts --maxWorkers=2 --reporter=dot
pnpm --filter @taki/shared exec vitest run src/memory-transition-candidate-schema.test.ts src/hindsight-transition-schema.test.ts src/hindsight-application-encoding.test.ts src/hindsight-connection-schema.test.ts --maxWorkers=2 --reporter=dot
& H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py --allow-http-fixture -- tests/native_results/test_transition_historical_references.py tests/native_results/test_transition_source_evidence.py tests/native_results/test_transition_source_refusals.py tests/native_results/test_transition_w3_consumer.py -q --tb=short -n 0
& H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py --allow-http-fixture -- tests/native_results/test_transition_unused_sources.py -q --tb=short -n 0
pnpm typecheck
pnpm lint
python .trellis/scripts/task.py validate .trellis/tasks/09-29-hindsight-transitions-emergency
& H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-29-hindsight-transitions-emergency/research/w3-checker-audit.py
```

Native quality from `H:/hindsight` used `.venv/Scripts/python.exe -m ruff check`, `-m ruff format --check` and
`-m compileall -q` with the23 API/test Python paths in `w3-native-owned-paths.json` plus the new regression path.
Native types from `H:/hindsight/hindsight-api-slim` used `../.venv/Scripts/python.exe -m ty check --python ../.venv`
with the18 `hindsight_api/` production paths from that same manifest. This is configured scoped type acceptance;
the historical full-tree Windows/MLX/Unix diagnostics were not relabeled as globally green. No monolithic native
hook that installs dependencies or rewrites unrelated/generated files was run.

Successful native group fixture `taki-hindsight-g1-80a3c6aa1ca8` and new regression fixture
`taki-hindsight-g1-2a556ab761de` both report `Stopped=true`, `DataRemoved=true`, `RegistryRemoved=true`; their private
pytest logs remain under `.trellis/.runtime/g1-validation/`. Counts from overlapping earlier runs are not additive.
The real HTTP fixtures use deterministic owned models; they do not claim real-corpus model or manual acceptance.

## Source preservation

`w3-checker-audit.py` leaves the delivered `w3-source-ownership.json` unchanged. Its SHA-256 is
`998edcd67c06757f9f400ce4d17a02dcc63f7456f3607e2f992be3f674ee5851`.
The independent `w3-checker-source-hashes.json` records current hashes for all97 delivered Taki source/spec paths and
all59 delivered native paths plus the checker regression (60 total). Relative to delivery, exactly these differ:

1. `packages/core/src/memory/transitions/transition-unused-delta.ts` - F1 producer repair.
2. `packages/core/src/memory/transitions/transition-unused-delta.test.ts` - real Local copy regression/refusal.
3. `packages/core/src/memory/transitions/index.md` - producer contract.
4. `.trellis/spec/backend/memory-transitions.md` - executable new-scope SourceSet contract.
5. Native `hindsight-api-slim/tests/native_results/test_transition_unused_sources.py` - new actual HTTP regression.

The reconstructed preimplementation/final-W2 baseline retains **289 unchanged native paths**, with no missing or
unexpected changes. All **372 generated Python files** remain byte-identical to canonical run `97f9a4800627`, with
no extras. No new generation was run. Both repositories' unstaged and cached `git diff --check` commands exit0;
Git prints existing line-ending notices, not whitespace failures. Owned source encoding is UTF-8 without BOM;
headers/indexes and trailing-whitespace checks pass. Existing non-W3 dirty-tree work remains preserved.

## Real-data evidence and limits

The parent-owned saved results were read and their acceptance boundary checked; this checker did not repeat
conversion or run another full corpus probe.

- `stage4-conversion-source/w3-d3b7dd5a-1c56-4437-b93b-f7dbc59bae75/result.json` records migration53,2 Banks,
  722 Sources/records,21 invalidated records,2 Blocks,722 SourceSets/refs and1446 original mappings in the mapped copy.
  Complete state round-trip and original file/row equality are true. Content hash:
  `a4fd1f3bd762f0f734a836c7bebd73349aa394193102208ff501ac6e47206c3a`.
- The parent D77 readback (`projection-de759cdd-48de-4b41-b35e-9abdef77b609`, documented in preflight) has2 Banks,
  722 documents,1216 units,722 original policies plus494 explicit neutral/due policies,673 memory references and5728
  typed comparisons. Digest: `5a53cc016547e9def802d567bdc1d1546f4a31d6822ea3f72ddd7ed14b82af41`.
- The43,259 native graph links are separately preserved by native table hashes. They are not all projected Local
  Source or lineage rows. This distinction is required when interpreting complete raw closure versus consumable rows.
- These are current Local/original and D77 structural evidence. They do not manufacture a W2 final proof, waive
  required final maintenance, establish the real W5 candidate join or certify a completed authority round trip.

## W4 consumer obligations

1. Use `captureTransitionLocal` under the actual W1 lease/configuration/fence and persist complete evidence with
   `persistTransitionNativeEvidence`; all admitted Banks, including empty scopes, must be present.
2. For reentry, use `prepareTransitionDelta` with the exact healthy common-baseline receipt or genuine unused proof,
   then `executeTransitionDelta` with historical result lookup and original upload/request identities. An executor
   takeover records its separate immutable upload attempt, not new original bytes or a repeated native effect.
3. Build with `buildTransitionLocalCandidate` or `buildTransitionHindsightCandidate` only after genuine final proof.
   Final mappings must use actual maintenance-advanced heads/history, including explicit awaiting Source evidence.
4. Call `readVerifiedTransitionCandidate` again inside the complete Core COMMIT. Create the exact unselected epoch,
   invoke `installTransitionLocalCandidate` in that transaction, and join matching authority/epoch/receipt/baseline/
   checkpoint identities, configuration, source state and lease. The installer alone publishes none of those markers.
5. Classify every `pendingSources` item against its exact original Pending/parent/custody evidence before healthy
   publication. Retain known terminal/no-dispatch history; unknown effects stay owned with no generic replay.
   A raw candidate pending list is not a readiness result. Queue outcomes/custody must join the same COMMIT.
6. Boot/runtime binding and lost-reply recovery must reconstruct that committed candidate/receipt; they must not
   install a different candidate, replay stale closures or enable a partially composed transition driver.

W4-W8 and owner/manual criteria remain open. W3 PASS is permission to consume verified preparation seams within
the already approved plan, not evidence that the complete product journey has shipped.
