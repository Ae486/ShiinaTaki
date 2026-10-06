# Taki Compatibility Patch Ledger

This is the live maintenance entry point for Taki-owned changes to this Hindsight checkout. Keep it alongside the
code so an upstream update can locate, revalidate, replace or retire each patch without reconstructing chat history.
It records compatibility work, not a second semantic memory engine.

The current incremental build is `taki-memory-hindsight-0.9.0-transitions-v1` (TAKI-HS-015 below).
Earlier build identities remain recorded with their original acceptance evidence.

## D77 application state and guarded native reflection

| Patch ID | State | Class | Necessity and contract |
| --- | --- | --- | --- |
| `TAKI-HS-012` | Baseline automated gates complete; blanket observation experiment removed in B6 closeout; D81 derived-input gap remains | `upstream-gap` + `taki-policy` + `integration-plumbing` | Native logical document projections omit original source bodies and native objects do not own Taki policy, provenance or Memory Blocks. Preserve complete application artifacts with immutable byte bodies, dual CAS, receipts and an independent state cursor, plus policy admission before native reflect consumes memory. |

- Source baseline: `6a749ba3e7d8719e336d9d1d8735a8e09da4366b`, Hindsight API/package `0.9.0`.
- Owner direction, 2026-09-13: finish existing B6/B7 before D79-D83 capability additions. B6 closeout removes the
  blanket observation experiment and restores ordinary own-record policy admission. D81 retains the known
  derived-visibility limitation. See Taki B6 `research/memory-capability-followups-2026-09-13.md`; no data or failed
  evidence is discarded, and experiment-only regression success is not complete derived-content acceptance.
- Build identity: `taki-memory-hindsight-0.9.0-d77-v1`; independent `application_state` and `application_reflect`
  contracts `1.0.0`. G1/D78 command/result hashes, receipts, certificates and native cursor meanings stay unchanged.
- Authority/design: Taki task `08-09-memory-runtime-integration/grill.md` and
  `research/d77-implementation-contract-2026-09-11.md`, including its native application-state plan.
- Implemented surface: new `engine/application_state/` typed models, byte codec, storage, publication, joint
  snapshot and read admission; the common `engine/replication.py` append hook; authenticated `MemoryEngine` entry
  points; optional request-scoped recall/reflect hooks in `engine/reflect/{agent,tools}.py`; thin extension routes;
  compatibility probes; additive PostgreSQL migration `d77a4f8c2e10` after `d78c3e6f8b12`, and `admin/cli.py` physical
  backup coverage for all eight application tables. The migration adds the explicit `application_capture_required`
  marker without changing prior cursor columns; downgrade refuses nonempty application evidence.
- API prefix: `/ext/taki-memory/banks/{bank_id}/application-state`. Only authenticated PostgreSQL SQL-row deployments
  advertise support after schema validation. New capture is optional on old schemas and transaction-fatal once installed.
- Multipart contents share the seal validator's `APPLICATION_BODY_TYPES` registry. `api/taki_application_schema.py`
  publishes every decoded body and embedded original Canonical component through the actual `app.openapi()` hook,
  with `x-taki-application-state-body-schemas` mapping body-schema versions to components. No schema-only endpoint
  is added. Limits are 256 KiB decoded parts, 512 KiB complete responses and 16 MiB unique preparation closure.
- Original byte bodies preserve deep supported JSON, NUL and escaped lone surrogates, using the independently tagged
  binary64 domain. SQL-indexed headers reject unrepresentable identifiers with a typed error; original source/unit
  metadata, strings and evidence are never normalized to fit PostgreSQL JSONB or TEXT.
- The common native hook publishes exact native changes and durable binding work; it does not infer a Source binding
  from a document ID or text. Joint snapshots include awaiting Source artifacts and their operation identities.
  Taki resolves these through immutable G1 result proof, checks current native source/hash evidence, then submits an
  explicit artifact/native CAS rebind. Provider-only reconstruction can enumerate the same retained awaiting bodies.
- Guarded reflect retains restrictions on unsupported opaque bodies, directives, profile context and whole-source
  expansion without exact admission evidence. Ordinary observations pass their own exact binding/policy/lifecycle gate,
  as other native facts do. That does not establish complete admission of every input used to generate their text;
  policy propagation/rebuild remains D81. Native callers without the hook, D78 input evidence and native
  observation-mutation refusals keep their existing behavior.
- Validation on 2026-09-11: the broad owned PostgreSQL matrix ran 660 cases: 553 passed, 103 skipped and four legacy
  fixture assumptions failed. Those assumptions (migration HEAD, an additive cursor column, a forwarding DB wrapper
  and new manifest fields) were corrected without weakening old proof assertions; all 26 D77 cases plus the four
  affected cases then passed together (30 passed). Coverage includes typed/byte losslessness, transaction/CAS/rollback,
  external native edits, joint replay, generation isolation, receipt replay, physical backup, complete authenticated
  HTTP flow, and actual native LLM/reranker/cache/structured-continuation input spies. A restrictive policy change
  after recall refuses the next model submission. All owned PostgreSQL instances were stopped and cleaned.
- The existing native reflect/tool mock suite additionally passed 57 cases; three real-model cases and one unrelated
  local-ML fixture were explicitly deselected. Its static `cl100k_base` test asset was checked against the installed
  tiktoken SHA-256 and read locally with the existing network guard unchanged. New D77 source passes Ruff, format and
  strict scoped type checking. The full API Ruff check passes; the package type check retains the known 27 Windows/MLX
  diagnostics in unchanged modules, and an untouched curation test has mixed-EOL format drift. The literal whole-repository
  auto-fixing lint hook was not run; read-only equivalents preserve unrelated maintained files and report their baselines.
- Canonical OpenAPI and all pinned SDKs were generated twice with 683 byte-identical outputs. Python 96, TypeScript 38,
  Go 6, Rust 8 plus one doctest and the complete locked build/source-compatibility gates passed. Application enum titles
  are source-qualified without changing wire values/defaults or native public names; the parent compatibility tag is
  inherited once. All original maintained wrappers, tests and lock/module files retain their recorded hashes.
- Independent native review reproduced and repaired same-batch duplicate exclusive native binding, unrelated/extra
  retirement CAS, and historical-assessment refusal of a legitimate same-object retirement after a native edit.
  The scoped 24-test PostgreSQL gate passed, including 11 new scenarios; the parent reviewed the repairs independently.
- Final actual native HTTP/PostgreSQL-to-Taki SQLite integration passed in owned fixture `2f49fea894dc` (82.51 seconds):
  immediate neutral policy, hidden input exclusion, guarded native reflect, ACK loss/reopen without duplicate native
  dispatch, pure layer and compound text/policy writes, typed original Source metadata, two Banks, user Block preservation
  and complete provider-only reconstruction into a new SQLite database. Core provider/storage/recovery are real;
  external models are deterministic substitutes. All owned listeners/PG data/registry were stopped and cleaned.
  Taki's final Core 2941, Shared 505, CLI 47 and Desktop 548 tests, typechecks, root lint and isolated Core startup passed.
  Detailed evidence is in the Taki task's `research/d77-runtime-validation-2026-09-11.md` and linked native/SDK reports.
- The 2026-09-11 deterministic checks used no original databases, retained D78 targets, external model requests, live
  authority activation, new dependencies or Git publication. They establish tested mechanics, not model quality.
- The owner-approved 2026-09-13 isolated API continuation completed grounded Reflect but found a hidden synthetic fact
  repeated in an admitted retrieved observation. A model-free probe confirmed the hidden original was excluded while
  its derived body was admitted. The old synthetic fixture failed to model this body-content leak. The ensuing blanket
  rejection experiment was not accepted as the product default and is removed during B6 closeout. Own-hidden canary
  rejection and benign observation admission remain regression requirements; full propagation is deferred as D81.
  Taki task `research/d77-derived-input-admission-2026-09-13.md` and `research/d77-siliconflow-validation-2026-09-13.md`
  preserve the actual failed attempt and its limits. No wire/schema or unguarded-native change is included in this cleanup.
- B6 closeout review also aligned direct mood admission: null, empty and whitespace-only disclosure now refuse native
  guarded Reflect, matching Core. Existing nonempty keyword matching stays unchanged. The focused actual-input matrix
  reproduced three failures before repair; all 16 Reflect regressions then passed, with the owned fixture cleaned.
- Final B6 closeout: actual HTTP-to-Core/provider-only reconstruction passed on the final source (`05be851c922d`).
  The owned actual-data run `api-b6-closeout-1` completed original-target Recall, ordinary observations, automatic Recall,
  grounded Reflect and bounded curator continuation. It preserved D81 as a known failure, not a passing information-
  exclusion guarantee. All 2,779 recorded source files and protected original/prior-acceptance files matched afterward;
  all owned services stopped without forced termination or remaining Job members. See Taki B6
  `research/b6-closeout-validation-2026-09-13.md` for per-pass failures, remaining assessments and manual/live boundaries.
- Rollback: disable D77 consumption and drain owned work before changing writers. Do not remove nonempty application
  evidence or deploy an older writer that silently misses required publication. Source evidence and terminal receipts
  are retained conservatively, independently of live Bank deletion and snapshot expiry.
- The patch remains local because no upstream publication is authorized. Replace it only when the provider offers
  equivalent byte-preserving original artifacts, exact native/application association history, paired recovery and
  pre-input policy admission. Ordinary native exports do not substitute for the separate application snapshot or
  physical backup; state-stream pruning intentionally does not reclaim retained original artifacts or receipt bodies.

## Record ownership and evidence

- Historical patches `TAKI-HS-001` through `TAKI-HS-008` were recorded in the TakiAgent repository at
  `.trellis/tasks/archive/2026-08/08-09-hindsight-compatibility-extensions/hindsight-patch-ledger.md` (present at Taki
  commit `c3f8bc4`). Their inventory and migration mapping are preserved below. That archive remains immutable evidence.
- This file is the live ledger for subsequent Hindsight patches. Taki task records keep implementation/review evidence
  and link here; they must not maintain a competing editable copy of the current provider inventory.
- Historical acceptance is dated evidence, not a claim that a new upstream revision or current live deployment has
  passed. Each new patch must name its own baseline, exact validation and outstanding gates.
- Routine G1 follow-up in TakiAgent: `.trellis/tasks/09-07-hindsight-recovery-evidence` (owner-authorized 2026-09-07).
  Its parent B5 review is `.trellis/tasks/08-09-memory-replica-sync-recovery/research/wave-3-review-2026-09-07.md`.
- Current D78 follow-up: `.trellis/tasks/08-09-hindsight-initial-cutover/research/d78-execution-contract.md` and
  `d78-native-preflight.md` (owner-authorized continuation on 2026-09-08). It preserves G1 and adds independent
  current-state transfer and first-activation maintenance proof. Implementation, independent review, owned integration
  and generated-client gates are recorded in B4 `research/d78-validation-2026-09-09.md`; live acceptance is separate.

## Baselines

| Meaning | Identity |
| --- | --- |
| Evaluated native API/package | Hindsight `0.9.0` |
| Original inspected upstream source | `4b2041eb3de5c4235f4a3dd5619fc47cce782e29`; not proven to be an immutable `v0.9.0` tag target |
| Accepted local extension-series checkpoint | `7eca2056dae5d70a682b755abfff8a107f6b08a0` on local `main` |
| First replication backend | PostgreSQL with SQL-row storage; Oracle replication acceptance is not implied |
| Routine G1 checkpoint | `8ab65b4c2ea238223eeef84cbdcc012ca7601e86`; routine implementation and independent review complete, including the approved actual-source Rust gate. |
| Current D78 working tree | Structured current-state import and first-activation proof implemented and independently reviewed; complete native result matrix, actual HTTP-to-Taki integration and all generated SDK contracts pass. Required native lint retains unchanged Windows type diagnostics, detailed below. Uncommitted; live acceptance remains separate. |

## Patch classes

| Class | Responsibility | Maintenance rule |
| --- | --- | --- |
| `upstream-gap` | Generic consistency or operability evidence missing from the evaluated native API. | Prefer an upstream-compatible seam; check native replacements during each upgrade. |
| `taki-policy` | Taki policy or compatibility signaling. | Keep isolated and additive; preserve native defaults and user overrides. |
| `integration-plumbing` | Public schemas, serialization, migration/backup, generated clients and packaging. | Regenerate from canonical sources; retain executable compatibility tests. |

## Historical patch inventory

| Patch ID | Status | Class | Contract and reason | Main maintenance hotspots |
| --- | --- | --- | --- | --- |
| `TAKI-HS-001` | Accepted historically | `taki-policy` | Add fenced observation instructions without replacing Hindsight's native consolidation mission. | Consolidation prompt/config/template plumbing and prompt cache boundaries. |
| `TAKI-HS-002` | Accepted historically | `upstream-gap` + `taki-policy` | Add stable memory revisions, conditional mutation/idempotency, and atomic controlled `taki-layer:*` entity/tag projection. | Curation request/response models, live/archive writes, mutation receipts, entity-label projection, HTTP/OpenAPI regeneration. |
| `TAKI-HS-003` | Accepted historically | `upstream-gap` | Add provider lineage, Bank generation, commit-visible per-Bank cursor state, append-only logical changes, retention/reset behavior, and frozen canonical serializers. | `engine/replication.py`, replication migrations, DB capability gates, backup/restore, migration DAG. |
| `TAKI-HS-004` | Accepted historically | `integration-plumbing` | Publish every frozen authoritative writer family in the same transaction as canonical mutation, including ordered tombstones and rollback exclusion. | Retain, consolidation, curation/document, observation maintenance, transfer, mental-model/directive, and Bank/config writers. |
| `TAKI-HS-005` | Accepted historically | `upstream-gap` | Materialize cursor-bound repeatable-read logical snapshots into immutable hashed pages with integrity manifests and expiry cleanup. | `engine/logical_snapshot.py`, canonical bulk serializers, snapshot migrations, backup/portable-transfer classification. |
| `TAKI-HS-006` | Accepted historically | `integration-plumbing` + `taki-policy` | Expose the independently versioned compatibility manifest, journal/snapshot APIs, fail-closed capability handshake, OpenAPI, and generated clients. Taki endpoints require explicitly authenticated tenant deployments; anonymous/default deployments fail closed. OpenAPI-facing errors use one shared typed envelope per operation so maintained clients decode actual 401/422 and operation failures consistently; the wire `error` discriminator remains stable. | Hindsight commit `52b5faad` implements the compatibility extension and focused contracts; `64fa85f8` regenerates the canonical OpenAPI, docs, and Rust/TypeScript/Python/Go clients and preserves the checked-in Go `go.mod`/`go.sum`. Hotspots include built-in `/ext/taki-memory` routing and Bearer security; compatibility, journal, snapshot, CAS/revision, and source-level `TakiDispositionTraits` schemas; canonical OpenAPI/bank-template artifacts; and maintained clients. HTTP/Supabase, migration/replication/snapshot, OpenAPI, client, lint/type, diff, and focused live `localhost:8888` gates pass. The full generated-client online suite was not rerun in the final turn, and Oracle end-to-end replication remains unavailable; neither is advertised as completed. |
| `TAKI-HS-007` | Accepted historically | `integration-plumbing` | Enforce an LF working-tree checkout for the standalone startup script so a Linux container can execute its shebang when the Hindsight checkout is built on Windows. This is a packaging/runtime portability fix only; it does not change startup behavior. | Hindsight commit `f700d9ac` adds `.gitattributes` with `docker/standalone/*.sh text eol=lf`. The tracked `docker/standalone/start-all.sh` blob was already LF; the attribute prevents Windows checkout conversion from reintroducing CRLF. A Windows-built `api-only` image executed the LF-only script, initialized embedded PostgreSQL, reached `/health`, and survived restart on 2026-08-18; the post-restart retest on 2026-08-19 again reached `/health` and the authenticated compatibility manifest. |
| `TAKI-HS-008` | Accepted historically | `integration-plumbing` | Normalize deterministic whitespace in generated clients so repeated regeneration cannot reintroduce trailing whitespace or multiple blank lines at EOF. This is reproducibility and maintenance plumbing only; it does not change the wire contract. | Hindsight commit `7eca2056` updates `scripts/generate-clients.sh` to normalize generated Python API/model source and Go text output at generation time, and normalizes the affected generated files. The defects were exposed by `git diff --cached --check` only after the new generated files had been staged; ordinary `git diff --check` could not inspect those untracked files. |

## Historical migration mapping

| Revision | Patch | Purpose | Maintenance note |
| --- | --- | --- | --- |
| `c4a7e2d9b1f6` | `TAKI-HS-002` | Add authoritative memory-unit revisions. | Preserve live/archive revision continuity and migration backup coverage. |
| `d5b8f1c3a7e2` | `TAKI-HS-002` | Add mutation receipts. | Bank lifetime deletion clears receipts; individual record deletion does not. |
| `e6c9a4f2b8d1` | `TAKI-HS-003` | Add provider lineage, durable Bank state, and logical journal. | Durable Bank state intentionally has no `banks` foreign key. |
| `f7d0a5c3e9b2` | `TAKI-HS-005` | Add logical snapshot metadata and immutable pages. | Accepted on 2026-08-11; the final unshipped schema intentionally has no foreign key to mutable `replication_bank_state`. |

## G1 recovery candidate

The owner's latest direction is to make Taki Local memory and Hindsight interoperable with aligned public logical
fields, keeping Hindsight's semantic service native and Taki's complete Local maintenance independent. Prefer Taki
REST adapters and supported transfer APIs, then official extensions, then minimal generic native hooks for proven
gaps. Taki records the confirmed direction in `.trellis/tasks/09-07-hindsight-recovery-evidence/grill.md`.

The owner accepted G1: a routine write may finish recovery after reliable native-result proof and matching local
factual application. Derived observation/model work continues under native policy, and its later writes synchronize
normally. Initial activation and a healthy return to Local retain independent completion/integrity gates. Do not
change native automatic model-refresh timing solely to finish routine pending rows.

Patch 009 now implements the selected routine native-result/append protocol. Independent cutover evidence remains
separate. The old strict option
below remains comparison evidence; its approximately 20-file footprint and atomic envelope are not selected scope.
Recheck native API/extension reuse before choosing the minimum adequate protocol. Existing patches 001-008 and the
remaining durability, identity, revision and journal guarantees stay in force until replaced by verified equivalents.
Source-backed design improvements during development are allowed; update this ledger and the affected contracts/tests
with each material refinement. Packaging alone does not remove coupling to private native transaction paths.

| Patch ID | State | Reason and direction | Evidence / completion gate |
| --- | --- | --- | --- |
| `TAKI-HS-009` | Independently reviewed and verified offline | Extension-owned tracked admission/result routes reuse native async retain, streaming/delta and conditional mutation. Same-transaction native operation/part receipts provide historical result pages and factual cursors without per-write derived-chain tracking or automatic-refresh changes. | Taki task `09-07-hindsight-recovery-evidence`: design, implementation/validation records and independent review, including the approved actual-source Rust gate. Live support/cutover acceptance remains separate. |

### Selected G1 implementation inventory

The selected routine implementation preserves native streaming and uses existing transaction/extraction seams.
The measured handwritten source footprint is 22 files: 14 provider files (nine existing files, four new focused
modules and one additive migration), two maintained SDK wrappers plus the Python public-export module, two generation sources, the Rust schema adapter,
and two Windows documentation-build scripts. The approved Rust dependency also changes two Cargo manifest/lock files.
Tests, records and generator-owned artifacts are counted separately.
The exact responsibilities are listed below. Native public retain parameters and Control Plane proxies stay unchanged.

The new build is `taki-memory-hindsight-0.9.0-g1-v1`, with independently negotiated `native_results` contract `1.0.0`.
Under `/ext/taki-memory`, tracked writes use `POST /banks/{bank_id}/retains` and
`PATCH /banks/{bank_id}/memories/{memory_id}`. Historical status and immutable pages use
`GET /banks/{bank_id}/native-results/{kind}/{operation_id}` and its
`/results/{result_hash}/pages/{page_number}` suffix. Existing native routes keep their semantics.
Canonical OpenAPI and all four SDK families represent these contracts and pass their scoped offline gates, including
the actual Rust runtime declaration/build below. The old approximately 20-file source/MM/atomic option is historical comparison only.

The 2026-09-08 source refinement preserves native large-append ordering: partition the submitted fragment first,
prepend the full old body only to its first outer slice, and freeze the full merged body plus exact global ordinals
before publication. This avoids introducing a forced full-extraction fallback that could change delta survivor IDs,
lifecycle or cost. The implementation's large-append/JSON/replace and interruption tests must prove this ordering.

Taki's `research/g1-cutover-evidence-contract.md` now records the independently proposed finite maintenance
certificate, explicit model-input limitations and durable Hindsight-source fence/recovery protocol. Those producer
changes are not part of the routine G1 implementation or a currently supported cutover capability. Initial activation,
planned switch-back and Local runtime completeness keep their own acceptance gates.

The candidate now has actual PostgreSQL/HTTP/SQLite evidence. Its final native matrix passed 69 cases in 144.22 s,
including all review corrections, nonempty backup/restore and actual Taki recovery. Final Shared 396 and Core 2036
tests pass. The reviewed existing mechanical
allowlist passed 544 cases with 99 non-applicable migration checks; one obsolete cancellation test double was fixed
and passed a narrow rerun. Full Taki and SDK gates are recorded in the task's validation report. Independent review
closed seven confirmed findings and withdrew the source-witness candidate after actual SQL verification. The final
14 changed Python source files pass type checking; 27 diagnostics remain in unchanged Windows/optional modules.

### Actual candidate maintenance surface

| Surface | Files / obligation during an upstream update |
| --- | --- |
| Native request model ownership | `hindsight_api/native_requests.py`, `api/__init__.py`, `api/http.py`: retain the original public models/imports and native request semantics. Reconcile upstream model changes at their new shared source. |
| Tracked producer proof | `engine/native_operation_receipts.py`, `engine/native_receipt_lifecycle.py`, `engine/retain/receipt_context.py`: stable identities/plans, historical results, source/attempt fences, lifecycle and post-seal private cleanup. |
| Native transaction hooks | `engine/memory_engine.py`, `engine/retain/orchestrator.py`, `engine/retain/fact_extraction.py`: preserve native streaming/delta/Batch/zero/error/tail behavior while atomically recording exact factual parts. |
| Extension/capability boundary | `extensions/builtin/taki_memory.py`, `api/dependencies.py`, `engine/taki_compatibility.py`: independent native-results capability, authenticated SQL/schema/store checks, exact candidate build, typed routes/errors. |
| Persistence | Alembic `a8e1b6d4f0c3_add_native_operation_receipts.py` adds `memory_native_operation_receipts` and `memory_retain_part_receipts`; `admin/cli.py` includes both in backup. These are private proof/replay tables, not new canonical replica kinds. |
| Producer regressions | `tests/native_results/`, updated extension contract/cancellation fixture, and the existing reviewed native write/journal/snapshot/admin regression set. |
| Canonical schema/clients | `hindsight-dev/hindsight_dev/generate_openapi.py`, its regression tests, `scripts/generate-clients.sh`, `hindsight-docs/static/openapi.json` and generated Python/TS/Go output. Maintain actual wrapper parity in Python/TS, the public exports in `hindsight-clients/python/hindsight_client/__init__.py`, and generated-contract tests. |
| Rust adapter and runtime | `hindsight-clients/rust/build.rs` preserves nullable references; source-qualified G1 enum titles avoid Typify's name-only type reuse. `tests/native_result_contract.rs` covers real serde/null/hash/enum behavior. `Cargo.toml` and `Cargo.lock` declare the approved existing `regress 0.10.5` as a direct runtime dependency; retain exact locked package versions/checksums. |
| Windows build checks | `hindsight-docs/scripts/check-integration-seo.mjs` and `sync-coding-agents-doc.mjs` normalize CRLF before parsing/comparison; all original checks remain enabled. |

Canonical generation exposed and fixed three concrete defects: closed-object nullable normalization in generator
7.10.0; Python `from_dict` turning omitted PATCH fields into explicit null; and Rust nullable-reference/type-title
loss. Preserve the source fixes and actual runtime model regressions. Repeating canonical generation produced
455 byte-identical OpenAPI/Python/TS/Go files with unchanged Go manifests. Do not hand-edit generated output.

The owner separately approved the required direct runtime `regress = "=0.10.5"` declaration on 2026-09-08. Its package
already existed in the locked build graph; only the root dependency edge was added, with no package/version/checksum
changes. The actual-source `cargo build --release --locked --offline` and four generated-model tests passed in
`d31d069c8e07`, and validation left the lockfile unchanged. The independent checker reviewed the diff and logs.
The earlier temporary copied-crate proof remains historical preparation evidence.

Offline source/client gates are complete. Deployment uses the existing extension/authentication configuration and
normal migration/startup process under
separate live authorization. Preserve incomplete replay records and Bank-generation identity during upgrades.
Rolling back to a build without G1 must refuse new tracked confirmation; never reclassify existing tracked rows as
legacy, delete their proof to force replay, or downgrade the two private tables while recoverable G1 work remains.

The demonstrated seams are the native operation/retain and conditional-mutation paths in
[hindsight-api-slim/hindsight_api/engine/memory_engine.py](hindsight-api-slim/hindsight_api/engine/memory_engine.py),
[conditional_mutation.py](hindsight-api-slim/hindsight_api/engine/memories/conditional_mutation.py),
[retain/fact_storage.py](hindsight-api-slim/hindsight_api/engine/retain/fact_storage.py), and their
[HTTP contract](hindsight-api-slim/hindsight_api/api/http.py). The proposed patch must preserve native semantic
processing. Endpoint/schema details are proposed in the task design; they are not supported until implementation and gates pass.
Upstream contribution is not yet requested or submitted.

### Earlier strict option - historical planning evidence

The following scheduling, atomic-retain and approximately 20-file inventory describes the previously evaluated
strict option under its original assumptions. It is not the implementation instruction for G1. Keep only components
whose remaining necessity is demonstrated by the selected native-result/append or independent cutover contract.

The evaluated strong-recovery option has one deliberate opt-in scheduling effect: automatic mental-model refresh may
start after a tracked operation's own source work finishes, before the ordinary Bank-wide consolidation reaches its
final round. This can change automatic refresh timing and call frequency. In that option it avoids a never-quiescent
Bank extending one recovery operation indefinitely. Reuse a shared refresh only with persisted input-boundary and
model-definition coverage; never force disabled native policy or claim coverage from a task ID alone. Keep the
untracked native path and explicit manual refresh behavior intact. A bounded source cohort was considered and rejected
because it would additionally change native source selection and batching.

Native streaming currently lacks sufficient durable part/result evidence to prove exact recovery of a partly written
document. The proposed first contract therefore completes native extraction before one authoritative transaction
publishes the document, complete fact set, logical journal and immutable receipt together. Reuse native append/JSON
assembly, delta handling and storage helpers; validate the producer-read base with an internal CAS. The atomic
full-retain fallback and resource envelope require a deterministic feasibility gate. Native batching thresholds are
candidate scope inputs, not measured memory-safety limits. The owner must choose whether a bounded single-input v1
is acceptable; larger native append coverage needs measured larger buffering or a broader durable-part protocol.

### Patch 009 conditional footprint of the evaluated option

Paths in the backend inventory are relative to `hindsight-api-slim/hindsight_api/`:

| Surface | Proposed files / responsibility |
| --- | --- |
| Admission, native writes and queue integration | `engine/memory_engine.py`, `engine/retain/orchestrator.py`, `engine/memories/conditional_mutation.py` |
| Source and model outcome evidence | `engine/consolidation/consolidator.py`, `engine/memories/base.py`, `engine/memories/pg/reads.py` |
| Public contract and capability gate | `api/http.py`, `extensions/builtin/taki_memory.py`, `engine/taki_compatibility.py` |
| Worker claim/restart and physical backup | `worker/poller.py`, `admin/cli.py` |
| New focused modules | Approximately three modules for typed contracts, receipt/work persistence, and native-helper-based atomic retain; final names/split follow implementation review. |
| Additive schema | One forward migration proposing `memory_operation_receipts` and `memory_operation_work`; PostgreSQL support with explicit unsupported Oracle behavior. No canonical document/fact column change is required by the base-state hash approach. |
| Maintained client/proxy plumbing | Python and TypeScript wrappers; control-plane retain/retain_async forwarding and `src/lib/api.ts` types. |

The primary handwritten inventory is 11 existing backend files, about three new modules, one migration, two wrappers
and three control-plane files: approximately 20 file entries before tests, documentation and conditional helper
changes. This is a planning estimate, not a final changed-file count. Regenerate canonical OpenAPI and all four
Python/TypeScript/Rust/Go SDK families. Keep generated output volume separate from handwritten implementation size.
Task backend, maintenance, DB claim adapters and fact-storage helpers are conditional touchpoints; reuse the existing
replication lock/publication and survivor-change machinery before adding another path.

Proposed wire changes are an optional typed `recovery` member on native retain/conditional mutation, an authenticated
operation-receipt/evidence read endpoint, and independent versioned operation-result/logical-completion capabilities.
Provider-owned request/native-result/native-receipt/final-completion hashes are distinct from Taki's local epoch and
receipt-envelope hash. Preserve legacy persisted rows without retroactive proof and advertise the exact new build
only after contract, migration, native-path and generated-client gates pass.

Physical backup/restore must include coherent receipt/work/queue/lineage state. Portable transfer excludes replay
history and starts fresh identities. Keep identities/results for the supported Bank-generation lifetime independently
of terminal-operation TTL; remove private prepared bodies when no longer required. Disabling new tracked admission
is the initial rollback boundary; do not drop evidence tables while pending consumers rely on them.

Validation must cover atomic fault/rollback and concurrency, lost responses and operation pruning, complete append
and delta results, source/scope failures, finite completion under unrelated traffic, refresh input coverage, stale
worker claims, authentication/tenancy, migration/backup/transfer, all generated clients and the actual Taki second-pull
path. Research ran no tests/services/generators. Live provider/LLM, user-data migration and deployment remain unrun
and outside this task's current authorization. Record final commands and exact results here after implementation.

## D78 current-state transfer and first-activation proof

| Patch ID | State | Class | Necessity |
| --- | --- | --- | --- |
| `TAKI-HS-010` | Implemented and independently reviewed; offline evidence below; live acceptance open | `upstream-gap` + `integration-plumbing` | Import an already-authored complete logical Bank without extracting its source again, then prove the finite native maintenance pass against exact current inputs and its resulting logical snapshot. |

The baseline is Hindsight `0.9.0` at `8ab65b4c2ea238223eeef84cbdcc012ca7601e86`. The candidate build is
`taki-memory-hindsight-0.9.0-d78-v1`; `current_state_transfer` and `cutover_verification` are separate `1.0.0`
contracts. Routine `native_results: 1.0.0` keeps its original wire and completion semantics. Capability publication
checks the actual schema shapes, SQL/document ownership and authentication. Both implemented producers are advertised
independently when those probes pass; a missing cutover table does not erase an otherwise valid G1 capability.

Client-only raw-source retain cannot preserve current edited units, invalidated or standalone records, nullable
source text, typed source/unit metadata, cross-document source links or authored derived resources. Ordinary native
task/queue state, consolidation markers and model timestamps do not prove which inputs a first-activation pass used.
The new provider seam therefore imports known state and records actual native work instead of inferring its result.

### Implemented surface and compatibility obligations

Paths below are relative to `hindsight-api-slim/`; the Generated contracts row explicitly uses repository-root paths.

| Surface | Maintenance obligation |
| --- | --- |
| Import wire and admission | `hindsight_api/engine/transfer/current_state_{schema,preflight,authorization,admission,native_ownership}.py`: exact source witnesses, verified B3 Bank/model/directive baselines, complete owned supersession, namespace and pending-work checks. G1 supersession validates each input's original boundary and reference manifest, not only the parent aggregate. |
| Import transaction and replay | `hindsight_api/engine/transfer/current_state_{rows,writer,store}.py` and wrappers in `hindsight_api/engine/memory_engine.py`: at most 10,000 records / 16 MiB per atomic Bank; native new IDs, final lifecycle/source links, indexes, journal and complete immutable mappings commit together. Replay reads the first result without extracting or writing again. |
| HTTP | `hindsight_api/api/current_state_transfer.py`, `hindsight_api/api/cutover_verification.py`, registered by `hindsight_api/api/http.py` under `/ext/taki-memory/banks/{bank_id}`. Authenticated typed engine methods own writes; handlers do not execute SQL. Shared 401/422/503 envelopes remain bounded and source-free. |
| Finite maintenance | `hindsight_api/engine/cutover_verification.py` plus `_candidate`, `_certificate`, `_content`, `_context`, `_model`, `_runner`, `_state`, `_store`, `_view`; optional consolidation transaction hooks and `MemoryEngine` model-refresh hooks bind full source/scope/model requirements, exact native inputs, actions/no-ops, partial committed receipts, attempts and final outcomes. Routine automatic scheduling is unchanged. |
| Actual model input | `hindsight_api/engine/reflect/{agent,prompts,evidence}.py` records inputs from the real prompt/tool/LLM assembly and final delta builder. Diagnostic `based_on` and tool traces alone cannot attest consumption. Authored content, definition/tracking policy and current input/lifecycle sets remain distinct. |
| Snapshot seal | `hindsight_api/engine/logical_snapshot.py` pins the certificate's immutable snapshot pages in the same database transaction. Original snapshot SHA/page contracts stay unchanged; `snapshot_records_hash` additionally hashes the full ordered records with the new encoding. |
| Metadata response fidelity | `hindsight_api/engine/response_models.py:MemoryFact.metadata` and `hindsight_api/api/http.py:RecallResult.metadata` preserve JSON value types, including nested values, booleans and null. Existing string values are returned verbatim. This widens generated response value types; old G1 string encoding and frozen hashes do not change. |
| Migration/backup | In `hindsight_api/alembic/versions/`, `d78a1c4e6f90` follows `a8e1b6d4f0c3` and `d78b2d5e7a01` follows it. `hindsight_api/admin/cli.py` backs up all six private transfer/maintenance tables in parent order, plus the pinned snapshot field in ordinary snapshot rows. |
| Source and consumer verification | `tests/native_results/test_current_state_{transfer,admission}.py`, `test_cutover_{compatibility,verification,verification_recovery,native_inputs,lifecycle,snapshot_boundaries}.py`, `test_current_cutover_{consumer,backup}.py`; the original snapshot concurrency proxy also delegates catalog `fetchval`. Taki owns the actual HTTP-to-SQLite fixture and full consumer/quality records. |
| Generated contracts | Repository-root paths: `hindsight-dev/hindsight_dev/generate_openapi.py`, `scripts/generate-clients.sh`, `scripts/postprocess-go-client.py`, `hindsight-clients/rust/build.rs`, canonical OpenAPI and all Python/TypeScript/Go generated clients. SDK contract fixtures/tests exercise typed JSON, full safe integers, required nulls, actual discriminators and nullable union alternatives. Taki's Windows runner uses the same pinned generators/options/postprocessors. |

New protocol hashes use `taki-current-state/tagged-json-binary64-v1`: recursively tagged JSON, unsigned UTF-8 key
order, finite binary64 big-endian hex numbers and normalized zero. This avoids Python/JavaScript number-printing
differences without rewriting old G1, C1 or snapshot digest formats. Both implementations share a golden fixture.

Transfer receipts have no Bank/object foreign key; historical import evidence survives supersession and Bank deletion.
Maintenance candidate/action/evidence rows similarly survive task/Bank deletion. Portable logical transfer does not
export private replay/maintenance history. Physical backup must retain coherent lineage, receipts and snapshots.

Migration `d78a1c4e6f90` permits already-public nullable `mental_models.source_query/content/max_tokens/trigger/
last_refreshed_at` values and widens live/archive `proof_count` from INTEGER to BIGINT for safe JSON integers.
Ordinary create defaults remain intact. Downgrade refuses unrepresentable null/large values; it must never invent
replacement values. Do not drop proof tables or remove pinned snapshots while consumers rely on them. Disabling new
admission is the first rollback step. PostgreSQL SQL-row storage is the supported provider; Oracle remains unsupported.

The focused transfer matrix passed 17 native and four response-model cases in 61.00 seconds on the owned PostgreSQL
fixture (`taki-hindsight-g1-72d27ca624f5`). Real engine recall, HTTP recall and model-fact reads preserve typed metadata;
the prior `str(value)` coercion has a recorded failing-to-passing test. Earlier focused tests cover transaction rollback,
full-set supersession, pending retain, paging/corruption, null/lifecycle/chunks/entities and historical replay.

### Final source and offline evidence (2026-09-09)

- Native result aggregate: 138 passed in 294.05 s, including current import/maintenance, G1 regression, actual
  two-Bank HTTP-to-Taki SQLite response-loss recovery and nonempty backup/restore (`aef11db788c3`). Expanded native
  proof plus ordinary consolidation/reflect checks: 133 passed, then the final lifecycle/scope-exit selection 10 passed
  (`89f71b548aec`, `f67010962eee`). Counts overlap. Exact G1 ownership corrections passed 29 cases (`3ccf0f81ea93`).
- Existing snapshot/consolidation/observation/extension/backup/migration selection: 258 passed and 101 conditional
  migration skips; the sole failure was a test proxy missing `fetchval`. After delegating that real query, the full
  snapshot file passed 16 cases (`9d6f75e54877`, `70d38141346a`). Native fixture data/registry were verified cleaned.
- Canonical schema/actual native SDK fixture/DAG checks: 22 passed (`6be40e90a2ab`). Canonical OpenAPI, all four client
  generators/builds and documentation build passed (`a8cf04c4d03b`). Python offline SDK: 96 passed (`d4b4016a0510`);
  TypeScript: 38 passed and build passed (`abe4057ff93e`); Go compile-only plus six real contract tests and twelve
  subcases passed, Rust eight actual generated serde contracts passed (`411a3c37e4bc`). Live SDK tests were excluded.
- An offline Python wheel imports both real packaged modules and passes D78 full-request plus old G1 omitted/null
  PATCH contracts. The maintained OpenAPI backwards checker found no issues and no old component was removed
  (`e32574aa37af`). Canonical schema: 665,488 bytes, SHA-256
  `cf999d5b9fd8bcdfe1b19ece108a6183a6a82c8545a574c1d0b87340b36e1419`.
- Required `scripts/hooks/lint.sh` was run after the final source edit. ESLint/Prettier/Ruff/ty-dev pass. The full hook
  exits 1 solely on the unchanged Windows API ty baseline (27 diagnostics in seven unchanged files) and three
  `termios`/`tty` diagnostics in unchanged embed `cli.py`; newly introduced diagnostics: zero. All 33 changed API
  sources and OpenAPI/Go generator helpers pass scoped ty. These platform checks are not reported as green.
  Final hook logs: `d78-validation/cc63303ff4084c92a23a354de39508f8`; baseline comparison and scoped gates:
  `d78-validation/33e40d91314f4a0c98eb67866eda5f9c`.
- Independent review fixed exact native ownership, Bank authorization/effective policy, actual model-consumption and
  historical scope-exit evidence, durable consumer invalidation, and generator decoding issues. A final generator
  review fixed a structured helper's tuple return with a frozen dataclass; no unresolved source finding remains.
  Exact canonical regeneration is byte-identical across 528 files, including current Rust output (`31a8e0af0dae`).
  The final file/manifest audit (`d78-validation/audit-1a187d454f7b`) preserves all 120 dependency manifests, the
  unrelated CLI hash and both checkout HEADs. Taki's report records the full commands and limitations.

Canonical generation corrects schema `const` as equivalent one-value enums and gives a nullable multi-arm union a
distinct inner component name; field required/default/validation semantics stay intact. Rust watches the current
relative OpenAPI path and `build.rs`, so copied caches cannot count old generated types as a current build. Go keeps
the declared discriminator decoder, refuses missing/unknown/case-alias tags and preserves required nullable arrays.
All JSON integers generate as int64; former int32 Go callers/helpers require source adaptation. Response metadata
now permits real JSON values; existing string values are unchanged. Maintained wrappers/proxy surfaces and dependency
manifests stay intact. The extension is exposed through the generated low-level SDKs and Taki's typed client.

Deterministic injected models prove mechanics only. Real model quality, existing user data, deployment, actual
authority activation, healthy return to Local and Taki D77/B6/B7 acceptance remain separate. No upstream issue/PR is
authorized. Reevaluate this patch when native transfer can preserve the complete logical domain and native maintenance
offers equally durable input/outcome/snapshot evidence.

## D78 maintenance coordination — actual-data correction

| Patch ID | Status | Class | Failure and required behavior |
| --- | --- | --- | --- |
| `TAKI-HS-011` | Implemented; regressions and corrected full-source actual-data retest passed | `integration-plumbing` | Coordinate ordinary native maintenance with D78 from structured import through finite verification, retaining genuine native execution and strict drift refusal. |

The 2026-09-09 isolated actual-data run imported all 722 Canonical sources/units, then correctly refused its Global
certificate: the candidate began at cursor 325, its 47 action receipts covered through cursor 347, and ordinary
consolidation wrote the first unreceipted observation at cursor 348. The periodic scheduler also accepted work for
the Character Bank while it waited for Global verification. Existing offline fixtures disabled that scheduler path.
A client retry cannot prove those unknown changes or recover the stale candidate; the failed target is retained.

Baseline remains native `8ab65b4c2ea238223eeef84cbdcc012ca7601e86` plus the prior documented local patches.
The compatibility build remains `taki-memory-hindsight-0.9.0-d78-v1`; both D78 contracts remain `1.0.0`.

The import transaction now acquires a five-minute Bank maintenance lease tied to the exact transfer, namespace,
Local manifest and random fence. Finite native calls renew valid admitted cohort members every thirty seconds,
including a matching Bank waiting for another Bank's verification. Completion/terminal release, expiry and proven
supersession fence old writes. Retryable incomplete work retains only a bounded recovery window. Ordinary scheduling,
manual retry, workers and final producers defer without dropping accepted work, spending retry budget or pretending
that unexecuted work completed. Other Banks and ordinary maintenance configuration remain active.

The accepted-operation trigger changes only the owner's physical row version. Prepare/claim lock it before trusting
a repeatable-read quiet view; every operation type entering the accepted set is covered. Ordinary submission,
manual retry, file conversion and completion/outbox paths preserve a consistent lock order. An old attempt checks
its fence before interpreting newer candidate changes. A genuine serialization abort from the same lease heartbeat
can reopen the short initial input transaction or finite sealing call once, rebuilding its view/binding. Model calls
and committed actions stay outside those retries; exhaustion is operational refusal, not fabricated source drift.

All paths below are relative to `hindsight-api-slim/hindsight_api/`:

| Surface | Exact files / resulting contract |
| --- | --- |
| Durable ownership and capability | `engine/bank_maintenance.py`, `engine/cutover_maintenance.py`, `engine/taki_compatibility.py`: namespace/transfer/attempt fences, finite cohort renewal, complete storage and enabled-trigger probes. |
| Atomic structured import | `engine/transfer/current_state_admission.py`, `engine/transfer/current_state_writer.py`: ownership is installed with the committed transfer. Explicit replacement follows full baseline and every-object proof checks, including valid native-result supersession. |
| Ordinary work and final writes | `engine/maintenance.py`, `engine/task_backend.py`, `engine/memory_engine.py`, `engine/consolidation/consolidator.py`, `worker/poller.py`: admission/worker deferral, late-write fences, real source completion bookkeeping and protection against stale cancellation/requeue. |
| Finite proof and sealed snapshot | `engine/cutover_verification.py`, `engine/cutover_verification_state.py`, `engine/cutover_verification_store.py`, `engine/cutover_verification_context.py`, `engine/cutover_verification_model.py`, `engine/cutover_verification_runner.py`, `engine/cutover_verification_certificate.py`, `engine/logical_snapshot.py`: private attempt fence and source reservation through sealing. Unbound logical snapshots keep their existing behavior. |
| Persistence and physical backup | `alembic/versions/d78c3e6f8b12_add_bank_maintenance_ownership.py`, `admin/cli.py`: new owner table, nullable private verification fence, admission trigger and backup inventory. |

The additive PostgreSQL migration follows `d78b2d5e7a01`. It backfills released owner rows for existing live-generation
transfers without changing old requests, candidates, receipts, mappings or journals. A missing required owner refuses;
it is not reconstructed from a potentially stale view. Physical backup includes `memory_bank_maintenance` after its
transfer FK parent. Logical Bank snapshots/portable exports omit this process ownership. Oracle remains outside D78
support. No prior migration, public DTO, endpoint, tagged hash, SDK wrapper or dependency manifest is changed by 011.

Evidence so far: the normal-worker race and late accepted-work snapshot were reproduced before correction. Focused
gates passed 15 lease/admission/compatibility cases, 22 actual-PG migration/capability/MVCC cases, 13 queue/late-writer
cases, and 7 real-renewal serialization recovery cases. The affected ordinary-path/backup/migration gate passed
252 cases; 102 conditional migration checks had no concurrent DDL to inspect. The first full matrix exposed a native-
result replacement regression and obsolete concurrency barriers; the corrected complete matrix passed 186 cases in
471.82 seconds. The required full hook ran in 19.08 seconds: all tasks except the same 30 Windows type diagnostics
passed, with no new diagnostic and byte-for-byte restoration of its incidental format changes. The existing HTTP
consumer fixture also emitted an asyncpg cancellation teardown diagnostic after pool closure; its assertions passed
and owned PG resources were stopped/removed, without claiming graceful-shutdown acceptance.
Independent review closed the demonstrated source and fixture findings. Canonical OpenAPI regenerated byte-identically
at 665,488 bytes / SHA-256 `cf999d5b9fd8bcdfe1b19ece108a6183a6a82c8545a574c1d0b87340b36e1419`; no SDK regeneration is needed.

The full-source rerun used a new isolated target copied from the untouched original snapshot. Both complete Banks
were imported and a deliberately lost import ACK recovered without redispatch. The consumer then failed after about
306 seconds of a long HTTP verification request. Native Global verification continued and completed its genuine
certificate, covering all 157 valid sources. The supervisor failed to stop on consumer exit; after Global completed,
the waiting Character lease expired and ordinary maintenance ran. Both targets are now stopped and retained. Neither
unknown derived changes nor the incorrect historical consumer outcome marker are accepted as proof. Complete
all-Bank certificate/reconciliation acceptance was not reached in that second run; the owner was informed of the monitoring failure.
The production HTTP transport and isolated supervisor corrections have since passed their focused/full tests and
independent review. The third full-source configured-model run (`654131f0175a`) passed on 2026-09-10 with frozen Taki
and native sources: 722 sources/units imported, all 701 valid sources consolidated, 21 invalidated units preserved,
20 Global and 69 Character consolidation batches plus one model step each completed. Native action receipts number
329 and 1084; complete certificate/evidence/raw reconciliation passed for both Banks, totaling 1944 snapshot records.
Both import and verification response loss recovered after SQLite reopen without replay. Production B4 readiness
passed after a further reopen, and source/B2/Canonical digests stayed unchanged. Consumer and supervisor exited 0;
all owned services stopped with no forced process termination, no remaining Job members and no cleanup error.
The actual targets/data remain retained. The 110 returned provider calls all reported HTTP 200 and complete usage,
totaling 1346264 tokens. The 950-file Taki and 324-file native manifests remained unchanged throughout the run.
See the Taki B4 `research/d78-real-data-validation-2026-09-09.md` report for exact artifacts and earlier failures.
This passes isolated actual-data acceptance, not production activation, manual semantic quality, D77/B6/B7 readiness,
maximum-envelope latency or the separately recorded whole-native Windows typecheck limitation.

Deployment must update all native writers coherently: an old writer does not honor the new fence. Stop/drain owned
maintenance before any rollback; dropping active ownership is not a safe recovery method. Prior transfer/proof data
remain intact, and the tested prior-head transition is a fixture result, not authorization to downgrade live storage.
The patch stays local because no upstream issue/PR or deployment was authorized. Retire it only when native upstream
provides equivalent durable import-to-seal coordination, late-result fencing and complete ordinary-worker coverage.

## Stage 3 backup proof and opt-in backup endpoint

| Patch ID | State | Class | Necessity and contract |
| --- | --- | --- | --- |
| `TAKI-HS-013` | Implemented; focused offline pytest on an owned embedded PostgreSQL passed; independent review and live acceptance open | `taki-policy` + `integration-plumbing` | Taki pairs a Core SQLite copy with a native whole-database backup and must prove that the pair is one recovery point (owner PR02, 2026-09-26: route c, a default-off endpoint callable with the existing API key; the ZIP stays on the native host). Native backup had no proof of lineage, Bank generations, cursors or receipt membership read in the same snapshot, and no way to run under an API key without shell/database access. A client-only reading could not bind these values to the exact ZIP snapshot. |

- Baseline: Hindsight `0.9.0` source `6a749ba3e7d8719e336d9d1d8735a8e09da4366b` plus the uncommitted local patch series above.
  Build identity stays `taki-memory-hindsight-0.9.0-d77-v1`: Taki Core admits exactly that build, so a bump would refuse
  every existing deployment until Core ships the new identity. Nothing existing changes: the endpoint is absent unless
  enabled and the CLI option is additive. Bump the build together with Taki when a change alters existing behavior.
  Taki task: `.trellis/tasks/09-25-hindsight-backup-restore` (`design.md` W5, `implement.md` Evidence W5).
- Proof: `admin/taki_backup.py` reads `read_backup_proof()` on the backup's own connection. It runs as the first
  statement of the REPEATABLE READ transaction that runs every COPY (`admin/cli.py` `_backup_on_connection()`), so proof
  and ZIP share one snapshot. It contains:
  - provider lineage;
  - the sorted `alembic_version` revisions;
  - upstream commit and compatibility build;
  - per requested live Bank in request order: generation, current and minimum cursors, and the D77 application cursors,
    or null;
  - receipt membership of the requested ids against Taki's pinned receipt map: `native-operation:` over
    `memory_native_operation_receipts`, `mutation-receipt:` over `memory_mutation_receipts`, `application-operation:`
    over `memory_application_operations`. Membership is scoped to the requested Banks and reports the exact count, the
    sha256 of the sorted unique ids joined by `\n`, the missing count and a sample of at most 16.
  The request model `TakiBackupRequest` mirrors Taki's Shared `HindsightBackupNativeRequestSchema` bounds (≤256 Banks,
  ≤1,000,000 printable-ASCII ids, unique).
- Manifest: `manifest.json` gains a top-level `taki` object: `{version: 1, backupId, proof, entries: [{name, bytes, sha256}]}`
  for every `<table>.bin`. The native manifest stays version `2`. `_restore` ignores the extra key, so a proof ZIP stays
  restorable by the native CLI (tested).
- CLI (route b): `hindsight-admin backup <out.zip> --schema <s> --taki-request native-request.json` validates the request,
  exiting 1 on invalid input, and writes the proof ZIP that Taki's `backup.admit` reads. Without the option, output is
  unchanged.
- Endpoint (route c): `api/taki_backup.py`, mounted in `api/http.py` under `/ext/taki-memory`.
  - `HINDSIGHT_API_TAKI_BACKUP_ENABLED` (default false) mounts nothing when off, so every path answers exactly like an
    absent route (404 `{"detail":"Not Found"}`).
  - When on, `HINDSIGHT_API_TAKI_BACKUP_DIR` is required: startup fails otherwise.
  - `POST /admin/backups` authenticates the tenant and requires the supported Taki build (401/503 like the other Taki
    routes). It then reads a byte-capped body (413) and validates it (422 `invalid_request`).
  - Single flight: it takes a database-wide `pg_try_advisory_lock` on the backup connection, so it also covers
    multi-worker and multi-process deployments sharing the database. A concurrent request gets 409 `backup_in_progress`.
  - It writes `taki-backup-<backupId>.zip` through an exclusive owner-only `.partial` file, then renames it; an existing
    target gets 409 `backup_exists`.
  - The ZIP's flush/fsync and manifest entry run in worker threads, off the event loop; the on-host test asserts it (F3).
  - It returns `{version, backupId, schema, proof, artifact: {location: "native-host", fileName, sha256, bytes}}`, never
    the ZIP.
  - `GET /admin/backups/{fileName}`, under the same gates, returns only `{fileName, sha256, bytes}`. A non-artifact name
    gets 422 `invalid_file_name`; a missing or non-regular file gets 404 `artifact_not_found`.
  - Refusals use `{"error": "taki_backup_refused", "reason": ...}`.
  - The backup dir is shared by all tenants of one deployment (Taki runs single-tenant); an authenticated tenant could
    read another tenant's ZIP digest, never its bytes.
- OpenAPI/SDK: both routers use `include_in_schema=False`. `generate_openapi_spec()` into a temp file is byte-identical
  to `hindsight-docs/static/openapi.json` with the flag off and on (sha256
  `582b83b3d8f85b783420546011bfb4431395f2c6e79e25d47b7cce7603dbb4f2`). No generated client or maintained wrapper changes.
  Taki calls the routes from its own Core client.
- Migrations: none. Physical backup/restore coverage is unchanged; portable transfer is untouched.
- Evidence (2026-09-27, offline `HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 LITELLM_LOCAL_MODEL_COST_MAP=True`, owned pg0
  instance created and removed by the run):
  - New `tests/test_taki_admin_backup.py`, 13 cases:
    - proof fields for live, deleted and absent Banks, the application cursors and exact receipt membership, including
      a present receipt of an unrequested Bank counted missing;
    - the bounded missing sample;
    - a write committed mid-backup is absent from both proof and ZIP, and the ZIP restored into a fresh schema re-reads
      an identical proof;
    - CLI request file writes `taki` entries matching every `.bin`, and an invalid request exits 1;
    - a plain backup has no `taki`;
    - the endpoint is absent by default, and enabling it without a directory fails at startup;
    - on-host backup plus digest read-back, and a repeat gets `backup_exists`;
    - single flight while another session holds the lock;
    - invalid, duplicate, bad-name, missing, wrong-key and oversized requests;
    - the routes are hidden from OpenAPI.
  - Together with `tests/test_admin_backup_restore.py` and `tests/test_taki_extension_contract.py`: 35 passed.
  - Scoped Ruff check/format and scoped ty pass on every changed file, and the full API Ruff check passes.
  - Whole-package `ty check hindsight_api` reports the unchanged 27 Windows/MLX baseline diagnostics, none in changed
    files.
- Not run:
  - the literal auto-fixing `scripts/hooks/lint.sh` (read-only equivalents above preserve unrelated files);
  - the full native pytest suite;
  - Oracle (unsupported: the proof and advisory lock are PostgreSQL-only, and the endpoint requires the supported
    PostgreSQL build);
  - a live deployment with the flag on;
  - the Taki W6 restore drill.
- Rollback: unset the flag, or remove the router and the CLI option; nothing persisted by native depends on them.
  Written ZIPs stay in the configured directory; retention is Taki D90. The patch stays local, since no upstream issue/PR
  is authorized. Retire it if native upstream ships an authenticated backup with an in-snapshot identity/receipt proof,
  or if Taki drops route c.

## Application-state snapshot serialization retry

| Patch ID | State | Class | Necessity and contract |
| --- | --- | --- | --- |
| `TAKI-HS-014` | Implemented; focused offline pytest on an owned embedded PostgreSQL passed; independent review open | `upstream-gap` (bug fix) | Hydrate and create-snapshot run in one REPEATABLE READ transaction that also writes body rows (`snapshot.create_bundle` → `store.save_body`). When a concurrent writer commits a row that transaction must write or lock, PostgreSQL aborts it with `SerializationError` (40001) and the route answered 500. The Taki W6 restore drill hit this once (run 6 step 5; run 7 passed). A client retry would repeat a whole HTTP round trip and classify a transient provider-side conflict as a provider failure; the conflict is local to one native transaction, so native retries it. |

- Baseline: Hindsight `0.9.0` source `6a749ba3e7d8719e336d9d1d8735a8e09da4366b` plus the uncommitted local patch series above.
  Build identity stays `taki-memory-hindsight-0.9.0-d77-v1`: this is a bug fix with no contract change (same routes,
  request/response shapes, status codes for every non-transient outcome, and persisted data). Taki task:
  `.trellis/tasks/09-25-hindsight-backup-restore` (`implement.md` W6 follow-up).
- Source: `engine/application_state/service.py`. `ApplicationStateService.run` now wraps the unchanged transaction body,
  moved to `_run_once`. Only REPEATABLE READ runs (`write=False`: hydrate, create/get snapshot, pages, changes, body/part
  and commit status reads) retry, and only on `asyncpg.SerializationError` / `asyncpg.DeadlockDetectedError`: 3 attempts
  in total, sleeping `0.05 s × attempt × uniform(0.5, 1.5)` between them. The last attempt's error surfaces unchanged, so
  a persistent conflict still reaches the route's existing error handling. READ COMMITTED write runs are not retried.
- Idempotency: each attempt acquires a fresh connection and transaction and builds a new store. The retried bodies
  (`snapshot.py`, `publication.py`, `store.py`, `logical_snapshot._load_snapshot_source`) act only through `store.conn`:
  no HTTP, filesystem, task submission, advisory lock, NOTIFY or other effect escapes the transaction before commit, so
  an aborted attempt leaves nothing behind.
- API/OpenAPI/SDK: none. Migrations: none. Backup/restore and portable transfer: untouched.
- Evidence (2026-09-27, offline `PYTHON_DOTENV_DISABLED=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
  LITELLM_LOCAL_MODEL_COST_MAP=True HINDSIGHT_API_LLM_PROVIDER=mock`, owned pg0 instance created and removed by the run):
  - New `tests/test_taki_application_state_retry.py`, 3 cases on a throwaway table, each attempt fixing its view and then
    updating a row another connection has just committed:
    - one forced serialization failure retries and commits exactly once (attempts `[1, 2]`, value `101`);
    - a persistent failure raises `SerializationError` after exactly 3 attempts, with no write from any aborted attempt;
    - a write run with a forced `SerializationError` is attempted once.
  - With `_SNAPSHOT_ATTEMPTS = 1` temporarily set, the first two cases fail and the third passes; restored afterwards.
  - Together with `tests/native_results/` `test_application_state.py`, `test_application_api.py`,
    `test_application_bodies.py`, `test_application_codec.py`, `test_d77_review_binding_guards.py`,
    `test_d77_runtime_consumer.py` and `test_application_reflect.py`: 50 passed, 1 skipped.
  - Scoped Ruff check/format and `ty check --python ../.venv` pass on both changed files; the full API Ruff check passes.
- Not run: `test_application_openapi.py`, `test_application_backup.py`, the full native pytest suite, Oracle (the
  application-state service is PostgreSQL-only), a live deployment.
- Rollback: restore the single-attempt `run`; nothing persisted depends on the retry. The patch stays local, since no
  upstream issue/PR is authorized. Retire it if native upstream retries or restructures these snapshot transactions, or
  if hydrate/snapshot stop writing inside the REPEATABLE READ transaction.

## Repeated-transition publication fence and baseline protocol

| Patch ID | State | Class | Necessity and contract |
| --- | --- | --- | --- |
| `TAKI-HS-015` | Implemented; automated wave checks complete; independent W2 review pending | `taki-policy` + `integration-plumbing` | Repeated healthy authority transitions need a durable all-supported-writer publication fence, finite native maintenance and paired application proof, and verified used-Bank delta re-entry. D78's finite maintenance lease and first-import result cannot establish these guarantees. |

- Baseline: source `6a749ba3e7d8719e336d9d1d8735a8e09da4366b` with the existing local
  patch series; prior migration head `d77a4f8c2e10`, new head `e30a9d7f6c21`.
- Implemented protocol: independently probed `taki-transition-v1`, with authenticated
  identity-bound acquire/lookup/claim/final-proof/outcome history. Executor TTL
  expiration never releases a transition fence. Proven abort and committed
  retirement are distinct durable outcomes; recovery cannot repeat an effect.
- A client-only fence cannot stop native HTTP/MCP, control-plane, maintenance,
  background or application writers. Enforcement belongs at their SQL publication
  boundary, using the existing Bank cursor/owner order and explicit accepted-work
  drain. Privileged raw administration is outside the supported writer contract.
- Implemented seams: native Bank coordination, current maintenance evidence producers,
  D77 paired snapshot/commit, a separate baseline-guarded delta writer, compatibility
  manifest/routes, additive migration and backup table inventory, generated clients.
  D78 initial-import admission and all existing receipts remain intact.
- Build `taki-memory-hindsight-0.9.0-transitions-v1` advertises `transitions` 1.0.0 separately.
  Migration `e30a9d7f6c21` follows D77. `engine/transition_*.py` owns fencing, exact
  history, finite maintenance, original-preserving application rebinding and paired
  certificates; `engine/transfer/transition_delta*.py` owns the complete-descriptor
  atomic native/application delta. `api/taki_transitions.py` exposes twelve typed
  authenticated operations. The compatibility module, MemoryEngine and backup
  inventory compose these producers without changing old D78/D77 admission rules.
- Genuinely new scopes require a non-backfilled durable Bank creation marker,
  never-reset usage/deletion evidence and complete matching template history. They
  consume an independent unused-scope proof; a currently empty used Bank refuses.
  No synthetic exit, first-activation transfer or Core authority receipt is created.
- Independent W2 review adds `engine/transition_initialization.py` and append-only
  `memory_transition_initializations` provenance for the actual B3/default-template
  producer's refreshes. Only its complete birth/import/operation/live-worker/history/
  output chain permits the allowed initialization footprint. Ordinary interleaved
  use remains sticky; old/missing histories are never backfilled. The ledger is
  included in capability detection, final auxiliary evidence and exact physical restore.
- All queue admissions check inherited writer/executor revocation even after a Bank
  becomes active/aborted. ID-only single/bulk deletion registers sorted per-Bank
  identities spanning its original transaction and post-commit children. Repeated
  live verification cannot start a second pass under the same executor; exact
  generation takeover and immutable proof recovery remain separate operations.
  See Taki `research/w2-independent-check.md` in the current transition task for
  the independent findings, new validation and final source hashes.
- A proven no-effect re-entry abort restores the old retired fence or holds an unused
  scope for exact retry. Applied/unknown staged effects cannot become a terminal abort;
  their original executor identity remains recoverable. Downgrade refuses retained
  transition/creation evidence. Ordinary administrative backup/restore is separately
  gated and privileged raw administration is outside the supported writer contract.
- `admin/transition_restore.py` scopes table-owner trigger suspension to the existing
  offline `_restore` transaction. It preserves exact origin/fence/history/proof rows,
  validates deferred FKs and restores original trigger modes before commit; failure
  rolls back data and DDL. Existing pre-e30 archives retain absent birth history,
  so restored old empty Banks cannot become new unused scopes. There is no API exemption.
- Canonical OpenAPI and Python/TypeScript/Go/Rust clients are generated with the
  pinned repository tools; named nullable unions retain the original wire shape.
  Maintained wrappers and unrelated control-plane CLI bytes remain protected.
  The exact scope, failed-to-passing PG/SDK cases, Core original projection and
  remaining independent-review gate are recorded in Taki
  `09-29-hindsight-transitions-emergency/research/w2-implementation.md`.
- Final affected backup regression: owned PostgreSQL run `7e117e93b43fb4d0`,
  28 passed in 99.58 seconds, exit 0/stopped. The earlier integrated run had
  271 passed / 104 non-applicable CONCURRENTLY migration cases skipped / two
  backup failures; the failures were corrected and are included in this final
  backup run. Actual HTTP-to-Core group `5be9388d48b7` passed three cases.
  Canonical repeat generation `440a699736c2` reproduced all 740 compared files;
  Python 98, TypeScript 39 and Rust 5 offline contracts passed; exact Go offline
  selectors passed. Core 110 and Shared 66 focused checks and root lint/typecheck
  passed. Native API Ruff passed; scoped types passed, while full Windows type
  checking retains 27 unrelated MLX/Unix-platform diagnostics. One pre-existing
  curation-test formatting gap is preserved. These are bounded automated checks,
  not full native suite, model quality, live deployment or owner acceptance.
- No upstream issue, publication or deployment is authorized. Retire only when
  upstream provides equivalent durable publication ownership, paired final proof,
  identity-preserving baseline delta and exact historical outcome recovery.

## Transition Source evidence and retained historical references

| Patch ID | State | Class | Necessity and contract |
| --- | --- | --- | --- |
| `TAKI-HS-016` | Implemented; W3 scoped automated gates complete; independent W3 review pending | `integration-plumbing` + `taki-policy` | Re-entry must preserve append-fragment Source bytes, exact ordered historical Source references and genuinely retired supporting units without replacing the physical native document or inventing live facts. |

- Baseline: source `6a749ba3e7d8719e336d9d1d8735a8e09da4366b` plus independently reviewed W2 local changes.
  Build remains `taki-memory-hindsight-0.9.0-transitions-v1`; the additive capability is independently advertised as
  `contracts.transition_source_evidence.version=1.0.0`. Dependency probing covers the actual upload and selector paths.
  Old transition/D77/D78 variants, wire hashes, receipt identities and ordinary writer fences retain their meaning.
- A client-only patch cannot publish original bytes while the Bank is transition-fenced, nor atomically resolve
  same-delta Source versions. `engine/transition_source_{models,upload}.py`, `transition_api_service.py`,
  `memory_engine.py` and `api/taki_transitions.py` implement narrow authenticated executor-owned prepare/part/seal
  routes. Every stage validates exact Bank/namespace/executor/phase; a proven transition refuses further uploads.
  No ordinary D77 upload exemption is introduced.
- `engine/transfer/transition_{delta_models,source_evidence,source_references}.py` add `source_evidence` (sealed
  original `application-source.v1` BodyRef plus exact physical TargetWitness) and `memory_evidence` (exact existing
  ArtifactVersion or Source explicitly upserted by this delta). Selection preserves order, multiplicity and two
  versions of one key. An available historical non-tombstoned revision stays valid after its latest head retires.
  Missing/foreign/hash-mismatched/undeclared selectors refuse without logical effects.
- `engine/application_state/{models,source_evidence,store,commits,snapshot}.py` and
  `engine/transition_application_rebind.py` consume `application-source-evidence.v1` with nested original bytes,
  previous artifact/body evidence and actual association. Alias-only edits do not rewrite whole-document payloads;
  retiring the head-bound alias preserves the document, surviving aliases and historical references. Ordinary
  snapshot/event/hydration/replica/reflect consumers retain nested closure; association-only rebind preserves bytes.
- `engine/transfer/transition_delta_{history,preflight,application}.py` validate inherited deleted-unit references
  against the exact original referrer, retained native journal/tombstone and namespace/baseline. They admit only
  proven historical identities, without broadening the complete live descriptor set or resurrecting deleted facts.
- No new native migration/table is required; native head stays `e30a9d7f6c21`. Existing byte-body and artifact history
  tables remain the storage source. Real full-table physical backup/restore retains the new body and pinned history.
  This adds no portable-transfer or Oracle support claim; the existing PostgreSQL compatibility boundary remains.
- Canonical OpenAPI and Python/TypeScript/Go/Rust assets were generated by the pinned pipeline in owned run
  `97f9a4800627`; generator, Go/Rust builds and the TypeScript CJS/ESM/DTS build passed. Maintained wrappers and module
  manifests are unchanged. An overbroad final Ruff selection touched 17 generated Python paths; those were restored
  from that saved canonical output, then the entire generated Python tree compared equal byte-for-byte. Generated
  files were not hand-fixed to satisfy native source lint.
- Native latest affected run `620fe484870c`: three real PostgreSQL tests passed in 88.80 seconds, including two actual
  historical-reference cycles, Source edit/retire/full physical restore, and strengthened Core HTTP alias consumption
  with an independent native artifact-to-unit/version oracle. Fixture stopped; data and registry removed. Earlier
  source-refusal/awaiting-proof run `e67de9d16c88` had four passes and one multipart-fixture failure; its corrected
  stale-upload case passed in `f9316fbe5912`. Earlier failed/interrupted fixtures remain evidence, not passing counts.
- W3-owned native source/test Ruff/format/compile (23 Python paths) and configured production `ty` (18 paths) passed.
  No full-native type/suite claim: earlier Windows/MLX/Unix diagnostics remain outside this scope. Taki root types and
  latest affected Core 48 tests passed; root lint exits 1 solely for a cohesive 51-line function under the owner's
  explicit minor line-limit exception. See the W3 report for all commands, isolation and source ownership hashes.
- Rollback is pre-publication only. Once new Source evidence/history exists, retain a capable reader and the original
  immutable evidence; do not downgrade by deleting history or replacing authority. W3 supplies candidates only;
  W4/W5 publication and the real-corpus journey remain separately gated. No upstream issue/PR or deployment was
  authorized. Retire this local patch only when upstream supports equivalent fenced byte upload, exact historical/
  same-delta selectors and complete nested Source closure with preservation evidence.

## Indexed transition association ownership lookup

| Patch ID | State | Class | Necessity and contract |
| --- | --- | --- | --- |
| `TAKI-HS-017` | Implemented; owned-PG correctness gates passed; independent review and migrated-clone performance open | `upstream-gap` + `integration-plumbing` | The row publication guard casts indexed endpoint UUID columns to text, scanning live/archive/entity tables per association row. Compare native UUID columns to typed JSON endpoint UUIDs while preserving the exact sorted OLD/NEW Bank set and all publication fences. |

- Baseline: the maintained `0.9.0` / `taki-memory-hindsight-0.9.0-transitions-v1` source, migration head
  `e30a9d7f6c21` (source SHA256 `3a310b19a4e6de34a0a9eb7935992105f90df21a0717e96fd6aad9834f9e6433`).
  New revision `e40b1e8a7d32` replaces only `guard_transition_association_write()`; the historical migration is immutable.
- A client-side change cannot alter this stored SQL boundary. Keep the same enabled row triggers, direct Bank,
  live/archive/entity endpoint union, sorted distinct OLD/NEW ownership, publication calls, locks and permits.
  Missing/JSON-null fields remain SQL NULL; the nullable legacy `memory_links.entity_id` remains covered.
- PostgreSQL-only dialect dispatch is deliberate, matching the existing transition protocol. No new tables/indexes,
  API/OpenAPI fields, SDK/client code, backup table inventory or portable data formats are required. Build and wire
  versions remain unchanged; the stored migration revision and function definition identify the operational repair.
- The new revision's downgrade restores the old function only. Never invoke the historical e30 downgrade on retained
  transition history. Tests may exercise e40-to-e30 on newly owned fixtures; working-pair rollback is separately reviewed.
- Source replacement is insufficient for a DB running the old function. Parent-controlled fresh-clone rehearsal must
  explicitly apply e30-to-e40, verify revision/function/trigger identity and every retained row before apply; a later
  working-pair migration needs the independent gate and its own review. Normal supervisor policy is unchanged.
- The V3 read-only diagnostic preserved all sources and found equal Bank sets in 8 cases. Single-link lookup changed
  from 259 to 8 shared-hit blocks and 0.860 to 0.119 ms. No actual entity-association samples were present, all plans
  had zero shared reads, and full trigger/DELETE/full-apply savings were not measured. This remains a local patch;
  no upstream publication is authorized. Retire it only when an upstream migration preserves the same contract.
- Correctness: 40 actual association cases passed; public/tenant e30-to-e40, e40-only rollback and re-upgrade passed
  with nonempty original transition history, unchanged function OID/attributes, other functions, triggers/indexes,
  table/materialized-view contents and sequence state. Existing focused fence/integrity/derived-link/backup/apply
  plus migration-shape yielded 252 passes / 105 non-applicable shape skips. Fixture setup failures are retained
  separately; the final two migration cases passed in 17.23 seconds. All four owned PG runs stopped and cleaned up.
- Scoped Native/helper types, Ruff/format and captured-SQL audit passed. The parent-only fresh-clone helper is
  delivered but unexecuted. Exact commands, failed fixture corrections, final source footprint and remaining gates
  are recorded in the Taki task `09-29-hindsight-transitions-emergency/research/w5-trigger-uuid-implementation.md`.

## Required record for each new patch

Before production changes, record the necessity, proposed direction and affected seams. Before acceptance, replace
planned fields with the verified final footprint:

1. Stable patch ID, class, native baseline and compatibility/build version.
2. User-visible contract or failure fixed; why a client-only adaptation is insufficient where a provider change is needed.
3. Exact source symbols/files, API/OpenAPI fields, migrations, backup/restore and portable-transfer treatment.
4. Generated SDK and maintained wrapper/proxy effects; no hand-edited generated drift.
5. Focused failing-to-passing evidence and final test/type/lint/generation commands, with unrun live/platform gates explicit.
6. Data/behavior compatibility, rollback constraints and known unsupported backends.
7. Upstream issue/PR if authorized, or why the patch remains local; specific triggers to replace or retire it.

## Upstream update checklist

Use this list when an upstream update is separately undertaken; this follow-up does not perform a rebase or live upgrade.

1. Record the candidate upstream tag/commit, package/API version and migration heads. Compare each patch with native
   support and classify it as retained, replaced-by-upstream or retired; do not drop a local guarantee by assumption.
2. Map conflicts by the inventory's source/API/migration hotspots. Preserve shipped migration identities, Bank lineage,
   operation receipts and checkpoint meaning; add new transitions instead of rewriting accepted history.
3. Revalidate exact writer coverage and transaction boundaries. For recovery evidence, include native-commit/enqueue
   interruption, task deduplication/retry, concurrent append, lost acknowledgements, pruning and generation changes.
4. Regenerate canonical OpenAPI and every maintained generated client with the repository scripts. Verify TypeScript/
   Python wrapper parity and relevant control-plane proxies; preserve Go module manifests and maintained wrappers.
5. Run affected migration/DAG/dialect and backup/restore coverage, focused native regressions, contract/client checks,
   lint/type checks and reproducibility/whitespace checks. Keep standalone shell entrypoints LF on Windows builds.
6. Advertise support only for the exact represented contracts that passed. Record remaining live/provider/manual
   acceptance separately; a healthy server or passing mock alone does not authorize an authority switch.

## Relevant maintenance entry points

- [Compatibility manifest](hindsight-api-slim/hindsight_api/engine/taki_compatibility.py)
- [Taki extension routes](hindsight-api-slim/hindsight_api/extensions/builtin/taki_memory.py)
- [Logical journal](hindsight-api-slim/hindsight_api/engine/replication.py)
- [Logical snapshot](hindsight-api-slim/hindsight_api/engine/logical_snapshot.py)
- [Taki backup proof](hindsight-api-slim/hindsight_api/admin/taki_backup.py) and [opt-in backup endpoint](hindsight-api-slim/hindsight_api/api/taki_backup.py)
- [Database migrations](hindsight-api-slim/hindsight_api/alembic/versions/)
- [OpenAPI generator](scripts/generate-openapi.sh) and [client generator](scripts/generate-clients.sh)
- [Provider coding/review standards](.claude/skills/code-review/SKILL.md)
