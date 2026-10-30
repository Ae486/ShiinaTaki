# Hindsight Recovery Evidence - Proposed Design

## Status and owner review

The owner's latest [confirmed direction](grill.md) is interoperability with public logical field alignment and
adapter/extension-first integration. Local retains its own complete maintenance; Hindsight mode uses native semantic
processing with Taki-specific policy. Source-backed implementation improvements are allowed during development.

The owner accepted G1: routine writes may be confirmed after reliable native-result proof and local factual
application while derived maintenance continues. The independent authority-cutover completeness gate remains.
The detailed atomic-retain/operation-scoped derived design below preserves an older evaluated option, not the selected
routine protocol. Its roughly 20-file estimate, input envelope and automatic-refresh timing effect are not approved
requirements. The task remains `planning`; the native-result/append/cutover protocol still needs source-backed design.

The source baseline is Hindsight `7eca2056` / API package `0.9.0`, and Taki `c3f8bc4` plus the preserved reviewed B5
Wave 3 changes. All three research reports are proposals grounded in current source; no new runtime acceptance is claimed.

## Source evidence and necessity

- [Producer contract research](research/recovery-producer-contract.md) proves that native retain/curation completion
  precedes some derived work and that post-commit submission can fail. Native consolidation can keep accepting later
  Bank writes, while automatic mental-model refresh waits for the final round. Queue emptiness and task success are
  insufficient operation-scoped evidence.
- [Append research](research/append-result-contract.md) proves that native append preparation, delta survivors,
  streaming publication and current document enumeration are not an immutable historical result. Native UUID replay
  is not payload-fingerprinted, terminal operations can be pruned, and current chunk/debug metadata cannot prove
  exact continuation of a partly committed retain.
- [Footprint and upgrade research](research/implementation-footprint-and-upgrade.md) names the source seams,
  public/client/schema surfaces, deterministic test gates and upgrade checks.
- [ADR 0009](../../../docs/adr/0009-single-memory-authority-with-local-replica.md) owns the logical Memory Replica and
  Pending Memory recovery contract. This patch does not create a second semantic memory engine or another authority.

A client-only implementation cannot make missing native transaction evidence durable or reconstruct the exact result
of an earlier append from a subsequently changed document. These are reasons for producer evidence when the required
guarantee depends on it; they do not make a core semantic-engine change necessary for ordinary field conversion.

## Integration direction before selecting a recovery protocol

1. Keep the versioned logical field map, provider identity mapping, Taki policy and client-side orchestration in Taki.
   Preserve logical round-trip meaning without mirroring private PostgreSQL tables into SQLite.
2. Prefer supported Hindsight REST APIs and assess native document/bank transfer for the appropriate structured-data
   path. Transfer may avoid repeated fact extraction, but regenerates destination identities and does not supply a
   journal, a retry receipt or a cursor-bound cutover snapshot by itself.
3. Use official HTTP/tenant/operation extension facilities for contracts they actually support. Post-commit best-effort
   callbacks are useful notifications, not native transaction receipts or complete derived-work evidence.
4. Add minimal generic transaction/task hooks only for demonstrated remaining guarantees. Keep compatibility protocol
   and Taki-specific logic in a separate module, with native-path tests and an upstream retirement condition.

G1 has resolved the routine-versus-cutover distinction. Reuse the prior rulings indexed in [grill.md](grill.md) before
asking any further product question. Honest native outcomes, idempotent append recovery, logical field fidelity and
cutover completeness are already required; investigate how to provide them instead of asking whether they are needed.
Do not silently remove existing patches or claim a smaller final footprint before proving the remaining protocol.

## Selected routine completion contract (design only)

1. Authenticate, verify the provider/Bank lineage and capture the existing Authority/lease/deadline guards.
2. Apply the first authoritative pull, then safely replay eligible original intents with revision checking.
3. Verify the actual native result, including stable request/result identity and the complete factual effect boundary.
   A missing operation, currently similar document or echoed client identity is not a replacement for that evidence.
4. Pull/apply journal pages through that boundary and confirm the pending write transactionally with the matching
   Authority/Bank and checkpoint. A successful native write never needs redispatch merely because a pull failed.
5. Let native observation/model work continue. Synchronize later committed changes normally; derived progress is
   separately reported from real evidence or remains unknown. Routine completion makes no all-summaries-current claim.

Initial activation and a healthy switch to Local keep their separate required-maintenance, manifest, reconciliation
and final-fence checks. A future implementation must version or explicitly migrate the previous `awaiting_derived`
contract without manufacturing native proof. G1 does not solve append's result identity or partial-publication issues.
Those mechanisms and the exact field mapping are engineering work under the existing no-loss/no-duplicate contract.

## Earlier strict option retained for comparison

The following sections describe the previously evaluated protocol, including per-operation source/model work
tracking. Do not implement them wholesale as G1's routine path. Reuse only a component whose remaining necessity is
proved for native-result recovery or the independent cutover gate; automatic model-refresh timing is not to change
solely for routine confirmation.

### 1. Versioned tracked operations and immutable native results

Add an explicit, optional recovery contract to native asynchronous retain and conditional mutation. It carries the
contract version, expected provider lineage/Bank generation and an optional negotiated result-reference bound.
Preserve the existing untracked request form and native UUID behavior.

The provider persists the normalized request fingerprint before acknowledging tracked admission. Exact duplicate
requests use the same identity; changed payloads under that identity are refused. Keep provider-owned request,
prepared-input, native-result, native-receipt and final-completion identities distinct. Define normalization and
hashing once and verify Python/TypeScript vectors, including Unicode and omitted/default values.

Store immutable native results separately from mutable logical-work progress. Retain results include the producer's
actual append base/prepared/result hashes, complete resulting source references with revisions/lifecycle, their
count/digest and native commit cursor. New-fact count does not stand in for the full delta result. Curation reuses
its existing immutable conditional-mutation result.

Receipt identity survives native operation pruning and document deletion for the supported Bank-generation lifetime.
Old untracked writes cannot acquire proof retroactively. A missing record is not proof that a write never happened.

### 2. Single-input atomic publication for the first supported retain contract

Reuse native text/JSON-array append preparation, sanitization, chunk extraction, entity resolution, delta selection
and storage helpers. Complete extraction/embedding preparation before opening the authoritative write transaction.
Do not hold that transaction across LLM calls.

Inside one transaction, lock Bank state and the operation/document in a documented order, recheck lineage and the
producer-read base-state hash, apply the complete native document/fact changes, publish the logical journal, and
persist the full result plus required work/task intentions. A changed base aborts before canonical publication;
re-prepare under the original request identity. A committed receipt is returned before any repeated preparation.
Notify the existing task backend only after commit.

This prevents the tracked path from exposing a new document hash alongside only a prefix of its facts. Native delta
already has a single-transaction pattern. The full-retain fallback still requires a deterministic feasibility gate
demonstrating native-helper reuse and rollback; it is not an existing proven mode.

**Proposed first-release scope:** one document/input per tracked retain UUID, PostgreSQL SQL-row storage, available
native document text for append, and a declared prepared-input/result envelope. Use resolved native batching/chunking
thresholds as candidates for a conservative single-publication envelope, then measure them in the feasibility gate.
These are batching thresholds, not established memory-safety limits. Taki's existing 256-reference, 512 KiB wire and
2 MiB durable-state bounds remain separate consumer limits.

Initial oversize/unsupported requests are refused before tracked admission. If a concurrent change makes a previously
admitted operation exceed the envelope during CAS re-preparation, record an explicit durable failure with no canonical
publication. Never silently route it to untracked streaming. Validate the complete result-reference bound before
publication, or roll back the whole transaction.

This proposed scope does not cover every large/multi-input native retain. Covering those cases requires measured
larger atomic buffering or a separate durable part protocol with exact extracted results, part identity and restart
ownership. A bounded first release must not be described as full coverage of all native append sizes.

### 3. Finite logical derived completion

At native commit, record the exact source/survivor versions and native scopes requiring logical maintenance. Reuse
the native consolidator's source selection, grouping, batching, prompts, scope and retry rules. Record real outcomes
at the source-marker/journal transaction; a later version or enclosing task success cannot prove an earlier source
was processed.

After the operation's sealed source set has settled, durably enqueue one fixed-purpose finalizer on the existing
task queue. It evaluates native automatic mental-model eligibility/scope/staleness, seals the selected model set
once, and associates native refresh tasks. Reuse a refresh only with persisted input-cursor and model-definition
coverage; otherwise enqueue a suitable successor. Manual refresh semantics and disabled native policy remain intact.

This deliberately lets automatic refresh for tracked operations start at their own source-completion boundary,
before the Bank-wide final round. It may change timing and call frequency. It is the smaller option than restricting
the native source cohort, which would also change consolidation batching opportunities.

Once every required logical result succeeds and declarations are sealed, persist a stable completion ID/hash and
commit-visible `through_cursor` under the Bank-state lock. Later unrelated writes and recurring cron work do not
extend the operation's dependency set. Conflicts with the required source/model itself remain explicit failures or
unresolved outcomes; there is no fixed wall-clock guarantee through outages or perpetual same-target changes.

Private ANN/graph/index quality, telemetry, webhooks and future recurring tasks are outside this logical completion
predicate. Their actual later logical writes still arrive through ordinary journal synchronization.

### 4. Public API and Taki consumption

Proposed public surface:

| Surface | Responsibility |
| --- | --- |
| Optional native `recovery: TakiRecoveryOptions` | Explicit versioned tracked admission; existing untracked form remains available. |
| `GET /ext/taki-memory/banks/{bank_id}/operation-receipts/{operation_kind}/{operation_id}` | Authenticated typed native result and logical-work/completion evidence under expected lineage/generation. |
| Independent `operation_result` / `logical_completion` capabilities | Advertise only the exact tested build, backend, schema and supported envelope. |

Engine methods own authentication, tenant resolution, operation validation and persistence. Routers only validate,
delegate and map shared typed errors. Keep no raw source preparation, credentials or worker exception text in the
evidence response. Follow the existing common error-envelope pattern for generated-client compatibility.

Taki verifies provider-computed input/result proof against its frozen native request, persists a versioned native
receipt, then constructs its local completion envelope using the captured local Authority Epoch and local receipt
hash. An echoed client hash is never producer proof. Preserve legacy rows/intent hashes without rewriting migration
035. Only negotiated new requests can use safe tracked replay and append mapping.

Keep the existing recovery order and guards: first pull, compatible replay, native/derived proof, second pull,
transactional confirmation at a matching checkpoint reaching `through_cursor`. Do not alter authority activation,
single-writer ownership, lease/deadline checks, same-lease reset continuation or unknown-outcome treatment.

## Conditional footprint of the evaluated option

This inventory applies only to the evaluated strong-recovery option. It is not the minimum cost of interoperability,
the selected implementation footprint, a changed-file count or a LOC/time commitment:

| Handwritten provider surface | Proposed amount |
| --- | --- |
| Existing backend modules listed in the footprint report | 11 files |
| New focused contracts/persistence/atomic-retain modules | About 3 files; final responsibility split may vary |
| Forward migration | 1 migration adding 2 dedicated receipt/work tables |
| Maintained Python/TypeScript wrappers | 2 files plus mapping tests |
| Control-plane forwarding/types | 3 named files plus relevant tests |
| Conditional helper changes | Task backend, maintenance, DB claim adapters or fact storage only if needed |

The primary list is approximately 20 handwritten file entries, plus tests, documentation and conditional helper
changes. Regenerate all four maintained SDK families (Python/TypeScript/Rust/Go) and canonical OpenAPI separately;
generated diff volume must not be presented as handwritten implementation size. Taki also needs its Shared contracts,
compatibility/client/recovery adapters and regressions; this is not solely a provider patch.

## Schema, validation and upstream maintenance

Proposed tables are `memory_operation_receipts` and `memory_operation_work`, using fixed-purpose typed state and
constraints, with no dependency on prunable task/source rows. No new canonical fact/document column is required by
the base-state hash approach. No new dependency, advisory lock, generic workflow framework or vector schema is proposed.

Append one migration after the verified current head, using explicit dialect dispatch. Initial support is PostgreSQL;
an intentional Oracle no-op must stay unsupported in capability negotiation. Physical backup/restore includes both
tables and coherent queue/lineage state. Portable transfer excludes operation/replay history and starts fresh identity.
Retire old-generation work on Bank replacement and remove private prepared bodies once no longer required.

Required gates are native-path fault injection/rollback, duplicate and lost-ACK replay, pruning, concurrent append,
delta/zero-result equivalence, source/scope failures, finite completion under continuous unrelated input, refresh
coverage/coalescing, stale worker claims, auth/tenant isolation, migrations/backup/transfer, OpenAPI/SDK parity, and
the actual Taki HTTP-to-SQLite second-pull path. Run affected suites/types/lint after implementation. Existing B5 pass
counts are a preservation baseline, not proof of the proposed contract.

[Hindsight's live patch ledger](H:/hindsight/TAKI_PATCHES.md) owns patch 009's baseline, final files/API/schema,
validation, execution tradeoffs and upstream replacement checks. Preserve the historical 001-008 archive. During an
upstream update, recheck admission, retain/delta publication, source marking, refresh cutoff, queue retry/pruning and
backup seams; retire local code only when upstream provides equivalent guarantees.

Disabling new tracked admission is the initial rollback boundary. Preserve existing receipt/work data for audit and
recovery; do not downgrade/drop it while a consumer relies on the proof. Live deployment, user-data migration,
authority activation, Git commit/push and task archival remain outside current authorization.

## Decision needed before production dispatch

Routine-recovery completion semantics are resolved by G1. Reassess native reuse and the minimum append/result and
independent cutover protocols from source. Only if atomic publication remains necessary does the
bounded single-input versus larger-append decision become relevant. Its input restriction and automatic-refresh
timing change must be explicit; neither is authorized by the general permission to optimize the design. Update the
ADR/specification, plan and patch ledger together after each accepted material decision.
