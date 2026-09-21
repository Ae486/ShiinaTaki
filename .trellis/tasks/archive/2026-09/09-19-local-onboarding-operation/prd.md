# Local-only Onboarding to Canonical Local

## Goal

Provide an explicit, guided path from an empty or supported Legacy workspace to usable Canonical Local memory.
The operator can preview, prepare, inspect exceptions, explicitly exclude unsupported sources, resume interrupted
preparation and activate from Home. Core owns durable operation state; the flow remains usable without Hindsight
or vector infrastructure. This is closure Stage 2a / PR05 under the existing Hindsight parent.

## Authority and dependencies

- The owner authorized leader-driven Trellis continuation on 2026-09-19. Grill is conditional on major unresolved
  requirements; no currently known owner decision blocks this slice.
- Reuse B2 migration and B6 Canonical Local runtime plus the completed Stage 1 operation owner and Home surface.
  Stage 1 records outcomes across client loss; it does not automatically resume unknown operations on Core restart.
- The parent requirement set, PR05, C01 and the latest overall review define this slice. Hindsight first activation,
  active Hindsight Bank lifecycle and repeated provider transitions remain separate stages.

## Requirements

- R1. An empty workspace and every supported Legacy format have a reachable Home onboarding path. The user can
  choose Local without configuring Hindsight or vectors. Existing Local/Hindsight authority must not be replaced
  through onboarding, and simply opening Home must not mutate authority or start migration.
- R2. Preview and preparation use the Core-owned workspace and authoritative migration state. Client parameters
  cannot choose an arbitrary filesystem root, fabricate a producer identity or override the authenticated actor.
  Show source counts, exceptions and useful diagnostics without returning raw memory text through operation status.
- R3. Preparation preserves original Legacy files and immutable snapshot evidence. Every manifest source must be
  accounted for, including after interruption before a source was visited. Verification must reject omitted,
  inconsistent or unresolved source coverage; historical completed runs must not be reopened by verification.
- R4. Long work is admitted as a discoverable Core-owned operation with stable producer association, truthful progress,
  single-flight mutation ownership and stage-aware recovery. Closing Home, losing a reply or replacing the client
  must not cancel, duplicate or silently replay it. Existing raw migration entrypoints must respect the same ownership.
- R5. Interrupted or failed preparation is resumable from preserved evidence and idempotent producer effects. A
  request must become observable before conversion finishes; source iteration must yield so status, client events
  and cancellation/refusal remain responsive. Report cancellation only when no later work from that execution can
  continue. The operator can discover a prior run without knowing its identifier.
- R6. Exclusions are explicit, source-specific and recorded with authenticated actor and reason. Source failure is
  never silently treated as exclusion. Supported well-formed data that cannot be converted is an implementation
  defect. A changed live source cannot be activated under an old preview/snapshot.
- R7. Activation requires explicit operator intent and fresh server verification of complete source coverage, current
  authority, snapshot integrity and the final Legacy writer fence. Preserve the durable commit/receipt boundary:
  before-commit failure retains Legacy; after-commit failure cannot restore the old writer or activate a second epoch.
- R8. Status distinguishes migration preparation, authority selection and actual runtime readiness. After a committed
  activation with failed runtime binding, show Canonical Local authority with an unavailable runtime and a supported
  recovery action. Do not label failed binding as successful usability or automatically fall back to Legacy.
- R9. A newly attached Home client reconstructs its view from Core and producer evidence. Reconnect/remount and push
  events refresh reads with generation guards, without polling or mutation replay. Loading, empty, preparing,
  exception-blocked, resumable, ready, activating, unknown outcome, failed and active states are actionable.
- R10. Successful onboarding binds the real Canonical Local runtime: existing foreground memory tools, lexical recall,
  ingestion/maintenance and scope isolation work immediately and after restart. Deterministic test seams may replace
  external model calls, but not the actual migration, authority transaction or runtime composition under test.
- R11. Exact primary messages crossing preparation/activation, failed binding and restart remain durably accounted for.
  Preserve trusted complete-group semantics, including prepare-before-callback, silent retraction and retained user-only
  failure. Never reconstruct provenance from role/range alone or retire an unresolved exact source behind a new baseline.

## Acceptance Criteria

- [ ] AC1: Empty-workspace onboarding through the real registered operations reaches Canonical Local, persists one
      valid activation receipt/epoch and remains usable after reopening Core, with no Hindsight/vector dependency.
- [ ] AC2: Representative supported Legacy fixtures preserve raw evidence, logical records, provenance, lifecycle
      and Memory Blocks; unsupported sources block until explicitly excluded with an auditable reason.
- [ ] AC3: Interrupt preparation before and after source registration/import. Reopen and resume the same producer
      without omitting unvisited manifest sources or duplicating committed effects; incomplete coverage never verifies.
- [ ] AC4: Two clients, lost submit replies and legacy RPC overlap cannot create concurrent migration mutation owners.
      Status discovers the same work, and conversion yields sufficiently for an independent status/event turn.
- [ ] AC5: Preview/source drift, unknown or mismatched run, stale operation, repeated exclusion and invalid mode produce
      precise refusals or proven idempotent results. No uncontrolled filesystem path or caller-forged actor is accepted.
- [ ] AC6: Activation revalidates after the fence; before-commit failure and after-commit bind failure preserve their
      different authority outcomes. Reconnect/restart discovers the committed result without a second activation.
- [ ] AC7: Cooperative cancellation/retry boundaries are verified with real producer state; unsupported cancellation
      is refused truthfully. Restart does not infer that an unknown write failed or automatically redispatch it.
      S2a offers pre-claim cancellation only; a running producer refuses cancellation while status stays responsive.
- [ ] AC8: Home covers empty/legacy preparation, exceptions/exclusions, resume, activation and unavailable runtime;
      retired-client responses are ignored and reconnect/remount/push never replay a mutation.
- [ ] AC9: Real Canonical Local integration proves scoped retain/recall and maintenance/ingestion after activation,
      including restart, with deterministic model substitutes where needed and no real model/service calls.
- [ ] AC10: Relevant Shared/Core/Desktop tests, workspace typecheck/lint, Desktop build and isolated Core boot pass.
      Owner manual acceptance is recorded separately and remains pending until observed and confirmed.
- [ ] AC11: Primary append/custody commit is atomic; crash before complete-group callback, cancellation/retry,
      user-only terminal failure and candidate replacement/late finalization preserve exact source evidence. Explicit
      recovery settles dead/terminal groups without Run replay; retirement refuses unresolved members at its target.

## Scope boundaries

- No Hindsight activation, provider round trips, remote administration, managed provisioning or backup/upgrade work.
- No automatic authority selection, vector prerequisite, new memory engine or second operation/scheduling authority.
- No original user database access, external model/service calls, destructive cleanup or implied manual acceptance.
- Preserve Stage 1 behavior for setup and replica operations. D84 remains separately tracked unless a specific shared
  change is required to uphold this slice's own operation identity; do not expand the slice to general B5 redesign.

## Research and implementation artifacts

- [Producer and lifecycle seams](research/stage2a-seams.md) — completed by the lifecycle research delegate.
- [Home and protocol integration](research/stage2a-home.md) — completed by the Home research delegate.
- [Overall review and current owner direction](../09-14-hindsight-integration-completeness-audit/research/overall-grill-2026-09-19.md).
- [Accepted plan amendments](../09-14-hindsight-integration-completeness-audit/research/plan-review-2026-09-18.md).
- Technical contracts and ordered execution/validation belong in `design.md` and `implement.md`; both are required
  and must pass review before activation. Research links are planning inputs, not claims of completed validation.
