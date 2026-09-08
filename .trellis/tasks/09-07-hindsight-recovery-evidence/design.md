# Hindsight Recovery Evidence - Selected G1 Design

## Status and sources

The owner approved continuation once technically ready. The source review supports implementation of routine native
result/append recovery with durable part receipts, preserving native streaming. G1 allows a factual write to settle
after reliable native-result proof and local application; observation/model work continues independently. Initial
activation and a healthy return to Local keep their separate completeness gates.

Primary implementation sources:

- [Confirmed decisions and prior-grill index](grill.md).
- [Minimum G1 producer protocol](research/g1-native-result-protocol.md), including exact native transaction/extraction seams.
- [Taki consumer transitions and field map](research/g1-taki-consumer-and-field-map.md).
- [Reviewed B5 baseline](../08-09-memory-replica-sync-recovery/research/wave-3-review-2026-09-07.md).
- [Earlier design snapshot](research/design-before-g1-implementation-2026-09-07.md), historical comparison only.

Baselines remain Taki `c3f8bc4` plus reviewed Wave 3 changes and Hindsight `7eca2056` / API package `0.9.0`.
Preserve prior work and the unrelated control-plane `bin/cli.js` edit. No live/user-data activation is implied.

## 1. Integration boundary

Taki owns the canonical adapter, Pending Memory transitions and replica checkpoint verification. Hindsight owns
semantic extraction, native append/JSON assembly, chunking, delta selection, embeddings, factual publication and
background maintenance. Keep native public retain parameters and Control Plane proxies unchanged.

Expose tracked operations in the existing `/ext/taki-memory` module, with engine-owned typed methods and minimal
optional transaction/extraction contexts in native code. Reuse native request normalization, validation, authentication
and parent/child queue submission; extract shared helpers where required instead of calling HTTP handlers internally
or copying a second memory engine. Existing untracked behavior stays compatible.

The approximately 20-file per-write source/MM design is superseded as the routine plan. There is no new per-write
derived work graph, model refresh trigger, general scheduler, or whole-document atomic buffering/input cap.

## 2. Public native-result contract

Use typed extension routes, matching existing route/error conventions:

| Route | Purpose |
| --- | --- |
| `POST /ext/taki-memory/banks/{bank_id}/retains` | Idempotent tracked native async retain admission. |
| `PATCH /ext/taki-memory/banks/{bank_id}/memories/{memory_id}` | Tracked native conditional mutation using the existing CAS/receipt path. |
| `GET /ext/taki-memory/banks/{bank_id}/native-results/{kind}/{operation_id}` | Read durable status and the sealed result manifest; never execute work. |
| `GET .../{kind}/{operation_id}/results/{result_hash}/pages/{page_number}` | Read immutable, bounded full-result reference pages. |

A tracked command includes the contract version, original native UUID, expected provider lineage and Bank generation,
and the normalized native input. Bank identity also comes from the path. The engine authenticates and verifies the
existing generation; old workers cannot lazily recreate a retired Bank. Native differing-payload UUID replay stays
unchanged for untracked calls; tracked UUID/payload conflicts are refused before publication.

The public result separates mutable execution progress from immutable result evidence. Bind kind/UUID, Bank lineage/
generation, normalized request hash, actual prepared-input hash, native outcome, document/update-mode identities,
created-count versus full-result-count, immutable manifest/result/receipt hashes and the native factual cursor.
Full retain references include identity, revision and lifecycle, with deterministic ordinals. No source text,
credentials, private prepared body or raw worker error escapes through receipts or logs.

Freeze exact typed wire models and compatibility constants in the first implementation slice. Advertise an independent
native-result capability only for the tested schema/build/backend; do not advertise per-write derived completion.
Regenerate canonical OpenAPI and all maintained SDK families. Add extension methods to Python/TypeScript wrappers;
existing native retain options/proxies need no new parameter.

## 3. Portable identity and durable admission

Use a versioned, dependency-free serialization for producer hashes: fixed ordered typed fields, explicit normalized
null/default/UUID/time values, preserved array order, and string-map pairs ordered by UTF-8 bytes. Reject invalid
Unicode rather than changing its meaning. Avoid untyped float serialization. Test numeric-looking keys, non-BMP/BMP
ordering, Unicode, defaults and omission in both Python and TypeScript.

Keep producer request, prepared-input, result and native-receipt hashes distinct from Taki's frozen local intent and
receipt-envelope hashes. Existing JavaScript canonicalJson is not automatically Python sort_keys JSON. An echoed
client digest is not producer evidence.

Persist the tracked request claim and fixed original-input/native-child association in the existing admission
transaction. Save generated document identities and complete native child payloads before acknowledging. Notify the
existing backend after commit. Queue pruning or child deletion cannot shrink the required input set.

Exact tracked retries return a sealed result or resume the recorded incomplete native operation. Taki must durably
record which dispatch contract it selected before dispatch, so a restart cannot treat an old untracked UUID as a new
safe tracked retry. An existing untracked operation without proof is not retroactively admitted.

## 4. Native streaming preparation and part receipts

Persist the actual native prepared append input before the first canonical write: stable original input/document,
combined body including JSON-array behavior, source base witness, resolved non-secret settings and deterministic
outer-slice/global chunk plan. Preserve full-body overrides and offsets for oversized native input. Never prepend the
fragment again on restart.

Use exact part identities including original input, preparation generation and global chunk ordinal. Repeated text
hashes are not the same part. Explicitly represent successful zero-fact parts, metadata/no-op and delta survivor
coverage. Uncommitted extraction may repeat; committed factual parts must not.

At each existing factual transaction:

1. Acquire Bank, receipt/attempt and document locks in a fixed documented order. Verify lineage/generation, task/
   execution generation, cancellation and the prepared compatible-state witness before native writes.
2. Skip already committed exact parts. Apply native fact/chunk/link/cleanup behavior for remaining parts.
3. Publish the ordinary logical journal and record that commit's part evidence on the same connection/transaction.
4. Update exact coverage and compatible-state witness. The transaction completing the declared input seals the full
   live/archive source manifest and factual boundary before releasing locks.

Do not use is_last, best-effort debug metadata, task disappearance, empty queue or current document hash as coverage
proof. Preserve native partial publication: only a complete sealed result can settle G1 recovery. On competing
takeover before any part, safe re-preparation may occur under the same UUID; after committed parts, preserve their
evidence and report the unresolved partial/conflicting outcome. Never fake completion, describe it as wholly
unapplied, erase history, or repeat the fragment automatically. Independent operations continue.

The producer base witness must detect same-content replacement and relevant source curation/lifecycle changes while
excluding harmless consolidation-only marker changes. A deterministic SQL-row digest is the initial no-new-column
approach; measure it and change the mechanism only with source/test evidence.

Native provider Batch API needs a typed tracked error outcome and per-part request/checkpoint identity. Its existing
error-to-zero and operation-wide batch checkpoint behavior cannot certify successful zero extraction. Reuse native
submission/parsing/modes, and keep these stricter evidence semantics opt-in.

A sealed-result retry must still preserve the native post-write maintenance tail without repeating extraction or
factual writes. G1 does not wait for, replace or reschedule that maintenance.

## 5. Conditional mutation and storage

Reuse the existing mutation fingerprint/CAS/unique claim and original result. Record the returned journal last_cursor
and original native result in the common receipt on that same transaction. An actual no-op seals an explicit unchanged
outcome with its locked boundary; never manufacture an empty journal batch. Later target edits/deletion do not rewrite
the earlier result. Old mutation receipts without an original cursor stay readable but do not gain today's cursor.

Add one forward, dialect-dispatched migration after the verified current head with two focused stores:

- Native operation receipts: generation/kind/UUID uniqueness, normalized request identity, fixed input/child set,
  typed private prepared plan, execution generation, progress, immutable result manifest and factual cursor.
- Retain-part receipts: exact preparation/input/part identity, typed extraction checkpoint/outcome, committed source
  references, cursor and compatible post-part witness.

No FK to prunable tasks or removable source rows. Keep admitted identity/results for the supported Bank-generation
lifetime. Remove private preparation when no longer needed for resume. Data clear/document deletion cannot silently
erase replay identity; Bank retirement fences old work before lifetime cleanup. Physical backup/restore preserves
coherent receipt/part/queue/lineage state; portable transfer excludes execution/replay history.

Initial proof support remains PostgreSQL with SQL-row document storage. Unsupported Oracle/external storage must fail
closed in capability/admission. Do not silently enable native document-text retention to make append possible.

## 6. Taki integration and compatibility

Preserve immutable intent hashes, original request times/UUIDs, Authority/Bank guards, leases, single deadline,
same-lease reset, receipt-first mutation replay and independent rows/Banks. The selected routine sequence is:

1. Verify admission and apply the first authoritative pull.
2. Safely dispatch/resume the original tracked operation and obtain its reliable native result.
3. Validate every required immutable result page, ordinals/counts and aggregate hashes against that operation.
4. Apply journal pages through the factual boundary and confirm the pending write transactionally against the actual
   persisted matching checkpoint. A failed second pull preserves native proof for the next attempt.
5. Synchronize later derived writes normally; derived freshness uses actual producer data or remains unknown.

Use an explicitly versioned compact native-result receipt for large full-result manifests; keep old inline <=256
receipts readable. Existing request/response <=512 KiB and durable state <=2 MiB bounds remain. Do not silently
truncate results or turn the inline limit into a new native append-size restriction.

Old queued/untracked/submitted/native-success/completed rows need tested, explicit transition rules. Do not default
an old receipt into stronger proof or blindly mark all awaiting_derived rows complete. If a new SQL phase is needed,
append a migration after checking current/parallel registries; otherwise prove JSON-only evolution preserves old
rows and identities. Do not rewrite migration 035.

Canonical field alignment already covers public logical sources/facts/models/directives; top-level snake/camel
mapping must preserve opaque nested keys. The consumer field-map report records the non-string metadata encoding
ambiguity and B4/B6-owned policy/provenance/retained-text binding. Resolve exact mappings in the appropriate adapter
slice; do not claim whole-product interoperability from the routine recovery implementation alone.

## 7. Independent cutover gate

Initial activation and a healthy return to Local still require complete current-Local/import coverage, required
source/model maintenance evidence, immutable manifest/reconciliation and the final Authority fence. Zero pending
writes and routine receipt tests cannot satisfy that gate.

Reuse source/version and model-input/outcome seams only for the explicit cutover operation. The current native
markers/watermarks are useful but are not yet a complete gate; the producer report identifies the missing consumed
source versions and model definition/scope/outcome coverage. Keep this as a separately verified slice after routine
recovery. Do not impose it on each pending write or claim B4/B6/live activation complete.

The completed [independent cutover research](research/g1-cutover-evidence-contract.md) now specifies the finite
candidate/input/outcome certificate, distinguishes initial activation from healthy switch-back, and identifies the
source-fence recovery requirements. It is a proposal for the independent slice, not an implemented capability or
an instruction to extend routine G1. In particular, old model watermarks and missing lifecycle coverage do not gain
proof by widening a recall window. Explicit cutover input changes and durable all-writer fencing require their own
implementation/review; they are not bundled into the routine completion guarantee.

## 8. Implementation and verification gates

The expected routine surface is seven existing provider modules, two focused new responsibilities and one migration,
plus Taki integration, tests and generated clients. File splits may follow actual responsibility; this is not a LOC
target. Root owns the plan/ledger; the implementer owns provider and Taki code within the assigned slice.

First prove native transaction/rollback, tracked UUID mismatch, lost ACK/pruning, stable append preparation,
zero/error/duplicate chunks, outer slicing, full/delta survivors, Batch API checkpoints, concurrency/attempt fencing
and immutable manifest paging. Use real isolated PostgreSQL transactions with controlled extraction/embedding/Batch
API fixtures. Then prove actual Taki HTTP-to-SQLite recovery and old-row reopen, and run affected suites/types/lint/
migration/backup/OpenAPI/SDK checks. Independent review follows the complete routine slice.

The existing bundled pg0 PostgreSQL 18.1 with vector/pg_trgm passed a clean, isolated probe and was stopped/cleaned.
Tests must disable dotenv loading, avoid inherited credentials/current DB URLs, and use only explicitly owned fixture
instances. Docker is not currently running; source/test implementation can proceed without a live Hindsight service.

No new dependencies, user data, live provider/LLM calls, authority activation, Git staging/commit/push or task archival
is authorized by this offline implementation. Preserve the protected legacy backup and unrelated worktrees.
