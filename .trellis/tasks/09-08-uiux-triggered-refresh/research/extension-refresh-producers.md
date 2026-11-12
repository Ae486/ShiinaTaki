# Research: Extension operator refresh producers

- Query: Which MCP/Skills/extension-strip facts can change after a mutation response or through another actor, and which real producers should invalidate those views?
- Scope: internal source research in `H:/TakiAgent-worktrees/t4`; planning only. Root owns the wider UI plan; this report does not research Perception or framework behavior.
- Date: 2026-09-08
- Task: `.trellis/tasks/09-08-uiux-triggered-refresh`; root supplied baseline `b251474`. Task pointers were not changed.
- Status: source research complete; implementation and software/runtime tests remain unimplemented/unverified.

## Findings

### Final selected direction

**The root-selected [design.md](../design.md), especially sections 3, 6 and 7, is authoritative.** Use ONE opt-in aggregate extension subscription on the existing authenticated operator connection:

```text
extension.subscribe({}) -> { status: "ok" }
extension.changed       -> { revision: <nonnegative safe integer>,
                            targets: <nonempty unique subset of
                                      mcp | skills | extension-status> }
```

Use one memoized, connection-keyed, idempotent membership per physical `WsClient`; install handlers before subscribe and read after acknowledgement. Close removes membership; hidden consumers retain dirty hints without reads/renders. Revision is process-local ordering for this channel, not a snapshot version, durable cursor, permission or Perception revision.

Use targeted existing `mcp.list`, `skill.list` and `extension.status` reads. Producer tables below define exact target coverage; no second projection store or desired/runtime merge is needed.

Passive broadcasting was **considered, not selected**. One opt-in channel follows existing fan-out, avoids unsolicited frames for older consumers and detects support. Three subscriptions add recovery work; explicit-only reads miss real asynchronous changes.

### Subscription, revision and compatibility requirements

- Follow `packages/core/src/server/methods/config-subscribe.ts:20`: install the sink before returning the acknowledgement; register close cleanup. `packages/core/src/config/config-subscriptions.ts:23` replaces the same connection's sink idempotently. Keep per-recipient exception isolation like `packages/core/src/server/timeline-subscriptions.ts:73`; a failed observer cannot change a mutation's result or block other observers.
- **Do not copy failed-promise memoization unchanged.** `apps/desktop/src/lib/ws-client-methods.ts:225` uses `configSubscription ??= request(...).then(...)` without clearing rejection. New extension subscription setup must allow a failed attempt to retire so deliberate Retry issues a real request. Reset only that attempt's promise, so a late failure cannot erase a newer attempt. If the first subscription was accepted but its acknowledgement was lost, retry must still leave one sink.
- Recognized JSON-RPC method-not-found is the unsupported-feature signal: current Core dispatch returns `JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND` (`-32601`) at `packages/core/src/server/method-registry.ts:85`. Retain entry/manual reads and report automatic refresh unavailable. Forbidden/authentication/invalid-acknowledgement/timeout failures are real errors, not unsupported shortcuts. No automatic retry loop.
- A microtask batch may union already-produced targets. It must retain **all** affected targets and one ordering revision for the aggregate channel, not reuse independent domain counters. Retire observer revision state with physical-client retirement. Empty subscribe acknowledgement is a sufficient membership barrier because it precedes a fresh read; it does not version that read.
- Notifications contain only revision and the closed targets: no IDs, config, secret refs/values, package locators, paths, raw errors, or execution I/O. Existing management/status reads are global operator-role surfaces; no narrower per-operator Host filter was found. Nodes and unauthenticated peers cannot subscribe. Any future narrower read authorization must also narrow notification recipients.
- Parse once through `apps/desktop/src/lib/ws-client-routes.ts` (existing config/monitor fan-out at `:135`, `:145`), expose typed local handlers on `WsClient`, and classify the new subscribe RPC's deadline. No new socket/router, generic event bus, persistent cache category, or Rust mirror for this operator-only frame. Zero subscribers cause no query, probe, connection, test, reconcile, or model call.

### Visible facts and demand boundaries

- MCP cards show desired transport/enabled/selection, phase, tool count and candidate outcome, not ordinary lease count: `apps/desktop/src/windows/home/pages/mcp/mcp-server-card.tsx:31`. Read on usable entry/current client, explicit refresh, own outcome or targeted lifecycle invalidation. Selected-tools expansion needs no RPC; background reads must not overwrite drafts/revisions.
- Skills list shows metadata/refusal, source/trust, lifecycle/runtime/enabled and scan state: `apps/desktop/src/windows/home/pages/skills/skill-card.tsx:30`. Use entry/manual/own-outcome/committed-change reads. Inspection is separately explicit (`packages/core/src/skills/skill-lifecycle-service.ts:35`, `:137`); collapse/reopen reuses a valid result (`skill-card.tsx:67`). No hidden/reconnect/list-triggered inspect.
- The strip shows available Hosts, descriptor count and collision count (`apps/desktop/src/windows/home/extension-convergence.tsx:28`). Only visible interested instances reconcile catalog invalidations; hidden copies retain dirty hints. Replacement clients need fresh authority; retained content remains qualified stale until covered.

### MCP: exact producer transition coverage

Runtime projection is derived in `packages/core/src/mcp/mcp-runtime-status.ts:29`: phase prefers a current candidate, then active, then non-closed draining, then disabled/failed/disconnected. `:47` selects the active record or newest non-closed draining fallback; `:52` sums leases and `:53` derives its tool count.

| Transition | Current source and timing | Required target / hook |
| --- | --- | --- |
| Desired add/edit/enable/disable/remove, including partial outcome | `packages/core/src/mcp/mcp-lifecycle-service.ts:113`, `:128`, `:136`, `:143`, `:150`. Durable rows commit before candidate completion. Enabled add/edit/enable/reconnect await their candidate; disabled add never calls the manager. Another operator can commit at any time. | `mcp` on actual durable change, including disabled addition and any committed row surviving later failure. A hook only on publication or successful RPC return misses these cases. |
| Current candidate starts | `packages/core/src/mcp/mcp-publication.ts:25` tracks desired ownership and begins a candidate before awaiting preparation; `mcp-runtime-status.ts:35` reports connecting even while last-good tools serve. | `mcp` after candidate ownership is installed. Applies to another actor, secret update and boot reconciliation. |
| Candidate succeeds/fails/is superseded | Outcome assignment/cleanup at `mcp-publication.ts:32`, `:35`, `:43`, `:45`, `:137`; current candidate removal at `packages/core/src/mcp/mcp-manager-state.ts:146`. Failure changes bounded `lastOutcome` while last-good can remain connected. | `mcp` after current outcome and candidate removal are coherent. Stale candidates cannot mutate current truth. `extension-status` only if active discovery actually changed. |
| Active publication/replacement/withdrawal | Atomic active-map swap at `mcp-publication.ts:83`; withdrawal at `mcp-manager-state.ts:177`; disable/remove at `packages/core/src/mcp/mcp-manager.ts:130`. | `mcp` + `extension-status`. Preserve immutable captured Run bindings and last-good semantics. |
| Disable returns, last lease later releases or deadline closes | Disable is synchronous after retirement (`mcp-lifecycle-service.ts:143`). Release/drain/close occur in `packages/core/src/mcp/mcp-generations.ts:60`, `:69`, `:80`. Later close can change visible phase/tool count. | `mcp` at the immediate closed-state transition. Convergence already changed at active withdrawal; drain completion alone does not refresh it. |
| Old replacement generation closes | May happen after response. Active record normally wins display (`mcp-runtime-status.ts:38`, `:47`), so only unrendered lease state changes. | No strip invalidation. A bounded per-retired-generation MCP invalidation is conservative; omit if it affects no displayed fact. |
| Secret set/clear | `packages/core/src/mcp/mcp-boot.ts:49` calls manager callbacks. Set starts fire-and-forget replacements via `mcp-manager.ts:171`; clear withdraws users and sets bounded failure at `:140`. Secret operation response does not await replacement settlement. | Reuse candidate/publication/close hooks; clear also invalidates changed outcome. Never include the secret/ref/config in the event. |
| Boot reconcile | `packages/core/src/main.ts:230` uses `void mcpBoot.manager.reconcile(...)`; candidates can finish after the page's first read. | Install manager callbacks before reconciliation starts; same target rules, with zero subscribers valid. |
| Ordinary tool-call acquire/release | `mcp-generations.ts:54`, `:60`; actual leased calls at `packages/core/src/mcp/mcp-turn-tools.ts:70`, `:96`. Lease counts are not rendered. | No per-call list/strip notifications. Last-release close remains covered above. |
| Explicit Test | `mcp-manager.ts:189` prepares an ephemeral candidate, closes it in `finally`, and does not publish desired/active/outcome-map state. | Initiator-only feedback; no shared test-result subscription. Test/Reconnect are never automatic refresh reads. |
| Independent remote death/tool-list change | `packages/core/src/mcp/mcp-connect.ts:20` passes only transport to the SDK; no manager transport-close/list-change observer exists. Tool rejection at `mcp-turn-tools.ts:82` does not replace status/outcome. | Not solved by this channel. No probes, added MCP connections, auto-reconnect, inferred failures or claim of observing remote `tools/list_changed`. |

The close timing is essential:

```ts
// packages/core/src/mcp/mcp-generations.ts:80-87
record.closed = true;
// ... clear close timer ...
record.closePromise = closeMcpClient(record.client)
  .finally(() => record.onClosed?.(record));
```

The status already excludes a closed record (`mcp-runtime-status.ts:31`). Existing `onClosed` is deferred cleanup and only removes it from `state.draining` (`mcp-publication.ts:93`). Add a distinct immediate state-change callback; do not move cleanup earlier or wait for possibly slow transport close.

**Do not condition this callback on `phase === "draining"`.** Secret clear can withdraw the active record while its lease drains; restoring the secret can start a deferred current candidate. Phase is then connecting, but tool count still comes from the draining fallback (`mcp-runtime-status.ts:35`, `:47`). Closing that old record can drop tool count to zero before the candidate settles. The close event must cover that visible change too.

### Skills: committed lists versus runtime publication

| Transition | Current source / timing | Notification requirement |
| --- | --- | --- |
| Import/replace/enable/disable/remove | Service queue at `packages/core/src/skills/skill-lifecycle-service.ts:28`; prepare/commit/publication at `:42`, `:50`, `:56`, `:79`, `:117`. Publication is synchronous before normal response, not a separate asynchronous settling phase. Another actor can still change the open list. | Commit-aware `skills` callback plus `extension-status` after coherent catalog publication. Surviving partial commits still invalidate despite later failure; pre-commit refusal/conflict is not an invented change. |
| Rejected import | `skill-lifecycle-service.ts:90` inserts an inert operator-visible row and returns without catalog publication. A failed replacement attempt can preserve the old package while adding this rejected row. | `skills` only. **Catalog-generation-only invalidation misses rejected inserts.** |
| Reconcile | `skill-lifecycle-service.ts:121` verifies rows, may mark content rejected/disabled, then publishes. Disabled active rows are also verified by `packages/core/src/skills/skill-catalog-manager.ts:48`. | `skills` + `extension-status`; reconcile remains a deliberate command, not an entry/event refresh API. |
| Catalog swap | `skill-catalog-manager.ts:60` assigns `current = { id: ++nextGeneration, ... }` synchronously. Even equivalent reconcile advances generation. Current production publication flows through `publishCommitted` (`skill-lifecycle-service.ts:117`) or boot reconcile (`packages/core/src/skills/skill-boot.ts:26`). | Put callback in committed service/publication orchestration; notify after map swap, before unrelated cleanup. A direct catalog callback is only necessary if another actual publisher exists. |
| Leased reads/GC | `skill-catalog-manager.ts:76`, `:96` retain current durable roots while releasing retired content. `load`/`readResource` at `:116`, `:127` return bounded INVALID on changed files without changing the durable row/catalog. | No per-read/GC event. No filesystem watcher was found. Explicit Inspect revalidates its result; explicit reconcile updates lifecycle truth. |

Associate inspection with current package/content identity from its returned row. An unrelated package update must not refetch or remount the inspected card. After replacement/removal or client retirement, a late inspection cannot reopen detail or claim current validation. A cached result is not proof that files have remained unchanged since inspection.

### Host catalog and extension strip

`packages/core/src/server/methods/extension-status.ts:14` synchronously projects current Skill, active MCP and Host catalogs through `packages/core/src/main.ts:438` and `packages/core/src/extensions/extension-run-context.ts:41`; it creates no new catalog authority or MCP connection.

| Transition | Exact authority path | Complete hook |
| --- | --- | --- |
| Accepted complete Node catalog | `packages/core/src/server/methods/host-catalog-publish.ts:27` checks authenticated Host/current connection; `packages/core/src/hosts/host-catalog.ts:50` validates provenance/version/generation, then `:68` performs atomic `live.set`. | `extension-status` after successful set. Readiness/membership/generations may change; do not relay the raw Node payload. |
| Disconnect/replacement/late old close | Existing `packages/core/src/server/connection-registry.ts:99` onRemove -> `packages/core/src/hosts/host-generation-retirement.ts:17` -> exact-generation catalog retirement. Replacement retires the predecessor before socket close (`connection-registry.ts:79`, `:113`). | Notify only an actual matching `live.delete` in `host-catalog.ts:71`; late old close must not remove or falsely invalidate a replacement. |
| Current invalid/non-monotonic catalog | `host-catalog-publish.ts:32` and `:40` retire the current catalog even though publication is rejected. Wrong-Host/stale-connection attempts cannot authorize that retirement. | The same actual-delete callback. Accepted-publish-only and physical-disconnect-only listeners are incomplete. |

`HostCatalogStore` has no current change callback (`host-catalog.ts:38`). Add one **inside the store after accepted set/actual matching deletion**; existing RPC/socket paths then need no duplicate notifier logic. Local active MCP and Skill publications also invalidate the strip (`packages/core/src/extensions/extension-sources.ts:29`, `:69`). Rejected Skill rows and failed last-good-preserving MCP candidates do not themselves alter its catalog.

Host snapshots contain live catalogs (`extension-sources.ts:117`; `packages/core/src/extensions/extension-registry.ts:120`), not invented retained offline Hosts. A generation change may leave strip counts unchanged.

### Existing identities and read races

| Existing identity | Valid use | Missing coverage |
| --- | --- | --- |
| MCP per-row configRevision | Optimistic mutation identity (`packages/shared/src/mcp-lifecycle-schema.ts:211`). | Runtime candidate/outcome/drain changes or list removal. |
| MCP runtime generation / candidate token | Process-local binding/publication ownership (`mcp-manager-state.ts:23`, `:101`; `mcp-publication.ts:88`). | Not a status version; resets on restart. |
| Skill revision/hash/catalogGeneration | Package/content association and runtime publication (`packages/shared/src/skill-lifecycle-schema.ts:67`; `skill-lifecycle-service.ts:34`). | Catalog generation misses rejected-row insertion; hash is not later filesystem verification. |
| Host owner/connection/catalog tuple | Accepted provenance and stale retirement rejection (`host-catalog.ts:50`, `:71`). | Does not order independent local Skill/MCP producers. |
| Extension observedAt / descriptor generations | Observation time and each captured owner (`packages/shared/src/extension-discovery-schema.ts:78`; `extension-sources.ts:145`). | No aggregate change cursor or atomic revision on existing read responses. |

Apply design section 3's read coordinator:

1. Handler -> subscribe acknowledgement -> initial read. Guard physical client, resource/detail scope, request/write epochs and dirty coverage on both success and failure. Duplicate demand joins one current flight; actual invalidations during it leave one trailing obligation. Unversioned responses cannot clear newer dirty marks.
2. Failure preserves permitted content plus retryable stale/error feedback and never schedules its own loop. Hidden consumers only retain a gap; reconcile once when required on show. Coalesce initiator notifications with post-outcome reads while allowing other operators to observe actual intermediate states. Never replay timed-out/unknown mutations.
3. Preserve mounted rows, drafts, expansion and reading position; separate strip binding from refresh. Existing list/inspect APIs have no AbortSignal: ignore retired reads without closing the shared socket or sending Host/Core cancellation. Do not hide by binding the mutation controller to null: `apps/desktop/src/windows/home/pages/skills/skills-controller.ts:37` resets its lock, while command settlement is separate at `:25`. Accepted commands, including explicit MCP Test/Reconnect, must still settle.
4. Inspection owns a package/content/detail epoch. Unrelated list updates preserve it; replacement/removal, close or client retirement reject late results. Valid collapse/reopen is local reuse, not automatic inspection.

Runtime-only `mcp.status` already exists (`apps/desktop/src/lib/ws-client.ts:175`), but structural invalidations exclude ordinary lease churn. A coalesced `mcp.list` avoids a second desired/runtime merge race.

### Focused tests and affected seams

| Suite / seam | Essential test and expected observation |
| --- | --- |
| `packages/core/src/mcp/mcp-generations.test.ts` | Disable with deferred call; last release/deadline closes; defer transport close. Notify at immediate closed state, leave draining after read, preserve unknown forced-close outcome. Also clear -> restore -> deferred candidate -> old lease closes while phase remains connecting and tool count drops. |
| Same suite + `mcp-lifecycle-service.test.ts` | Secret/boot background completion, last-good failure, superseded candidate; disabled add; committed desired change followed by failure. Notify real current changes even without successful overall RPC/publication; no stale publication, per-call lease noise, automatic probe or shared private Test feedback. |
| `packages/core/src/skills/skill-lifecycle-service.test.ts`, `skill-catalog-manager.test.ts` | Rejected import with unchanged catalog generation; replace/enable/disable/remove/reconcile; surviving partial commit; ordinary read/GC. List changes notify, publication also invalidates strip, pre-commit refusal/read/GC does not invent changes. |
| `packages/core/src/hosts/host-catalog.test.ts`, `host-generation-retirement.test.ts`, `server/methods/host-catalog-publish.test.ts` | Accepted publish/readiness change; current invalid candidate; replacement; late old close; forged/stale input. Only actual accepted set/matching delete notifies; rejected current candidate retirement remains covered. |
| New aggregate subscription/schema suite | Operator/node/awaiting roles, zero subscribers, throwing observer, duplicate subscribe, lost ack, malformed payload, target burst. One authorized sink per connection, exact close cleanup, isolated errors, bounded unique target union/revision, no secrets/IDs/raw content. Reads emit no events. |
| `apps/desktop/src/lib/ws-client.test.ts` | Handler before setup; memoized concurrent subscribe; transient rejection -> deliberate retry; accepted-but-ack-lost -> idempotent retry; -32601 versus forbidden/invalid ack; retired client. One parse/fan-out path; no permanently cached rejection, wrong fallback or loop. |
| MCP/Skills controller suites | Event during initial read, burst during read, mutation event plus settlement, hidden gap, old response/error, failed trailing read. One current flight/one trailing obligation, no lost invalidation, stale overwrite, erased draft or mutation replay. |
| `extension-convergence-controller.test.ts`, `extension-convergence.test.tsx` | Multiple mounted page/strip instances with only one visible; Host event; hide/show mid-read; reconnect. Only required visible projections fetch; old content gets truthful refresh/stale state without hidden repeated renders. |
| Skills controller/card tests | Inspect; collapse/reopen; unrelated list update; replacement/removal; close/rebind before deferred result. No automatic/hidden inspection; valid reopen costs zero RPC; stale result cannot reopen or overwrite another detail. |
| Later isolated process + real WebView2 | Operator A mutates while B observes; controlled Host changes; hide during a deferred command. Demonstrate cross-actor freshness, surviving command outcomes and stable editing/reading without user data, paid services or replay. Not yet executed. |

Root design/implement artifacts own the file list. Use the producer seams above, one subscription registry/method/schema, and existing Desktop route/controllers; add no generic store or execution path.

### Related specs and external references

- `.trellis/workflow.md`: planning is not implementation/lifecycle authorization.
- `.trellis/spec/backend/mcp-lifecycle.md`, `skill-lifecycle.md`, `extension-discovery.md`: desired/runtime/Host authority, coherent publication, immutable bindings, sanitized projections and no replay.
- `.trellis/spec/backend/server-push-and-connection-auth.md`: producer-backed, operator-gated existing-socket fan-out, membership cleanup and operator-only Rust-mirror exemption.
- `.trellis/spec/frontend/reactive-read-models.md`, `state-management.md`: one inbound seam, generation/visibility guards, truthful states, no polling or new persistence category.
- No external/framework documents were used for behavior claims. Live `@ai-sdk/mcp` declaration is `^2.0.10` (`packages/core/package.json:14`), locked to `@ai-sdk/mcp@2.0.10(zod@4.4.3)` (`pnpm-lock.yaml:2013`). No sufficient independent SDK lifecycle observation hook was established.
- Conclusions use direct current-source reads, not index revision assumptions; no runtime probes were performed.

## Caveats / Not Found

- Existing `ConnectionRegistry.onRemove` and deferred MCP `onClosed` are insufficient alone. Complete MCP/Skills/extension producer callbacks and the selected operator subscription are not implemented in the inspected baseline.
- Independent remote MCP transport death/tool-list change, Skill filesystem watching, and an aggregate revision on existing read responses were not established. A refresh channel cannot manufacture unobserved producer truth.
- The final single opt-in subscription has no identified architectural blocker. Failure-retry memoization and connecting-phase draining fallback are required implementation/test details, not reasons to add channels or state stores.
- Source research and artifact checks only: no software/process/WebView2 tests, traffic measurement, user-data access, dependency changes, production/spec/config/task metadata edits, pointer changes or Git operations. Only this research file was written. Owner manual acceptance remains separate.
