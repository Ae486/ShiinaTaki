# Hindsight Template Lifecycle

## Scope and current boundary

Stage 5B B1 provides pure Core composition/storage and an optional atomic Native template producer. B2 adds
the independently reviewed durable rollout/runtime integration and exact per-fact Native label evidence below.
B3 implements Home and managed backup equality under its separate whole-slice gate. Neither source implementation
nor a producer's self-check is independent acceptance; B3 physical paired restore and current-target admission
remain required even when protocol or individual Native transport checks pass.

## Identity and compatibility

- Optional Native build: `taki-memory-hindsight-0.9.0-template-lifecycle-v1`, contract `template_lifecycle` 1.0.0.
  Preserve old v1/transition/5A builds and enforce the existing mandatory contracts. Compare the complete manifest
  for preview identity; never discard a newly added optional contract before computing its identity.
- Bind requests to authenticated namespace, provider lineage, Bank generation and immutable request ID/hash.
  Existing Bank ID alone cannot confer ownership. Never reconstruct legacy before-images from current v1 equality.
- Core migration 058 persists immutable catalog/user/base/enrollment history separately from applied selection.
  Native migration e51c2f9a8b43 follows e40b1e8a7d32 and adds receipts, child admission and semantic result evidence.
  Historical migrations/receipts remain immutable. Never downgrade populated evidence.

## Composition and review

### Runtime selection identity and full validation

- `readTemplateSelectionIdentity(db, epochId)` retains its full history/receipt/snapshot validation contract and
  all construction, publication, recovery and original receipt-comparison callers. Template-consuming readers
  retain their independent full validation. It is not a cheap ordinary connection guard.
- `readCurrentRuntimeTemplateIdentity(db, epochId)` reads current eligible verified setup, validated checkpoint
  namespace/epoch/deletion, exact enrollment, applied pointer/selected-row metadata and selected-lineage defaults.
  For intact data it returns exactly the full reader's identity: epoch, Bank-id-sorted managed selections with full
  namespace, selection revision, receipt hash and template revision, plus defaults revision. Absent storage or no
  eligible applied managed selections returns null. Untracked/enrolled-but-unapplied legacy Banks remain valid;
  verified non-v1 Banks with missing, wrong-epoch or deleted checkpoints still refuse. New legacy routes remain live.
- Current reads exclude mutable checkpoint cursors, legacy route inventory and unapplied desired user/catalog
  revisions. They do not reconstruct previews or load historical selection documents. Exact enrollment identity,
  current selection column/document metadata and defaults pointer/metadata must agree. Missing current evidence
  refuses; a changed aggregate invalidates the captured connection identity.
- Migration 058 stores no independent effective-projection digest on a selection. The current reader therefore
  extracts only the selected projection and uses the existing digest function to preserve setup-digest drift
  detection. SQLite reads the containing current JSON row; cost is not independent of its size. There is no cache,
  TTL, schema addition, or new link from overlay selections to execution plans.
- Template document bodies changed out of band with current metadata intact are rejected at the next full
  validation (construction, publication, recovery or consuming read). Ordinary guards no longer verify enclosing
  document hashes, historical previews or receipt/snapshot proofs. The selected projection is consumed for setup
  consistency and still rejects a digest mismatch immediately. Full-reader corruption tests must not be weakened.

### Applied choices

- Preserve stored absence, tombstones and explicit values separately. User values equal to an earlier template
  value remain explicit choices. Reset reveals the current underlying template/base; suppression is deliberate.
- Capture actual config/resource before-images and exact target identity before enrollment. Unreviewed collisions
  refuse; removing Taki restores captured/inherited values while retaining complete user resources and surviving
  user label overrides. Unowned captured resources cannot be deleted through suppression.
- Keep the original v1 catalog byte-stable. New versions and explicit user revision history are independent.
- Managed v3 changes only the retain mission to preserve source attribution, conditions, uncertainty and historical
  time; questions/suggestions are not confirmed user facts, and plans are not completed events. Keep v2 definitions
  and digests immutable and selectable. New managed choices use v3; existing Bank selections/defaults change only
  through explicit preview/apply, preserving user values and suppression. Legacy setup remains v1.
- An externally changed value/group must be preserved or explicitly adopted in the user revision; a reviewed
  snapshot hash alone is not permission to overwrite that drift. Native inherited changes may recompose.
- Original receipt identity is immutable. Validate current proof progression for every model and directive,
  including requests without refresh children: revisions cannot regress; equal revisions require equal payload
  hashes and equal complete definitions. A definition change therefore requires a higher revision. Legitimate
  later refresh/content revisions remain admissible when the effective definition still matches the applied one.
- Validate logical progress only on the original receipt: a Core preview containing effective config/resource
  deltas requires `journal_after > journal_before`; a no-op or refresh-admission-only preview requires equality.
  Do not require an exact event count or reinterpret the original receipt clock from a later current readback.

## Native transaction and reads

- POST `/ext/taki-memory/template/snapshot`, `/apply`, `/result`, `/refresh-result` use actual Bearer/tenant/Bank/action/
  field permissions. Validator exceptions refuse. Read-only operations do not require 5A model-disclosure grants.
- Snapshot/result use read-only repeatable-read transactions and SELECT existing identity; never ensure, initialize,
  embed, enqueue or mutate during a read. Enforce strict duplicate-key/body/response and bounded-object limits.
- Apply checks immutable receipts before new writer admission and provider availability. New writes use the
  established writer scope, Bank/maintenance/fence order and coherent CAS snapshot. Config/resources, logical
  events, stable optional refresh admissions and receipt commit together. Recheck the live writer lease after
  final read-back/receipt insertion, immediately before leaving the transaction.
- Definition-only model creation uses empty content and null embedding/structured/query state. Preserve schema
  defaults and report ungenerated state; a timestamp is not model success. Definition changes preserve content.
- New effective overlapping changes have one CAS winner; independent no-ops can each get immutable receipts.
  Same request/hash recovers its original outcome; changed hash/target refuses. Only committed new admissions
  notify the backend. Notification failure preserves the receipt and durable child.
- Complete deletion proof includes real model rows, embedding, history and recursive knowledge-page dependencies.
  Do not replace this opaque destructive precondition with a definition hash.

## Refresh publication ownership

- Reuse the existing full/delta refresh pipeline. Sync must acquire the actual pending-to-processing durable claim;
  Worker must supply its issued worker ID and claim timestamp. Persisted admission classifies the child even if a
  transport caller removes its discriminator, preventing fallback into unguarded legacy execution.
- Check exact immutable payload, claim, definition hash and original object revision/hash before model work,
  before embedding, and again under final transaction locks. A-B-A edits cannot satisfy an old object revision.
- Provider checks follow the actual execution tree: cutoff/preparation, reflect tool loops, delta and structured
  output, and every LLM retry after its concurrency permits are acquired. A template-only inherited context
  checks the exact claim/definition and live transition writer lease in `wait_for` child tasks; the publishing
  guard stays with its original owner Task. Ordinary calls add no claim/database work.
- Ownership failures bypass ordinary provider fallback. Revoke inherited provider scopes when the owner exits
  or is cancelled; copied/detached contexts cannot start new work afterward. Existing cache cleanup may finish.
  Embedding admission is checked before executor submission, and drift during embedding still fails the final
  locked SQL check. Work already submitted to a provider cannot be recalled or claimed billing-exactly-once.
- Publish content, history, logical change, semantic result marker and guarded terminal queue state atomically.
  Replayed semantic markers precede current-definition checks. A crash after content COMMIT must not create
  duplicate history. Generic Worker completion/retry paths must not overwrite template child settlement.
- One child admission is guaranteed; upstream/model billing exactly-once is not. A crash before a semantic marker
  can require the same child's retry and repeated external work. No actual paid providers are used in self-checks.
- Genuine `definition_installed` initialization proves exact fresh empty/null rows and original creation identity.
  It is distinct from completed import/refresh and cannot reset `ever_used` or manufacture pristine eligibility.

## Wire hashing, evidence and verification

- Shared and Native use the unchanged D78 tagged JSON codec with separate template domains and identical static
  vectors. Snapshot hash excludes its own field; request hash excludes its own field; definition hashes cover
  the full normalized definition directly. Preserve complete optional trigger spelling and supplied presence.
- Shared/Native validate lifecycle-specific config values, structured response properties/required references,
  unique label values, finite nested tag groups and lifecycle model IDs consistently. Reject ambiguous tag-group
  discriminators and Python-only input aliases without narrowing the legacy Native DTOs or endpoints.
- Shared validates finite trigger structure and mutual exclusion; Native's existing `croniter` compiler owns
  cron semantics, including its supported extended syntax. Invalid cron refuses during request validation before
  engine/SQL/provider effects. Do not introduce a Shared cron interpreter or a narrower public cron subset.
- Core effective projection digest excludes snapshot hash and per-resource proof, while retaining target,
  selectors, stored/inherited config and definitions/name matches. This is not a generic whole-Bank digest.
  B3 must explicitly align backup proof with that exact projection before claiming managed backup equality.
- Label/backup evidence schemas in OpenAPI are shapes only until their B2/B3 producers exist. Do not add public
  placeholder endpoints or claim trusted policy classification from caller tags/entities.
- Native administrative backup inventory must include receipts, children and refresh results in FK dependency
  order and preserve nonempty original evidence through physical restore. This necessary B1 inventory slice
  does not implement B3 managed paired equality or its receipt producer, and does not relax existing archive
  version, column-compatibility, historical migration or offline restore requirements.
- Existing transition auxiliary witnesses include the exact PostgreSQL rows of all three lifecycle evidence
  tables. A no-op receipt changes this complete-state witness even when logical/application cursors are stable.
  Older schemas with none of the three tables retain their existing witness; partial table availability refuses.
- Run actual isolated SQL/auth/rollback/concurrency/claim tests, cross-language codec vectors, meaningful pure
  composition/storage/migration tests and canonical SDK generation. Explicitly write OpenAPI to
  `hindsight-docs/static/openapi.json`; the generator module's command-line default is root `openapi.json`.
  Check all implemented routes plus schemas in the actual canonical input before starting client generation.

## B2 Core executor lifetime

- Bound the operation owner's rollout wait to its stop/emergency/deadline signal even when an already sent
  Native transport ignores abort. Cancel executor heartbeat and deadline timers immediately on abort, without
  waiting for that transport to finish. Keep the existing lease duration and guarded settlement semantics.
- Ordinary shutdown settles the owner before SQLite closes. A possible Native effect remains `outcome_unknown`
  with its active hold; W6 retains the quarantined hold and old executor evidence. Cancellation never invents
  success, releases a possible-effect hold or revives the old epoch. Consume detached promise failures, and
  check cancellation before late continuations access SQLite or publish a receipt, checkpoint or selection.
- Verify both ordinary stop and actual W6 takeover followed by the production stop order and physical SQLite
  close. A fake Native Apply may commit after cancellation, but its late reply cannot change local evidence.

## B2 explicit derived observation

- Core `memory.templates.derived` accepts a strict `{ planId, bankId, childId }` and reads one child already
  admitted by that original plan and receipt. Reuse Native POST `/ext/taki-memory/template/refresh-result`;
  this operator method adds no Native route or DTO. A plan without its receipt returns `not_observed`.
- `observed` contains the verified Native result and this read's `observedAt`. `stale` reports
  `identity_changed` or `quarantined`; `unavailable` reports `not_observed`, `connection_unavailable`,
  `unsupported`, `request_failed` or `invalid_evidence`. Both non-observed states have `observedAt=null`.
- Check the original plan/receipt/request/target/model/definition identity and current local connection,
  configuration/secret revision, epoch and Bank identity before and after the bounded Native awaits.
  Stop/deadline signals refuse a late observation even if its underlying client completes afterward.
- The owning service's stop signal cancels both derived reads and preview before new or late database access.
  Preview captures its local guard before the first compatibility await, so an intervening configuration A-B-A
  change cannot become the reviewed plan's baseline merely because the final values match.
- The read does not persist an observation, acquire or renew an executor, submit model work, automatically
  poll or enumerate every child. Existing rollout status keeps its historical child observations explicitly
  marked `source=rollout_record` and their original `observedAt|null`; reopening status cannot claim a fresh read.

## B2 structured-label origin and exact publication

- Capture the original structured provider `labels` field in both ordinary and Batch API parsers before caller
  entities are merged. Only one exact scalar value in the selected complete `taki-layer` value group is eligible.
  Lists, stripped/case-folded alternatives, duplicate reserved-key spellings and unknown values are not proof.
  The ordinary Native parser may still retain useful facts; this optional evidence remains absent.
- Preserve parser-owned field-occurrence evidence before JSON decoding collapses duplicates. The selecting
  `facts` and `labels` containers and the exact `taki-layer` scalar must each be observed once in original JSON.
  Duplicate identical/escaped keys remain ordinary last-value data, without an extra model retry, but cannot
  establish classification. This quality is private Python state, never a public JSON marker or caller metadata.
- Native raw-text decoders share the strict JSON entry without changing their syntax/repair/retry policies.
  Repaired/scrubbed or rewritten JSON and already-decoded SDK/tool dictionaries carry no original-field proof.
  Such facts stay useful and neutral; no test-dictionary exception may bypass the production rule. Genuine
  positive fixtures must pass controlled original text through the actual parser, including ordinary OpenAI
  and Batch paths. Typed tool inputs whose original field uniqueness is unavailable remain neutral.
- The invocation-local ConfigResolver success marker belongs to the same resolution used for extraction.
  Tenant-hook exceptions and malformed replies, including falsey non-dictionaries, cannot issue that marker.
  Bank-config read/JSON-decoding failures and malformed values cannot issue it either, even when the inherited
  group equals the materialized Bank group. Missing, null or empty Bank overrides remain legitimate inheritance.
  Preserve it as a private setting inside the existing Native prepared-plan hash. Old plans and plans prepared
  after tenant fallback carry no such setting; a later successful resolution cannot upgrade them. Existing plan
  hashes/receipts retain their original bytes and meaning. No public DTO, metadata or Fact field accepts the proof.
- Carry the private origin through Fact, ExtractedFact and ProcessedFact, including filtering and actual returned
  database IDs. Verbatim collapsing and chunks mode have no single-fact structured origin. Publication rereads the
  final canonical payload after entities/tags are written; do not add provenance to the frozen logical hash domain.
- Native accepts the exact fixed encoded Global Bank and lowercase opaque Character Bank grammar. Core separately
  checks its complete canonical binding and registry. Do not infer scope from a caller label or copy Core taxonomy
  into Native. Hash the valid complete supplied group with the existing template `definition` domain, preserving
  omitted fields and array order. Existing Native type inference remains valid; do not require optional/unclassified.
- Positive publication requires the actual materialized Bank group in the same locked SQL transaction to match
  the captured group. Dynamic inheritance has no revision proof and remains neutral unless independently proven.
  The final valid world/experience payload must contain exactly one identical reserved entity and reserved tag.
- Native migration e62a3d0b9c54 follows e51c2f9a8b43. Immutable `memory_template_label_proofs` retain the original
  and previous proof links; mutable `memory_template_label_heads` alone grant current authority. Exact target,
  unit revision/hash, current group, producer and original chain are checked on reads. Both tables use the existing
  Bank writer guard; history also uses the immutable guard. Populated evidence refuses downgrade.
- Run label publication at the outer logical append even when application capture is disabled. Ordinary edits,
  imports, invalidation/revert, unit/document deletion and Bank retirement delete current heads. Even a same-UUID,
  same-revision, same-hash ordinary append cannot recreate proof from retained history or caller tags.
- Consolidation bookkeeping captures the old exact head and complete payload under the Bank lock before UPDATE.
  Only revision +1 and consolidated/failed marker changes may publish a linked proof for the new exact version.
  An additional payload change invalidates it. Source markers, logical append and sidecar publication roll back
  together on failure; matching tags alone never authorize a bookkeeping renewal.

## B2 label reads, inventory and Core consumption

- POST `/ext/taki-memory/template/label-evidence` accepts at most 256 exact unit versions and returns a proven
  subset. Require real Bearer/tenant authentication, allowed Bank, GET_MEMORY_UNIT/GET_BANK_CONFIG actions and
  `entity_labels` field visibility; hook exceptions refuse. This read does not need the 5A model-disclosure grant.
  Use a SELECT-only repeatable-read transaction with no identity creation, provider work or command enqueueing.
  Inherit the existing duplicate-key/body/response bounds, sanitized failures and no-store response handling.
- Capability support checks actual PostgreSQL sidecar presence and enabled writer/history trigger identities.
  Admin backup restores proofs before heads and preserves nonempty history/current pointers through real COPY.
  Transition auxiliary witnesses include both tables' exact rows; old schemas with neither retain their earlier
  witness, while a partial pair refuses. Check this pair independently of the earlier three B1 evidence tables.
- Portable export explicitly classifies these and all other instance-owned operational tables as omitted.
  Maintain an exact inventory parity test that fails on an unknown table; never hide drift using a computed
  BACKUP_TABLES difference. Portable import preserves legal user facts/config but cannot transplant proof authority.
- Core loads evidence only before first provider-derived policy binding, outside writer preparation and SQLite
  transactions, checking the request and selected group both before and after the await. Reject duplicate,
  unsolicited and mismatched target/lineage/generation/unit/version/hash/group/producer/scope evidence. A single
  canonical reserved tag, full Bank identity and registry value are required; existing/original/rebound policy
  keeps priority. Replaying one persistent binding intent does not issue another label read.
- Missing/unsupported or label-only malformed proof stays neutral. Authentication, cancellation, timeout and
  identity failures retain their existing refusal behavior. Disclosure remains null and the existing pinned and
  mood guards apply; inferred provenance does not grant those policies.
- Integration acceptance uses a real owned HTTP listener and fake Native providers through extraction and
  consolidation, then the actual Core client/replica/binding/application-command/Canonical projection with a
  physical SQLite reopen. Preserve real HTTP exchange records. Two independent hand-written JSON fixtures are
  not producer-to-consumer evidence; no paid provider or original service/data is admitted by this test scope.

## B3 Native template backup production

- The optional `template_backup` 1.0.0 producer uses build
  `taki-memory-hindsight-0.9.0-template-backup-v1`. Preserve prior build compatibility, mandatory contracts and
  complete-manifest preview identity. Existing lifecycle request/receipt/hash domains and the older
  `TemplateBackupEvidence` component retain their meaning. Shared and Pydantic use strict, separately named v2
  request/proof/archive/observation variants; no failed v2 request may fall back to v1.
- Canonical schema registration reuses the actual observation route's public request/response graph, including
  FastAPI's distinct `TemplateChanges-Input` and `TemplateSnapshot-Input` references from the original Apply.
  Add only otherwise unreachable v2 proof/response/archive roots in the evidence hook. Encode additions through
  FastAPI's Schema model before comparison, validate every substantive collision before publishing any addition,
  and preserve nullable fields, complete references and existing lifecycle/label component meaning. Do not strip
  Input/Output suffixes globally or create placeholder routes to make a generator pass.
- The request carries one exact target per requested Bank and either no selected request or the complete original
  selected `TemplateApplyRequest` plus its receipt hash. Recompute its original request/snapshot hashes, validate
  selectors and plan, then compare the actual receipt and SQL identity before using its selectors. A newly hashed
  selector list is not an original receipt anchor. Removal remains an explicit selected `none` application in Core.
- Native exhausts each exact lineage/Bank/generation's complete receipt history on the COPY connection, without
  filtering by Core-supplied operation IDs. Validate each full DTO, receipt hash and SQL identity, including no-op
  and refresh-only applications. Keyset pages bound per-page materialization, never the proven inventory. Missing
  storage, query failure or a corrupt nonselected receipt refuses; none means empty history only after a successful
  independent read. An unselected request with nonempty history returns that true inventory for Core to reconcile.
- Existing requested-operation membership also recognizes `template-receipt:<UUID>` and, when Core requires it,
  `template-refresh-result:<child UUID>`. The latter requires a real terminal semantic-marker row bound to the
  original receipt child. Pending/processing or a generic worker failure does not imply marker existence. Native
  permits actual `completed`, `superseded` and `failed` markers, checks paired nullable result fields and requires
  nonnull result evidence for `completed`; the full independent Apply inventory remains separate from this ID list.
- The database-only projection uses SELECTs on that same connection. It preserves target, original selectors,
  stored absence/tombstone/value, complete model/directive definitions and directive name matches. Omit only the
  inherited config values compared with the full B1 definition projection. Generated content, object deletion
  proofs and refresh history do not become template-definition equality. Ordinary content/cursor progress stays legal.
- Actual inherited configuration comes from the serving MemoryEngine, authenticated RequestContext and its
  ConfigResolver. Resolve all four inherited template fields even when stored overrides mask them. Use the
  invocation-local success marker with strict tenant failure, not fallback. Recheck Bank/action/field permissions
  and resolver/backend/extension/config/context lifetime through the final observation and seal. An exception must
  not put raw SQL, configuration or credentials in response/CLI traceback output.
- PostgreSQL repeatable read does not freeze dynamic tenant configuration. Record an actual `local-service`
  (route c) or `authenticated-service` (HTTP read) observation with request/schema/inherited-value commitments
  and bounded time; the HTTP response also echoes its fresh request nonce. Context identity contains authenticated
  schema, tenant ID, API-key ID and extension class;
  only its hash crosses the wire. It contains neither credential material nor incidental process/boot/object IDs.
  Fresh compatible service sessions can therefore observe equal state. In-flight source replacement revokes the
  old observer; equal before/after samples do not establish a tenant revision or rule out ABA.
- `POST /ext/taki-memory/template/backup-observation` is an authenticated SELECT-only read under repeatable read.
  It is independent of the default-off filesystem backup endpoint, creates no archive/state, and starts no model
  or worker. Its exact `{version:2,nonce,requestHash,schema,proof}` response has no ZIP fields. Responses and typed
  failures carry `Cache-Control: no-store`, with duplicate JSON keys and ambiguous/nonfinite values refused.
- Managed route b uses the actual `hindsight-admin backup --taki-request ... --taki-service-url ...
  --taki-api-key-env ...` producer. The last option names a preexisting environment variable; no credential-bearing
  URL, inline API key, supplied observation file or alternate CLI MemoryEngine proves service configuration.
  Independently join the service's exact targets, complete inventories, original anchors and database facets to
  the CLI's own transaction, using fresh nonce/request/schema binding. Preserve that service observation unchanged
  but keep ordinary cursors and COPY streams from the CLI snapshot, even if the service's ordinary cursors are newer.
- Reobserve before publishing the v2 archive and refuse detected config/source/facet/inventory changes. A failed
  v2 capture removes its unfinished `.partial` file; the CLI replaces a completed output only after successful
  validation and flush. Fully offline v2 requires every target to be unselected with independently empty template
  history. Managed capture without live service/context refuses explicitly. Normal Native and v1 backups remain legal.
- Keep the 640-MiB compact UTF-8 request cap and 512-KiB per-Apply cap independently; the observation wrapper has
  an additional fixed 128-byte allowance. Backup/observation response limits are 2 MiB and the produced v2 manifest
  limit is 4 MiB, with existing 256-Bank/one-million-operation cardinalities. Bound HTTP/file input before parsing,
  including bytes read after file stat. These are transport limits, not a low-memory or performance guarantee.
- The v2 archive producer checks serialized manifest bytes before file publication; Core's paired archive/admit/
  preflight consumers own the corresponding 4-MiB pre-parse reads. Historical generic Native `_restore` retains its
  existing parser and receives no new global manifest cap. Native physical restore retains version/column checks,
  FK order and atomic COPY of the complete B1/B2 evidence tables. Do not describe generic restore as invoking Core.
- Paired restore requires the copied Core selection/default/history/publication and clear-hold attestation, Native
  independent inventories, and a fresh actual target observation in the explicit stopped-writer D91 preflight.
  Historical artifact integrity and current-target configuration readiness are different verdicts. Writers start
  only after that operator/harness check; B3 does not add automatic restore/boot orchestration. Healthy transitions
  retain W9 final lease/publication guards, while W6 stays offline and keeps quarantined B2 outcomes.
- Healthy per-Bank observations request only that Bank's verified Apply receipt IDs and Core-observed terminal
  semantic refresh IDs. Complete W2 auxiliary rows independently join each requested refresh marker to its exact
  SQL child/Bank, original request/target/model/definition, terminal state and paired result fields. Complete Apply
  inventory remains a separate commitment; membership of one terminal marker cannot replace it.
- Reusing a saved W2 proof or final candidate reobserves the original schema and authenticated context after the
  current fence/status checks, without another maintenance run or rewriting the original evidence bytes. Check
  current Core/default/hold state around that I/O. Preserve the final W9 live-lease ordering at publication.
- Acceptance includes actual route c, actual managed CLI over an owned HTTP service with an independent SQL
  snapshot, and customized/removed physical COPY plus Core paired preflight. Preserve full original receipts,
  children/semantic results and nonempty B2 label sidecars; user definitions and explicit surviving overrides must
  persist. Common wire/hash vectors alone do not satisfy this gate. Canonical OpenAPI/client generation follows
  the existing checked-in specification path and never hand-edits generated models.
- The joint customized/removed drill must admit a real nonempty refresh through Core's original Apply and Native's
  claimed execution path with a deterministic provider. Bind the original copied-Core request/receipt/child to
  its completed SQL marker, queue settlement, generated user-model content/history and post-restore HTTP result.
  In the removed case these remain the earlier customization's commitments. Assert positive child/result/archive
  row counts as well as full-table equality; an empty table cannot satisfy physical recovery acceptance.
  Freeze source plus Core/Shared fixture JSON, package/config/lock and isolation/cleanup inputs before this joint
  run. Retain subprocess/CLI argv, outputs/exits, original artifact digests and exact owned target cleanup.

### Synchronous Core template history reads

Healthy transition request guards reuse `readHindsightTemplateComponents(db, input)`. Each invocation owns one
synchronous SQLite read transaction and one private history reader keyed by the complete `templateIdentityKey`.
Initial histories, execution/publication checks and defaults share that reader; each distinct Bank incarnation
still passes the complete original history validator. Nested callers use the existing savepoint wrapper.

`readHindsightTemplateBackupExecution`, `assertHindsightTemplatePublicationIdentity` and
`readHindsightTemplateBackupDefaults` accept an optional third `HindsightTemplateBackupHistoryReader` argument.
Their default reader remains an independent database read. The shared reader is internal to the components call:
it cannot escape into its returned DTO, a later invocation, an HTTP await, a write or another Database owner.
Keep requested Bank targets separate from additional histories referenced by defaults or prior publications.

All original document hashes, applied/default pointers, hold, receipt, publication and identity comparisons remain.
Malformed history retains its existing validation error; unpublished effects retain
`HINDSIGHT_BACKUP_TEMPLATE_UNPUBLISHED`; the transition guard continues mapping refusals to `MEMORY_TRANSITION_STALE`.
Global-only input must still validate referenced Character history while returning only the requested Bank.
Another generation of that Character must not inherit its predecessor's selected receipt.

Regression coverage must prove complete commitment equality, one full history load per identity within each call,
fresh reads and corruption refusal on the next call, out-of-input historical dependencies, incarnation separation,
independent helper defaults and nested-transaction rollback. Repeated checks around network awaits remain required.
Reuse `readHistory(identity)` inside the current read snapshot; do not retain a previous components result or a
successful configuration verdict across requests. Profile real connected work before changing these guards.
