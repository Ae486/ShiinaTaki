# B3 paired template backup: dispatch proposal

Status: read-only engineering proposal, 2026-10-08. B1 is accepted; B2 is being implemented by its existing owners.
This document neither accepts B2 nor starts B3. Only this file was written. No tests, builds, generation, services,
models, original data, dependencies or Git lifecycle actions were used for this proposal.

Sources: `design.md` sections 6 and 8, `b3-backup-integration-map.md`, the accepted B1 review, and targeted reads of
the existing backup schemas/producers/consumers, template projection/store, configuration resolver and transition
publication paths. The existing map is reused; its pre-review inventory notes are superseded by accepted B1.

## 1. Recommended delivery

Deliver one strict backup-v2 contract, with unchanged v1 readers, using three separately sourced facts:

1. Core attests its actual copied selection/history/publication and absence of unpublished effects.
2. Native independently enumerates and verifies every template receipt for each exact Bank incarnation.
3. Native observes the selected definition projection using real inherited configuration, independently of receipts.

Use the complete selected original `TemplateApplyRequest` to bind selectors to its immutable receipt. Do not persist
another Native ownership ledger, reinterpret the B1 receipt, or use `latest_request_id` as a Core selection pointer.
Keep ordinary Native cursors ahead of Core legal. A newer template receipt, including a no-op, is a distinct mismatch.

For managed route b, prefer one authenticated, read-only Native observation producer shared with restore preflight.
The CLI compares the service observation with its own transaction's database projection and complete receipt inventory.
It does not construct a second MemoryEngine or treat its own environment as the running service's configuration.
This keeps route b useful when the filesystem-producing admin endpoint is disabled, provided the service can answer
the read-only observation. Fully offline managed capture remains unsupported without a separately proven resolver.

## 2. Versioning and compatibility

| Surface | B3 choice |
| --- | --- |
| Native request, endpoint result, `taki` ZIP envelope, Core sealed/staged manifest | Add strict v2 variants. Preserve the exact v1 variants and their hashes; branch explicitly by version. |
| Native proof body | Add an explicit v2 discriminator and required template evidence. The historical unversioned body remains accepted only inside a v1 envelope. |
| `TemplateBackupEvidence` declared by B1 | Preserve the existing component/export. It has no adequate positive producer. Add a separately named v2 bank-proof component; do not silently give the old shape new semantics. |
| Lifecycle requests/receipts and codecs | Keep lifecycle `1.0.0` and all existing request/snapshot/definition/receipt hashes unchanged. New backup commitments have their own domain/version. |
| Capability/build | Add optional `template_backup: { version: "1.0.0" }` for the real v2 producer. Recommend exact build `taki-memory-hindsight-0.9.0-template-backup-v1`, reconciled with the released B2 build before implementation. Preserve the exact old allowlist and whole-manifest preview invalidation. |
| OpenAPI/SDKs | Export the new named components through the established schema hook and generate canonically. Keep filesystem admin routes hidden as today; the read-only observation route has an actual producer and typed clients. Do not hand-edit generated code. |

New template-capable captures use v2 even when every Bank is unselected. A v1 response cannot satisfy a v2 request,
and parsing cannot strip the extra evidence before verification. Core must not downgrade to v1 after a v2 refusal.
Old-instance operation and genuine historical v1 artifact verification remain available with their original meaning.
Historical v1 validity does not certify template-aware restore readiness. Current managed history or any relevant
unpublished effect requires v2; a v1 artifact cannot be relabeled as an empty template history.

Factor version-specific schema bases: `hindsight-backup-store.ts` currently obtains `StagedCoreSchema` from
`HindsightBackupManifestSchema.shape`, which stops working when that export becomes a union. Do not solve this by
making new evidence optional on a single permissive schema.

## 3. Minimal wire fields

Names below are proposed public names. Use one Shared/Pydantic contract per language, with the existing aliases
where applicable. B2's internal publication/hold reader names are interface requirements, not claims of completed code.

### 3.1 Native request v2

Retain `backupId`, `createdAt`, `providerLineageId`, `nativeBankIds` and `operationIds`. Add:

| Field | Meaning |
| --- | --- |
| `requestHash` | Backup-domain hash of the complete normalized request excluding itself, including all Banks and selected original requests. Echo it in the Native proof and archive envelope. |
| `templates[]` | Exactly one entry for every `nativeBankId`, at most 256; reject duplicates, omissions and extras. |
| `templates[].target` | Exact B1 target: provider lineage, Native Bank ID and generation, sourced from admitted Core setup/binding/replica evidence. |
| `templates[].selected` | `null`, or `{ request: TemplateApplyRequest, receiptHash }`. `request` is the complete original selected apply request from the copied, verified selection chain. |

Resolve generation from actual admitted Core evidence, independently of a nullable replica cursor. If no exact
generation can be established, refuse v2 capture as unproven; do not invent it from the later Native response or
initialize a Bank to make backup succeed. This availability boundary must be visible in the operator result.

Do not send Core hold assertions, selection revision or an expected current projection for Native to echo as truth.
The request's `selected: null` describes what Core selected; it does not authorize Native to declare the Bank legacy.

For a selected entry, Native recomputes the original lifecycle request hash, verifies its target and snapshot/hash
structure, reads the exact receipt and verifies the complete receipt body/hash and SQL identity columns. Only then
use `request.expected_snapshot.selectors`. A bare selector list plus receipt ID is insufficient. The original expected
snapshot is historical input, not the current projection and not a precondition to reapply anything.

### 3.2 Core attestation in the v2 manifest

The copied Core database is the source. Add a bounded `templates` attestation containing:

| Field/group | Required content |
| --- | --- |
| `version`, `attestationHash` | Versioned canonical commitment to the complete attestation, including the exact authority/Bank scope. |
| `hold` | Explicit `clear` plus a digest of the verified B2 publication/dispatch/hold observation. Unpublished or unknown effects refuse normal capture; generic terminal operation status cannot establish clearance. |
| `defaultsHash` | Verified scope-default selections and their immutable history, including explicit `none`. This prevents restore from preserving existing Banks but changing future Character provisioning. |
| Per-Bank `target`, canonical identity | Full incarnation and Global/Character mapping; never ownership by Bank ID alone. |
| Per-Bank `historyHash` | Complete verified enrollment, before-images, user revisions, selection history and relevant pointers. Include desired revisions even when later than the applied selection. |
| Per-Bank `selected` | `null`, or exact applied selection revision/hash, selected template revision (including `none`), enrollment/user revisions, original request ID/hash, receipt hash and actual B2 publication receipt/operation identity. |
| Per-Bank `receiptInventory` | Count and digest of the complete verified Native receipt tuples known to Core for this incarnation, not merely the last selection or this authority epoch. |
| Per-Bank projection commitments | For a selection: the existing full definition projection digest, its database-only facet digest and inherited-config digest. For no selection: explicit absence, not a synthetic empty managed projection. |

An overlay removed with `templateRevision: "none"` remains a selected, evidence-backed incarnation. Preserve user
resources, before-images, suppression and history; do not turn removal into `selected: null`.

Use the B1 chain verification, plus the actual B2 original-plan/publication/hold reader. Do not trust arbitrary JSON
columns or an unverified `hold: false`. Deduplicate the same original receipt reached through recovery only when
target, request hash and receipt hash all agree. Conflicting duplicates are corruption.

`readHindsightBackupIdentity()` currently runs before asynchronous `Database.backupTo`; its ordinary cursor fields
are documented lower bounds. For new template attestation, inspect the completed immutable Core copy and compare
it with the admitted template identity before Native dispatch. Do not describe the earlier live read as exact copied
selection evidence. Reuse the project's read-only copy-inspection pattern; this is not a general restore orchestrator.

### 3.3 Native bank proof v2

Keep ordinary Native Bank/application cursors and the existing requested-operation receipt membership proof. Add
one template bank entry for each requested target:

| Field/group | Native source |
| --- | --- |
| `target` | Actual authenticated schema's lineage and existing live Bank generation, verified against the request. |
| `receiptInventory: { count, digest }` | Complete independent SQL enumeration and full receipt verification for that incarnation. |
| `selected` | Explicit `unselected`, or verified `{ requestId, requestHash, receiptHash }`. These identify the supplied original request; they are not a Native claim about Core publication. |
| `databaseDefinitionHash` | Definition projection with only inherited configuration omitted; generated content/history/proofs remain excluded as in B1. Present only for a selected entry. |
| `inheritedConfigHash`, `definitionProjectionHash` | Actual inherited values and the unchanged complete B1 definition projection constructed with them. |
| `configurationObservation` | Version, actual source class (`local-service` or `authenticated-service`), request/observation binding, inherited-value hash, source-context identity and observation time. Never a fake database configuration revision. |

For `unselected`, projection/config observation is explicitly not applicable. The independent receipt inventory is
still mandatory and can be nonempty; Core then refuses the pair. Native must not hide those receipts or assert that
Core published, enrolled, cleared a hold, or selected its latest receipt.

No full apply requests, raw definitions, inherited values, credentials, provider configuration or million-ID list
are repeated in the response or ZIP manifest. IDs, hashes, counts and bounded provenance are sufficient there.
The original requests remain in `core.sqlite` and the staged `native-request.json` where required.

## 4. Complete receipt inventory and receipt reader

Define a new `taki-template-backup-receipts.v1` hash over the exact target and all normalized
`(request_id, request_hash, receipt_hash)` tuples. Use the existing tagged-JSON/binary64 canonical codec with this
new domain. Lowercase UUIDs, sort by UUID ASCII bytes, reject duplicates/conflicting identities, and freeze cross-
language vectors including the empty inventory. A count/digest cannot mean a sampled or bounded prefix.

Native enumerates `memory_template_receipts` using the authenticated schema and exact lineage/Bank/generation,
without a Core-supplied request-ID filter. Validate each full receipt using the existing row/DTO/hash rules before
hashing its tuple. Include no-op and refresh-only apply receipts. Count neither child state transitions nor later
content refreshes as new apply receipts. A corrupt row refuses; a query or budget failure is not an empty inventory.
Process rows incrementally if needed; do not truncate history to fit a wire-array limit.

Core derives the same inventory from all verified B1 selection history plus actual B2 recorded per-Bank outcomes
for this incarnation. Recovery reuses the original UUID. Normal backup refuses any still-unpublished outcome.
An external/unaccounted Native receipt is a mismatch requiring reconciliation, not a receipt Core may auto-adopt.

Extend both `HINDSIGHT_BACKUP_RECEIPT_MAP` and `readHindsightTerminalOperations()` with actual B2 original Bank
receipt readers. Use bounded ASCII `template-receipt:<request UUID>` keys; Native's `_receipts()` must implement
their membership over the same verified/scoped rows. Do not merely add a documentation row, use the generic
recovery operation ID, or concatenate arbitrary long Unicode Bank IDs into these keys.

Child-result markers remain fully backed up. Require a `template-refresh-result:<child UUID>` membership key only
if Core actually persists a corresponding terminal semantic-marker claim; pending/processing and generic worker
failure do not imply that marker exists. Do not make definition-only or pending-refresh backup require completion.
Keep the existing one-million aggregate operation-ID limit; the independent complete inventory is a separate digest,
not a new unbounded ID list smuggled into this membership field. Any count-limit refusal is explicit and unsampled.

## 5. Actual configuration and the smallest supported route-b extension

### Source facts and local-only feasibility

`admin/cli.py:backup()` loads `HindsightConfig.from_env()` and supplies a database URL/schema/request to `_backup`.
It does not possess the API's MemoryEngine, authenticated RequestContext or tenant extension. `ConfigResolver`
itself has a lightweight constructor, but takes its process's `_get_raw_config()` and supplied tenant extension.
Its current parent-resolution method can log tenant errors and fall back. B1 `template_access.inherited_values()`
instead reads the actual engine's global config and tenant hook and refuses exceptions.

Therefore a provider-free local resolver is technically constructible, but constructing it alone does not attest the
running service's cached global config, dynamic tenant configuration, authenticated namespace or Bank permissions.
Even a public/default-tenant branch can have a different process environment. Do not claim general managed route-b
support from `--schema public`, an internal context, an empty tenant object, Core's stored values or a supplied JSON file.
All four inherited fields remain part of B1's projection even when stored Bank overrides currently shadow them.

### Recommended common read-only producer

Add one actual, authenticated observation route under the optional template-backup capability, for example
`POST /ext/taki-memory/template/backup-observation`. It is independent of the filesystem admin-backup enable flag:
it reads authorized Bank evidence, creates no ZIP, initializes no state and starts no providers/workers.

Input: `{ version: 2, nonce: UUID, request: BackupNativeRequestV2 }`. Output echoes the nonce/request hash and
actual authenticated schema, and carries the typed v2 proof body without ZIP fields. The same private builder is
used directly by route c inside `_backup_on_connection` and by this route inside a read-only REPEATABLE READ.
Do not treat proof-only output as an archive. Add a maintained Core/CLI transport method; no automatic retry/write.

Use the actual MemoryEngine/RequestContext resolver and B2's same-resolution source-quality evidence. Require
authoritative success for every inherited field, valid context lifetime and complete key coverage; fallback,
unsupported context, a failing authorization hook or uncertain provenance refuses. This is an interface dependency
on B2, not a request for B2 to implement B3 now. Normalize once, without expanding omitted trigger/group defaults.

For route c, rows, receipt inventory and COPY use the same existing connection/transaction. A real configuration
observation is a separately identified external input: REPEATABLE READ does not freeze environment or tenant state.
Check that the resolver/context remains current through observation/seal and refuse a detected change. Do not claim
that equal hashes from two samples prove there was no intermediate ABA or create a fictional tenant revision/lease.
The proof describes captured database rows evaluated with the recorded authoritative observation; restore obtains
a fresh observation before current-target admission.

### Managed route b using the actual service

Add explicit CLI options for a validated Native service URL and an API-key environment-variable name; never put
the key in the request, proof, logs or command's ordinary data arguments. These are transport inputs, not a new
secret store or an automatic extension/provider bootstrap.

1. Parse the staged v2 request and validate the complete original selected requests before writing an archive.
2. Open the existing CLI backup connection/REPEATABLE READ and independently read targets, complete receipt
   inventories, requested-operation membership and database-only selected definition facets on that connection.
3. Call the actual observation route with a fresh nonce and the same immutable backup request. Validate the echo,
   request hash, actual schema, lineage/generations, full original-request anchors and source quality.
4. Require the service's database facet hashes and complete receipt inventories to equal those independently read
   from the CLI's snapshot. Only then use its inherited-config/full-projection observation for those same selectors.
   Never copy the service's later ordinary cursors into the CLI proof: CLI cursors and table hashes come from COPY's
   own snapshot. This permits ordinary content progress while binding the configuration observation to equal
   selected definitions and exact template history.
5. Keep the versioned service observation binding in the CLI-produced proof and complete COPY on the same connection.
   Missing/changed context, unmatched facets/inventory or observation failure refuses the Taki proof; no fabricated
   defaults, accepted observation file or fallback to v1. Cleanup preserves the existing partial-artifact rules.

The database facet is a new backup-domain digest of the B1 definition projection with only each config entry's
`inherited` value removed. It includes target, original selectors, stored presence/value, complete model/directive
definitions and name matches. It does not replace or narrow the full B1 projection digest used by Core.

**Product boundary:** unmanaged route b remains fully offline when independent template inventory is empty.
Managed route b gains an explicit live authenticated read dependency, even if the filesystem backup endpoint is off.
Without those connection inputs, the CLI must refuse managed v2 proof with an actionable reason. A normal Native
backup without Taki pairing and historical v1 flows remain unchanged. If root elects not to ship this small producer/
CLI adapter, managed route b is explicitly undelivered and requires route c; it cannot be counted as preserved route
coverage or silently staged as a usable offline path. The native CLI refusal and Core operator guidance must agree.

## 6. Byte caps and maximum-plan compatibility

The current route already permits up to 1,000,000 printable-ASCII operation IDs and 256 Bank IDs. Its exact existing
Core-minted request bound is:

```text
U1 = 4096 + 256 * (256 * 6 + 3) + 1_000_000 * (256 * 2 + 3)
   = 515_398_080 bytes
```

The factors account for the existing Bank-ID JSON escape bound, doubled quote/backslash ASCII operation IDs,
quotes/commas and fixed envelope. The new selected original apply subtree is at most 524,288 UTF-8 JSON bytes.
It is nested as an object, never encoded as an escaped JSON string. Reserve 8,192 additional bytes per Bank for
the bounded target/anchor/envelope, and 65,536 for v2 hash/version/observation wrapping:

```text
U2 = U1 + 256 * (524_288 + 8_192) + 65_536
   = 651_778_496 bytes
CAP_V2 = 640 * 1024 * 1024 = 671_088_640 bytes > U2
```

These are transport byte bounds, not expected sizes or RSS bounds. Parsing/cloning can consume substantially more
memory. Preserve the maximum admitted single-Bank request and 256-Bank plan; do not insert a 512-KiB aggregate cap,
split a Bank's atomic plan, silently truncate receipt history, or claim low memory use from a streaming length check.

| Boundary | Required limit/implementation |
| --- | --- |
| Each selected apply subtree | Existing 524,288-byte normalized UTF-8 JSON limit, independently rechecked. |
| Core HTTP and staged `native-request.json` | Same v2 compact UTF-8 serialization and 640-MiB aggregate cap before dispatch/stage. Current pretty-print helper must not inflate deeply nested original requests beyond this bound. |
| Native HTTP input | Streaming cap on bytes actually parsed, before JSON parse; Content-Length alone is insufficient. Version-aware semantic validation preserves the old v1 limit. Observation wrapping is included in U2. |
| CLI input file | Same aggregate cap before unbounded `read_bytes()`/parse, same nested limits and compact format. Reject oversize explicitly. |
| Native proof response / Core transport | Separate proposed 2-MiB decoded-UTF-8 cap, checked by the producer and set through `maxResponseBytes` only on backup/observation calls. The current generic transport default is 512 KiB and must not be raised globally. |
| ZIP `manifest.json` / Core sealed manifest | Keep the existing 4-MiB archive-manifest budget; compact bounded evidence only. No original apply bodies or full receipt lists inside. Add bounded file reads and serialize-before-write checks for the corresponding v2 Core metadata. |
| ZIP table streams | Existing streaming hashes, entry count and schema/COPY rules; the 640-MiB JSON request cap is not a ZIP/table-size limit. |

The fixed proof field bounds must make the 256-Bank maximum fit response/manifest budgets; add a maximal-metadata
construction test during implementation. Do not solve an output-bound failure by dropping Banks or fields. Existing
one-million terminal membership and whole-inventory scanning remain bounded by explicit failure/deadline behavior,
not by claiming that the returned digest covers a prefix.

## 7. Pair consumers, historical verification and restore admission

Extend the one common `verifyHindsightBackupPair` with an explicit v2 branch. First preserve all existing lineage,
Bank-set/generation, Native-ahead cursor and requested-receipt checks. Then require exact version/request binding,
complete per-Bank evidence, Core publication/hold validity, exact receipt-inventory equality, selected anchor equality
and full definition/inherited projection equality. Useful closed mismatch reasons are `template_proof_missing`,
`template_request`, `template_inventory`, `template_selection`, `template_projection`, `template_configuration`
and `template_unpublished`. Unknown proof never means zero. Failure ordering should expose the concrete earliest
scope/identity mismatch, without raw rows or configuration in operator errors.

| Existing caller | B3 behavior |
| --- | --- |
| `hindsight-backup-service.ts` capture | Check B2 hold, derive/verify template identity from the actual Core copy, dispatch exact v2 request, compare actual Native proof, then seal. Preserve epoch withdrawal and normal scheduler cleanup. |
| `hindsight-backup-admit.ts` route b | Revalidate staged request/identity against its copied Core, require matching v2 ZIP/request hash, then use the common verifier. Do not consult today's live Core selection as the historical staged selection. |
| `hindsight-backup-verify.ts` | Rehash original artifacts, reread their historical proof, reconstruct the copied Core attestation, and use the common verifier. Do not replace historical configuration observation with today's environment. |
| `hindsight-backup-restore.ts` | Verify the stopped Core copy/authority/complete setup/closure and credential custody as today, plus copied template history/publication/hold and fresh target v2 observation before declaring readiness. |

Keep **artifact integrity** and **current-target readiness** separate. A ZIP can remain a valid historical pair while
the target resolver now differs. Current config/context mismatch is a restore-admission refusal, not artifact
corruption; it must not clear historical `verifiedAt` or rewrite the archived proof. Keep exact existing schema/build/
upstream compatibility restrictions unless separately changed by a reviewed compatibility contract.

Add a small asynchronous read-only preflight adapter that obtains the fresh observation through the real transport
and invokes the synchronous `validateHindsightRestoreCore`. It performs no copy, restore, migration, provider start
or authority change. Its explicit caller is the supported D91 operator procedure/isolated acceptance harness while
writers are stopped. Record this call and refusal before the operator's writer-start step. There is currently no
production boot invocation of the helper; B3 must not describe one, add an automatic restore service, or claim it
can enforce the runbook against arbitrary privileged manual startup.

Historical v1 artifacts stay inspectable/verifiable as v1. Current managed state, unpublished effects, or an unproven
template inventory cannot pass template-aware restore readiness through the legacy branch. For a genuinely legacy
empty case, retain the existing legacy readiness contract and identify it as such, without invented v2 proof.

## 8. Healthy return/reentry and inventories

Retain Core overlay/default/history rows when returning to Local. Add a versioned, Core-owned template-attestation
commitment to new healthy preview/current-identity evidence, covering selection/default/history and hold state.
Preserve old serialized identities/hashes without default-expanding the new extension; historical records remain
historical, not newly certified managed transitions.

- `transition-current-identity.ts`: capture the attestation for the actual source/target incarnation and include it
  in fresh preview/admission/current checks. An unresolved B2 hold blocks ordinary healthy work.
- During fenced Native evidence collection, join the v2 observation to the actual W2 evidence by exact target,
  complete receipt inventory and database definition facet. Persist the association to its exact W2 evidence ID/
  proof hash in the existing immutable Core transition-document mechanism. An independent observation without this
  association is not the final fenced snapshot. Use the already complete auxiliary rows where possible.
- `transition-final-mapping.ts`: verify the final generation and the stored template/W2 association when building
  and rereading a candidate. A new generation leaves prior ownership foreign; it cannot be rebound by Bank ID.
- `memory-transition-publication-proof.ts`: after actual synchronous read-back, re-read the current Core template/
  hold commitment alongside connection/setup coverage; compare the persisted admitted/native association. No Native
  I/O inside SQLite and no bypass of W9's final live lease check. Binding revalidates the selected template through B2.

Do not alter Native frozen transition hash domains or manufacture pristine proof. If another serialized extension
is needed, version it separately with old-byte fixtures. Emergency W6 continues using its B2 quarantine inventory,
fully offline; it never calls this healthy Native observer and never converts an unknown old hold into success.

B1 already covers physical/FK and transition auxiliary inventory for receipts, children and refresh-result markers.
B2 owns the provenance sidecar and its corresponding inventories. B3 verifies that final released table set and
real restore behavior, without reopening B1 or reconstructing provenance from tags. No B3 migration is assumed
necessary; allocate only an actually required additive storage change against the post-B2 head.

## 9. Dispatch scope and minimal acceptance

| Owner | Cohesive file scope after B2 release |
| --- | --- |
| Core/Shared | `hindsight-backup-schema.ts` and new versioned schema modules; backup identity/receipt reader/pair/store/archive/client/native-route/service/admit/verify/restore; narrow read-only preflight adapter; healthy current-identity/final-mapping/publication-proof extension and required schema/document references. Use B2's verified readers rather than another hold owner. |
| Native | `admin/taki_backup.py`, same-connection CLI/API backup plumbing, read-only observation route/schema, strict configuration-observation adapter, row/projection reuse, exact capability/build detection, schema hook and canonical clients. Reuse existing authorization and never instantiate providers/workers in CLI. |
| Root | Accept the two tradeoffs below, allocate the independent B3 gate and D91 runbook/harness call, reconcile exact B2 heads/contracts and serialize heavy checks. |

Minimum acceptance, performed later by the assigned owners and independent reviewer:

1. Byte-preserving v1 parsing/verification and v2 strict missing/extra/wrong-version refusal, maximum compact request
   bound and 256-Bank proof/manifest bounds, explicit per-call response cap, CLI oversize refusal before parse/write.
2. Real SQLite/PostgreSQL: exact managed pair; pre-enrollment Core/post-apply Native; undeclared no-op and refresh-only
   receipts; corrupted full receipt; forged selected selectors; wrong generation; missing evidence; terminal unknown
   plus persistent hold. Test all four real pair consumers, not only a pure schema fixture.
3. Ordinary Native memory/generated refresh progress and later cursors remain accepted when template definitions,
   inheritance and apply-receipt inventory are unchanged. Changed definitions/inheritance refuse independently.
4. Route c uses the actual resolver on the backup connection's captured rows. Route b uses its actual CLI producer
   plus an authenticated fake-service/real-route observation and independent database-facet/inventory joins. Cover
   missing context, fallback, wrong nonce/request/schema/target, stale facet and service failure. Zero provider calls.
5. Real isolated physical restore of customized and removed overlays, original receipts, child markers and B2
   sidecar; read-only Core preflight rejects mismatched pairs/current config before the explicit harness starts any
   writer. Configuration drift must leave historical artifact verification intact. Do not relabel this as auto-restore.
6. Actual healthy return/reentry retains the complete Core history and exact-generation selection, refuses hold or
   selection changes during final read-back, and preserves W9. Changed incarnation requires reviewed re-enrollment;
   offline W6 and late quarantined callbacks remain independent.

## 10. Root decisions before B3 dispatch

Recommend adopting both choices, rather than leaving implementers to choose incompatible contracts:

1. **Ship the shared read-only observation producer and the CLI transport adapter.** This preserves a managed
   route-b path without starting providers or trusting a second process's configuration. Its explicit product cost
   is live service/authentication for managed route b and a small new read-only capability/endpoint. If root defers
   this adapter, document managed route b as unavailable and require route c; do not mark fallback coverage complete.
2. **Keep the existing maximum request cardinalities and adopt the 640-MiB v2 cap.** This is a large existing admin
   protocol extended by 128 MiB of legal apply bodies, not a small ordinary API request. If this resource envelope is
   unacceptable, select a separately designed paged/session protocol before dispatch; silently lowering the cap
   violates the accepted maximum-plan contract. This proposal does not add that larger protocol.

No new user product choice is otherwise required by the strict path. B2's final resolver-quality and publication/hold
reader interfaces are integration dependencies for root to reconcile after B2 review, not new work assigned to the
currently active B2 owners by this proposal.
