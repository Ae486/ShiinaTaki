# B3 execution decisions and active dispatch

Root engineering decisions were made on 2026-10-08 under the owner's existing Stage 5B implementation and scheduling
authorization. The combined B2 gate now PASSES on 2026-10-09 in `b2-independent-review.md`, with current source
reconciliation in `b2-joint-source-readback-2026-10-09.json`. B3 implementation is released under this plan.
Read `b3-backup-design-proposal.md` for source-grounded wire and call-site details, `b3-resume-checkpoint-2026-10-09.md`
for exact names/fixture handoff, and `review-plan.md` for gates. Proposed B3 producers are not accepted until verified.

## Active ownership and first checkpoint

- `stage5b_composition_implement`: sole Core/Shared owner for versioned backup schemas/encoding/fixtures/public
  exports, all Core backup producers/consumers/client adapters, copied-Core attestation, explicit D91 preflight,
  healthy transition evidence/association and final template/hold revalidation. Necessary Core boot/registry,
  tests and indexes belong here; Native and Desktop production remain read-only. Own the backend backup,
  transition/publication specs and send lifecycle-spec amendments to the Native owner for one-writer integration.
- `stage5a_implement`: sole Native owner for Pydantic, actual authenticated observer, route-c and managed route-b
  producer/CLI, complete receipt inventory, physical restore, compatibility build/capability and canonical
  generation. Own Native documentation and the lifecycle spec, preserving the new Core executor lifetime section.
  Shared fixtures and Core source remain read-only; communicate concrete cross-layer changes to their owner.
- `stage5a_home_implement`: sole Desktop owner for the typed template WS adapter, required `ws-client.ts`,
  `ws-client-methods.ts`, `rpc-deadline.ts` composition, Operations template components/controller/hook/fixtures,
  `operations-page.tsx`, necessary existing display mappings and their indexes/tests. Own relevant frontend specs.
  Core, Shared, Native and backup producers remain read-only; request real producer changes from Core.
- Root owns task metadata, dispatch, slot coordination, combined acceptance and `docs/HANDOFF.md`.

All three scopes may implement concurrently. Core has the first short heavy-check slot for Shared wire/hash
fixtures and its typecheck, then explicitly releases it. Native/Core agree the actual fixture and new hash domains
before consumer completion or canonical generation. Home consumes the stable B2 methods independently. Subsequent
test/build/generation slots are granted by root when each coherent source is ready; no concurrent heavy work.
No new migration is presumed. No owner spawns nested agents or reverts another owner's existing edits.

Root approved a finite public-entry allowance after the Core owner identified 573 of 575 occupied lines and
the additional strict B3 protocol exports: only `packages/shared/src/index.ts` may grow to 625 lines. Core owns
the matching narrow edits in `eslint.config.js`, `CLAUDE.md` and backend `quality-guidelines.md`. Preserve the
source-bearing named-export AST restriction, all other file/function/parameter limits and readable formatting.
This does not admit implementation logic or another barrel, and the checkpoint records the actual entry size.

## Accepted decisions

1. Implement the shared authenticated, read-only Native backup observation producer and the managed route-b CLI
   transport adapter. Reuse the actual service's resolver and authorization; do not instantiate an alternative
   CLI MemoryEngine or treat CLI environment values as the running service's effective configuration. The CLI
   independently compares its own transaction's exact targets, full template receipt inventories, original request
   anchors and database-only definition facets with the service observation. COPY/cursors remain from that CLI
   transaction. Fresh nonce/request/schema binding is mandatory; an operator-supplied observation file is not proof.
2. Managed route b requires that live authenticated observation even when the filesystem backup endpoint is
   disabled. An unselected Bank still needs independently observed empty template history for the offline v2 case.
   Missing service/context, fallback or a mismatch refuses explicitly without a v1 downgrade. The source change
   and isolated fake-service tests are authorized; no original service or credential is used in this task.
3. Retain existing maximum cardinalities and use the proposed 640-MiB compact UTF-8 v2 request cap, with the
   original 512-KiB per-apply subtree cap independently enforced. The documented upper bound is 651,778,496 bytes,
   below 671,088,640. Bound input before parsing, use compact staging, and preserve explicit oversize failures.
   Keep separate 2-MiB backup/observation response and 4-MiB manifest caps; do not increase unrelated transport
   limits. This is capacity preservation, not a memory-use or performance claim. No paged/session protocol is added.
   The v2 manifest bound is enforced by its producer and Core's bounded archive/admission/preflight reader before
   parse. Preserve the historical generic Native `_restore` behavior for v1/plain archives; do not add a global
   restore limit or claim that generic reader has the new pre-parse cap. Paired readiness still requires the
   explicit Core preflight after the real Native physical restore and before writer startup.
4. Use strict versioned request/proof/manifest variants and a real optional backup capability. Existing lifecycle
   hashes/receipts and v1 artifact bytes retain their original meaning. Resolve the exact new build and exported
   names against B2's released source before dispatch, then coordinate Shared/Pydantic and canonical generation.
5. Keep copied-Core publication/hold/history/default attestation, Native complete receipt inventory and Native
   current definition/config observation separate. A missing proof cannot mean empty history. Removed Taki
   overlays remain selected `none` with ownership and user history. Do not infer selection from a latest receipt.
6. Preserve the proposal's explicit observation boundary: a database transaction does not freeze dynamic tenant
   configuration. Record the real authoritative source/context and observation, refuse detected source/context
   invalidation, and never invent a tenant revision or infer absence of ABA from two equal samples. Current-target
   readiness requires a fresh actual observation. Source provenance identifies the observation; an incidental
   process/boot identity must not falsely make an otherwise compatible restart a configuration mismatch.
7. Extend the existing D91 stopped-copy preflight with a narrow asynchronous read adapter and an explicit operator/
   isolated-harness invocation before writer startup. Do not add or claim automatic boot/restore orchestration.
   Historical v1 integrity and current template-aware readiness remain different verdicts. A template-capable
   target cannot pass current managed/unknown inventory through a legacy branch; obtain explicit fresh evidence.
8. Healthy return/reentry gets a separately versioned association between copied Core template state and actual
   fenced Native evidence, with final synchronous template/hold revalidation and W9 lease preservation. Old bytes
   stay historical. W6 emergency remains offline and uses B2 quarantine, never this new observer.

## Allocation after B2 review

- Core/Shared owner: versioned backup protocol, copied identity/receipt inventory, common pair consumers, archive/
  staging adapters, stopped-copy preflight and healthy transition associations. Reuse B2's verified plan/hold/
  publication readers; do not create a competing owner. Coordinate exact public fields before consumers finalize.
- Native owner: same-connection backup proof, complete scoped receipt enumeration, actual configuration observer,
  read-only route and CLI adapter, inventories/physical restore tests, optional capability and canonical generation.
- Home owner: consume the released Core template methods and actual explicit user-choice/selection detail; finish
  customization/update/removal, preview consequences, original-plan recovery and observer/reconnect states. Home
  does not reconstruct user intent from final Native values or mint Native requests/evidence.
  Reuse `memory-operations-controller.ts` for serialized submit, subscribe-before-read invalidation and unknown
  outcome rediscovery. Compose a focused section in `operations-page.tsx` and a Shared-validated WS adapter alongside
  `ws-client-hindsight-configuration.ts`; retain the existing operators' generation/visibility lifetime rules.
  Recovery availability must come from the released Core status, not a new Home inference over hold/phase. Catalogs,
  explicit user choices and bounded conflict/name-match review detail already belong to the Core read contract.
- Root: reconcile current heads/source, freeze disjoint file ownership and shared-contract writers, update contexts,
  serialize one heavy workload, then run one independent whole-5B gate after all B3 self-check handoffs.

No additional migration is reserved until a concrete storage need is established against B2's final heads. Retain
all earlier failures and unchanged passing B1/B2 evidence; rerun affected transaction/runtime/compatibility paths.
The final gate includes the real customized/removed paired restore, fresh target refusal, route b/c, healthy/W6
regressions, and Home's actual dispatcher/client/controller/DOM paths. Stop after 5B; Stage 5C is not dispatched.

## Final review allocation and resource sequence

The backup protocol and healthy transition work cross independent persistent stores; Home has a separate observer
lifetime. After B3 implementation handoffs, use independent Native, Core/Shared and Home reviewers with disjoint
fix ownership, rather than adding a new review for every helper. Each reviewer covers the complete current B1-B3
scope in its layer and the preserved W9/5A integration boundaries. Exact reviewer reuse follows availability.

Native owns its real route/CLI/physical-copy producer tests and generated output. Core/Shared owns all shared wire
definitions, copied-Core attestation, common pair consumers, restore preflight and healthy publication checks.
Home owns the WS adapter/controller/hook/DOM and browser fixture checks; it requests any Shared or Core fix from
that owner. Cross-repository acceptance fixtures keep the Native HTTP/PG driver and Core SQLite entry separately
owned. A cross-layer issue remains open until both affected sides are reconciled on the final source.

Keep one heavy check/generation/build slot and at most two Vitest workers throughout. Run affected tests during
implementation, then one consolidated final source gate for workspace types, root lint, serial workspace tests,
Desktop build, canonical clients and the required isolated cross-repository/restore paths. The root package scripts
use parallel workspaces; invoke the packages with explicit serial scheduling instead. Reuse unchanged valid prior
evidence; a targeted correction reruns its affected scope without relabeling an older full run as current. Record
manual/installed-environment checks separately as Stage 6 rather than inferring them from the fixtures.
