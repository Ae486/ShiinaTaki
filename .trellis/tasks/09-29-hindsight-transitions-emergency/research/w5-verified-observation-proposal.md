# Scoped verified transition observation proposal

Status: research/design only. No additional production changes are authorized or implemented. The completed narrow
patch remains independently recorded by `w5-postcommit-readiness-source-manifest.json` (SHA256
`5f056f60218dbba7a1b574f7f89c63f77b788e394321fb1ab421f2bba3ca2341`). Real services remain stopped.

## Decision and scope

Introduce a service-owned verified observation scope. Preserve the existing publication reader's control flow and
database reads; retain only expensive immutable native verification and the pure Local Bank projection inside that
scope. Every observation still checks the actual stored evidence bytes and recomputes current publication joins.
Do not retain a publication verdict, candidate verdict, binding readiness answer or SQL query result.

This differs materially from caching a whole candidate/publication: `readVerifiedTransitionCandidate` currently
reads ancestry, historical rows, preparation/delta results and current immutable documents. Continuing to execute
that function avoids inventing a second dependency inventory or missing a future database dependency.

The first iteration adds observation-only reuse at two existing explicit boundaries:

1. `TransitionEvidenceContext.read` / `bundle`: complete native verification already produces a frozen evidence
   object and verified body closure. A retained entry can be reused only after a fresh same-DB query matches
   `id`, `transition_id`, `slot` and every stored body byte. Existing caller-object rejection and detached mutable
   body views remain. Full contexts still start empty and close after one synchronous callback.
2. `projectTransitionLocalBank`: this is a pure function of the verified evidence and supplied projection arguments.
   Reuse its deeply frozen result only with the same verified current evidence, optional verified baseline evidence,
   and exact complete semantic arguments. Its current callers still read every dependency before reaching this seam.

This is a proposed implementation, not a measured performance result. The retained default-config failing replay
remains the reference until the actual observer/deadline scenario passes.

## Proposed files and API responsibilities

| Production file | Proposed narrow change |
| --- | --- |
| NEW `memory/transitions/transition-observation-store.ts` | Private domain store for verified native evidence and pure Bank projections; bound to one Database object, one selected receipt and one service lifetime. No SQL/result or authority cache API. |
| `memory/transitions/transition-evidence-context.ts` | Separate observation runner creates a fresh active synchronous context backed by that store. Existing full runner always uses fresh entries. Every retained evidence use rereads exact row identity/body bytes. Observation entries become reusable only after a complete successful publication read; any failed validation discards them. |
| `memory/transitions/transition-local-projection.ts` | Wrap the existing pure Bank projection in a domain-specific observation memo seam. Full contexts always execute the original projection. Observer hits still require current verified evidence membership and an exhaustive argument key. |
| `db/memory-transition-publication-reader.ts` | Add `createTransitionPublicationObserver(db)` with a verified selected-marker read and `close/reset`. Reuse the existing private `readVerifiedPublication` and its complete checks; normal `readVerifiedTransitionPublication` remains a fresh independent validation. |
| `memory/local-runtime-binding.ts` | Add a detached read-only publication-state query (`binding` plus `lifetime` only), sourced from the existing private state/current pointer. It does not read or certify authority. Existing full snapshot/capture/write behavior remains. |
| `memory/hindsight-runtime-binding.ts` | The same publication-state query, including replacement failure, retirement and stop. No new state, listener or authority owner. |
| `memory/runtime-composition.ts` | Expose the two publication-state reads through the existing binding-query helper. Keep full `bindingSnapshot`/`hindsightBindingSnapshot`, recovery and admission methods unchanged. |
| `boot/memory-transition-boot.ts` | Own the observation reader. Keep execution `ready` as it is. Add a separate observer readiness callback that combines current publication state with verified selected-marker/publication observation. Close the observation scope after the underlying service has stopped. |
| `memory/transitions/transition-healthy-service.ts` | Accept optional `observeReady` for `status` and the same read-only service-failure status projection. Preview/admission/execution/finalization continue to use the original full `ready`. Existing fixtures default to `ready`; actual boot tests exercise the new path. |

Focused colocated tests and the touched indexes/specs accompany these nine production paths. No migration, protocol,
native change, worker/thread, timeout/TTL change, driver polling suppression or new dependency is proposed.

The binding-state query is necessary because the existing `snapshot()` combines in-memory state with a full
authority read. It must return a new detached object so callers cannot mutate the binding's private state. It is
explicitly incapable of granting authority or admitting a Run; only the verified observer may label readiness.

## Lifetime and cold start

- One store belongs to one boot-composed healthy service and one exact Database object. It is not a process-global
  registry. Closing the service clears retained bytes, objects and projections. Reopening SQLite creates a new store.
- Keep only the current selected receipt's dependency closure. A new selected receipt drops the prior store before
  seeding; changed/absent/stopped/replaced publication cannot reuse an old binding answer. No time-based expiry.
- For an already published binding during default boot, seed the observation scope synchronously in boot composition
  before any transition client dispatch. Seeding performs the complete existing publication/candidate/native check.
  It does not substitute for the separate full runtime-construction check that already ran.
- For a missing binding or a requested epoch different from the current published epoch, return false without
  claiming authority. The preserved absent path does not need a corpus read.
- A later newly published receipt has no retained entry. Its first observation performs full verification, never
  guesses readiness. A validation failure clears the scope and refuses; restoring valid bytes requires a new full
  seed. No asynchronous/background warmup is required to establish correctness.
- The first cold observation after a newly bound receipt can still be expensive. Validate its interaction with actual
  driver heartbeat/finalization before claiming the complete healthy journey is responsive. If it remains blocking,
  request a separate explicit same-boundary seed handoff; do not silently accept a stale receipt or lengthen deadlines.

## Exhaustive pure-projection identity

The observation memo key must cover every semantic field of the actual `projectTransitionLocalBank` input:

- Current evidence and optional baseline evidence must be objects owned by the active verification context after
  fresh persisted-byte checks. Caller-created objects with the same IDs remain invalid.
- Include complete `scope`, `epochId`, `createdAt`, `previous`, `localEpochIds`, and the baseline's `reusedMemoryIds`.
  Preserve ordering, duplicates and distinction between absent/null/empty values as in the original function.
- Build the remaining input identity by destructuring only the known nonsemantic verification context and replacing
  verified evidence objects with their context-owned identities; include all remaining fields. A future input field
  therefore participates automatically instead of depending on a hand-maintained selected-key list.
- Store only the completed pure result, deeply frozen. Cached JSON must never escape as mutable state; native body
  bytes retain the existing isolated-view contract. Do not memoize a throwing or partially computed projection.
- If an argument changes, execute the original projection and compare it with the freshly read persisted candidate,
  exactly as the current candidate reader does. A changed ancestry or mapping is not permission to accept an old
  output merely because the candidate ID is unchanged.

## Reads and protections retained on every observation

| Dependency | Current producer/check retained |
| --- | --- |
| Selected marker, active epoch and predecessor | `validateSelectedPublication`: receipt/epoch/provider/lineage/checkpoint identity, predecessor closure, active-state selection. Observer never trusts a marker alone. |
| Publication, receipt, proof, candidate and common baseline | Existing schema, content-hash and exact cross-identity readers run on each call. No retained SQL row can hide corruption or deletion. |
| Current and prior native evidence | Existing immutable document identity/body bytes are reread in full before retained verification can be used. A changed body with the old ID, changed slot/transition, missing row or foreign DB refuses. |
| Local ancestry | `readTransitionLocalAncestors` runs again; its current ordered result is part of the pure-projection key. |
| Return historical rows | `historicalRows` reads the actual closed-origin revision snapshots, retired Sources and operation receipts every time. The reconstructed state's complete sorted history still compares with the stored candidate. |
| Reentry preparation, delta and capture | `findPreparation`, `readTransitionPreparation`, `readTransitionDeltaResult`, final mapping validation and `readTransitionLocalCapture` still run. Negative/changed lookups cannot be hidden in a memoized candidate. |
| Scope/proof and checkpoints | `transitionPublicationBanks` and the complete checkpoint loop still execute over byte-verified evidence. Current Hindsight application/native checkpoints retain their namespace, monotonic-cursor and deletion checks. |
| Queue/cutoff | Existing exact intent/replay/sequence/command-hash sequence, count and attempt cutoff checks run on each call. Outcome/progress reads remain the original status readers. |
| Pending/source/parent joins | `classifyTransitionSources` re-reads ordinary validated Pending state, source-command/body and write-parent journals; original disposition checks remain. |
| Primary custody and compacted members | `verifyTransitionCustodyAssignment` retains live group/member/witness/span/Timeline checks and producer-derived consumed-span proof. Legal append/finalize/retract/ingest behavior remains. |
| Runtime publication | Read the current detached in-memory binding state; verify selected receipt/epoch through the observer, then require the original running/published/requested-epoch conditions. |

Normal Local record/policy/Block edits remain legal because the existing publication reader already validates the
immutable committed candidate and relevant historical custody; it does not demand that current editable Local rows
equal their old published projection. Keeping that reader's control flow preserves the distinction. There is no
whole-database revision invalidation and no cache of current Local data or query results.

## Required checks before approval to resume

1. Demonstrate fresh independent COMMIT, bind, boot/reconstruction and data-admission validation still executes,
   even after an observation store is warm. An observation context must not be accepted as a substitute at these
   public entrypoints. Existing full-context expiry and cross-DB/caller-envelope tests remain.
2. Exercise actual boot status cold/warm reads and every lifecycle boundary: absent/failed/retired/stopped; replaced
   same epoch; new receipt; historical requested epoch; DB close/reopen; malformed marker/receipt/proof/candidate/
   baseline; evidence byte/identity deletion or mutation. A failed read must discard partial retained artifacts.
3. Fault each current mutable join separately (custody and consumed spans; Pending/parents/source command; queue/
   cutoff; ancestry/history; current native/application checkpoints). Prove new/removed relevant rows are seen.
4. Use actual Local edits, policy changes, Blocks, legal primary append/finalize/consume and advancing checkpoints to
   show permitted progress remains readable; no global DB-change invalidation should repeatedly rebuild the corpus.
5. Verify projection-key changes for every semantic input, two Banks with overlapping local/native IDs, duplicate and
   ordered Source references, and byte mutation through returned body views. Compare observed validation with a new
   full independent reader in each test, including rejection equivalence.
6. On a NEW default-config committed corpus copy, seed before dispatch, then rerun the exact retained v2 three-turn
   response, unchanged 60-second deadline and actual 10-second polling. Require successful response and truthful ready
   status; record cold seed and warm poll times, source hashes and zero model/network calls.
7. Replay an owned complete driver with real boot observation active and a pending injected heartbeat response across
   native-finalization/bind/final-readiness. The existing full bind/ready boundaries can still be expensive; a green
   observer-only replay is not the same as a completed real RETURN.
8. Run focused type/lint/tests serially with at most two workers, update new manifests separately, obtain independent
   review, then let the parent decide the real-service continuation gate. No real service start is part of this proposal.

## Remaining uncertainty

Retaining native verification plus pure projection may leave material cost in repeated candidate parsing/hashing,
source-set comparison, reentry final-mapping validation or historical inventory. Do not expand to caching those DB
results if timing remains red. Measure the remaining cost and either improve a pure computational boundary or
propose the next smallest explicitly verified seam. This proposal deliberately keeps mutable dependency reads
visible rather than creating a second authority reconstruction algorithm.
