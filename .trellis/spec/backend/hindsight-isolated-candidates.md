# Hindsight isolated candidates

## 1. Scope / Trigger

D1-A provides experimental same-version archive admission and an immutable candidate verifier under
`packages/core/src/memory/hindsight-candidates/`. It is independently accepted for deterministic
source behavior. D1-B adds controlling-Core persistence and the registered Memory Operations adapter;
it has no installed Host producer. D1-C/D still own actual restore and runtime verification.
Preserve the existing [paired-backup](./memory-hindsight-backup.md) and
[template](./hindsight-template-lifecycle.md) contracts; D1 does not publish authority or upgrade models.

## 2. Signatures

- `admitHindsightCandidateArchive({ corePath, archivePath, manifest, targetSchema })`
  returns `{ inventory, inventoryHash }` or throws `HindsightCandidateRefused`.
- `verifyHindsightCandidate({ ...admission, ownership, observer?, signal?, missingCredentials })`
  returns `HindsightCandidateVerification`: `refused`, `unverified`, or `baseline_verified`.
- Internal `CandidateObserver`: `observe()`, `assertCurrent()`, optional `openInventory()` and
  `client(endpoint)`. A snapshot supplies its actual schema, `copyTable(name)` binary streams and `close()`.
  These interfaces are dependency ports, not public JSON evidence issuers.
- `@taki/shared/hindsight-candidate-domain` owns strict prepare/inspect/resume requests, original
  dispatch/resource/restore/observation records and closed `HINDSIGHT_CANDIDATE_*` codes.
- `createHindsightCandidateService({ db, currentGuard, resolvePlan, driver })` supplies existing-request
  lookup, synchronous admission/persistence, deferred execution, cancellation and original outcomes.
  Neither public requests nor stored JSON can supply `resolvePlan` or the Host driver.
- `observeHindsightCandidateOperation(db, operationId)` reads an operation-specific committed receipt.
  Core wires this local callback even when fresh candidate admission has no configured driver.
- Controlling-Core migration 060 owns the five `hindsight_candidate_*` tables. Its imported
  `HINDSIGHT_CANDIDATE_DOMAIN_SQL` is frozen migration lineage; later schema changes need a new migration.

## 3. Contracts

Shared owns `hindsight-candidate-schema.ts`, version 1, profile
`same-version-postgresql-sql-bodies-v1`. The current profile pins v2 backups, Core migration head 59,
Native head `e62a3d0b9c54`, `taki-memory-hindsight-0.9.0-template-backup-v1` and upstream
`4b2041eb3de5c4235f4a3dd5619fc47cce782e29`. Version/schema changes require a reviewed profile and actual
producer evidence; never relax original-version restore or renumber applied migrations.
Controlling-Core head 60 does not change the accepted archived-Core profile at head 59. A later
head-60 source profile must be admitted with its actual producer before the D1-C/D current-version
runtime gate; never migrate a head-59 archived copy to make it pass.
Historical fixture producers explicitly cap migrations at their archive profile and keep that cap
on reopen; the default general fixture still follows the current registry. A current-head fixture
must exercise explicit unsupported refusal until its own archive profile is admitted.

Admission preserves all supported Native tables across primary/history/body/application/control/
Pending/template families. The current 61 names match Native `BACKUP_TABLES`; the count alone is not
completeness proof. Ordered column names/types must match the stopped target. `alembic_version` and
`bank_stats_cache` are explicitly classified migration/derived objects, outside preserved-row equality.
Unknown tables, extensions or body backends require support before admission. Document body references
must resolve to unique SQL file-storage keys with non-null data.

COPY equality hashes each binary tuple, then hashes the sorted tuple hashes: preserve duplicates,
NULL versus empty, and binary bytes independently of row order/ZIP compression. Payloads stream;
row digests and body-key collections still grow with cardinality, and admission rereads archives for
existing deep verification. Manifest/table limits are bounds, not throughput or constant-memory claims.

Core input is a completed immutable copy: regular single-link file, no WAL/SHM/journal sidecars,
whole-file hash/size checks before and after, existing copied Bank/receipt/template attestation and
contiguous migration history. Use `openReadonlyDatabase`, never ordinary Core construction, migration,
job execution or repair. Reuse legal Native-ahead pair semantics unchanged.

Freeze admission paths/schema and verifier manifest/ownership before asynchronous work. Derive the
endpoint only after Host resource/ownership validation. Compare full restored snapshots before and
after authenticated v2 template preflight; recheck source/candidate observation, archive/Core bytes and
session currency before returning. A source restart may differ from historical capture identity;
current physical exclusion and historical backup provenance are separate facts.

**Required later producer:** authenticate original backup/request/Core/archive/capture-environment
evidence; establish full actual schema objects/types/constraints/triggers, PG/extensions/artifact
identity; bind all source exclusions and the candidate to real Host/installation/engine/image/
container/volume backing/attachments/PG/startup/listener. Obtain schema and COPY streams from that
same candidate under read-only snapshots. Enforce session identity at dispatch and across replacement.
Prove migrations/workers/maintenance/webhooks/models remain fenced and due/processing rows unchanged.
Caller inventories, digest strings, labels or matching synthetic objects cannot establish these facts.

D1-B admission joins the existing Memory Operation transaction. Resolve an existing `requestId`
before fresh source/custody admission, return its original operation, and refuse changed input.
The candidate ID, Memory Operation ID and Run/Attempt/Effect IDs remain separate. Store bounded
plan/request/guard commitments and original Host effect links; generic state and scheduling stay
with Memory Operations. The `hindsight-candidate` family shares the existing exclusive-family guard.

Reserve and restore have one immutable dispatch fence each, joined to real Core Effect records.
Unknown effects cannot be replayed. `candidate.inspect` cannot dispatch; explicit `candidate.resume`
uses fresh operation currency and may observe original resources or dispatch only an unfenced step.
Stopped storage has no fabricated API listener. Restore receipts bind the original request/archive/
physical identity, and baseline evidence binds the preserved inventory and actual verification identity.
Close the driver scope on completion/failure so a detached callback cannot read or mutate a closed DB.

A driver return alone cannot complete an operation. Seal an operation-specific observation after
accepted facts; boot reads only that receipt, with no Host calls or fresh credential lookup. An older
candidate baseline cannot complete a newer interrupted inspection. Missing fresh producer wiring
refuses before candidate admission, while local receipt classification stays available.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Missing file / failed read | `absent` / `unreadable`, preserving the subject. |
| Bad hash, body/entry/row mismatch or asynchronous drift | `tampered`; no verification publication. |
| Missing required table/column/body | `omitted_required_data`; never empty successful inventory. |
| Unsupported version/schema/type/body backend or live sidecar | `unsupported`. |
| Wrong owner or foreign attachments / source-shared resources | `foreign` / `not_isolated`. |
| Missing observer/provenance/rows/authenticated template port | `unverified` with explicit missing evidence. |
| All internal contracts satisfied | `baseline_verified` for the admitted historical copy; no authority/readiness claim. |
| Reused request with changed input | Closed candidate conflict, original rows unchanged. |
| Dispatch lost reply / stale currency after an effect | `outcome_unknown`; retain original action/resource identity and inspect only. |
| Read-only inspection attempts dispatch / detached driver callback | Refuse before an effect or later DB access. |
| Reopen with a committed receipt and no fresh driver | Reconstruct only that original operation's result from local storage. |

Refusals use closed reason/subject fields and retain recognized backup codes. Names are field/table
labels, never paths, body keys, credentials or raw exceptions. Missing environment or row proof must
prevent contacting the validation service; cancellation/session invalidation suppresses acceptance.

## 5. Good / Base / Bad Cases

- Good: a supported complete pair preserves nonempty body/Pending/template/history state; all actual
  installed producer obligations pass before later runtime acceptance.
- Base: archive admission succeeds without an observer and returns explicit unverified evidence.
- Bad: infer readiness from a synthetic observer, rebuild historical provenance from today's source,
  start copied jobs, silently strip unsupported columns, or replace live Core with the older copy.

## 6. Tests Required

Keep candidate admission/COPY/file/identity/verifier and Shared schema tests, plus existing paired
backup and v2-consumer regressions. Cover each omitted table, malformed COPY/count/digest/column,
duplicate/NULL/empty data, SQL bodies, selected/removed templates, Pending, live sidecars, input mutation,
foreign/shared resources, missing evidence, source/row/file drift and revoked sessions. Assert unchanged
copy/source bytes and no writer/migration calls. Native-profile parity uses actual table names.
Synthetic Native columns/rows/Host identities prove consumer behavior only; actual producer tests
belong to D1-C/D. D1-B/C must prove durable original-operation/restore identity and no replay after reopen.
Exercise the real registered Memory Operation owner as well as repositories. Verify pre-claim cancel,
lost reserve/restore reply, fresh explicit continuation, wrong/shared resources and receipts, scope
revocation and driverless boot classification. Migration tests preserve populated 059 config/receipts,
leave an immutable 059 reader byte-identical, add empty controlling-Core tables and roll back a failed
060 migration receipt. Generated Host/Native evidence remains deterministic evidence only.

## 7. Wrong vs Correct

Wrong: expose `baseline_verified` from caller-supplied physical/provenance objects as deployment readiness.

Correct: use the internal verifier behind authenticated installed producers, keep missing facts explicit,
and accept only the historical candidate baseline after those producers pass actual runtime validation.
C3/C4/D2 retain model configuration, transformation and guarded publication responsibilities.
