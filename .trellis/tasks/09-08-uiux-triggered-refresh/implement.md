# Page state and triggered-refresh implementation plan

Status: **A-D completed with engineering acceptance on 2026-09-08**, code commit `7d89191`.
See [final evidence](implementation-evidence-2026-09-08.md). Read [prd.md](prd.md), then [design.md](design.md)
and the research manifests. After the complete plan was presented, the owner renewed the goal to
advance identified defects/optimizations autonomously until a real decision or manual-only test
requires the owner. This clears the routine implementation confirmation for this plan; it does not
reopen unrelated G1-G5, capture-policy, D77 or true-T4 work.

## 1. Scope and execution order

One task delivers one cross-page refresh contract through the internal batches below. They share
read coordination and final interaction evidence, so separate child tasks are not needed now.
Implementation is in T4 only. Preserve concurrent Avatar Lab, OpenBiliClaw, config, documentation and
unrelated task changes. Read current source/branch/task pointers again before each implementation batch.

| Batch | Deliverable | Dependency / verification |
| --- | --- | --- |
| A | Correct resource states, demand triggers, read retirement/coalescing and stable rendering/drafts | Existing protocol only. Focused controller/state/component regressions plus Desktop typecheck and scoped lint. |
| B | Actual Perception producer invalidation, subscribe/read restoration and truthful activity/pause presentation | Uses A's lifecycle rules. Shared/Core/Desktop contract and race tests, including stopped-sampler deadline expiry. |
| C | Aggregate opt-in extension invalidation and targeted MCP/Skills/strip refresh | Uses A's lifecycle rules and B's established subscription pattern. Actual lifecycle/Host transition and cross-operator tests. |
| D | Integrated native acceptance, independent full-task review and evidence/spec alignment | A-C complete. Final gates once for the resulting source; retained prior evidence is reused only within its proved scope. |

The Core/Shared producer foundation of B may proceed alongside A under separate file ownership.
B's Desktop integration still consumes the completed A read-lifecycle rules. C's shared composition/
transport changes follow B to avoid simultaneous writers in shared exports and Core composition.

The root owns task/spec integration, review assignments and final evidence. A worker must receive
explicit file ownership, sources, current task path and the no-recursive-delegation/no-commit boundary.
Related internal changes may share one review; the final review covers the full task, not only batch C.

### Bounded context loading

The startup manifests contain the common state/push/quality contracts and current Home inventory.
They intentionally fit the repository's injection budget together with these task artifacts. The
following additional reads are **required before the corresponding code/review work**, rather than
silently truncating every large source study into the initial prompt. Read current files, not memory.
The final reviewer loads all applicable rows. Root project rules in `CLAUDE.md` and `CONTEXT.md` still apply.

| Work | Required additional context |
| --- | --- |
| A: forms, demand, retained UI | [React/source review](research/react-refresh-continuity.md), [config contract](../../spec/backend/config-store.md), [connection recovery](../../spec/frontend/operator-connection-recovery.md), [existing motion requirements](../08-22-t4-agent-architecture-observability/research/uiux-motion-continuity-2026-09-05.md). |
| B: Perception producers/privacy | [Perception study](research/perception-producer-refresh.md), [runtime privacy/sampling contract](../../spec/backend/agent-runtime.md), [database/single-writer guidance](../../spec/backend/database-guidelines.md), [connection recovery](../../spec/frontend/operator-connection-recovery.md). |
| C: MCP/Skill/Host producers | [Extension study and selected design](research/extension-refresh-producers.md), [MCP lifecycle](../../spec/backend/mcp-lifecycle.md), [Skill lifecycle](../../spec/backend/skill-lifecycle.md), [extension discovery](../../spec/backend/extension-discovery.md). |
| Any permission/authority-sensitive work | [Permission authorization](../../spec/backend/permission-authorization.md); retained UI data is never action authority. |
| D: integrated/native verification | [E2E harness](../../spec/backend/e2e-harness.md), [Home/native window contract](../../spec/frontend/home-window.md), all changed-domain rows above and relevant existing acceptance artifacts linked by the inventory. |

Record the relevant additional files read in each implementation/review report. Do not change global
Trellis limits or treat an index-only/truncated injection as having read a complete contract.

## 2. Batch A — resource state, demand and continuity

- [x] Reconfirm the defects in `research/home-refresh-inventory.md` against the implementation head.
  Establish meaningful deferred-promise/controller regressions before fixing the affected behavior.
- [x] Complete `lib/use-cached-fetch.ts` and `cached-fetch-state.ts` lifetime/state contracts. A null
  loader, retired client, disposal or hidden consumer cannot let an old response restore current data.
  Inspect `lib/timing-policy-sync.ts` before extracting repeated read coordination; do not migrate that
  proven owner or Chat/Monitor into a new universal controller.
- [x] Apply one-flight/trailing invalidation to the affected feature read owners. Track true cold
  loading, refresh with content, successful empty, initial failure, stale failure and no transport.
  Preserve mutation locks/outcomes separately from read visibility and disposal.
- [x] Fix MCP's all-state previous-data projection and keep its master/detail/editor parent position
  stable during loading and when a real list becomes empty. Preserve draft/base revision and selection.
- [x] Fix Costume's no-cache failure/empty/previous-result wording and Operations/Perception's null-data
  skeleton/empty branches. Operations status and storage failures remain independently retryable.
- [x] Add source-backed entry/re-entry/demand policies for Settings, Operations, Costume, MCP and Skills.
  Reuse existing config push/gap behavior, retaining invalidations until successful reconciliation.
  Permission/approval reads stay coherent and authority-gated; no invented push subscription.
- [x] Make the existing shared config subscription retryable after rejected/invalid/lost setup and
  expose its observation gap in Settings. Recovered membership reconciles the existing timing-policy
  owner once, without requiring another config event or adding a new timing store/polling loop.
  Preserve one membership and coalesce actual simultaneous identical config reads where applicable.
- [x] Preserve dirty/focused/IME config drafts. No-op blur and active composition do not write; a
  same-field conflict blocks blur submission and offers local use-latest or explicit overwrite-save.
  Return a typed local save outcome and clear only the matching successful attempt's unchanged draft.
  Preserve newer edits/refusals/retired outcomes and provide a deliberate action for a still-unsaved
  draft after an earlier save settles. Do not auto-save on refresh, advance an MCP retry revision from
  background list updates, or claim config writes have server CAS. Only the matching submitted commit may
  advance a retained same-target editor's retry revision.
- [x] Make Skill inspection association/lifetime explicit. A valid collapse/reopen is local; an
  invalidated result requires deliberate inspection. Late closed/replaced replies cannot reopen it.
- [x] Separate extension-strip connection binding from view invalidation. Gate identical hidden
  consumers rather than refreshing every mounted copy; deduplicate genuinely concurrent same-key reads.
- [x] Add effective route/document visibility handling only where needed. Prove that window blur is
  not hide and that changing visibility does not cancel a running Core/Host command.
- [x] Update touched production headers and directory indexes; preserve current visual tokens and
  the accepted Chat/Pet and DSH component boundaries.

Expected frontend scope: `apps/desktop/src/lib/{use-cached-fetch,cached-fetch-state,ws-client-methods}.ts`
and the existing config/timing subscription recovery seam; Home visibility
and extension-convergence owners; focused Settings, Operations, Perception, Costume, MCP and Skills
hooks/controllers/views plus their tests/indexes. Any new pure helper must own an established repeated
invariant and stay within the existing size/responsibility guidance. No dependency/config change.

## 3. Batch B — Perception producer-to-view path

- [x] Add strict `perception.subscribe` / `perception.changed` schemas/constants and explicit Shared
  exports. Preserve existing card/pause result schemas and the single durable pause writer.
- [x] Add data-free callbacks after accepted ActivityState changes, effective seals and actual sampler
  scheduling transitions. Compose the change owner in the existing Perception layer. Do not notify
  raw capability output, denied app identity, screenshot content or unrelated GC/config events.
- [x] Add the small connection-keyed operator subscription registry and normal close cleanup. Install
  producer hooks before background activity can change observed state; zero subscribers is valid.
- [x] Observe successful pause transitions and one absolute-deadline projection wake-up. Test hydrated,
  replaced, indefinite, long and already-expired deadlines; no new DB write/resume/sampling/model call.
- [x] Extend the current WsClient methods/handler Set, strict inbound parser and retirement cleanup.
  Memoize successful subscription setup per physical client, recover from a rejected setup promise,
  and use the existing idempotent request/deadline classification.
- [x] Use one coherent card read after handler installation and acknowledged subscription. Retire
  independent mount card/pause reads; controls derive only from fresh authoritative evidence, with
  local write/read epochs and a post-outcome reconciliation for uncovered changes.
- [x] Make activity/scheduling wording match the actual fields. Show the latest sampled activity,
  scheduled-loop state and known pause state without fabricating live Host/capture availability.
- [x] Add recognized unsupported-Core behavior: bounded entry/manual reads, useful automatic-refresh
  unavailable feedback, no timer fallback and no downgrading authentication/forbidden errors.

Expected producer scope is enumerated in
[perception-producer-refresh.md](research/perception-producer-refresh.md): Shared Perception schema;
Core activity/perception factories/state/samplers and registration; Desktop WS/deadline and Perception
owner/view tests. No Shell capability, raw store, sampler cadence, dwell, retention or schema migration.

## 4. Batch C — extension producer-to-view path

- [x] Implement the root-selected opt-in aggregate contract in design section 6, not the passive
  broadcast alternative in the initial research. Add one `extension.subscribe` and strict targeted
  `extension.changed`, with process-local invalidation revision and normal connection cleanup.
  A failed setup promise must be retryable on the same client; a repeated server subscribe is idempotent.
- [x] Cover desired MCP commits, current candidate start/final state, active publication/withdrawal,
  boot/secret background replacement, and actual status-changing closure. Notify on `closed = true`
  rather than waiting for deferred client-close cleanup; preserve that cleanup callback's purpose.
  Cover connecting candidates whose displayed tool count still comes from a draining fallback.
- [x] Cover Skill committed list changes, rejected imports that do not advance catalog generation,
  catalog publication and surviving partial commits. Do not notify ordinary resource leases/read/GC.
- [x] Add Host catalog change observation at successful set and actual matching delete inside its
  owner. Cover invalid current-candidate retirement and late old connection closure without changing
  generation/auth checks or adding callbacks independently to every caller.
- [x] Add subscriber isolation and optional bounded microtask union of already-produced targets.
  Emit no data/config/secrets/errors/IDs and create no query/test/reconnect/reconcile on the producer path.
- [x] Bind existing MCP/Skills/strip consumers before baseline read, await the one subscription,
  and invalidate only relevant visible projections. Coalesce own-write notification and settlement.
  Closed Skill details remain demand-only; unrelated package changes preserve their disclosure.
- [x] Preserve old-Core/manual behavior and all existing lifecycle/authorization outcomes. No remote
  transport/list-change detection is claimed unless the current producer actually observes a change.

Expected source scope is enumerated in
[extension-refresh-producers.md](research/extension-refresh-producers.md), adjusted to the selected
subscription registry/method in place of passive registry-wide broadcasting. No new runtime authority,
immutable Run snapshot mutation, Host routing rule, automatic MCP connection/probe or filesystem watcher.

## 5. Required test matrix

The matrix below is complete within the linked engineering evidence. Use current installed test tools and framework-free controllers; do not
install a test/browser dependency as an incidental implementation choice.

| Case | Required evidence |
| --- | --- |
| First usable entry; repeated render/duplicate demand | One needed current-scope baseline; no request because an ordinary component render occurred. |
| Finite event burst during one read | One owned flight and one pending trailing read; no lost dirty mark or requests after the source becomes idle. |
| Cold failure, successful empty, refresh success/failure with prior data | Correct state/action; no permanent skeleton, fake empty success, or removed prior content. |
| No transport, old client success/failure, hide/show, disposal | Obsolete results cannot apply or clear newer state; no hidden read/publication loop; exactly the required restore on return. |
| New push/echo racing an older snapshot | Current data cannot regress or be declared fresh from an uncovered response; privacy gets its stronger freshness rule. |
| Write pending while page is hidden | Read work stops as appropriate; command still settles once and is never cancelled/replayed by visibility. |
| Dirty config/IME and MCP editor during refresh | Draft text, base revision, focus and selection survive; no-op/conflicted/composing blur sends no write; use-latest is local and overwrite is explicit; failed/retired saves or a new draft cannot be cleared by an old fulfilled promise. |
| Disclosure reopen and obsolete detail replies | Valid local reopen costs zero RPC; explicit Inspect performs a read; obsolete replies cannot open/replace another detail. |
| Same/partly changed data | Stable unaffected DOM nodes and local state; actual changed fields update; busy/error metadata remains truthful. |
| Perception source acceptance/seal/scheduling/pause/expiry | Current/recent dwell distinction retained; data-free notifications occur only after actual facts; no new sensing, private payload, pause writer or expiry DB write. |
| Extension candidate/drain/rejected import/Host retirement | Every relevant late/cross-actor state invalidates; no per-tool-call/lease event or new connection/probe. |
| Subscription permission/duplicate/failure/close | Only authenticated operators; one membership per client; failure isolation, retry on the same client after rejection/timeout/bad ack, idempotency after lost ack, and complete close/shutdown cleanup. |
| Config setup failure followed by a missed timing change and successful retry | Settings recovers and the existing timing store reconciles once even without a subsequent push; no duplicate membership, permanently cached rejection, new timing owner or poll. |
| Older Core and malformed notification | Recognized unsupported subscription degrades explicitly; forbidden/invalid content does not gain a fallback authority; no UI polling. |

## 6. Batch D — final acceptance and quality gates

- [x] Run targeted actual Core/WS integration with synthetic sources and two authenticated operators.
  Prove that one actor's accepted changes refresh the other visible view without exposing raw content.
  Keep tests offline/local and isolated from user data, provider accounts, Keyring and real MCP services.
- [x] Build and freeze the final production frontend assets and relevant source/config hashes. Preserve
  concurrent Lab/config inputs and explicitly bound what this task's evidence certifies.
- [x] Exercise delayed reads and errors in an isolated real WebView2 host: MCP editing/expanded tools,
  Skills inspection/collapse, each cold/stale failure, config field editing/composition, scroll/selection,
  hide/show/reconnect and external actor updates. Record request counts and before/intermediate/after
  node identity, active element, input selection, DOM Range and viewport-relative reading anchor.
- [x] Label composition-event automation and actual OS IME evidence accurately. A static render,
  source test or final screenshot alone is not proof of focus, selection or intermediate geometry.
- [x] Include reduced motion and real native visibility. Retain relevant existing Chat/Pet and Monitor
  acceptance as regression evidence; rerun those paths only when common touched code or findings justify it.
- [x] Complete one independent full-task Trellis review, fixing its findings, then run final relevant
  gates on the resulting source. Do not repeat successful unchanged whole suites during each small edit.
- [x] Synchronize frontend read-model/state/visibility and backend server-push specs with the implemented
  contracts. Remove the identified historical overclaims. Record new test/native evidence and the old
  AC crosswalk without checking unrelated CJK performance or personal owner-inspection boxes.
- [x] Verify native/helper cleanup, source/asset integrity and scoped Git diff. Prepare a coherent
  owned-file delivery; do not stage concurrent work or infer push/archive/commit authority from planning.

Final commands, after focused gates and approval to implement:

```powershell
pnpm -r typecheck
pnpm lint
pnpm --filter @taki/shared test
pnpm --filter @taki/core exec vitest run --maxWorkers=4
pnpm --filter @taki/desktop test
pnpm --filter @taki/desktop build
git diff --check
```

Run the full Core suite alone to avoid known concurrent-worker timing noise. Shared operator-only
frames do not need Rust mirrors; add Rust checks only if a justified implementation actually changes
Rust/build contracts. Run relevant existing E2E/deadline/shutdown checks when touched seams warrant
them. Record existing/concurrent failures separately with evidence; they cannot be silently counted
as passing or repaired by reverting another contributor's files.

## 7. Rollback and completion boundary

Each source batch remains coherent and reviewable; branch-local snapshots/commits require applicable
authorization. Disable/revert the new consumer subscription wiring first if needed; existing reads
remain available and unused producers are harmless. Preserve Core/Host authority, canonical Timeline,
pause persistence, generations, privacy screening and existing migrations.

This task closes only its state/triggered-refresh acceptance after evidence exists. Historical pure
frontend long-CJK profiling, D77, Avatar Lab/OpenBiliClaw and actual T4 initiative/Heartbeat/cross-device
work keep their separate status. Do not archive the architecture parent or claim all UI/UX complete.
