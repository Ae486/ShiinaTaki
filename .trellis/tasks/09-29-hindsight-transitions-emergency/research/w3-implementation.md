# W3 implementation delivery

Date: 2026-10-02. Active task: `H:/TakiAgent/.trellis/tasks/09-29-hindsight-transitions-emergency`.
Original implementer: `/root/w3_implement`. W3 implementation is ready for the parent's independent check;
this report does not mark independent, product, owner/manual or real-roundtrip acceptance.

## Scope and source identity

- Taki: `H:/TakiAgent`, branch `main`, HEAD `fccfc4fb78958c90efebdb4a5a98b355bcb73a40`.
- Native: `H:/hindsight`, branch `main`, HEAD `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`.
- Additive Core migration053 follows052. Native migration head remains `e30a9d7f6c21`.
- Complete Local/native evidence, isolated candidates, historical mappings/common baselines, exact prepared deltas,
  Source uploads and final post-maintenance mapping validation are implemented. W4 owns authority/custody/queue
  COMMIT and runtime publication; W5 owns orchestration; W6 owns emergency use. No partial driver was enabled.
- No commit/push/reset/rebase, dependency installation, finish/archive, original-data modification or authority
  replacement occurred. No real-corpus extraction/conversion or model invocation was performed by W3.

## Implemented behavior

### Capture, closure and isolated reconstruction

`captureTransitionLocal` reserves the real SQLite writer, independently discovers every current Bank/source/unit/
policy/lineage/derived object/Block and joins real revision snapshots, maintenance receipts and Source retirement.
It rechecks current source/configuration/lease before admitting immutable bytes. The extracted neutral coverage reader
does not relax old initial-local/B2/B4 guards; a caller's omitted row cannot certify deletion.

The native loader consumes every page named by the final W2 proof and validates exact request, namespace, Bank,
executor/fence, page/count/hash and native/application/maintenance/auxiliary closure. Stored evidence includes original
byte bodies, all artifact versions, tombstones, unbound/derived objects and auxiliary histories. The internal Local
JSON codec preserves legal typed/null/empty/deep JSON, including inert special keys and surrogate data; frozen native
wire hashes still use their original codec. Missing, duplicate or foreign evidence refuses before publication.

Candidate construction covers the complete admitted Bank set, including empty Banks. Durable scope/epoch reservations
reuse existing Local logical IDs through verified ancestry/mappings and assign one stable ID only to genuinely new
objects/scopes. Native IDs remain separate. Staging writes actual unselected canonical rows, per-unit provenance,
policy, FTS, derived payloads, source sets, aliases and revision snapshots; it never temporarily selects an epoch or
manufactures a first-activation receipt. Unbound native units receive the real initial neutral due-policy producer,
including invalidated objects, without inventing a completed assessment.

### Baselines, semantic changes and exact recovery

Prepared common baselines gain historical authority only through the exact genuine healthy return-local receipt.
Existing scopes require their exact retired native baseline. A new Local scope must be absent from that baseline and
join the actual native unused-scope proof. Missing/foreign/emergency/pruned state refuses; there is no reset or full-copy
fallback. Epoch/Bank relocation is not an edit. Current complete native/application descriptors explicitly reuse,
upsert or retire; actual unchanged native IDs/revisions/bodies and application versions stay unchanged.

Deletion joins real Local retention/retirement history to the old mapping. Edited-then-retired Sources retain their
available baseline bytes and actual last revision, without invented transient bodies. Historical source-memory edges
use retained original referrer/native tombstone/journal evidence and dedicated Local historical identity storage;
they never become fake live units. The ordinary Local incoming-support hard-delete refusal remains intact.

Preparation stores the original signed delta and exact Source body bytes/BodyRefs/request identity before effects.
Execution reads original native result history first, then uploads only under current Core configuration/source/lease
and exact native executor guards. Every upload stage is checked; lost seal/delta replies and SQLite reopen reuse the
original IDs/bytes. New executor attempts are separate immutable documents. Results are persisted exactly once.
Final mapping validation joins actual post-maintenance native and application revisions, including new derived objects,
and cannot treat immediate post-delta revisions as the final snapshot.

Real semantic Local policy edits/reclassification/reinforcement now advance `policyVersion` once in the existing
receipt transaction; no-op/text-only/unchanged-importance operations retain it. Local edit timestamps survive native
reuse only with exact common-baseline/final-field evidence. Consolidation bookkeeping alone does not erase them;
real later native changes use their actual values even with an earlier wall clock. There is no blanket clock maximum.

### Physical Sources, append aliases and references

One physical native document has one native descriptor. Independent append-fragment artifacts become genuine Local
aliases with exact original bytes/provenance. `head.bound_artifact` may be an append alias, so it cannot by itself
identify the physical Source's CAS address. The projection resolves that address from complete history and proved
original Local identity. At an exact current binding it retains the physical original bytes/provenance. At an older
physical binding it retains the true CAS address/stable Local ID while taking current content from the native head;
it does not claim the historical binding equals the newer document. Ambiguous/foreign original identities refuse.

An actual physical Source edit after alias head takeover now updates the original physical artifact and stable Local
ID. Alias-only edits use the separate sealed-byte `source_evidence` variant and do not rewrite physical document text/
metadata. The new stored `application-source-evidence.v1` retains previous artifact/body evidence and actual native
association, while edited Local bytes clear claims of an original native operation/encoding/witness that no longer hold.

`memory_evidence` selects exact historical non-tombstoned Source versions or actual Source outputs from this same
delta. Ordered references retain duplicate entries and two versions of one key. A selected old non-tombstoned version
remains valid after the latest head retires. Missing/foreign/wrong-hash/undeclared/tombstoned selections refuse.
The ordinary nested body/snapshot/event/hydration/replica/binding/reflect path and physical backup consume the new
closure. Known auto-gate associations are translated through verified identity into explicit source sets; opaque
metadata is preserved. Real Local evidence/retention/copy readers use these stores. Copy creates distinct new Local
Sources for distinct pinned versions, retains duplicate ordering and per-unit provenance, and never clones native IDs.

The source capability is independent: `contracts.transition_source_evidence.version=1.0.0`. Old/missing/unsupported/
foreign capabilities or missing client methods refuse before upload/POST. Authenticated transition-owned body routes
validate exact namespace/Bank/executor/phase before prepare, each part and seal; ordinary D77 upload fences are intact.
Old source/memory variants, hashes, first-import guards, snapshots and receipt history keep their meaning.

### Awaiting Source custody boundary

Actual native final proof can retain a Source saved before its native operation was dispatched. `candidate.pendingSources`
therefore derives the current latest `awaiting_native` artifacts from complete verified evidence, carrying namespace,
artifact/version/hash, BodyRef/bytes/hash, original operation/document and proof/evidence identity. Earlier awaiting
versions subsequently bound remain raw history. Pending items create no confirmed Source/document/native mapping.
Candidate hash/read-back/reopen covers the complete list; re-entry explicitly reuses the raw artifacts.

W4 must join every item to original Pending/parent/custody evidence and a factual disposition. W5 healthy publication
requires a disposition for each item; raw custody bytes alone are insufficient. Known terminal refusal/non-dispatch
retains history, unresolved outcomes remain owned without generic replay, and W6 may preserve unknowns honestly.

## Consumer APIs and W4 integration

All database APIs receive the real Core `Database`; mutation/preparation calls use
`TransitionCaptureInput = { lease: TransitionLease; now: string; assertConfiguration(): void }`.

| API / file | Contract |
| --- | --- |
| `captureTransitionLocal` / `db/memory-transition-local-capture.ts` | Complete reserved capture; returns immutable capture ID/state hash and actual current inventory. |
| `loadTransitionNativeEvidence` / `memory/transitions/transition-native-loader.ts` | Authenticated complete W2 proof/pages/bytes loader. |
| `persistTransitionNativeEvidence` / `db/memory-transition-candidate-repo.ts` | Stores exact complete evidence after lease/configuration checks. |
| `buildTransitionLocalCandidate(db, {...input, evidenceIds})` | Builds all-Bank isolated return-local candidate with stable target epoch/scopes/mappings. |
| `prepareTransitionDelta` / `db/memory-transition-delta-repo.ts` | Requires real capture/common-baseline receipt, exact target owner and optional unused inventory; persists request and Source uploads. |
| `executeTransitionDelta` / `memory/transitions/transition-delta-execution.ts` | Historical lookup before effects; resumes original uploads/request and persists exact native result. |
| `buildTransitionHindsightCandidate(db, {...input, preparationIds, evidenceIds})` | Joins every preparation/result to actual final maintenance proof and complete final mapping. |
| `readVerifiedTransitionCandidate(db, candidateId)` | Reconstructs and compares state, Blocks/history, source aliases/sets, mappings and pendingSources from original evidence. |
| `saveTransitionCommonBaseline` / `requireTransitionCommonBaseline` | Immutable candidate baseline; future use requires exact healthy receipt/epoch/mapping/state join. |
| `installTransitionLocalCandidate(db, candidateId)` | W4 calls inside its outer transaction, after creating the exact unselected planned-switch epoch and before publishing markers/receipt. |

The W4 join must revalidate candidate/source/configuration/lease and all admitted Banks, install rows/Blocks where
appropriate, publish matching epoch/authority/receipt/baseline/checkpoint identities, classify every pending Source,
and resolve custody/queue ownership atomically. The installer neither creates that epoch nor changes markers, Blocks,
receipts, custody, queue outcomes or runtime handles. Boot validation must use the same verified candidate identity.
Fixture-only epoch/receipt creation used to exercise these primitives is not production activation evidence.

## Changed files and preservation

`w3-source-ownership.json` records final SHA-256 and pre-W3 hashes for **97 Taki source/spec paths and 59 native paths**.
Its baseline combines the retained preimplementation inventory, final W2 owned files and final checker corrections;
it does not compare the whole dirty tree only against Git HEAD and misattribute older work to W3.

- Shared: complete candidate/preparation/source schemas, independent capability, Source body/selector variants and exports.
- Core: `memory/transitions/` production/tests; immutable candidate/capture/delta/upload/staging repositories; real Local
  provenance/history/source/copy/retention/policy consumers; complete ordinary D77 body/bundle/replica integration.
- DB: additive053 and registry/reopen/migration tests. Only historical test fixtures were updated to include053;
  no historical migration implementation was renumbered or rewritten.
- Native: 18 production Python files plus five native helper/test files, canonical generated clients/OpenAPI and
  `TAKI_PATCHES.md` entry `TAKI-HS-016`. Full per-path details are in the JSON inventory.
- Specs: canonical Local runtime, application runtime and complete W3 executable transition contract; touched module
  indexes/header contracts are present. Research helpers, this report and the HTTP fixture are task-owned evidence.

Final audit: **289 preexisting/final-W2 native paths retain their exact expected hashes; no missing or unexpected native
paths**. Both repositories' unstaged/cached `git diff --check` exit0. W3 text files have valid UTF-8 without BOM or
trailing whitespace, and Taki production headers/folder indexes pass. No unrelated file was restored with Git.

## Verification evidence

Counts below identify separate executions and overlap. They must not be added into one unique-test total.

| Check | Actual result / evidence |
| --- | --- |
| Latest affected Core | `pnpm --filter @taki/core exec vitest run src/db/hindsight-local-coverage-repo.test.ts src/db/migrations/lineage-reopen-matrix.test.ts src/memory/transitions/transition-source-aliases.test.ts src/memory/transitions/transition-local-candidate.test.ts --maxWorkers=2 --reporter=dot`: **4 files / 48 passed**, 23.77s, exit0; `w3-final-core.log`. |
| Root types | `pnpm typecheck`: all five workspace projects Done, exit0; `w3-final-typecheck.log`. |
| Root lint | `pnpm lint`: **exit1**, solely `transition-local-projection.ts:52` `projectTransitionLocalBank` 51 versus50 lines. Owner explicitly permits small cohesive formatting/wrapping overages; no code compression or forced split. No other lint finding; `w3-final-lint.log`. |
| Native source quality | Explicit 23 `hindsight-api-slim/` W3 Python paths: `python -m ruff check`, `ruff format --check`, `compileall -q`: all exit0; `w3-final-native-ruff-scoped.log`. |
| Native configured types | From `H:/hindsight/hindsight-api-slim`, `../.venv/Scripts/python.exe -m ty check --python ../.venv` plus the18 owned production paths: exit0; `w3-final-native-types-project.log`. |
| Latest actual PG / HTTP | Fixture **620fe484870c**, three tests passed in88.80s, harness exit0, stopped/data removed/registry removed; `w3-final-native-tests.log` and private fixture `pytest.log`. |
| Canonical generation | Run **97f9a4800627**: OpenAPI, Python, TypeScript, Go, Rust and docs commands exit0, including Go/Rust builds. Separate TypeScript SDK CJS/ESM/DTS build passed. Existing run retained; no needless repeat generation. |
| Source ownership / hygiene | `python research/w3-final-audit.py`: exit0; exact source/hash inventory, all four diff checks, UTF-8/header/index/whitespace checks and372 generated Python source comparisons passed. |

Latest native invocation used the existing installed interpreter and owned loopback-only harness:

```powershell
& H:/hindsight/.venv/Scripts/python.exe .trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py --allow-http-fixture -- tests/native_results/test_transition_historical_references.py::test_inherited_tombstone_survives_two_actual_delta_cycles tests/native_results/test_transition_source_evidence.py 'tests/native_results/test_transition_w3_consumer.py::test_w3_complete_evidence_and_real_policy_delta[alias]' -q --tb=short -n 0
```

These three tests verify real successive historical-reference cycles; actual alias-only Source upload/edit with unchanged
physical native rows; exact old/new/duplicate references; later alias retirement preserving a live physical document;
full native table-byte backup/restore; and actual Core HTTP prepare/upload/delta/final maintenance/complete projection.
The HTTP reference oracle is independently obtained from native memory-artifact bindings and selected Source versions,
not from the projected SourceSet that is under test. Latest helper changes return named dataclasses, not multi-value tuples.

The final Core group includes all nine physical/alias regressions: actual physical edit targets the original artifact
after alias takeover, genuine older physical artifact/current native-v2 distinction, conflicting/foreign original-ID
refusal, retained physical provenance/ID, exact ordered repeated historical references, live alias-only upload, historical
selection after latest retirement, copied distinct versions/provenance, and real Local rolling retention retiring only
the unused alias while a surviving unit keeps the physical document.

Previously completed W3 groups retained in `w3-checkpoint.md`/leader evidence: Core transitions/copy/policy/migration
12files53PASS before the last physical-address repair; Source upload interruption/reopen/same-ID/config refusal3PASS;
Source capability missing/version/unsupported/foreign no-POST4PASS; ordinary paired replica/nested-body/original read/
association-only rebind1PASS; Shared4files39PASS. The latest affected physical/candidate checks above supersede their
overlapping paths. The earlier legacy group122PASS/2FAIL led to two fixture fixes: semantic reclassification now rightly
expects policyVersion2; explicit historical lineage migration list now imports/includes053. Both pass in the final group.

Earlier native runs remain separately recorded: `a660f747d59d` alias HTTP1PASS31.22s after the physical-address repair;
`e67de9d16c88`4PASS/1multipart-fixtureFAIL119.86s (full restore, aliases/history, selector refusal, actual awaiting final
proof); corrected first-part stale-upload fixture `f9316fbe5912`1PASS23.38s. They were stopped and cleaned. Earlier
`3831becdf41a`2PASS/aliasFAIL and `8ca9f6041b7c`aliasFAIL exposed missing real Local ancestry and an incorrect expected
referrer assumption; the production ancestry and independent native oracle corrected these. `79844a499b12`1PASS31.24s
preceded strengthening the oracle. Interrupted `65fda97de069` lost its execution session after daemon restart and has
no complete outcome: **not a PASS**. Its stopped owned path was checked and cleaned. All failed/interrupted logs remain.

Two final check invocation mistakes are retained transparently. An overly broad Ruff selection included17 generated
Python paths (1998 automatic fixes; two generated F841 findings remained). All17 were restored from the saved canonical
`97f9a4800627/python/hindsight_client_api` output; all372 generated `.py` files then matched that stage byte-for-byte.
No generated F841 was hand-fixed, and native source quality was rerun on the correct23-file scope. First `ty` invocation
used repository root without the API project config (107diagnostics); the second had the project but resolved the wrong
environment (5unresolved imports). The final command explicitly selects both API project cwd and existing native venv
and passes. These are invocation corrections, not suppression of new source errors. No full-native typecheck PASS is
claimed; W2 documented27 unrelated Windows/MLX/Unix diagnostics.

## Required real-data evidence and remaining boundaries

Final-schema real Local reuse result:
`.trellis/.runtime/stage4-conversion-source/w3-d3b7dd5a-1c56-4437-b93b-f7dbc59bae75/result.json`.
Two new private copies each contain2Banks,722Sources/records,21invalidated records,2Blocks,722SourceSets and722references;
the validated copy retains1446original mappings. Full state roundtrip and original file/row preservation pass at
migration53. Shared content hash: `a4fd1f3bd762f0f734a836c7bebd73349aa394193102208ff501ac6e47206c3a`.
The helper records0conversion/model/native/authority calls; it exercised structure, not a fabricated current final proof.

Parent independently completed the already-converted D77 projection on a new copy:2Banks/722documents/1216units
(1195live+21invalidated),2models/2directives/2Blocks,722original policies+494neutral due policies,722document references,
673memory references and5728typed-original field comparisons, with total_changes0/original hash unchanged. Its digest
is `5a53cc016547e9def802d567bdc1d1546f4a31d6822ea3f72ddd7ed14b82af41`; see `real-data-reuse-preflight.md` and the
parent projection evidence. W3 did not repeat that projection or the original extraction.

Independent W3 check remains the next gate. W4 must implement the full publication/recovery join and pending custody
dispositions; W5 must exercise the actual reused-corpus transition/final maintenance/candidate journey. No real-roundtrip,
runtime activation, emergency completion, Home integration, deployment, full-native suite/model quality or owner/manual
acceptance is claimed. Rollback before selection preserves immutable staging/history; after any future publication,
use the accepted recovery/transition protocol rather than deleting evidence or rolling authority back by hand.
