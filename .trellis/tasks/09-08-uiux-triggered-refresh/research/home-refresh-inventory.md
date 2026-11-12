# Home refresh inventory and acceptance alignment

- Date: 2026-09-08.
- Scope: planning-baseline Desktop source and existing engineering evidence; the findings below are historical
  evidence at `b251474`, not a claim that the repaired implementation still has these defects. See the evolving
  [implementation evidence](../implementation-evidence-2026-09-08.md) for current verification.
- Worktree / baseline: `H:/TakiAgent-worktrees/t4`, `task/t4-skills-mcp-productization`, `b251474`.
- The registry is `apps/desktop/src/windows/home/pages.ts:34`: Chat, Settings, Operations, Perception,
  Costume, MCP, Skills, Monitor. Settings and extension pages contain several independent resources.

## Owner requirement

The owner approved planning after the previous read-only audit and requested a deliberate refresh
policy: initialize a view, update genuinely changing information from its producer, read other details
when entered or expanded, avoid unnecessary repeated reads, and preserve the visible page while data
changes. Technical frontend choices are delegated. Planning did not itself authorize implementation; the later
renewed execution goal cleared that gate, as recorded in [prd.md](../prd.md).

## Source-confirmed gaps

| Finding | Current evidence | Required correction |
| --- | --- | --- |
| MCP loses its visible content while refreshing | `mcp/mcp-controller.ts:61` publishes loading with `lastGood`; `mcp/mcp-page.tsx:96` projects loading to `null` and line 109 renders the skeleton. | Keep the current master/detail subtree while a permitted previous snapshot exists. A delayed refresh must not reset disclosure, focus or selection. |
| Costume cold failure claims empty data | `costume/costume-page.tsx:55-56` selects empty rows after loading ends; line 107 always calls them the previous result. `use-costume-page.ts` uses an empty fallback when the cache has no data. | Distinguish a failed unknown list from a successfully empty list and an actual previous list. |
| Operations and Perception cold failures keep loading placeholders | `operations/operations-page.tsx:48`, `operations/storage-card.tsx`, `perception/perception-page.tsx:56-59`. Data nullness, rather than the request phase, selects loading or no-activity content. | Expose independent resource phases; a failed read ends its loading state and does not assert no activity. |
| Cached requests are not retired by absence of a loader alone | `lib/use-cached-fetch.ts:41-56` increments its generation only when a new non-null load starts; its effect has no cleanup. | Explicitly retire old resource/client/visibility requests. A null loader, hide or unmount cannot let a late result restore current-looking state. |
| Config subscription failure cannot currently recover on the same client | `lib/ws-client-methods.ts:225-229` permanently memoizes rejection. `settings/use-config.ts` only logs setup failure; `lib/timing-policy-sync.ts` retains last-good timing after that failure. | Permit deliberate same-client subscription retry, retain a visible observation gap, and reconcile both Settings and the existing timing owner after recovered membership. Do not add polling or a second timing store. |
| Config pushes can replace an active draft | `settings/knob-field.tsx:46` copies every changed server display value into draft state. | Separate last observed server value from an actively edited draft; preserve input/IME ownership and surface same-field changes safely. |
| Some refresh paths lack coalescing or consumer lifetime | MCP, permission and approval list controllers protect client epochs but do not serialize all read triggers. `skills-controller.ts:39` checks request tokens but does not know a closed detail's lifetime. | Deduplicate reads, retain invalidations that arrive during a read, and retire obsolete detail replies without cancelling an underlying command. |
| Extension refresh identity mixes transport binding and content invalidation | `extension-convergence.tsx:21-23` calls `replace` for both client replacement and `refreshKey` changes. | Bind once per client generation; invalidate a view separately and avoid duplicate initial reads from list/bootstrap changes. |

The page-relative paths above are under `apps/desktop/src/windows/home/pages/`; `lib/` is under
`apps/desktop/src/`, and `extension-convergence.tsx` is directly under `windows/home/`.

These are source findings. The prior accepted G1-G5 tests did not certify all of these delayed-read,
first-failure, or active-draft cases. No new window reproduction was run for this planning inventory.

## Current mechanisms and planned policies

This table names behavior, not a new global configuration/registry to implement. The final design
settles producer notification details using the two producer research files.

| Page / resource | Existing mechanism | Planned refresh policy | Hidden / closed behavior |
| --- | --- | --- | --- |
| Chat activity and history | Independent socket; subscribe-before-history and committed-batch restore; activity/text publications; explicit older history reads. | Preserve its accepted event stream, exact commit handoff and cursor recovery. Navigation must not add a redundant whole-history reload. | Preserve the existing background activity-observer exception; do not cancel the turn or stop Core on hide. |
| Settings: config | `use-config.ts`, `config-gate.ts:18-37`: per-generation snapshot, `config.changed`, skipped hidden deltas and an on-show catch-up. | Reuse the stream. Deduplicate initial/subscription/visibility reads; keep a skipped-delta obligation until successful reconciliation. Server changes update clean fields; dirty fields retain editing ownership. | Keep the cheap subscription/gap tracking where required by the existing shared connection, suppress hidden view work, reconcile once when shown and behind. |
| Settings: permission policy and cells | `use-permissions.ts:30-53` performs paired level/cell reads on client replacement; mutations/conflicts refetch. There is no permission-push handler in this hook. | One coherent pair on first use/replacement; refresh on demand/entry and before newly requested advanced inspection when not covered by current evidence; mutation/conflict refresh remains exact. Do not infer permission from a retained view. | No automatic write/replay. An old view may be qualified and disabled; every replacement client requires fresh policy. |
| Settings: durable approvals | `approval-decisions-controller.ts`: list, revoke, conflict recovery; no durable-list subscription. | Entry/manual read and post-revoke reconciliation. Ephemeral approval-close events are not proof of a durable-list change or cross-socket coverage. | Retain only safe disposable presentation; no hidden repeated reads or replayed revocation. |
| Operations: memory status and storage usage | Separate cached reads plus `memory.tidy` / media-clear follow-up reads in `use-operations.ts`. | Snapshot on demand: initial entry, re-entry when no live coverage, explicit refresh, and the affected successful operation. Do not label these counters continuously live. | Suspend display refresh. A running tidy/clear still settles; show the outcome and reconcile on return. |
| Perception: activity, sampler status, pause | `use-perception.ts:49-68`: per-client/visibility reads and post-pause refresh; no producer notification. | Add an event-driven current-view subscription for actual accepted producer changes; reuse existing card/pause authority. First subscribe/read and reactivation are coherent and coalesced. | Retire observation/detail work and stop issuing reads while hidden. Sampling remains Core-owned and does not depend on the page being open. No persisted perception/pause cache. |
| Costume: list and import result | `use-costume-page.ts` uses guarded snapshot cache; import and explicit refresh reread; Pet result events own selection outcomes. | Entry/manual list reads and relevant import/result invalidation. Preserve the currently confirmed costume and one pending operation's own outcome/deadline. | No hidden list-fetch loop; never cancel/replay a Pet switch because the page is hidden. |
| MCP: list and runtime status | `mcp-controller.ts` reads per generation and after mutations; delayed drain/candidate transitions need producer coverage. | Show retained rows during refresh. Use producer invalidations only for facts that can change the visible projection; entry/manual/own-write triggers remain. Do not run `mcp.test` or reconnect as a freshness probe. | Unobserve expensive view work and mark behind; an MCP operation continues under its original authority. |
| MCP: selected tools and editor | Tools are already present in the selected server snapshot; the draft belongs to the page. | Expanding a still-valid loaded tool list is a local presentation action, not another read. Refresh changed server data without replacing a dirty editor. | Closing a disclosure performs no mutation or automatic probe. Explicit authority/target changes retire incompatible state. |
| Skills: package list | `skills-controller.ts:37-38`: initial bind, serialized operations, refresh with current-generation previous packages. | Entry/manual and visible producer invalidation; include meaningful rejected/import/reconcile changes, not just catalog-generation increments. Preserve current-generation list identity while reading. | Do not silently broaden cross-client snapshot reuse; fresh binding retains its current authority rules. Running import/reconcile is not cancelled on hide. |
| Skills: inspection | `skills-controller.ts:39`, `skill-card.tsx` retain one inspected result and local collapse state. | Explicit Inspect reads. Collapse/reopen reuses the current validated result; a changed package revision/identity invalidates it. Closed invalidated content waits for the next demand. | No background inspection fetch. Retire stale detail replies; do not reopen a collapsed result when a late request completes. |
| MCP / Skills: extension status strip | `extension-convergence.tsx`, `extension-convergence-controller.ts`: safe prior view with request token, keyed by page lifecycle data. | Share one active resource owner per Home generation where both pages need the identical projection; invalidate from relevant actual Host/catalog changes, not every tool lease. Reuse a concurrent initial read. | At most lightweight dirty tracking without repeated reads; restore when an extension page becomes visible. |
| Monitor: Run list, trajectory, Inspector | Controller-owned generation/visibility/cursor restore, summary single-flight/trailing refresh, measured ledger and detail epochs. | Preserve the accepted DSH implementation and use it as a contract example, not a generic-hook migration target. | Existing unsubscribe/backfill, selection and history behavior remains authoritative. |

For snapshot-only resources, re-entry is an explicit user-demand trigger. A resource already covered
by an intact subscription does not need a duplicate read merely because it rendered again. Focus
moving to another application is not itself a request to refetch every Home resource.

## State and presentation rules to preserve

- HomeShell keeps visited page instances under stable `entry.id` keys and `hidden`; do not replace
  that with forced remounts. The route visibility store is an existing signal, not proof of native
  minimize/hide behavior: verify document/native visibility when adding effective visibility gating.
- `useCachedFetch` already retains last-good data on failed revalidation. Complete its request
  lifecycle and page projections instead of introducing another disk cache or page-wide loading flag.
- Loaded empty data is an explicit successful result; unknown transport/data, a failed first read,
  and an already loaded empty result are different states.
- Cached/past content can remain only while its authority and privacy contract allows it. Old
  Privacy Pause data must never become a current "observation active" claim after reconnection.
- Preserve the accepted use of native details and the DSH custom state layout. Shared state semantics
  do not require all eight pages to import an identically named `ErrorState` component.

## Historical acceptance crosswalk

| Original pure-frontend AC | Reusable evidence / final boundary |
| --- | --- |
| Per-batch gates and final formal check | The G1-G5 delivery record retains scoped gates and independent reviews. This task needs gates for its new source, then a final review of the complete task scope. Do not repeat unchanged full suites during planning. |
| Approval keyboard/focus and tones | A1/A2 WebView2 report line 31 covers Tab/focus/Escape; current `approval-dialog.tsx` retains primary allow and danger-soft deny. Keep these as regression boundaries. |
| Long CJK Markdown performance | Still a separate follow-up: `chat-activity-coalescer.ts` is 40 ms; `timeline-message.tsx:16` memoizes unchanged text; the growing text segment still reaches `markdown-view.tsx` as a whole. No long-CJK profile is claimed. |
| All added disclosures can collapse | Current native details, Skills collapse state, and DSH Inspector/folds have G4/A1-A2/D68/Chat evidence. This task additionally proves continuity across the new delayed refresh paths. |
| G4 useful-information cleanup | Reuse its scoped source/DOM/accessibility/binding evidence. Notification revisions remain internal and do not return as product counters. |
| Eight-page loading/empty/error behavior | This task owns the identified corrections and a per-resource matrix. The later approved DSH Monitor design supersedes a literal requirement to use identical components everywhere. |
| Visual acceptance | G1-G5 has delegated engineering window acceptance; it is not personal owner inspection. This planning task has neither new code acceptance nor personal visual acceptance. |

Evidence entry points:

- [G1-G5 delivery](../../08-22-t4-agent-architecture-observability/research/uiux-delivery-2026-09-07.md).
- [Original frontend PRD](../../08-30-frontend-uiux-optimization/prd.md).
- [G4 native QA](../../08-30-frontend-uiux-optimization/research/g4-webview2-qa-2026-09-05.md).
- [A1/A2 native QA](../../09-05-uiux-readable-operations/research/a1-a2-webview2-qa-2026-09-06.md).
- [D68 delivery](../../08-28-dsh-observability-expansion/implementation-evidence-d68-b-2026-09-07.md).
- [Chat/Pet delivery](../../09-05-uiux-live-tool-feedback/implementation-evidence-2026-09-07.md).

## Spec drift to correct with implementation

`frontend/reactive-read-models.md` is a design baseline, but two historical descriptions exceed
the current implementation: a loader becoming null does not retire a cached read by itself, and the
permission hook has no dedicated push listener. Update the spec against the eventual implementation;
do not copy those sentences as runtime proof. Preserve the existing privacy and authority constraints.
