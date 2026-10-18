# B2 implementation allocation

Activated after the combined B1 independent gate passed on 2026-10-08. This is an execution refinement of
the reviewed PRD/design under the owner's resumed authorization, not a new product scope. The frozen starting
source is `b1-reviewed-source.json`. B2 has one integrated runtime/recovery/policy review before B3; small
adapters share that review. Fresh heads reserve Core 059 and Native e62a3d0b9c54 after e51c2f9a8b43.

Schedule refinement after implementation exposed the larger Core test workload: the complete, released Native
and label scope may enter independent review while Core continues in disjoint files. Core then has its own
independent check, followed by current-source/dependency reconciliation for the single B2 gate. No B3 implementation
starts from a partial pass. After releasing its label files, that owner may receive one separately assigned Core
test-only file against a stable Core-owned fixture; it must not resume writes to checker-owned label files.

## Ownership

- Native implementer: H:/hindsight structured-label capture, private fact propagation, PostgreSQL sidecar,
  append-boundary invalidation/explicit bookkeeping republishing, bounded authenticated evidence endpoint,
  Native migration/backup/transition inventories, Native tests, OpenAPI and maintained client generation.
  The existing B1 label DTO is the starting transport contract. Do not write Taki Core or new operation schemas.
- Core lifecycle implementer: H:/TakiAgent operation family, original-plan executor/hold storage, fixed Bank rollout and
  recovery, final publication, provisioning defaults, runtime lifetime/admission, trusted-label preload/consumer,
  Core additive migration, boot/operator methods, affected tests and corresponding folder indexes. The concrete
  trusted-label consumer and integration fixture are delegated below; this owner supplies their selected-group
  getter and runtime wiring and remains the sole writer of shared folder indexes.
  This owner alone edits the Taki Shared operation/status schemas and public index. Preserve the existing
  label-evidence DTO unless an actual missing contract is first coordinated with the Native owner and root.
- Core label implementer (`stage5b_label_implement`): the new `hindsight-template-label-evidence.ts`, existing
  `hindsight-application-binding-runner.ts` and `hindsight-application-binding-context.ts`, focused label/binding
  tests, and `testing/hindsight-template-native-consumer.fixture.ts` plus a narrowly needed seed helper. Existing
  `hindsight-application-policy.ts` is read-only unless a required change is coordinated first. This owner does not
  edit runtime/boot/client/Shared/plan/hold/default files, Native source or shared indexes/specs; it sends index
  entries to the Core lifecycle owner and lifecycle-spec amendments to the Native owner.
- Root: task artifacts, status/acceptance, dispatch sequencing, shared-contract conflict resolution and resource
  scheduling. Native is the sole writer of the shared lifecycle spec; Core sends its required amendments for
  integration. Other affected Core specs can be updated by the Core owner. No Home implementation in B2.

All owners must read the current curated manifests and the two B2 source maps. They are not alone in the
repositories, must preserve other changes, and must not spawn nested agents. Recheck current heads before
allocating migrations; B1 delivered Core 058 and Native e51c2f9a8b43. Never edit recorded migration contents.

## Contract checkpoint before cross-layer consumption

The Native owner publishes the exact route, evidence/hash normalization, supported storage/scope boundary and
one deterministic successful/neutral fixture before the Core consumer is finalized. Existing group definitions
retain their supplied fields and ordered arrays; do not expand defaults on only one language. Use the existing
template definition hash and frozen Native unit payload hash, not a new hash embedded in the logical payload.
The Core owner verifies exact Bank incarnation, unit revision/hash, selected effective group, one reserved tag,
scope and existing policy guards. Missing/unsupported evidence is neutral, never fabricated classification.

The preloaded Native/Core owners aligned the following source-grounded details before activation:

- Add `POST /ext/taki-memory/template/label-evidence` using the existing Request/Result DTOs, at most 256 exact
  unit versions. Missing proof returns an empty/subset result. The authenticated read never creates state.
- Hash the supplied valid complete `taki-layer` group with the existing template `definition` domain, preserving
  omitted fields and array order. Native recognizes the existing strict opaque `taki-hs-v1-g/c-<digest>` grammar
  for scope; Core separately verifies its full canonical binding and registry. A value or caller metadata is
  never used to infer scope.
- ConfigResolver can fall back when tenant fetching fails and dynamic tenant configuration has no transaction
  revision. Positive evidence therefore requires the captured effective group to match the actual materialized
  Bank group within the publication transaction. Only an independently provable stable inherited source could
  extend that rule. Otherwise retain normal legal facts but omit classification proof; fallback is not trust.
  This keeps the ordinary v2 path useful while preserving the design's neutral handling of uncertain evidence.
  Capture that fact from the same successful resolution used for extraction; a later successful read cannot
  turn an earlier fallback into trusted evidence. Native Global identity uses the exact fixed encoded ID;
  Character identity uses the existing lowercase opaque grammar, with full canonical verification in Core.

The accepted Core API direction is `memory.templates.preview`, bounded per-Bank preview detail and
`memory.templates.status`, plus `template.apply` / `template.recover` arms on the existing operation submit
surface. Core owns the real preview and returns a short-lived ID/hash; operator-supplied snapshots are not
evidence. Check an existing admission before testing preview expiry so lost replies recover the original work.
Keep old generic terminal rows immutable in meaning; explicit recovery points at the same original plan,
Native requests and publication. Move transferable B1 user-edit schemas into Shared and reuse them in Core.
Concrete field names may be finalized by the owner during implementation and communicated before Home starts.

The Core owner freezes the public operation/preview/status methods and result-bearing recovery surface before
Home is assigned. Public shapes live in Shared; derive internal representations rather than declaring a second
wire shape in Core. Native wire changes require canonical generation; Core-only operator shapes do not.

## Implementation and evidence obligations

1. Persist the immutable original plan and per-Bank request identities before dispatch. Own executor generation,
   boot, token, bounded deadline and checkpoint CAS independently of the generic terminal operation status.
   A possible Native effect retains its durable hold until exact selection publication or old-epoch quarantine.
2. Establish admission and quiescence through actual runtime seams. Cover boot, new captures, live local reads,
   recall/reflect, tools, Utility/source/background work and conflicting operations. Preserve frozen Run context,
   primary witnesses and the W6 offline emergency inventory/quarantine exception. Old callbacks cannot publish,
   renew, release a hold or change unknown outcomes after quarantine.
3. Recover partial multi-Bank effects using original receipts and fixed IDs. Publish all selections/defaults and
   applicable readiness, receipt and hold release in one synchronous outer transaction. Recheck live lease,
   executor, epoch, configuration/secret revisions and complete Bank identities after final readback.
   Binding failure after that transaction recovers binding only. No Native I/O is allowed inside SQLite.
4. Capture genuine structured labels in both extraction paths before caller entities are merged, carry private
   evidence through filtering and actual unit IDs, and bind it atomically at the final logical publication.
   Work even with application capture disabled. Ordinary edits/imports/reverts/deletes invalidate evidence;
   consolidation bookkeeping requires explicit verified exact-version republishing or safe invalidation.
   Exercise normal extraction -> consolidation -> sync. Chunks/collapsed ambiguous facts remain neutral.
   The accepted bookkeeping reproof requires the old exact sidecar and complete prior payload under the Bank
   lock, permits only revision/consolidated_at/consolidation_failed_at changes, then links a new exact proof
   to that verified predecessor in the same transaction. Other payload changes invalidate the proof.
5. Make fresh/new Character provisioning use admitted scope defaults, including explicit none, while preserving
   legacy v1 verification. Keep desired/applied/bound/derived state distinct. Label inference cannot override
   original/curated policy or enable pinned/undisclosed mood-gated layers.

Tests must use real local transaction/reopen paths and fake Native/providers, including interrupted dispatch,
terminal unknown/failed plus restart, final-readback lease expiry, post-commit binding recovery, held memory
unavailability with retained witnesses, emergency takeover with late callbacks, exact label identity, spoofed
caller inputs and mutation invalidation. Do not count data-shape fixtures as end-to-end producer evidence.

The Core label owner owns the cross-repository integration acceptance harness, with the Native owner supplying
the isolated fake-provider/HTTP fixture seam. Reuse `tests/native_results/test_d77_runtime_consumer.py`'s
`owned_http_listener` and actual uvicorn routes, then invoke the Node consumer fixture with `--endpoint`, `--seed`
and `--sqlite`. Native supplies actual extraction/consolidation seed data; Core consumes real authenticated routes
and commits real replica/application state. Retain the HTTP exchange observation; do not replace application-command
writes with a static response bundle. Prove actual structured extraction and consolidation output reaches
the real replica/application-binding consumer and canonical policy, including a spoofed/neutral case. Coordinate
this fixture early; two independently hand-authored JSON fixtures do not prove the full path. Reuse the existing
isolated runner and HTTP/test infrastructure, keep the real wire bytes/version proofs intact and report the
actual process/transport boundary exercised. Run this integration only in the shared heavy-check slot.

## Resource and handoff policy

One heavy test, build or generation workload at a time, with explicit ownership handoff. Vitest uses at most
two workers. Native pytest uses the existing isolated runner; no real .env, services, credentials, original
data, model calls or dependency additions. Reuse unchanged passing checks and rerun affected behavior.
Each owner reports changed paths, actual commands/exits/counts, retained failures, source identities and
fixture teardown. No owner's self-check accepts B2 without the integrated independent review.
