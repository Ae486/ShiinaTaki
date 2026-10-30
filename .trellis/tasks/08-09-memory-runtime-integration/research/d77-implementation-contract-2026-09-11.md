# D77/B6 Implementation Contract

- Date: 2026-09-11
- Authority: the owner's accepted [policy-readiness ruling](../grill.md) and explicit Trellis design/implementation authorization.
- Scope: finish D77 application-state preservation and B6 Hindsight consumption, policy and recovery integration.
- Sources: [native plan](d77-native-application-state-plan-2026-09-11.md), [Taki plan](d77-taki-policy-runtime-plan-2026-09-11.md),
  ADR 0009, B1 policy/provenance contracts and the existing G1/D78 executable specifications.

## 1. Frozen scope and ownership

The two referenced plans are adopted as the detailed engineering design, subject to the precise decisions below.
Their old proposal/pending labels do not reopen accepted product choices. Implementation must preserve existing
Local/runtime/read-client changes and every frozen G1/D78 command, hash, receipt, certificate and native journal meaning.

Local remains a complete but algorithmically smaller provider. Preserve consumable content and recovery evidence;
do not implement Hindsight graph retrieval, observation synthesis or mental-model maintenance in Local. B7 planned
Local switch-back, re-entry and Emergency Local Takeover remain a separate task with a separate grill. This slice
does not activate authority, load original user data, run real models, commit/push or archive tasks.

Hindsight baseline is 6a749ba3e7d8719e336d9d1d8735a8e09da4366b; Taki baseline is 3c63a8080c92ffbb3ee8257dc2d979c2ba4ed711
plus the existing uncommitted B6 Local/read-client slice. Preserve unrelated native engine/db, Supabase, shared test
conftest and control-plane bin/cli.js changes. The leader records their initial hashes and owns final preservation checks.

## 2. Policy and assessment

The independently versioned policy body has a resolved Taki policy, policyBasis (neutral, registry or curated),
and assessment state (not_required, due, failed or assessed). Preserve the original Canonical record/source as immutable
evidence when available; original identity/provenance and current native/runtime bindings are distinct.

Neutral development defaults are declared Taki policy, never inferred provider facts:

- layerId: unclassified, the existing reserved fallback, not a fake registry layer.
- visibility: retrieved; importance: the existing automatic-writer default 5, factored into a named shared constant.
- retention: permanent until a supported policy replaces it; unknown classification cannot trigger destructive expiry.
- disclosure and emotionalWeight: null unless proven existing state supplies them.
- origin: retain proven self/observed state; otherwise observed, with actual ingress validation and content fencing.
- policyVersion/updatedAt: persist a real first policy insertion and subsequent revisions; repeated reads reuse them.
- assessment: due for the exact native binding. Failed review preserves usable current policy and durable retry state.

Registry resolution is permitted only for sufficient trusted per-unit labels and matching Bank ownership. A bare
relationship label does not prove a deliberate pin. Existing hidden, mood-gated, expiring or pinned policy cannot be
replaced with neutral merely because a later native field is missing. Malformed/unavailable existing application state
is not authenticated absence. Basic identity, scope and lifecycle checks always precede admission.

Use a separate Shared policy/assessment schema; do not add assessment fields to frozen Canonical or G1/D78 payloads.
Canonical consumer projection may replace only its Taki layer tag with the policy-authorized tag. Preserve exact native
tags, metadata and payload hash in the independently stored native evidence. A projected tag is not a native mutation.

For a genuinely provider-created object, source provenance may be provider-derived with actual native references and
null conversation bounds. Never fabricate a user turn, source body, original writer or successful historical Write Gate.

## 3. Native application-state protocol

Adopt the native plan's ApplicationNamespace, NativeVersion, ArtifactKey/Version, BodyRef, command, receipt, hydration,
snapshot and state-change contracts. Public Pydantic model names must be TakiApplication-prefixed to avoid generated
client collisions. All outer native wire fields use snake_case; embedded original Canonical bodies retain their own
field names and exact supported JSON values. The producer's schema is mirrored and tested in @taki/shared.

- Independent capability: contracts.application_state version 1.0.0.
- Guarded reflection is separately advertised as application_reflect, never inferred from bare native reflect support.
- New build identity: taki-memory-hindsight-0.9.0-d77-v1. Existing G1/D78 contract versions and historical proof bytes stay intact.
- Route prefix: /ext/taki-memory/banks/{bank_id}/application-state.
- Application ID: taki; tenant schema comes only from engine authentication.
- Native cursor/revision and application state_cursor/artifact revision remain separate clock domains.
- Artifact kinds: bank, source, memory and block. Sources and Memory Blocks are not native fact/model/directive substitutes.
- Original source and unit metadata are independent. Preserve their full bodies, encoded witnesses and association history.

Body upload, immutable parts, seal, commit/status, hydrate, snapshot/pages and change/pages follow sections 3-7 of the
native plan. Body schemas and all concrete request/result/error fields must be finalized in the native typed models
before the Taki wire client is implemented; the native implementer reports that model checkpoint to the leader.

Use 256 KiB decoded parts and the existing 512 KiB ordinary response limit, including complete base64/envelope bytes.
Manifest/descriptors are paged and hashed; large native/application objects never become truncated successful records.
An independently advertised 16 MiB upload/command preparation ceiling is an operational limit, not a redefinition of
Canonical validity. Preflight and report unsupported input before native source dispatch; snapshots/journals preserve
their complete body closure through parts. Every part/record/request digest binds the exact Bank/generation namespace.

Use a new explicit digest domain with the established tagged-binary64 encoding. Preserve raw byte checksums separately
from semantic JSON hashes. Do not inherit the D78 model's depth-64 validator or change old encoders to implement D77.
Byte-preserving body parts must handle supported JSON strings/keys that cannot be stored losslessly in JSONB.

All application writes use immutable historical receipts plus native-version and artifact-version CAS. Exact replay
returns the original receipt even after newer native changes. A failed CAS never applies part of a command. Bank deletion
closes the generation without cascading away source evidence or receipts; recreation does not inherit active bindings.

The common native append hook publishes complete native changes and binding work in the same transaction. App-only
changes publish state events without changing native revisions. Multiple append calls in one outer transaction form
one complete application event. Preserve original artifacts across rebinding; never match by text or nearest revision.

Snapshot/hydration use one repeatable-read native/application view with immutable body references. Snapshot plus replay
must equal a later complete snapshot. Do not use the D78 cutover-binding hook as a general snapshot pin. Add all tables
to the native physical backup inventory and implement explicit state replay floor/reset behavior.

## 4. Policy-safe native reflection

Owner sequencing amendment, 2026-09-13: complete derived-observation policy propagation/input-proof capability is
deferred as D81 until after existing B7. The actual failure remains a documented limitation, not a passing guarantee.
The blanket observation-rejection experiment was removed in the owner-approved B6 closeout. Keep addressed-record policy,
namespace/integrity checks and existing whole-source/unsupported-opaque-input restrictions; ordinary observations pass
their own policy/lifecycle gate. Do not build a general proof system as a new B7 prerequisite.
See [the precise scope and sequencing](memory-capability-followups-2026-09-13.md).
The complete derived-input guarantee below remains the follow-up target rather than proof of current coverage.

Reuse native reflect and its existing tools. Add a separate, optional request-scoped read-admission hook; native callers
without it and D78 evidence paths keep their current behavior. Enforce admitted versions before initial profile/directive
input, candidate reranking, MM/observation/recall/expand tool results, traces and each model/cache submission.

The new application-state reflect endpoint resolves a typed Bank/generation-bound policy context and actual persisted
policy. It never trusts caller-supplied eligible booleans. Its bounded context carries purpose, policy version, query
time and relevant mood/actor scope; detailed shape is frozen alongside the native models and Shared mirror.

An eligible fact does not authorize its entire source document or sibling facts. A model's declared based_on subset
does not prove every input it consumed. Whole-source expansion and opaque derived bodies require verifiable complete
admission or explicit version-bound admission evidence; otherwise withhold those inputs while retaining their data.
This is a restriction of model input, not deletion or a Local semantic reimplementation.

Policy admission has an explicit checkpoint/validation linearization point. Recheck relevant restrictive changes before
later model submissions; no transaction spans network/model work. Do not claim that a lock-free check can retract an
input already dispatched before a concurrent mutation. No output-only filtering may stand in for this guarantee.

## 5. Taki application projection and runtime

Add an application-aware repository/runner beside the existing native-only B5 path. Preserve the old same-native-revision
hash guard. App-only policy changes use explicit app-CAS reprojection and atomically update native evidence, Canonical
projection, application state, FTS and the native/application checkpoint pair under existing authority/Bank/lease guards.

Keep existing B5 scheduling, catch-up/backoff, Pending admission and ordered G1 recovery. A new runner can implement the
existing scheduler interface, but it must not reinterpret native-only checkpoint values. Seed B5/app state from verified
joint evidence; raw B4 staged rows alone are insufficient. Newer app-only state must survive restart and snapshot rebuild.

Implement a Hindsight MemoryProvider and subsystem using existing B3 configuration/secret/Bank bindings and the common
coordinator/Run capture. Healthy recall uses native candidates followed by exact native/application hydration. Apply
eligibility before final limits; do not attach old replica revisions to a newer hit. Actual native reflection goes only
through negotiated guarded reflect. A bad policy binding is not an availability fallback.

Degraded reads use verified replica plus a separate truthful Pending source/intent overlay under Hindsight authority.
Extend Shared results additively for pending mutations and recall overlays; never create fake Canonical facts/revisions.
Healthy and degraded writes share durable intent and tracked G1 identities. Confirmation remains native factual proof
plus actual local application, independent of detailed assessment or derived freshness.

Hindsight ingestion reuses exact primary commit witnesses, one original-source eligibility/ownership gate and the
20-message cadence, but never Local fact extraction. Its pre-retirement flush persists complete source coverage as
confirmed work or durable Pending intents. Compaction itself is unchanged. Both-Bank partial work must remain explicit.

The dedicated curator receives only due/changed/exceptional policy work and permitted Block maintenance. It uses the
existing Utility Slot, report/step bounds and retry delays, with durable claim/retry state. No generic merge/rewrite/
observation-generation/mental-model-refresh toolset is added. Existing native observation mutation refusals stay intact.

Preserve Core-owned Block identities and writer rules, including the user-owned card. Restoration uses an internal
validated exact-revision restore path, not a fake background rewrite. Shutdown settles/stops owned schedulers and
curator work before closing SQLite. The old Hindsight runtime guard is replaced only when this composition is real.

## 6. Implementation slices and gates

1. Preserve baseline and fix B5 hidden-before-LIMIT filtering independently (already assigned).
2. Implement native application models/codec/storage/publication/snapshot/authenticated API and the policy read guard.
   The implementer reports the early typed-model checkpoint; the leader mirrors wire contracts and runs generators.
3. Implement Shared policy/assessment and additive Pending consumer contracts; then Taki app client/projection/store.
4. Assemble real provider/write recovery/ingestion/flush and the narrow policy curator, retaining the completed Local path.
5. Integrate boot/runtime/Run capture serially; use independent check agents for assembled native and Taki code.
6. Run focused tests, then required broader quality gates, source/encoding/preservation audits and isolated startup.
   Update specs, validation record and handoff. Do not mark D77/B6 complete from isolated modules alone.

Required proof includes real SQLite/PG transactions and reopen, failed CAS/rollback, native external edits, app-only
updates, joint snapshot plus replay, source-evidence-loss reconstruction, typed JSON/parts/overflow, two-Bank isolation,
neutral recall before model completion, failed assessment retry, hidden-data exclusion before actual native model input,
truthful Pending overlays, exact source flush coverage, immutable Run identity and unchanged G1/D78 behavior.

Reuse the owned Windows pg0 harness and network guard under the earlier G1 task. It creates a unique database, verifies
its actual data directory and refuses all unowned network connections. The leader verified PostgreSQL 18.1 with vector
and pg_trgm on 2026-09-11; the probe stopped and removed only its own data/registry. No Docker startup is required.

Canonical OpenAPI and all maintained SDKs must be regenerated and checked using the existing pinned tooling. Native
lint/code review and Taki trellis-check remain required. Preserve unrelated native files when running formatters.
Real-model semantic quality, original-data activation and B7 remain separately identified acceptance boundaries.
