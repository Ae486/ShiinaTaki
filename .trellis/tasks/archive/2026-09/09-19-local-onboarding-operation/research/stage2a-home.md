# Stage 2a Home and Protocol Integration

Date: 2026-09-19; inspected main at `516e151`. The Astra Home research delegate failed twice with rate limits before
persisting findings; the leader completed this bounded source review. No runtime/UI/manual acceptance was run.

## Existing seams

| Evidence | Consequence |
| --- | --- |
| `apps/desktop/src/windows/home/pages/operations/operations-page.tsx:20-31` mounts `MemoryAuthorityCard` through `useMemoryOperations`. | Add a focused Local onboarding card in the same Operations page; use existing PageCard/ActionButton/FeedbackLine primitives. No new top-level navigation or settings subsystem. |
| `memory-operations-controller.ts:50-67,76-102,105-115,126` coalesces changed pushes, compares client plus generation, serializes writes and refetches outcomes. | Follow this controller pattern for onboarding. The existing controller is sync-specific; keep a sibling onboarding controller instead of growing it into a workflow engine. |
| `use-memory-operations.ts:34-59` obtains an authenticated client through `useHomeClient` and disposes generation listeners. | Hooks only bridge React state and controller. Core remains the operation authority across Home closure/replacement. |
| `apps/desktop/src/lib/ws-client-memory-operations.ts` validates results with Shared schemas and memoizes subscription per client. `ws-client.ts:80,99,190` exposes the method group and event listener. | Reuse submit/cancel/changed for durable commands. Add a small typed read/exclusion method group, attached through existing client method composition. No second event router or per-card physical subscription. |
| `packages/core/src/server/methods/memory-operation-methods.ts:23-46` registers operator-only operations and sanitizes errors. | Local operations extend the existing registry/union. Short exclusion obtains authenticated actor from MethodContext; no actor or lease-owner override in client parameters. |
| `packages/core/src/memory/operations/memory-authority-status.ts:24-40` currently probes only Hindsight; Local/Legacy availability is inferred. | Add composition-owned binding readiness, consumed by both the authority card and onboarding status. Never call captureRun as a read probe: it may create Banks/baselines. |
| `packages/core/src/memory/runtime-composition.ts:75-79` owns the migration destination rooted under Core dataDir. Existing B2 RPCs accept caller workspaceRoot. | New client methods take no filesystem root. Production compatibility routes must constrain their root to the effective Core workspace and cannot bypass the new operation owner. |
| `memory-authority-card.test.tsx` uses renderToStaticMarkup; controller tests use deferred fake clients. | Use existing testing dependencies for UI state/late-generation checks; actual producer behavior belongs in real Core integration tests. |

## Recommended interaction

1. On mount/client replacement, subscribe to the existing operation push and read the current onboarding overview.
   This discovers a preserved run/operation without a stored browser identifier. Showing the card does not prepare.
2. For Legacy with no run, an explicit preview reads the current Core workspace. Display empty/Legacy source summary
   and explain original evidence preservation; the preparation request carries this exact report identity.
3. Preparation uses the durable prepare kind. Repeated clicks are locally serialized; another operator receives Core
   BUSY and can observe the admitted operation. A timeout causes a read/refetch, never an automatic submit retry.
4. A prepared run with blockers displays paginated source-relative diagnostic rows. Exclusion needs a selected source
   and explicit reason; no mass auto-exclude and no raw memory body in summaries. A short command returns authoritative
   status; explicit resume prepares remaining evidence. Changed live data needs the safe replacement-candidate path
   in lifecycle research, not a blind restage into the old epoch.
5. A verified run exposes an explicit enable-Local action. Its operation re-verifies under the final fence. Admission
   feedback says accepted/preparing, not enabled. The operator does not need to read hashes, receipt IDs or SQL terms.
6. After commit, show Local active only with ready runtime evidence. A committed-but-unbound result exposes binding
   recovery; retries never perform another authority commit. Existing Local shows status and no fresh onboarding;
   Hindsight shows the current authority and no Local onboarding action.

## Required states and controls

| State | Controls / evidence |
| --- | --- |
| Loading / read error / disconnected | Skeleton or last frame plus error; retry read; all mutating controls disabled without a current trusted view. |
| Empty or Legacy preview | Source summary and prepare action bound to report identity. |
| Operation admitted | Observe status; cancel only before actual producer claim. |
| Preparing / activating | Producer progress and active operation; running cancellation is explicitly unsupported in S2a. |
| Source-blocked / interrupted preparation | Exact diagnostics, explicit exclusion where admissible, resume or safe new preview/preparation. |
| Ready for activation | Explicit enable action; server remains responsible for fresh verification. |
| Unknown outcome | Discover exact run/receipt and current authority; no synthetic failure/success and no automatic replay. |
| Local committed, runtime unavailable | Show both facts and explicit binding recovery; never offer a fresh migration or fallback writer. |
| Local ready | Actual local runtime available; no Hindsight/vector prerequisite and no optional reflect promise. |

## Protocol and event requirements

- Prefer a new bounded onboarding read/exclusion group, with overview, preview and paginated exceptions; ordinary
  mutations use the two local operation kinds recommended by lifecycle research. Final exported names live in design.
- Overview combines exact discovered run/receipt, selected authority, actual runtime readiness and relevant operation.
  It must find historical/raw B2 runs, not only the recent-operation list. Derive action flags from producer proof.
- Use source counts/progress from saved ledger checkpoints. Publish through the existing operation CAS/changed path
  after durable changes. A short exclusion also needs an invalidation signal for other clients; reuse the operation
  channel with an explicit read-model invalidation event or an existing producer event, not a fake operation result.
- Shared schemas are strict and own all request/result types. Keep local diagnostics separate from replica errors;
  update exhaustive kind labels and deadline classification when adding the methods. Reads use interactive deadlines.
- No polling or queued mutation replay. Gate expensive hidden-page reads according to reactive-read-models.md;
  refetch once when visible after missed invalidations, retaining generation protection.

## Validation and ownership

- Frontend worker owns new onboarding client/controller/hook/view modules, Operations page mount and relevant indexes;
  it must consume reviewed Shared contracts rather than introduce local message interfaces.
- Core/Shared worker owns schemas, server registration, producer state/actions and read-model invalidations. Runtime
  composition, migration registry and authority transactions have one writer; do not parallelize production edits there.
- Test all states with validated Shared fixtures. Controller tests cover delayed old-client replies, push during reads,
  hidden/show restoration, failed subscription, exclusion changes from another client, lost mutation reply, remount and
  no write replay. Render tests verify action availability/disabled states and truthful committed-but-unavailable copy.
- Core integration must traverse registered methods, actual SQLite/B2 producers and runtime composition. UI snapshots
  and old marker-edit tests alone cannot establish onboarding usability. Packaged/manual owner checks remain separate.
