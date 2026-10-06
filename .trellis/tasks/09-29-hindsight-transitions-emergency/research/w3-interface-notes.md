# W3 consumer notes from W2 protocol review

Status: W2 independently passed on 2026-09-30. These notes guide the approved W3 consumer implementation; read the
final W2 implementation/check reports and actual schema as the producer contract.

## Existing entrypoints to preserve

- `packages/core/src/db/hindsight-local-coverage-reader.ts` and `hindsight-current-capture-reader.ts` contain complete
  Local witnesses/capture. Extract a neutral transition reader without relaxing the existing initial-local entrypoint.
- `hindsight-authority-repo.ts` and the legacy activation marker validators retain their first-activation proof arms.
  No B2/D78/import receipt is invented to make a transition-created epoch pass an older guard.
- `packages/core/src/memory/hindsight/hindsight-application-projection.ts` validates native/body/artifact closure and
  restores typed originals. Its consumable output is not the complete preservation inventory: retain unbound heads,
  tombstones, native-derived payloads and every auxiliary/history record needed by the common baseline.

## W2-specific preservation rules

1. Reused native Banks require the last exact retired healthy baseline. Compare complete descriptors and mappings;
   unchanged semantic records reuse native identity/revision/body. Epoch/Bank placement alone is not a content edit.
2. New Local scopes use the separately proven unused-scope native branch. Core must prove their scope is absent from
   the previous common baseline and persist one mapping across retries. Native proves creation/unused history. A used
   then cleared target, pruned/unverifiable history, or changed template/configuration cannot substitute for this proof.
   Native now retains actual B3 template initialization provenance, including the real completed refresh/history.
   A pending/failed/unknown or incomplete initialization is not unused-ready. Preserve its
   `memory_transition_initializations` auxiliary records as native evidence; do not materialize them as user memory.
3. Current Local changes append a transition-owned D77 revision with exact predecessor, Local manifest/record hashes,
   and actual post-delta native version. Old original bodies and receipts remain readable. Ordinary D77 original-input
   equality is unchanged. Preserve null/empty/typed/nested metadata, including legal object keys such as `__proto__`.
4. Source `original_witness` must be the actual post-delta native version. Core's `projectSource()` checks every field
   before retaining original provenance; a stale/predicted/null witness would falsely relabel authentic Local input as
   provider-derived. Read back through that real projection, not just native JSON equality.
5. Native finite maintenance may advance previously bound records and create new derived records. The final producer
   rebinds existing policies through ordinary D77 validation. Newly derived, previously unbound objects remain explicit
   in its complete snapshot. W3 preserves them and uses the existing Core policy producer for an explicitly recorded
   first neutral Local policy; there is no prior application policy or successful model assessment to invent.
6. Delta mappings precede maintenance. Final mapping/candidate validation must join the actual final snapshot/revisions
   and application closure, not assume every target still has its immediate post-delta revision.

## Verified current Local reader and staging seams

The parent read these exact files during independent W2 review (no W3 code was changed):

- `hindsight-local-coverage-reader.ts`: `readHindsightLocalCoverageState()` discovers all rows of Banks, sources,
  units, policy, lineage and derived objects plus all provider-independent Blocks. Source provenance is separately
  witnessed. Its private `readEpoch()` explicitly requires `reason='initial-local'`; retain that restriction in the
  old public B4 entrypoint when extracting the neutral reader. Full-record hashing is distinct from SQL-row hashing.
- `hindsight-current-capture-reader.ts`: `readHindsightCurrentCapture()` hydrates and validates the supplied manifest's
  witnesses. It is not an independent discovery of omitted units/sources. W3 must first create the complete current
  manifest under the actual writer reservation, then hydrate/recheck it; an incomplete caller-supplied manifest cannot
  establish coverage. Reuse its lossless JSON restoration and exact row-disposition checks.
- `canonical-memory-authority-repo.ts`: `authorityEpoch()` is provider-neutral, `activeEpoch()` requires Local, and
  `createBank()` requires the currently active Local epoch. `getBank()/listBanks()` can read a historical epoch. W3
  needs an explicitly isolated candidate/staging publication path; never temporarily change the active marker or
  manufacture an initial-local epoch merely to make an ordinary writer accept a candidate.
- `hindsight-local-bank-binding.ts`: Local scope resolves through the verified B3 binding and checks a complete unique
  native Bank set. This binding alone does not certify native generation, final proof or an unused Bank; join those
  exact W2 witnesses separately and retain historical Local IDs only through proven receipt/mapping lineage.

## W1 admission versus final identities

`packages/shared/src/memory-transition-schema.ts` permits null `targetBankId`, and paired null `nativeBankId` /
`nativeGeneration` for a Local predecessor. This supports a new Local scope before the actual native generation is
created. Do not mint a pretend provider generation for preview. The immutable admission identity stays unchanged;
the candidate/final mapping and native proof must carry and validate the concrete producer identities. Hindsight
predecessor Banks still require their actual native identity at admission. A re-entry operation as a whole still
requires its previous common-baseline receipt; new scopes do not remove that requirement for the existing scopes.

The admission identity is immutable. Already admitted writers may finish during the owned drain, so the final source
manifest/revisions must come from the fenced producer boundary and its resolved source-work evidence. Do not rewrite
the preview identity to disguise those effects, reuse a pre-fence hash as final proof, or mistake a legitimately drained
effect for an unowned write merely because it completed after admission. W4/W5 supply that drain/custody boundary.

## Complete evidence versus transport validation

`hindsight-transition-client.ts` and `hindsight-transition-proof.ts` validate bounded responses and their native hashes,
identities and namespace relationships. They do not build a complete multi-Bank candidate. W3 must fetch every page
named by the actual final proof, verify the native/application/maintenance/auxiliary closure and preserve exact bytes.
Reject missing, duplicate, reordered-with-wrong-hash and foreign pages; a correctly hashed single page or delta result
is not proof of complete coverage. Join the delta's namespace, operation/request/source-manifest and mapping inventory
to the persisted preparation and final status. Final maintenance may advance the immediate delta mapping's revisions.

The legacy current-state orchestrator is a useful replay pattern, not a transition admission shortcut. It reads an
exact historical transfer result before POST and persists complete returned mappings/evidence. A transition must use
its own durable request and result identities; do not call the old B4 producer to manufacture admission history.

`canonical-memory-maintenance-retention.ts` is the real Local irreversible retention producer. It writes a durable
`hard-delete-rolling` maintenance result after preserving a snapshot, and records source retirement in
`canonical_memory_retired_sources` with last_revision/deleted_at. The existing Local coverage reader's table list does
not include those retirement/history rows. Transition capture must join the actual required lifecycle evidence with
the complete current inventory and prior common baseline. A disappeared record in a supplied manifest cannot by itself
justify W2's explicit_delete/expired/scope_retired descriptor. Preserve the original journal/history rather than minting
retirement evidence from the current clock.

`projectHindsightApplicationRecord()` can withhold a non-bound document/unit, projects derived objects separately,
and deliberately limits consumable content. Preserve all native and D77 heads, tombstones, history, original bodies,
auxiliary rows and unbound objects in the common baseline even when they are not immediately consumable. Staging must
not silently drop them or create a successful model assessment to make the runtime reader accept them.

## Recovery and later ownership

Safe pre-effect abort preserves historical results and restores the appropriate retired/unused hold only with
transactional proof. Applied/unknown native effects retain the original transition identity for claim/lookup/recovery.
Do not invent a fresh delta request after a missing response. Read final W2 recovery semantics before consuming them.

W3 stages candidates and evidence only. W4 owns the complete authority-selection/epoch/receipt/candidate/custody/queue
COMMIT join and its boot validation; W5 owns healthy operation orchestration. A repository fixture containing an epoch
and receipt is not proof of a usable runtime or permission to enable a partial driver.
