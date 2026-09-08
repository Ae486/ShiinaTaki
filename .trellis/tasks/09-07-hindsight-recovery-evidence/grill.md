# Memory Interoperability - Confirmed Direction and Open Decisions

## Status

Recorded on 2026-09-07 at the owner's request. The owner subsequently accepted G1's second option: routine write
recovery completes after reliable native confirmation and local application; derived maintenance may finish later.
The owner also required checking prior grill records before asking another question. This record updates the accepted
design; it does not claim that the existing code already implements the amendment.

The existing task remains `planning`. Read this record before the three research reports: their source findings
remain useful, but their approximately 20-file provider proposal is one evaluated option, not the selected footprint.

## Confirmed decisions

| Topic | Confirmed direction | Delivery consequence |
| --- | --- | --- |
| Product goal | Interoperability between Taki's Local memory system and Hindsight, with an explicit choice of authority. | Preserve usable Local-to-Hindsight and Hindsight-to-Local paths; do not turn the task into a redesign of Hindsight. |
| Local authority | Without an activated Hindsight authority, Taki uses its own complete Local Memory Provider. | Canonical Local storage needs working ingestion, retrieval, tools, tidy, retention, background maintenance and Memory Block projection. This belongs to existing B6 runtime integration, not an optional new feature. |
| Hindsight authority | Hindsight owns native semantic extraction, retrieval and maintenance when selected. | Taki retains companion-specific ownership, Write Gate, layer/visibility/retention and block policy; it must not run duplicate generic consolidation or mutate the replica as authority. |
| Interchange model | Align Canonical Memory Records with Hindsight's public logical objects and field meanings to reduce conversion cost. | Reuse equivalent names/types and preserve identity mappings, source/fact relationships, timestamps, lifecycle and provenance. SQLite and PostgreSQL may keep different physical tables and indexes. |
| Implementation preference | Use Taki adapters and supported Hindsight APIs first, then official extension mechanisms, then minimal generic native hooks for proven gaps. | Keep field conversion and Taki policy outside Hindsight's semantic core. A module called a plugin is not upgrade-safe if it monkey-patches private methods or cannot observe the required transaction. |
| Native reuse | Reuse useful Hindsight APIs, transfer formats, maintenance/configuration facilities and documented extension seams where their guarantees fit. | Evaluate reuse against the actual path and required guarantees; native transfer is not automatically a cursor-consistent snapshot, continuous change stream or retry receipt. |
| Upstream maintenance | Keep a minimal, traceable compatibility series with one live ledger in the Hindsight repository. | Each necessary patch records its native baseline, reason, affected files/schema/API/clients, tests, behavior effects and upstream replacement/retirement condition. Existing patches are not removed merely because an adapter-first direction is preferred. |
| Design evolution | Source-backed improvements and better native reuse may refine the design during development. | Update the task/specification, compatibility record and affected verification in the same slice. Routine refinements do not need repeated permission. New loss/duplication risk, weaker guarantees, supported-input restrictions or semantic scheduling changes need an explicit product decision. |
| Routine recovery completion - G1 | A recovered write may settle once its authoritative native result is reliably confirmed and its factual changes have been applied to the local replica. | Observation/mental-model maintenance continues natively and its later changes synchronize normally. This amends the previous per-operation derived wait; it does not waive safe replay or authority-cutover completeness. |
| Grill preparation | Read relevant earlier decisions before asking the owner. | Reuse an existing ruling when it answers the question; cite and amend it only when new evidence creates an actual conflict or a new product tradeoff. |

## Prior discussion review and question filter

Reviewed the relevant sections of these existing records before continuing the grill:

| Record | Decisions already covered | Treatment in this task |
| --- | --- | --- |
| [T5 decision log](../../workspace/pleia/t5-decisions.md), T5-R0, R7-R11 and R20 | Memory quality, user-owned identity card, reversible retention, scheduled tidy, Utility Slot, blocks versus searchable records. | Reuse the accepted Local policy. Do not ask again whether Local needs maintenance. Historic file storage and T5-R6 tool-only recall are superseded by the later Canonical/provider and automatic-recall decisions. |
| [T5 kickoff rulings](../archive/2026-08/07-28-memory-context/notes.md) and [final PRD](../archive/2026-08/07-28-memory-context/prd.md) | More specific block/write-gate/maintenance decisions and corrections to early research. | Use the final accepted ruling when it supersedes an early suggestion; port applicable behavior to Canonical Local in B6. Preserve these archived records. |
| [T4 second grill](../../workspace/pleia/t4-second-grill-prep.md), G2-08 | Pending Memory is usable in recall, reasoning and ordinary behavior; confirmation status is not a blanket behavior suppressor; an outage does not change authority. | Do not ask again whether chat or usable local memory must stop until Hindsight confirms a write. G1 concerns recovery bookkeeping and background summary freshness. |
| [ADR 0009](../../../docs/adr/0009-single-memory-authority-with-local-replica.md) and [provider PRD](../08-09-hindsight-memory-provider/prd.md) | Single authority, native Hindsight semantics, Canonical logical alignment, durable/idempotent pending writes, stale-mutation supersession, journal/snapshot integrity, adapter-first extensions and verified provider switching. | These remain binding. This turn amends only the routine derived-completion wait, with the authority-switch gate kept separate. |
| This record and the current recovery research | Current interoperability direction; actual native result, append and derived-proof gaps. | Source findings are engineering evidence. The old strict implementation proposal and its file estimate are not owner decisions. |

Before each future grill question: locate the existing ruling, check whether it was superseded, and verify any
code-answerable uncertainty. Ask only when an unresolved product choice remains. State what is new, why the existing
ruling cannot settle it, a concrete user scenario and the recommendation. Missing implementation is not a reason to
re-ask an already accepted requirement. Do not treat an engineering protocol choice as a product question unless it
changes supported scope, behavior or guarantees.

## Data compatibility obligations

- Maintain a versioned field mapping for the supported logical source, fact, observation, model, directive and bank
  state. Distinguish common fields, Taki-only policy, provider identities and derived/rebuildable indexes.
- Preserve supported logical state across round trips, including deletion/invalidation meaning and source provenance.
  Do not equate a source with one extracted fact, replace identity mapping with record-count equality, or silently
  drop fields that the receiving provider does not use for its own retrieval or maintenance.
- Keep native identity/version semantics explicit. A transfer API that allocates destination IDs needs durable
  source-to-destination mappings; matching field names alone does not prove identity-preserving conversion.
- Existing current-Local records and historical Markdown sources have different import paths. Evaluate native
  document transfer for already structured data without silently replacing the accepted legacy-source extraction path.
- The exact mapping and native reuse are engineering questions to verify from schemas and code. Ask the owner only
  when a real loss, unsupported capability or behavior tradeoff remains after that investigation.

## G1 - Routine recovery confirmation (accepted 2026-09-07)

[ADR 0009](../../../docs/adr/0009-single-memory-authority-with-local-replica.md), the parent PRD and B5's executable
contract still govern one authority, durable pending writes, revision checks, journal/tombstone completeness,
verified checkpoints and explicit authority changes. The owner accepted the second option after the plain-language
example of saving "the user does not eat coriander" before updating a broader dietary-preference summary.

The selected routine sequence is: authenticate and check lineage, pull existing remote changes, safely replay eligible
intents, verify each actual native result, and pull/apply its committed factual effects through a verified checkpoint.
That write may then leave Pending Memory. Observations and mental models continue under native policy; their later
logical writes arrive through the ordinary journal. Routine write confirmation is not a claim that every derived
summary is current. Show derived progress only from a real producer; an unavailable status remains unknown rather
than fabricated as complete, empty or zero.

Initial Hindsight activation and a healthy return to Local still need their independent required-maintenance,
complete-manifest, reconciliation and final-fence checks. Zero pending writes alone is not a cutover proof. The choice
does not authorize changing native automatic refresh timing merely to make a routine recovery row finish.

Native acceptance, native result mapping, derived maintenance completion and local checkpoint application are distinct
facts. Unknown native write outcomes must remain explicit and must not be blindly replayed under either design.
Queues becoming empty or a task disappearing cannot stand in for evidence that the required work succeeded.

## Source checks for this review

- `packages/core/src/memory/canonical-local-runtime.ts:21-37` still exposes empty retention/tidy operations and an empty
  background tool set. Its foreground canonical tools exist, and block projection reads canonical storage. This is
  evidence of missing maintenance wiring, not evidence that all Local tools or storage are missing; B6 must close it.
- Before this amendment, ADR 0009 explicitly waited for derived maintenance before the recovery second pull. The
  reviewed B5 code still implements that older sequence with `awaiting_derived` and a required completion port.
  G1 now changes the design, not the runtime. Versioned result/transition handling and regression coverage must
  establish the new native-confirmation/local-application condition without blindly confirming existing rows.
- The existing producer/append research remains the source evidence for missing receipts and operation-scoped derived
  proof. Its evaluated implementation choice is conditional; the public field map and exact reuse still require their
  own code/schema verification before implementation acceptance.

## Remaining engineering review

1. **Safe append/result recovery:** reuse native identity/result facilities
   where sufficient and design only the remaining gap. Relaxing derived timing does not by itself solve lost-response,
   concurrent-append or partial-publication ambiguity. Atomic single-input publication, its size envelope and changed
   automatic model-refresh timing are not selected requirements. Safe, idempotent recovery is already required; do not
   ask the owner again whether duplication or silent data loss is acceptable.
2. **Supported interchange coverage:** verify the field map, current-Local import and return-to-Local paths, preserving
   opaque supported logical state where needed. Escalate only concrete incompatibilities that cannot be resolved from
   source and the accepted lossless logical contract.
3. **Independent cutover proof:** retain the existing stronger activation/switch-back requirements. Determine the
   minimum native evidence needed for that finite, explicitly fenced operation rather than imposing it on every
   routine pending write. Its exact implementation remains an engineering task, not an unresolved product preference.

Use `grill-with-docs` one question at a time, with a recommendation and a concrete scenario. Persist each answer before
moving to the next dependent decision. Do not ask again for the already approved cross-repository scope or ordinary
implementation refinements. No production dispatch is implied by this recording/review step.

There is no second product question ready after this prior-record review. Continue the source/schema/protocol work
within the accepted direction. Reopen the grill only if that work exposes a new concrete tradeoff; do not ask the owner
to repeat existing decisions or select an implementation mechanism that can be evaluated from code.

## Ownership and records

- Parent product decisions: [provider PRD](../08-09-hindsight-memory-provider/prd.md).
- Current-Local import and authority fence: [B4](../08-09-hindsight-initial-cutover/prd.md).
- Replica/Pending mechanics and existing safety limits: [B5](../08-09-memory-replica-sync-recovery/prd.md).
- Full Canonical Local maintenance and provider-specific runtime selection: [B6](../08-09-memory-runtime-integration/prd.md).
- Current bridge/recovery alternatives: this task's [design](design.md), [plan](implement.md) and preserved research.
- Live provider patch inventory: `H:/hindsight/TAKI_PATCHES.md`; historical patches 001-008 remain in their archive.

No production code, test/service execution, user-data migration, authority activation, Git commit/push or task archival
is claimed by this design checkpoint. Preserve the existing B5 work and unrelated Hindsight changes.
