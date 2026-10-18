# Stage 5B template lifecycle design

Status: engineering design reviewed under approved Stage 5 scope. The independent confirmation's final label
removal correction is applied. 5A independent acceptance and ownership release are complete; the post-5A live
migration/build readiness checks in `implement.md` passed on 2026-10-07. Ready for B1 implementation.

The seven findings in the [independent design review](../10-07-hindsight-configuration-observation/research/stage5b-design-review.md)
are accepted as engineering corrections. Sections below and section 8 implement those decisions; the companion
`research/design-review-resolution.md` maps each finding to its required producer/check. No new owner product
choice is needed for this strict implementation path.

## Sources and responsibility

Read the [PRD](prd.md) and [source-grounded research including its follow-up](../10-07-hindsight-configuration-observation/research/stage5b-template-lifecycle-research.md).
The follow-up supersedes the initial suggestion to precompute model embeddings before template application.
Native owns authenticated resource mutation, logical changes, conditional receipts and existing refresh execution.
Core owns the built-in catalog, user revisions, ownership history, desired rollout and current runtime admission.
Home is a disposable operator client. This is not a new Native taxonomy engine, scheduler or generic transaction API.

## 1. Composition and managed enrollment

Keep immutable `taki-bank-v1` and its legacy verifier. Add a new catalog revision containing the existing missions,
definitions and an owned `taki-layer` enum group. Do not rewrite v1 bytes/digests or reinterpret old setup receipts.
Version user customization independently for each exact Bank incarnation. The composition order is inherited
Native defaults/base Bank overrides, the selected Taki contribution, then explicit user values/suppression.

Core stores immutable overlay revisions and captured before-images, plus one CAS-selected applied revision.
The exact additive migration numbers are chosen only against the post-5A heads. Key records by the existing
connection/provider lineage, canonical Global/Character identity and Native Bank generation, never Bank ID alone.
The existing operation journal owns execution; overlay tables store configuration/history/evidence, not a second
operation status machine. Include these logical records:

- Enrollment identity and immutable original Bank-override presence/value and resource definitions/identities.
- Independently numbered user revision, selected built-in revision or explicit `none`, and normalized effective plan.
- Applied selection revision, exact Native request/receipt identity and verified effective-definition digest.
- Connection-wide admitted built-in defaults for new Global/Character provisioning; user changes remain per Bank.

Absence of a Bank override means inheritance. Do not capture resolved server defaults as synthetic overrides.
Use existing PATCH-null/tombstone semantics or equivalent exact SQL key removal when restoring inheritance.
Explicit user value, inherit and suppression remain distinct, including a value equal to an old template value.
Merge label groups by exact group key; owning `taki-layer` does not own the entire `entity_labels` list or
`entities_allow_free_form`. Preserve unrelated groups and free-form entity behavior.

Native replaces the whole `entity_labels` field. Keep original field presence/base separate from the active
materialized reviewed list. CAS that complete list. On Taki removal, recompose from the captured base and surviving
explicit user group values/suppression; restore original absence/tombstone only when that result needs no Bank
override. Never erase surviving user label changes to restore inheritance. Later
parent-group changes require fresh preview/reconciliation while materialized; do not promise live nested inheritance
or misrecord resolved parent groups as historical Bank overrides.

Model identity is Bank + model ID; directive identity is Bank + exact captured UUID. Duplicate name matches are
conflicts, not permission to choose one. Capturing preexisting resources proves an overlaid base, not creation
ownership. An absent-resource precondition followed by insert and receipt in the same transaction proves creation.
Explicitly distinguish fresh creation, deliberately reviewed existing-base enrollment and untracked legacy/collision.
Only the second may intentionally overlay a captured preexisting resource; a normal collision never implies consent.
On removal, restore proven base definitions or remove proven-created resources only when the preview includes
that exact deletion. User-owned custom resources must remain complete after Taki removal, not dangling patches.
External changes after the last accepted state are drift and require a new reviewed preview; never overwrite them.

An old v1 match or ownership tag cannot recover overwritten historical values. Keep legacy runtime/setup support
unchanged and expose untracked enrollment/removal when evidence is missing. Fresh managed enrollment captures the
real state after normal Native Bank creation, including server-default resources. Do not infer whole-Bank creation
from a 404/create sequence or reset Native `ever_used`/pristine provenance.

## 2. Native conditional producer and wire contract

Add a finite optional `template_lifecycle` compatibility contract and a new exact build identity after 5A. Maintain
old identities and every mandatory transition/source/application/result capability. Ordinary allowed Bank write
permissions authorize this lifecycle; 5A model-disclosure grants do not authorize or gate template mutation.
Use the actual authenticated schema, Bank restrictions, operation validators and field permissions; exceptions
in any authorization hook deny. Never trust a namespace, authority proof or permission supplied by the client.

Proposed bounded route family under the existing Taki compatibility router:

| Action | Contract |
| --- | --- |
| Snapshot/preview read | Exact target and requested managed field/resource selectors; returns a coherent read-only snapshot of existing override presence, complete managed definitions and resource identities/revisions/hashes. No Bank/identity initialization. |
| Apply | Core-minted request UUID, immutable payload hash, exact Bank generation, expected snapshot/projections, explicit config/model/directive delta, initialization context only when genuinely valid, and requested refresh choices with stable child UUIDs. |
| Original result read | Same authenticated target/request identity; returns its original committed receipt or truthful absent/in-progress/refused state. It does not infer historical success from current definitions. |

Define strict Pydantic and Shared schemas once per language, with no arbitrary SQL, environment, secret or raw
exception fields. Use the finite limits and existing cross-language codec specified in section 8;
reject oversized/malformed input instead of truncating a precondition. Snapshot and apply canonical hashing
preserves absent versus null, ordered/semantically unordered fields,
empty tags and all managed definition fields including model trigger. A definition-update precondition need not
depend on unrelated generated content; deleting a resource must guard its complete current object, including
generated content/history that the action would remove. Do not use the non-coherent legacy export as a CAS proof.

The Native mutation enters the existing transition writer boundary and uses the established Bank/replication lock
order. In one SQL transaction: verify target generation; reread an existing same-ID receipt; reject hash/target
reuse; recheck actual config/resource preconditions; apply exact deltas; append the existing logical changes or
tombstones; insert requested stable refresh rows; insert the result receipt. Ordinary Native writers use those
same underlying locks and must invalidate relevant state, so a template-only counter is not sufficient CAS.
Fault injection after each write must roll back all rows, journal effects, jobs and receipt together.

Extract narrow validated internal SQL helpers taking the existing connection; do not nest public CRUD calls that
acquire independent connections. Keep model/directive semantics and Native logical-change builders. A request
replay waits for or reads the original receipt and returns the original child IDs, without repeating any admission.
Same ID with a different hash is a conflict. Record target, before/after projection digests, applied deltas and
child IDs in the receipt; never rewrite that historical receipt after a later user edit.

## 3. Derived model generation and retry truth

Definition-only model insertion uses supported `content=''`, `embedding=NULL`, null structured/query state and
existing schema defaults. Do not make content or refresh timestamp nullable. Definition-only updates preserve
current content/embedding. Reads, previews and the configuration transaction make no provider calls.

An ungenerated model is visible as configured but cannot appear in vector-based mental-model search until a
real refresh produces content/embedding. Model freshness must come from actual job/result evidence; the schema's
default refresh timestamp is not success. A plan may explicitly request refresh and acknowledge its potential
provider work. Definition-only application remains valid without model availability and shows ungenerated state.

Extract private refresh admission from the existing `_submit_async_operation` path: accept a fixed child UUID,
validated authenticated payload and the caller's SQL connection. Preserve maintenance/provider/validator and
initialization checks. Insert the complete pending refresh job in the template transaction, reference it in the
receipt, and notify the existing backend only after the winning commit. The durable row survives lost notification.
Do not call public submit after commit, which generates another UUID. Embedded/sync execution must claim/settle
that same durable job before executing; request replay only observes it.

Template-created refresh payloads carry expected definition identity. Check it before generation and inside final
result publication so a later user edit cannot be overwritten by an old job. Extend the shared existing refresh
path with this narrow optional guard; do not create a second refresh implementation or reuse cutover proofs.
Definition-applied, ungenerated, refresh-pending/failed/superseded and runtime-bound are independent facts.

The template-owned Sync path must acquire an exact pending-to-processing execution claim; Worker uses its issued
claim. Validate target/type/payload and owner, and fail closed on lookup errors. Missing, terminal or foreign-owned
jobs do not execute. Freeze the apply-time model revision/hash as well as its full definition identity, and check
both plus live execution ownership under final publication locks. This conservatively supersedes a child after a
content-only edit and closes definition A -> B -> A races. Atomically store a child result marker with generated
content/history/logical publication, including resulting revision/hash and semantic outcome. Crash after content
commit reads that marker; replay cannot duplicate history or replace superseded outcomes with generic success.
Complete this execution/result path in B1 before any admitted template child can run.

Guarantee one configuration commit and one durable child admission per request. Existing worker crash/retry may
repeat upstream model/embedding calls; do not promise exactly-once external execution or billing. Keep original
job IDs and factual outcome/retry state. Tests use deterministic fakes/traps, never original models or paid calls.

## 4. Core rollout, final publication and recovery

Add one cohesive template operation family to the existing memory-operation registry. Reuse its admission,
exclusive-family ownership, persisted original request, status and observer recovery. Proposed stages:

`admitted -> preparing -> quiescing -> applying(bank cursor) -> verifying -> publishing -> rebinding -> completed`

The generic operation owner currently has boot/state CAS but no executor lease. Add template-specific executor
generation/token, boot identity, bounded lease deadline and monotonic checkpoint revision within the existing
operation ownership boundary (nullable additive columns or a typed producer checkpoint with equivalent SQL CAS).
Use the established five-minute/30-second lease/heartbeat policy as the initial bounded timing reference; verify
actual fixture flow and final deadline boundaries. Do not claim the old generic row already supplies these guards.

Persist an unpublished-template-effect hold from the original recorded dispatch/effects versus its selection
publication receipt. It survives generic failed/outcome_unknown terminalization and restart. Once a call may have
been sent, missing response cannot release it. Consult this hold at boot/runtime construction, Run/reflect and
source/background admission, auto-provision/revalidate and every conflicting operation admission. Hold the
Hindsight memory runtime globally during a rollout; use existing memory-unavailable Chat behavior while preserving
primary witnesses. The in-memory backup write fence alone keeps reads/reflects open and is insufficient.
Only explicit recovery of the same operation/plan can cross its own hold. Read-only boot/status never replays work.
Release the hold with the exact selection/publication receipt in the same SQLite transaction, not in `finally`.

Preserve the existing W6 offline emergency exception. A new emergency-local takeover does not resume or
consume held Hindsight state: its synchronous local admission quarantines the old epoch's producers and
preserves exact unknown effects in the incident. Extend that existing inventory/quarantine path to template
plans, executors, holds, dispatches and known receipts before allowing the exception. It must not await Native,
a hung template executor or a fresh backup. Old callbacks cannot renew, publish selections, release the hold
or overwrite unknown outcomes after quarantine. Ordinary conflicting operations remain blocked; an old
quarantined Hindsight branch cannot be automatically reactivated/reentered. Do not release its hold as success.

Admission captures authority epoch, connection/secret/config revisions, fixed Bank set/incarnations, expected
overlay selections, immutable plan and per-Bank Native request IDs. Check this set again before effects. A global
built-in update includes actual provisioned Banks before publishing its new provisioning default; per-Bank user
changes do not become implicit cross-Character defaults.

For active Hindsight, quiesce affected foreground/background writers and source ingestion through the existing
lifecycle/runtime boundaries. Block or degrade new work while an applied rollout is partial. An operation row
alone does not fence Native writers: Native CAS and transition-writer participation still apply. Preserve source
custody, outbox and current authority; no template operation is an authority transition.

Process the fixed Bank list with request IDs persisted before dispatch. A successful Bank remains committed if
a later Bank fails; report partial application and resume the original plan. Verify the original receipt and the
current effective definitions separately, then synchronize real Native changes. A refresh may remain pending
without being falsely reported as generated or silently treated as missing configuration publication.

Publish selections, applied receipt/digest and setup/readiness projections in one short synchronous Core
transaction. After all synchronous read-back, recheck live lease/executor, exact expected revisions, epoch,
connection and Bank identities immediately before commit. No Native I/O occurs inside SQLite. Use a separate
overlay-selection identity for runtime admission; do not redefine historical connection fingerprints.

Rebind through the existing runtime replacement seam. After selection commit, a binding failure recovers only
the recorded committed selection/binding. It never reapplies Native writes or silently restores a previous
template. An explicit no-Taki-overlay selection is a valid runtime state, not a failed setup or empty v1 import.
Enrolled Banks verify selected effective configuration; legacy Banks continue their legacy verification path.

Lost reply/restart reads original Native receipts and child states before deciding the next action. Identity drift
requires reconciliation, not replay against a different instance. Cancellation before effect dispatch can settle
without effect; after a possible/known Bank commit it must retain unknown/partial recoverable outcome. Do not
automatically compensate over newer user edits or describe partial application as cancelled-with-no-effect.

## 5. Per-fact layer production and consumption

Generate the owned `taki-layer` value enum from the existing scope registry: Global profile/activity, Character
relationship/episodes/intentions, plus unclassified. Keep optional/uncertain classification and `tag=true`.
Use Native's existing per-fact extraction/label-entity/tag pipeline in both extraction paths. User suppression
continues to win and is shown as reduced taxonomy coverage rather than secretly overridden.

Tags/entities alone are not classification proof: Native merges caller content-wide entities into every fact.
Capture a tiny typed record from the validated per-fact structured labels before that merge, with owned group,
allowed value, effective group digest and producer version. Persist it in a server-owned sidecar atomically with
the unit and logical revision, bound to namespace/Bank generation/unit ID/revision/payload hash. Do not place
trusted evidence in caller-writable metadata or change existing frozen logical payload hash formats. All actual
mutation/restore/invalidation paths invalidate or explicitly republish exact-version evidence.

Expose bounded authenticated exact-version label evidence under the optional contract and preload it before the
synchronous application-binding resolver. Require current unit's one canonical layer tag, scope, selected group
and genuine structured provenance to agree. Extra reserved caller tags/entities that make the unit ambiguous stay
neutral. Missing old-row/old-build evidence is neutral; per-unit curation cannot mint extraction provenance.
At first Native application binding, supply the existing trusted per-unit label only from this checked evidence.
One valid same-scope label may initialize neutral-safe policy. Missing, malformed,
multiple, unknown, cross-scope, pinned relationship or undisclosed mood-gated intentions evidence remains neutral.
Preserve existing original/curated policy before inference. Do not borrow source-wide/caller tags as per-fact proof,
rewrite raw Native evidence, re-extract old documents or mass-reclassify existing policies.

## 6. Backup, migration, compatibility and rollout

Add immutable Core/Native migrations only at live heads; legacy rows receive no fabricated ownership/history.
Include new Native request/receipt tables in admin backup selection/FK ordering and schema parity. Extend the
paired receipt map/proof where terminal operation remote receipts require verification. Validate restored
selection, target generation, current resource state and original receipts before writers start. Copying SQLite
bytes alone is insufficient; a pre-apply Core / post-apply Native pair must refuse.

Add versioned per-Bank managed-template state to both Core backup identity and Native proof captured inside the
actual backup transaction: generation, enrolled/legacy mode, selected receipt/selection identity, effective managed
projection digest and unpublished-effect state. Require equality for managed template state; receipt membership
alone cannot detect extra Native template changes when Core predates enrollment. Keep the existing Native-ahead
cursor rule for ordinary memory writes. Missing managed proof is not success, including a Core legacy snapshot
paired with a Native managed Bank. Block normal capture during unpublished work; incident evidence stays separate.
Use bounded UUID-based template receipt keys, verify complete receipt identity/hash and include refresh-result
markers and per-fact evidence tables in backup/FK/transition-protection inventory.

Healthy return/reentry retains overlay history and reconciles exact Bank identities. Recreated/restored Banks
with changed generation require evidence-qualified re-enrollment. Preserve pristine-target initialization proof
independently; managed ownership never implies an unused target. Candidate upgrade remains 5D.

The old pristine verifier requires model completion evidence. Add a distinct definition-installed initialization
event on the same transaction as genuine initial enrollment: exact absent-resource insert, initial creation/template,
empty content, null embedding/structured/query state and no fabricated history. Only that exact state can satisfy
the new definition-only case; requested refresh keeps its own real admission/completion requirements. Later changes,
extra resources or different initialization templates still invalidate unused eligibility. Preserve old import proof.
Preexisting server defaults may remain safely enrollable while unused-scope proof is unavailable; do not force it.

New Native API schemas require canonical OpenAPI and all maintained SDK generation, exact finite build admission
and mandatory-contract regressions. Keep 5A observation optional and intact. A changed manifest invalidates old
previews through the whole-manifest hash; do not normalize new fields away or widen a version-prefix check.
Old builds without lifecycle capability retain existing setup/runtime and a truthful unavailable lifecycle action.
No production rollout is performed in this task. Rollback never downgrades schema, deletes evidence or guesses
prior user values; before Native mutation, safe cancellation is possible, and afterward recovery uses receipts.

## 7. Home and verification

Reuse Operations, the typed WS client and existing original-operation subscription/reconnect behavior. Show the
selected Bank(s), template/user revisions, preview changes and provider-work/deletion consequences, conflicts,
desired/applied/bound/derived results and available recovery. Use no browser-owned applied state. Action names
are registered only with real producers. No new prompt/model/admin capability is exposed to the agent.

Derived values retained during rollout are explicitly historical observations with their real observation time.
Provide a bounded Core-owned read of one original admitted child so post-publication completion/failure can be
observed without applying, recovering or refreshing a model. Validate complete original identities and current
local context before and after the asynchronous Native read. Missing, stale or failed observation is explicit,
not a fabricated current pending state. Reads never write SQLite, claim/renew execution, poll automatically or
sweep every child of a full multi-Bank plan.

Acceptance follows the PRD and research test matrix: composition/ownership, authenticated atomic mutation,
duplicate/lost outcomes, derived-job guards, active runtime/custody, real per-fact policy flow, paired restore,
compatibility and actual Home interactions. Use focused gates at Native commit and Core publication milestones,
then independent whole-slice review. Preserve failures and actual exits; use fresh isolated fixtures only.

## 8. Frozen request, snapshot and compatibility details

The independent review's source-backed contract is accepted with these finite lifecycle-v1 limits. Old Native
generic endpoint limits remain unchanged. Reject a whole oversized/unsupported plan before effects; never truncate
before-images or silently split a single Bank's atomic application.

| Field | Limit |
| --- | --- |
| Core rollout Banks | 1..256 unique exact identities; one Native transaction per Bank. |
| Managed config | Three existing mission/instruction keys plus the `entity_labels`/`taki-layer` selector, maximum four. |
| Models/directives | At most 64 unique model IDs and 64 exact directive UUID selectors; at most 64 requested child refreshes, each for an included model. |
| Bank/resource IDs | At most 256 Unicode scalars; strict UUIDs and existing lowercase model-ID grammar where applicable. |
| Names/tags/label values/group keys | 1..512 UTF-8 bytes; at most 32 tags. |
| Mission/instruction/query/directive text | At most 20,000 UTF-8 bytes; empty only when its action/schema permits. |
| Label groups | At most 32 total groups, 64 values per group; one owned optional value group with `tag=true`. |
| Model max_tokens / directive priority | 256..8192 / -1000..1000 integers respectively. |
| Nested JSON | At most 256 keys/items per container, keys <=128, strings <=20,000 UTF-8 bytes, depth <=32, total nodes <=4096. |
| Request/response body | At most 524,288 decoded UTF-8 bytes; enforce request streaming cap before parse and both outbound caps before send. |

Use complete current Native MentalModelTrigger validation, including mode/cron, fact/exclusion/tag predicates,
chunk budgets, response schema and tracing. Do not hash a partial trigger. Preexisting unsupported/oversized base
state refuses enrollment without erasing it. Deletion uses an opaque digest of the complete actual row plus all
removed history/dependencies, including embedding, with bounded displayed consequences. Digest inputs are never
truncated just because the response has a cap.

B1 independent review clarification (2026-10-08): Shared and Native must agree on the structural fields,
normalization, finite bounds and mutual-exclusion rules. Native remains authoritative for cron compilation
through its existing croniter semantics, including supported extended syntax. Do not copy that interpreter
into Shared, add a dependency or freeze a narrower public cron subset. A structurally valid Core preview does
not attest Native cron compilation; Native rejects invalid cron before database/provider effects. Record and
test this server-side semantic-validation boundary instead of claiming identical semantic acceptance sets.

Use `hindsightCurrentStateJson` / Native `current_state_bytes` unchanged for tagged JSON and binary64 encoding.
Hash exact normalized snake_case domain fields with `taki-template-{request|snapshot|definition|deletion|receipt}.v1`.
Keep stored presence as absent/null_tombstone/value; do not asymmetrically expand defaults. Preserve text/Unicode
and ordered definition/tag/trigger arrays. Sort selector sets by UTF-8 identity, reject duplicates, canonicalize
UUIDs to lowercase, reject NaN/infinity/lone surrogates, and bound counts/revisions to safe integers. Request hash
excludes itself but includes target, deltas, expected projections, resource IDs, refresh choice and child IDs.
Freeze Python/TS vectors for non-ASCII/astral/prototype-like keys, null/absence, selectors, tags, triggers and numbers.

Preview/result use an actual read-only REPEATABLE READ transaction and SELECT existing identity/cursor state;
never call INSERT-based replication ensure/lock helpers. Apply enters transition_writer_scope, then locks existing
cursor/generation -> maintenance owner -> transition fence -> canonical Bank/resources/request/jobs in the actual
established order. Sort multi-resource selectors. Preserve final writer lease/fence protection for every new table.
No public CRUD call opens another transaction inside this one. Revalidate exact state under these real locks.

Enforce same-request uniqueness per authenticated schema, storing target lineage/Bank/generation/hash to reject
cross-target reuse without disclosing another Bank. Reread existing receipt before evaluating a stale original
snapshot or current refresh-provider availability; original committed results remain readable after later edits.
Current authorization and target identity still apply. Conflicting effective mutations have one winner; independent
no-ops may each record a receipt with no fabricated logical changes. Timeouts do not imply another writer failed.

After 5A release, recheck Core head 057 and Native head e40b1e8a7d32. If unchanged, allocate Core 058 and a new
unique Native revision descending from e40; otherwise revise against actual heads. Proposed exact build is
`taki-memory-hindsight-0.9.0-template-lifecycle-v1`, contract `template_lifecycle` 1.0.0. Keep exact 5A and previous
builds, immutable migrations/receipts and whole-manifest hashing. Final B1 wire must include label/restore evidence
shapes before canonical generation; code acceptance still waits for actual B2/B3 consumers and whole-slice checks.
