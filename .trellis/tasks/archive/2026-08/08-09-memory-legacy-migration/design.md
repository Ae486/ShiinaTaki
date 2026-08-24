# Batch 2 Legacy Normalization and Local Cutover Design

## 1. Boundaries

The migration owns legacy filesystem discovery, immutable snapshotting, normalization, deterministic identities,
Hindsight-ready payload construction, ledger persistence, canonical staging, completeness verification, and the Local
authority activation marker. Batch 1 owns canonical schemas/repositories/provider semantics. Parent Batches 3/4 own
Hindsight connection/import and Hindsight authority. Legacy Markdown remains authority until activation commits.

No Hindsight private schema, HTTP field, Bank creation, or remote operation is copied into this design.

## 2. Components and interfaces

Keep modules under repository small-file conventions:

The `legacy-migration/*` modules are an on-demand operator/offline package. They are not imported into canonical Local
startup or ordinary retain/recall/mutation/assembly/background-maintenance dependency graphs.

- `packages/core/src/memory/legacy-migration/legacy-source-normalizer.ts`: bytes -> normalized source or exception.
- `legacy-format-variants.ts`: supported syntax matrix and raw evidence capture.
- `legacy-retain-sanitizer.ts`: deterministic credential/hidden-envelope refusal plus an explicit policy for ordinary
  emails and phone numbers; it must not silently erase intentionally stored user text without a recorded rule.
- `legacy-identities.ts`: domain-separated SHA-256 identity derivations.
- `legacy-snapshot.ts`: read-only snapshot manifest and byte-copy strategy.
- `legacy-migration-ledger-repo.ts`: durable phase, attempt, diagnostic, exclusion, and result persistence.
- `legacy-migration-runner.ts`: operator-invoked offline dry-run, stage, verify, resume orchestration; excluded from
  normal startup and runtime memory paths.
- `legacy-canonical-converter.ts`: normalized entry/Block -> canonical data and Hindsight-ready payload.
- `legacy-canonical-import-repo.ts`: migration-only deterministic source/unit/Block importer. It may use Batch 1
  schema/repository primitives for validation, but it does not call public Local `retain`: that API creates random
  memory IDs, requires at least one unit, and applies ordinary runtime replacement semantics.
- `legacy-activation-repo.ts`: one runtime-selection marker read and one activation transaction.
- `canonical-local-runtime.ts`: the production canonical Local runtime selected after activation; it has no Markdown
  dependency. The migration converter/importer is not retained inside this runtime.

The safe operator trigger is an operator-only Core method family (likely
`packages/core/src/server/methods/memory-migration.ts` with shared params/result additions beside
`packages/shared/src/memory-schema.ts`), not a UI. `dry-run` returns a non-durable report ID; asynchronous `stage`
returns the durable run ID, phase, and counts. `status`, `verify`, paginated `exceptions`, explicit `exclude`, and
`activate` are follow-up actions.
The method never returns memory or Block content. Only the operator-only paginated exception method may return a
snapshot-relative path. Activation refuses a caller-supplied authority/provider identity and uses only the persisted
verified run, prepared Local epoch, and lease fencing token.

The trigger is an offline/resumable migration and audit capability, not a resident compatibility adapter. It is not
constructed by normal startup, retain, recall, mutation, assembly, or background maintenance. After activation, normal
runtime exposes only canonical Local operations; preserved Markdown is read-only evidence for explicit operator review.

Illustrative internal types (exact Zod schemas are implementation deliverables):

```ts
type SourceDisposition = "pending" | "normalized" | "staged" | "verified" | "converted-zero" |
  "converted-one" | "converted-many" | "excluded" | "failed";
type LedgerPhase = "discovered" | "snapshotted" | "normalized" | "staged" | "verified" | "activated";
interface LegacySourceRef { sourceId: string; relativePath: string; rawSha256: string; snapshotId: string; kind: "entry" | "block"; }
interface LedgerRow {
  source: LegacySourceRef; phase: LedgerPhase; disposition: SourceDisposition;
  attempts: number; diagnostics: string[]; excludedAt: string | null; exclusionReason: string | null;
  canonicalSourceId: string | null; documentId: string | null; operationId: string | null;
  resultCount: number; resultMemoryIds: string[]; updatedAt: string;
}
```

The row permits zero IDs and many IDs; `resultCount` is persisted separately and must equal the result-row count.
`converted-zero|one|many` and `excluded` are cutover-resolved. `failed` is a durable blocking state, not successful
terminality: retry increments the per-source attempt number and resumes from the earliest safe phase, while exclusion
is the only operator action that waives it. Terminality is never inferred from source/fact count equality.

## 2.1 Persisted migration and authority state

Batch 2 adds additive SQLite state (exact table names may follow the repository naming convention, but these columns and
constraints are required):

- `memory_migration_runs`: `run_id` PK, `snapshot_id`, prepared Local `epoch_id`, phase/status, requested/updated time,
  `lease_owner`, monotonically increasing `lease_fence`, `lease_expires_at`, verified manifest/readiness digests,
  activation transaction ID, and bounded activation state. A partial unique index permits at most one non-terminal run; every mutating
  statement compares the current `lease_fence`, so an expired worker cannot resume and commit after another owner.
- `memory_migration_sources`: `(run_id, source_id)` PK, kind, canonical relative path, raw SHA-256, byte length,
  normalized/content hashes, current phase/disposition, canonical source/document/operation IDs, explicit
  `result_count`, duplicate-evidence relation, exclusion reference, and timestamps. Raw text is not duplicated in
  SQLite. The same exact source may appear in a later audit run without colliding with prior run history.
- `memory_migration_attempts`: `(run_id, source_id, attempt_no)` PK, phase, lease fence, started/finished timestamps,
  one closed diagnostic code, and sanitized detail bounded to the shared 512-character error limit.
- `memory_migration_results`: `(run_id, source_id, result_ordinal)` PK, one canonical memory ID per result row, revision,
  and result payload hash. Ordinals are contiguous from zero; zero rows plus `result_count=0` means `converted-zero`.
- `memory_migration_exclusions`: `(run_id, source_id)` PK, immutable snapshot ID/raw hash/path identity, bounded reason,
  operator actor, and created time. A later run never inherits a waiver implicitly; a byte or path change creates
  another source ID and cannot inherit the old decision.
- `memory_authority_selection`: singleton `mode` (`legacy-markdown` or `canonical-local`), active epoch ID nullable,
  verified snapshot ID nullable, activation transaction ID nullable, and updated time. The mode is the runtime authority
  truth; canonical staging may have a Local epoch while this row still says `legacy-markdown`.
- `memory_migration_activation_receipts`: one immutable receipt per committed activation, keyed by run/transaction ID,
  containing the verified snapshot/readiness digests, epoch, lease fence, committed time, and marker mode. Startup uses
  the singleton selection for routing and the receipt for audit/recovery proof.

Migration 021 inserts the singleton selection as `legacy-markdown`; once schema version 21 is present, a missing or
malformed row is an integrity failure. Stage may call the Batch 1 explicit factory once to initialize one Local epoch and
deterministic Global/Character Banks for canonical foreign keys, but it never changes `memory_authority_selection`.
That Batch 1 epoch pointer is canonical-internal staging state, not runtime authority. Dry-run initializes neither epoch
nor Bank. Activation validates that the prepared epoch is the same active canonical epoch, changes only the runtime
selection row/receipt, and makes that marker the single production selection truth.

## 3. Snapshot and raw evidence

Walk `workspace/memory` entry files and `workspace/blocks` Block files through allow-listed roots without following
symlinks, junctions, or reparse points. Every discovered `.md` is evidence, including an invalid placement; an
out-of-root link is represented by a manifest exception containing only link metadata and is never dereferenced. Use
`entries/<path>` and `blocks/<path>` as distinct canonical POSIX relative-path namespaces, convert host separators to
`/`, reject `.`/`..` and canonical-path collisions, and sort the resulting UTF-8 bytes lexicographically. Do not NFC-
normalize path or body text: raw path spelling and body semantics are evidence. Preserve exact source bytes, including
CRLF/LF. Raw text exists only when
strict UTF-8 decoding succeeds; invalid UTF-8 remains byte evidence plus a diagnostic.

Before copying, preflight the exact total source bytes plus manifest overhead against available disk space. Copy into a
private temporary sibling, fsync files/manifest where supported, reject any source whose stat/hash changes while copied,
and atomically rename the complete directory to its final hash-addressed name. Never publish a partial snapshot. The
manifest uses canonical JSON and contains snapshot schema/normalizer versions, snapshot ID, creation time, source kind,
canonical relative path, byte length, raw SHA-256, and exception code where applicable. Exceptional sources also carry
structured parser evidence (phase, closed code, and optional line/column/category), never a raw parser/Zod/SQLite
message or offending value:

```text
workspace/memory-migration/<snapshot-id>/
  manifest.json
  entries/<canonical-relative-path>
  blocks/<canonical-relative-path>
```

`snapshotId = H("legacy-snapshot/v1", manifestPayloadHash)` where `manifestPayloadHash` excludes snapshot ID and
creation time. The snapshot is private audit/rollback evidence, never runtime Markdown fallback or an operator download.
Dry-run may construct the same shape under the OS temp directory solely to make a race-free report, but must delete it
before returning and must not create a ledger row. A staged run publishes one durable snapshot. Before activation,
re-stat and rehash every live source and prove the same complete names/hash/length manifest; any addition, deletion,
change, link, or timeout aborts activation. Discovery/dry-run need no write fence. Stage/verify use the persisted fenced
lease; final activation additionally uses the bounded runtime quiescence in section 9.

The original `workspace/memory` and `workspace/blocks` trees are never rewritten, deleted, or used as a post-activation
runtime store. They remain read-only evidence for the explicit operator migration/audit workflow; normal startup and
runtime paths do not construct a reader for them after canonical activation.

## 4. Normalization matrix

| Variant | Accepted behavior | Exception |
| --- | --- | --- |
| Fences and newlines | Opening fence is the first line `---` with optional trailing whitespace; the first later line whose trailing whitespace is exactly `---` closes the live parser subset. LF and CRLF plus an absent/present terminal newline are accepted. | BOM, invalid UTF-8, missing fence, or a Batch 1 string bound exceeded (JavaScript string length, not a code-point claim). |
| Keys and scalars | Unique keys matching the live `[a-z][a-z0-9_-]*` subset; JSON double-quoted strings, bare `true|false`, decimal numbers, and trimmed literal strings. Unknown flat scalar keys are preserved in bounded legacy metadata. | Duplicate/invalid key, alias conflict with a canonical key, nested/flow/multiline YAML, non-finite/unsafe number, or metadata outside Batch 1 JSON bounds. |
| Required entry fields | `id`, `layer`, `importance`, `created`, and `status`; filenames need not match `id`. Any non-empty legacy `id` accepted by live `entryFromFile` is preserved as provenance; it is never a canonical key. A bounded safe projection or hash may be used only for metadata/indexing. | Missing/empty ID, unknown layer, importance outside integer 1..10, invalid status, or non-offset ISO timestamp. |
| Optional entry fields | `disclosure`, `origin`, `emotional_weight`, `expires`, `updated`, `reinforce_count`; missing `origin` defaults to `self` with a compatibility annotation. `reinforce_count` maps to `reinforceCount`; `updated` and `reinforce_count` are independent, matching the live codec. | Origin outside `self|observed`; disclosure over 512; non-finite emotional weight; invalid timestamp; reinforce count not a positive integer. |
| Ownership/placement | `global/<layer>/*.md` for global layers; `characters/<safe-character>/<layer>/*.md` for per-character layers. Canonical separators and roots are used independent of host OS. | Out-of-root/reparse path, unsafe character, wrong root/depth, or layer/path ownership mismatch. |
| Lifecycle/retention | `active` remains valid; `archived` becomes invalidated. Registry retention is authoritative: permanent, rolling, and importance-decay parameters map exactly; expiring uses explicit `expires`, otherwise `(updated ?? created) + configured intentionsDefaultDays` frozen into the run. `updated` is the recency anchor where present. | Reversed dates, explicit expiry before creation, or a value that cannot satisfy the Batch 1 retention schema. |
| Body result | A body with normalized JavaScript length greater than zero creates exactly one Local `experience` unit. Whitespace-only bodies are valid non-empty strings under the shipped Batch 1 schemas; only a truly empty normalized body is `converted-zero`. | Sanitizer refusal or canonical source/unit bound violation; no truncation and no fake unit. |
| Legacy Block Markdown | Frontmatter-less bytes under `blocks/global/<id>.md` or `blocks/characters/<safe-character>/<id>.md`; registry ID/scope/order/writer are preserved. Editor notes remain exact raw evidence but canonical content uses the same `stripNoteBlock` view as the shipped runtime. Empty/stripped-empty means no structured row and `converted-zero`. | Unknown ID, wrong scope/depth, frontmatter, over-bound content, conflicting canonical row, or Block-shaped file in the entry tree. |

`safe-character` is exactly the shipped `isSafeSegment` grammar `[A-Za-z0-9_-]+`. Entry filenames are arbitrary
single-segment `.md` names and are not validated as legacy IDs. Numeric frontmatter values use the live scalar parser,
then must be finite/safe where projected and satisfy the exact Batch 1 integer/range schema. Unknown keys are evidence
and bounded metadata only; they never override canonical fields or select behavior.

Closed durable diagnostic codes are:

```text
INVALID_UTF8 | UNSUPPORTED_BOM | INVALID_FENCE | INVALID_FRONTMATTER_KEY | DUPLICATE_FRONTMATTER_KEY |
UNSUPPORTED_YAML | MISSING_REQUIRED_FIELD | INVALID_LEGACY_ID | UNKNOWN_LAYER | INVALID_IMPORTANCE |
INVALID_STATUS | INVALID_ORIGIN | INVALID_TIMESTAMP | INVALID_REINFORCEMENT | FIELD_BOUND_EXCEEDED |
METADATA_BOUND_EXCEEDED | PATH_OUT_OF_ROOT | REPARSE_POINT | INVALID_PLACEMENT | OWNERSHIP_MISMATCH |
UNKNOWN_BLOCK | BLOCK_SCOPE_MISMATCH | BLOCK_FRONTMATTER | BLOCK_CONFLICT | SANITIZER_REFUSAL |
CANONICAL_SCHEMA_MISMATCH | IMPORT_CONFLICT | SNAPSHOT_CHANGED | LEASE_LOST | INTEGRITY_MISMATCH
```

The code is durable and operator-visible; bounded detail may name the field and expected category but never quote its
value or a raw parser/Zod/SQLite exception. Unsupported/corrupt/path/ownership/Block-conflict/sanitizer/bound failures
are eligible for explicit per-source exclusion. `CANONICAL_SCHEMA_MISMATCH` for a source otherwise inside this matrix is
an implementation defect and cannot be converted into an expected exclusion by tests. Raw key order, quoting, newline
style, unknown scalar fields, compatibility annotations, and every rejected value remain only in snapshot evidence.

## 5. Deterministic identities

Use UTF-8 bytes and one frozen length-delimited tuple encoder to prevent concatenation collisions. The encoder is
`u32be(byteLength) || utf8Bytes` for each field, with a `u32be(fieldCount)` prefix; no delimiter, JSON.stringify,
locale, path separator, or platform encoding is permitted. `H(domain, ...)` is SHA-256 over the UTF-8 domain string
encoded as the first field plus the remaining fields. The formulas below are exact and versioned:

```text
sourceId    = H("legacy-source/v1", relativePath, rawSha256)
contentHash = H("legacy-content/v1", normalizedContentUtf8)
documentId  = H("legacy-document/v1", bankId, sourceId)
operationId = H("legacy-operation/v1", bankId, documentId, rawSha256)
memoryId    = H("legacy-memory/v1", bankId, documentId, resultOrdinal, resultPayloadHash)
```

`relativePath` is the canonical POSIX path including `entries/` or `blocks/`; `rawSha256` and all hash outputs are
lowercase hex. `normalizedContentUtf8` converts CRLF/CR to LF for content identity only; do not NFC-normalize entry
bodies unless an implementation test and an explicit compatibility decision prove that it is safe, because raw evidence
and user-visible body semantics are exact. `resultPayloadHash` is the hash of canonical JSON with recursively sorted
object keys and stable array order. `resultOrdinal` is a non-negative decimal string encoded as UTF-8. The domain field
is never omitted or reused for another identity. Every derived ID is lowercase `sha256:<64-hex>` and stores its
domain/version separately for audit/debugging without exposing content.

Physical path and raw hash distinguish crash-left duplicate files. Bank-specific document IDs remain safe for later
Global/Character fan-out. Epoch scope is stored by the canonical tables but intentionally excluded from migration IDs so
dry-run, retry, and a rebuilt staging epoch produce the same identities. No slug or legacy filename is an unrestricted key.

## 6. Conversion and disposition

### 6.1 Frozen entry-to-canonical projection

The migration freezes the following mapping rather than delegating semantics to the ordinary Local provider:

| Legacy value | Canonical projection |
| --- | --- |
| Path-derived ownership | Global layers use the deterministic Global Bank for the prepared epoch; per-character layers use that character's deterministic Bank. The Bank ID participates in document/operation/memory identities. |
| `id` | Bounded legacy provenance metadata only, preserving any non-empty value accepted by `entryFromFile`; never a document, memory, request, or Bank key. |
| Body | `CanonicalMemorySource.retainedText` and one `CanonicalMemoryUnit.text`, after newline normalization and the versioned migration sanitizer; canonical source/unit schema bounds apply without truncation. |
| Raw evidence | Snapshot path, raw SHA-256, source ID, normalizer/sanitizer versions, and legacy status/origin compatibility flags in bounded metadata/sourceRef. Raw bytes stay only in the snapshot. |
| `layer` | `policy.layerId`; exactly one `taki-layer:<layer>` unit tag; visibility comes from the frozen `V1_MEMORY_LAYERS` row. |
| `importance`, `disclosure`, `origin`, `emotional_weight` | Direct policy projection, using `null` for an absent optional canonical value and `policyVersion=1`. Missing legacy `origin` becomes `self` plus compatibility metadata. |
| `created` | `source.createdAt`, unit `createdAt`, `mentionedAt`, and default `eventDate`; the exact strict offset-bearing timestamp is preserved. |
| `updated` | When present, source/unit/policy `updatedAt`; otherwise `created`. It is independent of `reinforce_count`. |
| `reinforce_count` | Bounded provenance metadata and unit `proofCount = max(1, reinforce_count ?? 1)`. It never invents lineage rows. |
| Retention | Registry policy is authoritative: permanent; exact rolling-window days; exact importance-decay parameters; or expiring with explicit `expires`, otherwise `(updated ?? created) + intentionsDefaultDays` frozen in the run configuration to match the shipped retention recency anchor. |
| `status=active` | Unit `state=valid`, `invalidationReason=null`, `invalidatedAt=null`; eligible for canonical FTS. |
| `status=archived` | Unit `state=invalidated`, reason `legacy-archived`, `invalidatedAt=updated ?? created`; excluded from canonical FTS. |
| Context/entities/scopes | `context=null`, `entities=[]`, `observationScopes=null`, `sourceMemoryIds=[]`, `chunkId=null`, `occurredStart/End=null`, consolidation timestamps null, fact type `experience`, revision 1. |
| Provenance | `actor=system`, `origin=legacy-import`, path-derived `characterId` or null, no timeline bounds, `capturedAt=created`, `sanitized=true`, bounded opaque `sourceRef`. |

Canonical JSON uses UTF-8, recursively lexicographically sorted object keys, no insignificant whitespace, JSON number
spelling, and array order defined by the field contract. Set-like arrays (tags, entities, source IDs) are deduplicated
and byte-sorted before serialization; semantically ordered arrays retain their specified order. Results are sorted by
`resultOrdinal`, then memory ID bytes. Canonicalization never relies on locale-sensitive comparison.

The canonical runtime must preserve the legacy retention contract without touching Markdown: recall eligibility checks
the policy projection against the current time (including `updatedAt` recency), and a canonical retention worker applies
the same permanent/rolling/expiring/importance-decay registry rules through canonical invalidation and FTS removal in
Core transactions. It may retain invalidated canonical rows for audit/restore; it never invokes the legacy sweeper or
silently serves an expired/decayed unit while waiting for the next sweep.

The provider-neutral retain projection mirrors these source/unit/policy fields and stores the same payload hash, but
no Hindsight-private fields, request, network call, or provider receipt exists in Batch 2.

For each normalized entry: resolve Bank from layer/path ownership; sanitize text/metadata through the deterministic
legacy-retain sanitizer. Credential classes and hidden prompt/tool envelopes are refused or redacted according to a
versioned policy; ordinary email/phone text is not universally deleted unless the migration policy explicitly says so.
Build one canonical source with normalized body, content hash, `legacy-import` provenance and bounded legacy metadata;
build one `experience` unit when body is non-empty
with exactly one matching `taki-layer` tag, policy/lifecycle/timestamps; and stage a sanitized Hindsight-ready retain
payload without calling a provider. An archived entry is represented by an invalidated unit with a deterministic
`invalidatedAt` (the legacy `updated` timestamp, otherwise `created`) and reason `legacy-archived`; its legacy status is
also retained in bounded metadata. It is not active FTS. A legitimate empty body ends `converted-zero` with no unit; it never calls Local `retain`, whose result schema requires at least one unit. Synthetic many-result mapping is
represented in the ledger for future provider results and never assumes one source equals one fact.

For duplicate physical evidence, stage each source separately and record a deterministic duplicate relation; never
collapse raw evidence. For Blocks, resolve registry scope/order/writer, insert structured rows at revision 1, preserve
empty or missing semantics, and never create generic source/unit/FTS rows. A missing Block is not a source and is not
manufactured. The migration importer is a dedicated `actor: migration` path that validates the registry writer but does
not impersonate `user` or `background`; it may seed an existing user-owned `user-card` only through a dedicated
provenance/receipt field, and a canonical row with a different content hash is a blocking conflict. After activation the
runtime Block path is structured-only and its normal writer policy is enforced again. All future background-owned Block
writes use the `background` policy path. A whitespace-only Block becomes zero-result only after the shipped
`stripNoteBlock` view is trimmed, matching current `BlockStore.readBlock` behavior.

### 6.2 Migration-only canonical import contract

`legacy-canonical-import-repo` owns one synchronous per-source transaction. Its input contains the prepared epoch/Bank,
operation ID, exact payload hash, deterministic source/unit IDs, zero/one/many ordered unit projections, Block projection
when applicable, and current lease fence. Its replay behavior is closed:

- no prior operation: validate Batch 1 schemas, insert the exact source/unit/policy/FTS or Block rows, then insert the
  operation receipt and ledger results atomically;
- same operation ID and exact payload hash: return the already committed ordered result without revision bumps;
- same operation ID or deterministic destination identity with a different payload hash: fail `IMPORT_CONFLICT`, do
  not replace/invalidate an existing row, and leave the source blocking;
- zero-result: persist the source/provenance and zero-result receipt/ledger disposition without manufacturing a unit or
  calling Local `retain`;
- Block: use a migration-only repository method that checks registry definition/scope/writer policy, permits only an
  absent destination or exact same migration receipt, and never exposes `actor: migration` through runtime APIs.

The public `CanonicalMemoryRepo.retain` and `StructuredMemoryBlockRepo.replace` remain unchanged for normal runtime
callers. The importer must not depend on Batch 1's random memory ID generation, at-least-one-unit result schema, active
provider request identity, or document-replacement invalidation semantics.

## 7. Ledger state machine

```text
DISCOVERED -> SNAPSHOTTED -> NORMALIZED -> STAGED -> VERIFIED -> ACTIVATED
     |             |              |             |          |
     +---------- failure/diagnostic; resumable retry -------+
     +------------------------------> EXCLUDED (explicit durable decision)
```

Resolved dispositions are `converted-zero`, `converted-one`, `converted-many`, and `excluded`. `failed` is durable but
unresolved and blocks activation; retry returns to the earliest safe phase. `excluded` is durable and audited, and raw evidence remains.
Each attempt records phase, timestamps, sanitized code, and bounded diagnostics. Replays never create another canonical
result for the same operation.

## 8. Dry-run, staging, and verification

- Dry-run snapshots/discovers/normalizes/derives identities in memory or a private temporary snapshot and asserts no
  durable canonical, Block, authority, ledger, snapshot, marker, or source bytes changed. The temporary tree is removed
  before the method returns, including failure paths.
- A staged run has a strict ordering: discover and copy the complete immutable backup, atomically publish and receipt it,
  then begin normalization/conversion. Snapshot publication failure produces no canonical staging and no conversion
  results. The snapshot is the source of truth for every retry; the live Markdown tree is never used as a mutable
  conversion input after publication.
- Staging uses the migration-only import contract to insert or exact-replay canonical source/unit/policy/FTS/Block rows
  per idempotent operation; it never performs ordinary document replacement. A failed row transaction rolls back; its
  diagnostic is recorded separately in the ledger. FTS is a rebuildable projection.
- Verification recomputes snapshot hashes, parses ledger rows, validates IDs/FKs/epoch/Bank/tag/lifecycle, compares FTS
  rebuild results, confirms Block exclusion, and requires every non-excluded source to be terminal-success or zero-result.

## 9. Fence and concurrency

Activation uses a process-wide `MemoryAuthorityRuntime` gate shared by every legacy reader/writer, not a migration-only
mutex. The gate tracks foreground operations and detached jobs and can atomically stop admission. The sequence is:

1. Outside SQLite, prepare the canonical runtime bundle and verify the immutable snapshot, ledger, source/result hashes,
   Banks, records, Blocks, FTS rebuild, and persisted readiness digest.
2. Acquire the bounded runtime fence. Stop admitting new legacy tool calls, prompt/Block assembly, direct writes,
   reconcile, tidy, retention, operator maintenance, auto-memory, compaction flush, and image-description writes. Cancel
   scheduled maintenance and drain every already-admitted operation; timeout aborts with the marker unchanged.
3. While the fence remains closed and after the drain, re-enumerate, stat, and SHA-256 hash the complete live entry and
   Block candidate set outside any SQLite transaction. Compare exact paths, kinds, lengths, hashes, and manifest digest
   with the prepared snapshot. Any addition, deletion, reparse point, or changed byte aborts.
4. Re-run final canonical/ledger verification outside the transaction and persist a readiness digest tied to the run,
   snapshot, prepared epoch, lease fence, source/result counts, canonical payload hashes, Block hashes, and FTS digest.
5. Enter one short synchronous SQLite transaction with no filesystem access, promise/await, callback to external code,
   or other async gap. Recheck the monotonic lease fence, `legacy-markdown` selection, verified run/readiness digest,
   complete non-excluded source dispositions, result counts/hashes, prepared active Local epoch/Banks, and absence of a
   prior conflicting receipt. Insert the activation receipt and update the singleton selection to `canonical-local`.
6. After commit, synchronously bind the in-process runtime to the already prepared canonical Local runtime before
   reopening admissions. If this post-commit binding cannot complete, keep the gate closed and fail the process/restart path; never
   reopen legacy. On restart, the marker selects canonical before any legacy object is constructed.

Filesystem hashing never occurs inside the activation transaction. If quiescence, hashing, readiness verification, or
the transaction fails before commit, the gate reopens on legacy and no activation occurs. No dual-write bridge exists.

## 10. Activation, recovery, rollback

Persist one singleton selection containing active provider, epoch, activation transaction ID, snapshot ID, and legacy
retirement epoch. Startup reads and validates it before constructing either runtime, composing prompts/tools, reconciling,
or starting schedulers:

- valid `legacy-markdown`: current engine and legacy tools; canonical staging dormant;
- verified `canonical-local`: canonical Local provider/tools; no legacy reconcile or mutable Markdown writes;
- absent/mismatch/corruption after migration 021: fail closed with sanitized integrity error, never silently fallback to Markdown.

Activation checks lease ownership, manifest, resolved ledger coverage, canonical Banks/records/Blocks/FTS integrity,
and epoch. It commits selection, activation receipt, and legacy retirement together. Pre-activation failure may discard
and rebuild canonical staging while preserving ledger/snapshot. A process death after commit is recovered by the durable
marker and canonical selection. Post-activation normal runtime has no Markdown translator; only an explicit offline
operator audit/migration invocation may inspect the preserved snapshot and ledger.

### 10.1 Complete runtime retirement inventory

The pre-activation fence and authority-selected runtime binding must cover every current Markdown seam. A canonical activation is incomplete if any of
these can still touch `workspace/memory` or `workspace/blocks`:

- boot composition in `main.ts`/`memory/bootstrap.ts`, including `createMemoryEngine`, startup `reconcile`, legacy
  roots, and legacy retention-sweeper startup;
- `chat-agent.ts` instruction assembly, Block/pinned/intention reads, foreground tool construction, and the legacy
  `BASE_SYSTEM_PROMPT` instructions naming `memory_search`, `memory_write`, or `memory_archive`;
- foreground and background `MemoryEngine.createTools`, `createBackgroundTools`, direct `writeEntry`, search, archive,
  reinforcement, disclosure, refile, and Block mutation operations;
- episodic writer, pre-compaction flush writer, `auto-memory` detached chain and watermarks, plus compactor flush-first
  behavior;
- image-description `writeEpisode` binding and all other direct `MemoryWriteOp` consumers;
- tidy report reads, tidy maintenance tools, automatic tidy trigger, and operator `memory.tidy`;
- boot/periodic retention listing, archive, and hard-delete;
- media/status/operator surfaces whose paths, byte counts, or maintenance dependencies assume the Markdown tree.

Legacy and canonical tool suites and their prompt instructions are selected as one bundle. No permanent legacy aliases or
dual-format adapter are loaded in normal runtime. If a historical translator is retained, it is an explicitly invoked,
offline operator/audit module that cannot execute normal Markdown reads/writes or enter prompt/tool/background paths.
Runtime tests use filesystem sentinels after activation to prove every listed path is unreachable.

## 11. Privacy and verification matrix

Operator-only diagnostics may include snapshot-relative source path and opaque source ID. Ordinary logs/errors/receipts
contain counts, phase, opaque IDs, status/error code, attempts, and bounded categories only; never raw Markdown, body,
disclosure, query, secrets, complete payloads, or hidden prompt material.

| Area | Required proof |
| --- | --- |
| Parser | Every matrix variant, exact bytes/hash, invalid syntax, alias conflicts, unsupported YAML. |
| Ownership | Global/per-character derivation, safe segments, mismatch, traversal, crash-left duplicates. |
| Identity | Repeatability, domain separation, bank/epoch isolation, zero/one/many mapping. |
| Ledger | Phases, retries, exclusions, diagnostics, reopen, idempotent replay. |
| Snapshot/fence | Dry-run no-write, hash mismatch, quiescence timeout, bounded fence, restart recovery. |
| Conversion | Source/unit/policy/provenance/lifecycle/retention, empty-body zero result, Block isolation. |
| Activation | FKs/tags/hash/FTS integrity, one transaction, startup selection, no fallback. |
| Privacy/regression | Sentinel non-leakage; legacy and Batch 1 suites before/after failed and successful activation. |

## Explicit non-goals

No Hindsight HTTP/client, Bank provisioning, remote import, replication journal, Pending Memory, automatic recall,
operator UI, timeline rewrite, Markdown deletion, or generic fact extraction is designed or implemented here.
