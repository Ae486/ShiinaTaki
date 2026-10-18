# Context excerpt: source-runtime-and-acceptance

Extracted without semantic edits from the full Stage 5B research to avoid context-injection truncation.
Source: `../10-07-hindsight-configuration-observation/research/stage5b-template-lifecycle-research.md`.
Source SHA256: `b80ed090b6b2d99be9fe499dd4f0ac690f987b4f3074b2bab77d6c2007708461`.
The full research remains retained. The refresh/enrollment follow-up supersedes earlier embedding-preparation advice.

### 6. Core end-to-end state and interruption recovery

Suggested phases, carried by the existing durable operation adapter:

`admitted -> preparing -> quiescing -> applying(bank cursor) -> verifying -> publishing -> rebinding -> completed`

- **Admission:** snapshot authority epoch, connection/secret/config identity, selected template and user revisions, Bank set/incarnations, immutable plan hash and Native request IDs. Acquire the existing exclusive operation family so setup/provision/transition/backup cannot interleave.
- **Quiesce:** for an active Hindsight runtime, drain relevant foreground and background work through existing lifecycle boundaries before changing behavior. Keep new Run admission degraded/closed while the rollout is partial. A local operation row alone does not stop Native writers; Native CAS/writer boundaries still apply.
- **Apply:** process the fixed Bank list; persist each original request identity before dispatch. One Bank transaction may commit before another fails. Preserve confirmed receipts and continue the same plan; never claim global rollback or mutate prior receipt history.
- **Verify:** verify exact current definitions/config and the Native receipt, then synchronize resulting logical changes. If generated model work is outstanding, report definition-applied/derived-pending separately.
- **Publish:** one short synchronous Core transaction CASes selected revisions, applied receipt/digest and relevant setup/readiness projections. Recheck operation ownership/lease, current epoch, connection and all Bank identities immediately before commit. No Native I/O inside SQLite.
- **Rebind:** reuse the runtime binding replacement seam. A post-publication bind failure keeps committed selection and reports binding unavailable; recovery rebinds that same selection rather than reapplying Native writes.
- **Restart/lost reply:** query each original Native result, verify its plan identity, continue unfinished Banks, and never infer success from the disappearance of an operation. A Native/connection identity mismatch is reconciliation-required. New preview is required when external drift prevents the original precondition.
- **Cancel:** allowed before any irreversible dispatch. After a known per-Bank commit, stop at a recoverable boundary and report partial application; do not label it cancelled-with-no-effect or auto-compensate over new user edits.
- **Removal:** does not disable Hindsight or change authority. Introduce an explicit admitted no-Taki-overlay state that runtime verification understands; user resources and inherited Native behavior remain usable. Do not fake removal by marking setup failed or applying an empty v1 manifest.
- **Observers:** Home observes the original Core operation ID after reconnect. Status reads do not replay commands, run model refresh, or promote desired state to applied state.

Built-in revision rollout should include the actual provisioned Bank set before publishing its connection-wide default, while per-Bank user customization remains independent. Keep old desired-setting fingerprints/receipts intact; use a separate overlay selection identity for the new runtime guard rather than rewriting prior fingerprint inputs.

### 7. Per-fact taxonomy: configuration AND consumption are needed

Native already supplies the useful extraction mechanism:

- `engine/retain/entity_labels.py:33-42,172-227`: a `type="value"` group with a finite enum and optional null; `tag=True` enables tag projection.
- `engine/retain/fact_extraction.py:1136-1181`: builds the actual per-fact structured `labels` schema.
- Same file `:1549-1598,2344-2388`: converts each fact's selected label into a label entity in both extraction paths.
- Same file `:2497,2716,2811-2823`: injects tags after fact extraction.
- `entity_labels.py:300-331`: re-derives controlled tags from final entities while preserving unrelated tags. It does not invent `unclassified` for an absent value, or independently validate a raw entity string against the enum.

Add a `taki-layer` enum group from the existing registry filtered by Bank scope, plus `unclassified`. Permit absent/uncertain classification and explain the neutral choice; do not require a confident class for every fact. Its `tag=True` setting is essential. Preserve free-form entities and all non-owned label groups. User override/suppression is still highest precedence; display when it disables the controlled taxonomy rather than secretly overriding the user.

**Current Core gap:** `packages/core/src/memory/hindsight/hindsight-application-binding-context.ts:91-110` initializes a newly observed Native memory without passing a `label`. `hindsight-application-policy.ts:88-104` therefore chooses neutral even if Native supplied a label. Merely adding `entity_labels` does not prove the final Memory Layer assignment.

Reuse the supported `HindsightTrustedUnitLabel` argument with the exact observed Native namespace/object revision/hash. Admit only one valid scope-compatible Native label, and never borrow a source-wide or caller-supplied tag as per-fact proof. `hindsight-application-policy.ts:134-145` already rejects pinned layers, incompatible ownership and mood-gated labels without disclosure; keep those checks. Existing original/curated policies take precedence over fresh inference.

Expected safe outcomes:

- A valid Global profile or Character episodes fact can get the registry policy through exact per-unit evidence.
- Absent/malformed/multiple/unknown/cross-scope labels remain `unclassified`, default importance, retrieved visibility, permanent neutral retention and due assessment.
- A `relationship` label cannot mint always-visible/pinned memory. An `intentions` label without real disclosure remains neutral. Template instructions must not invent the missing disclosure.
- `hindsight-policy-admission.ts:58` projects one canonical policy layer tag while leaving exact Native evidence intact; preserve this separation. Existing tests at `hindsight-application-policy.test.ts:142-171` are executable examples of the fallback.
- No taxonomy edit re-extracts old documents or mass-reclassifies existing curated facts. That would exceed this lifecycle slice and the deferred curator work.

### 8. Backup, restore, migration and compatibility

- Core overlay history and selections live in Core SQLite, so the existing paired full Core copy preserves them. Add migration/reopen tests and semantic verification; the fact that bytes are copied does not prove the restored selected receipt matches Native.
- Add Native request/receipt tables to the explicit admin backup list, FK order and table parity test. New terminal operation kinds must be represented in the Taki backup receipt map/pair proof where that map requires remote receipts; do not leave an unsupported terminal ID silently unverified.
- Restore verifies Bank generation, applied plan/selection digests, current effective resources and original request receipts. A Core snapshot from before application paired with Native from after application must refuse, not automatically import the old template.
- Carry selected overlays/ownership across healthy return/reentry through retained Core state and exact per-Bank binding reconciliation. If a restored/recreated Native Bank changes incarnation, old ownership cannot be transferred by Bank ID alone.
- Add new immutable migrations at the then-current heads; do not edit applied Core/Native migrations or pretend old Banks had managed user revisions. Old valid v1 Banks remain supported in legacy mode; unsupported Native lacks mutation capability and gets a truthful unavailable action.
- Introduce a finite optional compatibility contract/build identity coordinated with 5A's changes. Keep old exact build support and existing whole-manifest stale-preview rules; do not widen compatibility with a prefix match or rewrite saved evidence.
- Candidate upgrade itself remains 5D. 5B supplies restorable template/user state and isolated restore evidence; it cannot close the entire C11 upgrade or Stage 6 installed/manual acceptance.

### 9. Exact acceptance and check grouping

| Group | Necessary tests |
| --- | --- |
| Composition / independent revisions | Built-in update leaves explicit user value unchanged, including a value equal to old template; removing user override reveals current Taki/base; removing Taki preserves user resources and prior Bank overrides; absent base inherits current Native default; unrelated config/labels/resources unchanged; explicit suppression survives update. |
| Ownership / enrollment | Fresh absent resources acquire ownership; preexisting same-ID/name collision refuses; duplicate directive names refuse; legacy-v1 missing before-images remain untracked; exact UUID deletion; external change since preview refuses with no overwrite. |
| Native atomicity / auth | Actual authenticated route; wrong namespace/Bank/validator/field permission denied before effect; permission-hook exceptions deny; fault after each resource write rolls back all rows, logical events and receipt; two concurrent requests against one expected snapshot have one winner. |
| Idempotency / derived work | Same ID/hash returns original receipt without a second mutation/embedding/refresh; different hash refuses; loss before and after commit; definition update preserves generated content; empty tags genuinely clear; refresh pending/failure remains distinct; preview makes zero writes/provider calls. |
| Taxonomy end to end | Fresh Global and Character config -> actual extraction schema with fake structured model -> per-fact entities/tags -> replica/application binding -> canonical policy; valid same-scope cases; missing/null/unknown/multiple/cross-scope; pinned relationship and missing-disclosure intentions neutral; original curated policy preserved; both Native extraction paths exercised. |
| Active runtime / interruption | Quiesce and concurrent Run/auto-provision/backup/transition exclusion; crash at every phase; partial multi-Bank commit; expired/replaced Core lease at publication; changed secret/config/epoch/Bank generation; post-commit bind failure recovers binding only; new Character gets admitted built-in version. |
| Backup / migration / compatibility | Fresh/historical/reopen Core and Native migrations; paired isolated restore of customized/removed overlay; mismatched pair refuses; new table parity and receipt map; old build without capability; 5A build preserved; stale whole-manifest preview; healthy return/reentry and pristine target provenance regressions. |
| Home | Operator-only actual dispatcher; preview diff includes deletions and provider work; separate desired/applied/derived states; two observers; reconnect observes original operation; stale preview, conflict, unsupported, partial application, failure and recovery are actionable without browser-local truth. |

Use one implementation owner for Native/Shared/Core schema, admission, registry and runtime changes; Home can be delegated only after the contracts are stable and with disjoint file ownership. Suggested milestones:

1. Pure overlay composition + Native transaction/receipt + additive schemas: focused tests, then a targeted transaction/auth review before layering more behavior.
2. Core operation recovery + runtime + taxonomy producer/consumer: targeted integration tests and cross-layer review, including source custody/transition interaction.
3. Home and full-slice closure: one independent checker covering all of 5B, affected-package checks and selected adjacent regressions. Reuse unchanged 5A evidence, but recheck shared manifest/client/boot files actually modified by 5B.

This may still use one implementation agent serially. The separation is by risk milestones, not arbitrary function count. Do not run full Core suites repeatedly while contracts are still changing; run the appropriate full affected scope at the completed slice, retain real failures/exit codes, and rerun only impacted checks after fixes.

## External References / Versions

No network research or external model/service execution. Dependency source is local Hindsight API 0.9.0 and its maintained Taki compatibility extension. Native `CLAUDE.md` requires endpoint/OpenAPI/client artifact synchronization. Exact future build IDs and migration versions must be selected against the live post-5A source, not copied from this report.

## Related Specs

- `.trellis/workflow.md`: persisted research and independent implementation/check dispatch.
- `.trellis/spec/backend/index.md`, `database-guidelines.md`: Core database ownership, migrations and synchronous transaction boundaries.
- `.trellis/spec/backend/memory-operations.md`: existing operation owner, observation and recovery.
- `.trellis/spec/backend/memory-hindsight-lifecycle.md`: setup verification, template-change refusal, degraded runtime and binding replacement.
- `.trellis/spec/backend/hindsight-application-runtime.md`: exact Native evidence, original/curated policy and neutral fallback.
- `.trellis/spec/backend/memory-hindsight-backup.md`, `memory-transitions.md`, `memory-transition-publication.md`: paired receipts, custody, immutable operation identity and final guard.
- `.trellis/spec/frontend/memory-transitions.md`: operation observation/reconnect and truthful outcomes.
- `.trellis/spec/guides/index.md`: source grounding and cross-layer consistency.

## Caveats / Not Found

- No tests, services, models, original data/credentials, dependency changes, Git actions or production writes were performed. This is current-source research, not executed acceptance.
- No complete existing independent template/user-overlay lifecycle or public atomic template-CAS contract was found in the directly inspected setup/Native mutation paths.
- The important reusable correction is PATCH-null's existing inherited-default semantics; do not build a new key-deletion endpoint merely because the raw JSON retains tombstones.
- Existing v1 history cannot prove lost pre-v1 values; preservation must be evidence-qualified. No owner question blocks building the strict fresh/enrollable path. Actual destructive enrollment of an unresolved legacy collision requires its own concrete review later.
- Adding the group alone fails the C16 consumer requirement: the current first-binding production call omits the trusted label argument. This is a required 5B code path, not deferred daily policy reclassification.
- The new atomic Native producer is the substantive compatibility change. Do not substitute sequential public import/DELETE calls plus a Core success flag, or mistake transition writer admission for SQL atomicity.

