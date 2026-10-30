# Interactive delegation execution plan

Status: implementation authorized, 2026-10-25; S0 baseline/interface verification starts first. [Design](design.md)
is the implementation contract; [PRD](prd.md) owns requirements and current authorization. Activate with `task.py start`.
Existing October 23 tests are historical evidence, not this follow-up's acceptance.

## Ordered slices and ownership

This task stays one integration unit during planning. Its tightly shared schema, admission, context and UI boundaries
make a serial foundation appropriate; do not create extra task state merely to mirror this checklist. After approval,
the following slices may become child tasks if separate ownership/acceptance is useful. Parallel writes begin only after
the shared contract is stable and ownership has been explicitly handed off.

| Slice | Responsibility / primary files | Exit evidence |
| --- | --- | --- |
| S0 — lock interfaces and baseline | Coordinator: read current task/specs/research, branch/worktree and migration registry; capture working preimages of owned files and required runtime versions. Freeze new Shared schemas, internal action names and scope validity with reviewer. | Reviewed interface/error matrix and isolated baseline fixture. No edits based on historical HEAD alone. |
| S1 — durable private contracts | Persistence owner: `packages/shared/src/subagent-*.ts`, new inbox/history/summary shapes, `packages/core/src/db/subagent-*`, `run-message-repo.ts`, new forward migration and linked admission/terminal hooks. Include the validated primary inbox-consumer association and separate raw-input/summary witnesses. | Real SQLite atomicity, legacy mapping, receipt immutability, order/cursor and no-wake migration tests. No production dispatcher enabled from schema-only progress. |
| S2 — interactive lifecycle and inbox | Runtime owner: `harness/subagent-service.ts`, `subagent-state.ts`, `subagent-completion.ts`, recovery/parent execution/queries; collector/tools, primary input-intent seam, `turn-recording.ts`, conversation writer/activity routing, normal Run admission and `main.ts` wiring. | Delegate → async message/input wait/final → exact accepted/delivered/handled state; concurrent foreground/idle race, restart routing, stop-origin suppression and no duplicate effects. Mixed public/private steps preserve complete pairs, public partial text and private Memory/activity exclusion. |
| S3 — no expiry and speech separation | Same Runtime owner, with exclusive delivery handoff: direct-request report adapter, Shared prepared-publication validity and authorizer/delivery, generic admissions/timers/currentness/Continue. | Same work across old deadline; no hidden task timer; unchanged finite feature sources; silent handling without speech authority; final-answer right not consumed by interaction. |
| S4 — context and model tools | Context owner after S2/S3 handoff: `ChatAgent`, `work-context`, `run-message-store`, measurement/reduction/quality helpers, private summary repo, recording/material/disclosure owners, delegation result projections and inspectors. | Actual shared Runtime > old caps, pressure compaction inside/between SDK calls, production receipt/CAS/stop/unknown/disclosure checks, all raw pages reachable and process references bounded. |
| S5 — continuous private projection/activity | Runtime/read owner: private history projection/order references, activity sink/recovery, authenticated methods/Shared protocol/WS adapters. | Core/WS newest/older/gap pages, interleaving, duplicate prevention, live→complete batch handoff, independent child/main streams and auth/generation isolation. |
| S6 — shared Chat and child controls | Desktop owner: `features/subagents`, shared extraction from `windows/home/pages/chat`, semantic tool formatter, existing controller/state adapters. | Continuous sender-aware Chat rendering; drafts/selection/anchors/paging/IME, active input, single Stop/Continue operation and reconnect/unknown states against actual WS/Core. |
| S7 — integration and quality | Coordinator + independent reviewer; full original requirement audit, targeted specs updated to delivered behavior. | Required checks, actual native scripted-model flow, retained evidence, reviewed scope/rollback, explicit outstanding human/external gates. |

Shared barrel, `ChatAgent`, `RunService`, `main.ts`, migrations and publication interfaces each have one writer at a time.
S6 can build against a frozen S5 contract while S5 implementation proceeds only if files do not overlap. Every agent gets
the original PRD, design, execution slice, relevant manifest and explicit ownership. Complex implementation and review
use Astra; small bounded implementation may use 6.1 Sol, per the owner's current instruction.

## Acceptance matrix

| PRD criterion | Required later test / observation |
| --- | --- |
| Foreground remains available; bounded eventual handling | Script continuing user requests while multiple children produce events; finite eligible backlog advances FIFO at real model intents, no active foreground abort, no one-utterance-per-event burst. Test idle handler yield and primary/idle claim race. |
| Durable event truth | Crash/fault at acceptance, claim, intent, action result and disposition; preserve accepted/delivered/handled distinction, exact batch/action identities, old receipts and visible reconciliation. Pre-intent retry is separate from unsafe post-intent replay. |
| Async / input wait / final / runtime failure | One message continues independent work; needs-input releases lane; reply resolves the exact pending question in same conversation; stale answer refuses; natural no-final stop stays partial. |
| User Stop and resumed reporting | Stop across collector/provider/restart races causes no automatic main notification; explicit reads show actual state; parent direction cannot clear latch; explicit user continuation restores subsequent normal reporting. |
| No age expiry | Answer after former 12-hour maximum, including old generic rows; same work continues under fresh genuine authority, old terminal Runs/digests remain unchanged. Real permission/source expiry, cancellation and request timeout still refuse correctly. |
| No fixed child cap | Deterministic child crosses project and SDK fallback caps in actual `ChatAgent`, with multiple pressure-triggered SDK segments and same Run/Attempt. Assert unique Effect/input/material keys, no tool replay, no interim task terminalization, unchanged main/parent-continuation cap. |
| Summary/history truth | Source/sender/negation and pending input survive; exact recent paired rounds preserved; raw material survives compact model output; every cursor/body page reachable; cross-child cursors refuse. First consumption, actual raw inclusion and summary coverage differ; summary-only inputs get no new raw receipt. Many addressed corrections and concurrent arrival preserve the complete pending batch through its captured watermark. Failure/non-shrinking/CAS-stop leaves prior coverage intact; giant round fails explicitly if unfit. |
| Long-run resource behavior | Inspect SDK and project retained references across many pressure boundaries; verify raw recording/material/prepared caches release only after durability, successful disclosure survives segments, giant input and unresolved/provider tools cannot force unsafe rollover. Offline probe is insufficient for this gate. |
| Compact actionable output | Capture actual model request/result: readable identity/status/output, exact stale-protected action target, one requested page, no routine full receipt/input echo. Native raw evidence remains retrievable. |
| Real child Chat experience | Actual WebView2 + authenticated WS + production Core, isolated database and scripted model: two children/main concurrently, source labels, long paging/scroll, live commit race, Stop/correct/Continue, target switch, reconnect and timeout. Inspect rendered states and interaction recordings. |
| Preserve surrounding behavior | `record_only` produces no automatic parent inference; finite source/report publication, original-request final speech, prepared result/currentness, child read-only Memory and primary Chat/Memory behavior retain their contracts. |
| Mixed foreground routing | Actual primary model step includes public text, ordinary public tool and private inbox action. Check complete paired partitions, real next SDK request, source sidecars, original user row, public partial text, private Run/action receipts, main/Pet activity, presentation offsets, exposure, both Local/Hindsight source witnesses and restart replay. A private completed effect still fences automatic retry when public projection is empty. See [boundary cases](research/foreground-private-boundary.md). |

## Commands and evidence discipline

Current scripts verified during planning; run these after relevant production changes, not as proof of a document-only plan.
Use Node >=24 and locked pnpm; no inherited live-provider flags or real `.env.local` in deterministic fixtures.

```powershell
python .trellis/scripts/task.py validate 10-25-agent-delegation-conversations
pnpm --filter @taki/shared typecheck
pnpm --filter @taki/core typecheck
pnpm --filter @taki/desktop typecheck
# Run the focused existing/new test files listed by the owning research report first.
pnpm -r typecheck
pnpm lint
pnpm -r test
pnpm --filter @taki/e2e test:e2e
pnpm --filter @taki/desktop build
git diff --check
```

Use the existing native scripted-model harness/production-restart fixture after updating its exact scenario assertions;
retain the final command, source hashes, environment, screenshots/traces and exit codes under task evidence. Run required
Rust checks if native inputs change; unchanged evidence may be reused only with input parity proved and stated. Do not
claim a UI or provider acceptance from compile, mock-only component tests or the SDK feasibility probes.

For this planning turn, validate manifests/links/UTF-8, inspect scoped diffs, and review the two retained offline SDK probes
plus the real TurnQueue primitive experiment. No reason exists to rerun the full application suite without production edits.

## Rollout, migration and rollback

- New schema is forward-only on the authorized T4 lineage. Inspect the registry immediately before choosing a version;
  preserve old migrations/receipts and unknown schemas fail atomically. Fresh, current T4 and legacy T4 fixtures must open,
  retain data and reopen idempotently. No real-user database is part of this plan.
- Introduce producer/storage contracts before consumer/UI activation. Bridge eligible legacy completion rows once by
  stable identity; never run legacy and new notification consumers independently over the same outcome.
- Preserve each owned preimage from the actual dirty worktree. A code rollback restores only owned edits after reconciling
  later changes; never reset to HEAD or reverse somebody else's work. Schema rollback is not a down-migration/delete.
- After migration, an old binary is not presumed compatible with no-expiry/new event rows. Use a compatible forward fix
  or restore the isolated pre-migration database with its matching binary. Production data rollback needs separate approval.
- Do not activate dispatch from a partial schema/context/UI slice. Keep final integration and source/private isolation
  as completion criteria, not an optional later hardening item.

## Planning closeout and next boundary

- [x] Recover original instructions and current task/worktree state.
- [x] Persist Runtime, SDK/context and UI source research plus bounded offline feasibility probes.
- [x] Write PRD-linked design, ordered implementation plan and curated context manifests.
- [x] Saved independent architecture challenge resolved in the plan; coordinator verified foreground routing and input-frontier corrections against current source. New reviewer calls failed; no fresh independent approval is claimed.
- [x] Document/manifest/link validation recorded in [planning validation](research/planning-validation.md); change direction ready for owner review.
- [x] Owner authorized implementation in session `01a17186-8409-7073-b737-845377a5e84f`; activate task and begin S0/S1.

The implementation and manual acceptance boxes in the PRD remain open. Native Hindsight, T4/main schema convergence,
real-model campaigns, new child image ingestion, permanent closure and Git/release actions are not silently included.
