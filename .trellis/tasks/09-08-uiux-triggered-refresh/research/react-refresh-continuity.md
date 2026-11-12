# Research: React refresh and UI continuity

- Query: What is the smallest React 19 / Zustand 5 design for event- and demand-triggered refresh that retains visible content, DOM identity, drafts, selection, focus, disclosure state, and reading position?
- Scope: Mixed; official framework documentation and selected local seams. The parent task owns the complete page/producer audit.
- Date: 2026-09-08
- Status: Planning research for [the approved PRD](../prd.md), not implementation or interaction acceptance.

## Findings

### Recommended direction

Extend the existing read hooks and feature controllers. Retain permitted last-good data, keep content components mounted, and coordinate reads per resource with explicit visibility, invalidation, and retirement rules. Use existing Zustand only where a domain already owns shared state or concurrent consumers actually need one owner. Add no query framework or compiler dependency for this task.

React re-rendering calls component functions to compute the next output; it does **not** imply rebuilding the entire DOM. React commits the necessary DOM differences. Stable component types, sibling keys, and tree positions let existing nodes and local state survive. Changing a key/type, moving a component into a different parent subtree, or conditionally removing that subtree can destroy that continuity. Keeping data alone is insufficient if the page still replaces its content with a skeleton. [R1][R2]

React does not choose a resource's network freshness, privacy, or producer policy. `memo`, `useTransition`, and animation cannot correct incorrect request ownership, stale writes, or destructive render branches.

### Installed baseline and files found

| Evidence | Finding |
|---|---|
| [apps/desktop/package.json:19](../../../../apps/desktop/package.json#L19), [pnpm-lock.yaml:66](../../../../pnpm-lock.yaml#L66) | React and React DOM are declared `^19.2.0`; lockfile and installed package metadata both resolve to **19.2.7**. |
| [apps/desktop/package.json:24](../../../../apps/desktop/package.json#L24), [pnpm-lock.yaml:81](../../../../pnpm-lock.yaml#L81) | Zustand is declared and installed as **5.0.14**. |
| [vite.config.ts:51](../../../../apps/desktop/vite.config.ts#L51), [pnpm-lock.yaml:97](../../../../pnpm-lock.yaml#L97), [pnpm-lock.yaml:742](../../../../pnpm-lock.yaml#L742) | Installed `@vitejs/plugin-react` is **6.0.3**. Vite uses `react()` without compiler integration. The compiler entry in the lockfile is optional peer metadata, not an installed compiler. Installed plugin source exports a separate `reactCompilerPreset`; this config does not use it. |
| [apps/desktop/package.json:13](../../../../apps/desktop/package.json#L13) | No React Query, query-core, or SWR dependency/import was found; their desktop package paths are absent. `@tanstack/react-virtual` **3.14.9** is an installed virtualizer, not a query cache. “SWR” in the local spec names a stale-while-revalidate pattern. |
| [use-cached-fetch.ts:33](../../../../apps/desktop/src/lib/use-cached-fetch.ts#L33), [cached-fetch-state.ts:26](../../../../apps/desktop/src/lib/cached-fetch-state.ts#L26) | Existing guarded cache seam seeds data, retains it on start/failure, and distinguishes refreshing. Request generations and presentation flags need the refinements below. |
| [home-shell.tsx:88](../../../../apps/desktop/src/windows/home/home-shell.tsx#L88), [page-visibility-store.ts:26](../../../../apps/desktop/src/windows/home/page-visibility-store.ts#L26) | Visited pages retain a stable `entry.id` wrapper and use `hidden`; a narrow selector exposes the shell's actually shown page. Hiding does not itself stop effects. |
| [use-mcp.ts:38](../../../../apps/desktop/src/windows/home/pages/mcp/use-mcp.ts#L38), [mcp-state.ts:16](../../../../apps/desktop/src/windows/home/pages/mcp/mcp-state.ts#L16), [mcp-page.tsx:94](../../../../apps/desktop/src/windows/home/pages/mcp/mcp-page.tsx#L94) | MCP already has controller ownership and `loading.previous`; the page discards that previous value in its rendering projection. This is a concrete continuity defect rather than a missing React feature. |
| [skill-card.tsx:50](../../../../apps/desktop/src/windows/home/pages/skills/skill-card.tsx#L50), [skill-card.tsx:67](../../../../apps/desktop/src/windows/home/pages/skills/skill-card.tsx#L67) | Inspection disclosure owns local `collapsed` state. Retaining its component preserves that state across result replacement; clearing `inspected` would unmount it. Its existing collapse action deliberately removes the inner content. |
| [timeline-message.tsx:14](../../../../apps/desktop/src/windows/home/pages/chat/timeline-message.tsx#L14) | Module-level lazy Markdown and a `memo` text leaf demonstrate selective work avoidance. Preserve this reference boundary; this task does not redesign the accepted Chat transcript. |

### Pattern 1: Preserve identity through the entire render path

- Render last-good content through the same component type and parent position during refresh and recoverable failure. Keep cold-load placeholders local to resources without a snapshot. Use a small truthful refresh/error marker without replacing the list, editor, or detail pane.
- Key changing lists by stable entity/record identity. Do not key ordinary refreshes by request number, timestamp, response revision, or connection generation. A new JavaScript array can still reconcile stable keyed children; stable references additionally reduce rendering work, but are a separate concern.
- Keep local drafts and editing revision separate from refreshed server data. Do not copy each incoming snapshot into a dirty form or reset it through a changing key. Surface a concurrent server change through the existing conflict/save contract. A mutation's pending state remains distinct from a background read's busy state.
- Preserve a selected entity ID and disclosure state while that entity remains valid. A real deletion, scope change, or loss of authority may require removing the affected content and disabling its actions. Do not keep an unauthorized record merely to preserve selection.
- Reserve marker/control space where it would otherwise shift reading targets. Correct identity cannot by itself prevent text wrapping, container resizing, or list insertions from moving geometry; use bounded local anchor reconciliation only where measurements demonstrate the need.

The MCP example makes this distinction concrete: [mcp-page.tsx:96](../../../../apps/desktop/src/windows/home/pages/mcp/mcp-page.tsx#L96) turns `loading.previous` into `null`; lines 109-122 then remove `McpMasterDetail` and move a surviving editor into a different subtree. The draft held at [mcp-page.tsx:29](../../../../apps/desktop/src/windows/home/pages/mcp/mcp-page.tsx#L29) can survive while the editor's DOM focus/selection does not. The existing [previousMcpData helper](../../../../apps/desktop/src/windows/home/pages/mcp/mcp-state.ts#L86) demonstrates the correct all-state data projection; the fix must also retain a stable editor location when an actual list becomes empty. Wrapping this page in `memo` would not repair those branches.

### Pattern 2: Retain allowed snapshots with resource-local status

Keep snapshot presence, active request, failure, invalidation, and transport availability conceptually separate. Adapt each feature's existing discriminated union/reducer; do not force permission/MCP controllers into the persisted cache hook.

| Actual resource condition | Presentation |
|---|---|
| No snapshot; authorized read running | Initial loading for this resource. |
| Successful snapshot with zero rows | Successful empty state, with its appropriate next action. |
| Snapshot retained; read running | Existing content plus a real refreshing indication. |
| No snapshot; read rejected | Initial failure and working retry; no fabricated empty success. |
| Snapshot retained; read rejected/invalidated | Existing permitted content, stale/error feedback, and retry. |
| Transport unavailable | Connection/unavailable state; retained content only where allowed; unavailable writes disabled. Absence of data alone is not a running request. |

At [cached-fetch-state.ts:40](../../../../apps/desktop/src/lib/cached-fetch-state.ts#L40), `isLoading` currently means `data === null && error === null`, irrespective of `running`. At [use-cached-fetch.ts:42](../../../../apps/desktop/src/lib/use-cached-fetch.ts#L42), a null loader is a no-op. Their combination must not be interpreted as proof of an active load. Transport and request retirement need explicit treatment, including settling an obsolete busy marker.

**Retention is conditional on authority.** Distinguish ordinary staleness from a privacy clear, confirmed revocation, deleted resource, or changed authority scope. Such invalidations immediately remove the affected sensitive projection and retire its outstanding callbacks; they cannot wait for a transition, debounce, retry, or exit animation. Ordinary reconnect retention must follow that resource's existing contract. Permission snapshots still require fresh Core authority per client; cached display values never authorize actions. Preserve the exact persistence allow-list and secret scrubbing in [state-management.md:75](../../../spec/frontend/state-management.md#L75): no new persisted category; Perception remains memory-only and pause/chat content acquire no cache key.

### Pattern 3: Push/invalidation plus demand, owned per resource

Use a small feature-local coordinator, with a shared pure helper only where the same rules repeat. Its identity includes the authenticated client and relevant authority/entity/query scope; request/detail epochs are bookkeeping and must not become UI remount keys.

1. Register the existing typed producer listener before the initial read when both are needed, so an intervening change cannot disappear into a subscription gap. Apply an authoritative complete push directly; use an invalidation-only event to request the affected read. Do not invent a producer or inspect raw WS frames from components.
2. First usable entry/open performs one read if no valid snapshot or equivalent in-flight/subscribed read covers it. A later open follows the resource's explicit policy: reuse a valid result, or perform a fresh inspection when that action promises one. Collapsing already-fetched files need not refetch a skill merely because they are shown again.
3. Permit one in-flight read per resource/client scope. Duplicate demand joins it. A genuine producer change, successful write, or missed-hidden-update gap advances an invalidation marker; any number of such changes during one flight leaves one pending trailing read. Start that read after settlement only if still needed and visible/open. Stop when the triggering events stop; no timer re-arms the fetch.
4. Capture client, authority scope, request epoch, and detail-open epoch at start. Check them before accepting success **or failure**. Retire them on client replacement/null, disposal, relevant hide/close, and hard invalidation. Abort only if the transport supports cancellation; correctness must still come from rejecting obsolete completions.
5. Do not let an older read replace a newer accepted push/write. Where available, compare a producer revision/cursor as well as request identity. Without comparable revisions, an invalidation arriving during a read remains pending; do not label that response current or erase newer data. Preserve last-good/newer data and reconcile through the trailing read.
6. Hidden/closed expensive consumers stop reads/subscriptions according to their page policy. A cheap permitted invalidation listener can record a gap without publishing hidden renders; correctness/privacy listeners may remain live. Reactivation consumes the gap once. Keep accepted Chat background settlement and Monitor recovery rules intact.

At [use-cached-fetch.ts:41](../../../../apps/desktop/src/lib/use-cached-fetch.ts#L41), each `refresh()` currently starts a request, increments a counter, and ignores only completions superseded by another started load. The effect at line 54 has no retirement cleanup. Switching `load` to null, hiding, or unmounting does not itself invalidate the old request. Also, `mutate()` at line 64 does not retire an earlier snapshot read. These are reasons to add explicit lifetime/coalescing contracts; “has a generation ref” does not prove all races safe.

This coordination does not replay mutations. A successful write applies its validated echo or invalidates the affected projection once; request timeout/reconnect never retries the write automatically. Keep feature-specific conflict and approval identity unchanged.

### Pattern 4: Stable snapshots first; scheduling only when measured

Installed Zustand 5.0.14's `apps/desktop/node_modules/zustand/react.js:8` uses React `useSyncExternalStore`. React requires repeated `getSnapshot` calls for unchanged state to return the same immutable value; changes are compared with `Object.is`. Do not allocate a fresh array/object from a snapshot getter on every call. [R3]

- Reconcile validated results by stable row identity and real relevant values/revisions. Reuse unchanged row and `data` references; replace only changed objects. A false equality comparator can hide changes, so do not infer equality from a revision that does not cover the displayed fields.
- Keep fetch/error metadata truthful even when data is equal. An unchanged-data refresh can legitimately render its start/finish marker; acceptance is not “zero React renders.” Narrow selectors let unrelated data consumers avoid that work.
- Prefer existing simple selectors. For a small computed tuple/object that truly needs one selector, installed `zustand/react/shallow.js:6` provides `useShallow` and returns the previous result when shallow-equal. It does not stabilize arbitrarily recreated nested structures or replace correct snapshot ownership.
- Use `memo` on expensive leaves only after evidence of repeated avoidable work, with stable relevant props. Its default comparison is `Object.is`; local state and consumed context can still re-render it. Existing Chat text memoization is a reference, not a reason to memoize every page. [R4]
- `useTransition` can schedule a measured expensive **React-owned** derived view without blocking urgent input. Its callback executes immediately; it is not an arbitrary loading delay, network deduplicator, response-order guard, or debounce. Updates after an awaited request need a further `startTransition` in the documented API; input control updates remain urgent. Track real request state independently. [R5]
- Do not expect `startTransition(() => zustand.setState(...))` to make external-store updates nonblocking. React explicitly says those mutations cannot be marked as nonblocking Transitions and may restart a transition as blocking to maintain a consistent store snapshot. Suspending based on an external-store snapshot can also expose a fallback over visible content. Avoid a new whole-page Suspense refresh boundary. [R3]

### Feasible approaches and tradeoffs

| Approach | Benefit | Cost / decision |
|---|---|---|
| **A. Extend existing hooks/controllers** | Retains typed WS, existing privacy/cache boundaries, UI state, and current tests; no dependency or ownership migration. | Must explicitly test coalescing, retirement, status projection, and same-data reconciliation. **Recommended for this task.** Keep feature behavior local; share only established repeated invariants. |
| **B. One domain-local resource owner using existing Zustand** | Useful when multiple concurrent consumers need the same snapshot and deduplicated work; narrow subscriptions can isolate updates. | Requires lifecycle ownership and stable snapshots; a second store mirroring an existing controller would add drift. Use selectively when the page audit proves shared consumers, not as a universal Home store. |
| **C. Adopt TanStack Query v5** | Provides query caching, invalidation, background-fetch state, and structural sharing. | A new dependency and migration still need custom WS authority/client keys, visibility/detail gates, retirement handling, dirty-form separation, and privacy eviction. Its default staleness/refetch/retry policies require explicit adaptation to authenticated WS availability. Keep persistence disabled and writes outside automatic replay. **Not justified by the current seams.** [R6] |

TanStack Query's defaults are useful capabilities, not this product's freshness policy. Its official current documentation describes cached queries as stale by default, automatic refetch triggers, query retries, and JSON-compatible structural sharing. A later adoption would need deliberate settings; for example, invalidation-driven freshness must not use a setting that also blocks manual invalidation. No such adoption or dependency installation is proposed here.

### Proposed acceptance measurements and verification boundaries

These are proposed checks, not results. Record observed counts and timings against representative fixtures before setting performance thresholds; no frame rate, millisecond saving, or percentage improvement is claimed.

| Scenario | Evidence to capture |
|---|---|
| Cold load, successful empty, retained refresh, cold failure, stale failure, no transport | Reducer/controller and meaningful component tests show the correct state and a working retry. A loading flag must correspond to its documented condition. |
| Duplicate demand and a finite invalidation burst during one flight | Deferred-promise tests count one active request and at most one pending trailing read; duplicate demand without new invalidation adds no trailing request. No continuing reads after the system becomes idle. |
| Replacement/null client, close/reopen, hide/show, privacy invalidation, push/write racing a read | Deliver old successes and failures after retirement; neither may update the current projection, clear a newer error, re-open a detail, or revive revoked data. Verify no mutation replay. |
| Equal or partly changed snapshots | Compare data/row references, DOM node references, and mount/unmount observations. Unchanged rows retain identity; changed fields update. Busy/error metadata can still commit. Include subscription cleanup/remount coverage so development Strict Mode does not create duplicate live ownership. |
| MCP background refresh while editing; Skills inspection refresh while collapsed | Same editor/detail component location, unchanged draft and editing revision, selected ID and disclosure state. A real conflict/removal is visible and follows the existing authority rules. |
| Native focus, input selection, and selected readable text | Actual WebView2 test records `document.activeElement`, input selection endpoints, and DOM Range endpoints before/during/after unrelated refreshes. Include Chinese IME entry. Operator-directed focus changes are distinguished from background disruption. |
| Reading anchor with adjacent insertion/removal, refresh error, resize, hide/show | Record stable anchor identity, viewport-relative bounds, and scroll offset across intermediate frames and settlement; calibrate pixel-rounding tolerance in the fixture. Verify no automatic tail jump while the user reads/selects older content. |
| Native motion / accepted Chat-Pet and Monitor boundaries | Targeted actual WebView2 observations, including reduced motion, prove geometry and selection behavior beyond jsdom/static markup. Existing accepted scroll/restore contracts remain regression boundaries. Personal owner acceptance is recorded separately. |

Stable keyed DOM does not guarantee a native selection can remain identical when the selected text itself changes, its record is deleted, or its authority is revoked. Define such cases explicitly; test unchanged readable regions for exact preservation and affected regions for deliberate, nonmisleading behavior.

### External references and related specs

Official documentation was accessed on 2026-09-08. React's site is rolling documentation, not a patch-specific 19.2.7 specification; the cited APIs apply to the installed React 19 stack. TanStack Query is an evaluated **v5 alternative**, not an installed package.

- **[R1]** React, [Render and Commit](https://react.dev/learn/render-and-commit): trigger/render/commit and minimal DOM changes.
- **[R2]** React, [Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state): identity, keys, types, tree position, and removal. Also checked the [official source](https://raw.githubusercontent.com/reactjs/react.dev/main/src/content/learn/preserving-and-resetting-state.md).
- **[R3]** React, [useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore): immutable cached snapshots, comparison, subscriptions, and transition limitations.
- **[R4]** React, [memo](https://react.dev/reference/react/memo): comparison semantics and optimization limits.
- **[R5]** React, [useTransition](https://react.dev/reference/react/useTransition): immediate callback execution, urgent inputs, async boundaries, and ordering limitations.
- **[R6]** TanStack Query, [Important Defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults), verified through its [official repository source](https://raw.githubusercontent.com/TanStack/query/main/docs/framework/react/guides/important-defaults.md).

| Local contract | Relevance |
|---|---|
| [state-management.md:9](../../../spec/frontend/state-management.md#L9), [state-management.md:73](../../../spec/frontend/state-management.md#L73) | Core authority, local draft ownership, narrow Zustand selectors, guarded retention and persistence. |
| [reactive-read-models.md:8](../../../spec/frontend/reactive-read-models.md#L8), [reactive-read-models.md:46](../../../spec/frontend/reactive-read-models.md#L46), [reactive-read-models.md:82](../../../spec/frontend/reactive-read-models.md#L82) | Typed push routing, client generations, no polling, visibility gaps, resource recovery, and user-owned reading. |
| [hook-guidelines.md:3](../../../spec/frontend/hook-guidelines.md#L3), [quality-guidelines.md:13](../../../spec/frontend/quality-guidelines.md#L13) | Colocated hooks/controllers, subscription cleanup, exposed errors, selector discipline, and evidence-led optimization. |
| [Motion continuity research:110](../../08-22-t4-agent-architecture-observability/research/uiux-motion-continuity-2026-09-05.md#L110), [verification boundary:143](../../08-22-t4-agent-architecture-observability/research/uiux-motion-continuity-2026-09-05.md#L143) | Refresh retains content, controls and anchors; geometry requires actual WebView evidence. These are existing design requirements, not proof of newly tested behavior. |

## Caveats / Not Found

- Context7 was absent from this researcher's tool metadata. Used read-only requests to official React pages; TanStack's client-rendered page yielded no extracted prose, so its official source supplied the text. Zustand's attempted guide URL/source path returned 404; Zustand claims above use the installed 5.0.14 implementation and React's official external-store contract instead.
- A matching request counter alone does not prove freshness after an intervening push, authority change, or detail closure. The parent page/producer audit must specify the available source revision/invalidation identity and the exact per-resource visibility/retention policy before implementation.
- The read-model spec's shorthand reference to `useCachedFetch` generations is broader than that hook's actual null-loader/unmount behavior. Treat the concrete code finding above as an implementation gap to address and later synchronize with specs.
- Research completed without running the app, tests, profiler, browser automation, or native windows. Network/request-count, DOM, geometry, IME, and personal owner acceptance remain unverified. Only this assigned research file was written; no production/spec/configuration/dependency/task-metadata or Git changes were made by this researcher.

## Design review

- Query: Review [design.md](../design.md) and [the Home inventory](home-refresh-inventory.md) for implementable coordination, identity, draft, and visibility rules.
- Scope: Internal; selected config input/save sources only. No new external research or tests.
- Date: 2026-09-08

### Actionable gap: define the config conflict and save lifecycle

The design's draft rule needs a concrete commit contract. [KnobInput:84](../../../../apps/desktop/src/windows/home/pages/settings/knob-input.tsx#L84) currently commits every text/number blur; [KnobField:46](../../../../apps/desktop/src/windows/home/pages/settings/knob-field.tsx#L46) replaces the draft from every changed display value. Merely preserving the draft and adding a warning would still let blur overwrite a known newer server value.

Recommended minimal behavior:

1. Track the latest observed non-secret server value separately from the editing baseline, draft, edit identity, focus, and composition state. A clean unfocused field follows the server. Focus alone is not an edit: if the server changes while a clean field is focused, preserve its immediate input/selection, then adopt the latest value on blur without sending `config.set`.
2. A same-field update during dirty editing preserves the draft and shows the latest non-secret value with an inline conflict indication. Suppress ordinary blur submission while conflicted, including blur caused by clicking the resolution controls. Offer **Use latest value** (`使用最新值`, local discard, no write) and **Confirm overwrite** (`确认覆盖保存`, deliberate submission of the retained draft). A newer observed change invalidates an earlier review/confirmation token; re-check the latest local field state before sending.
3. Composition is not submission. Do not send the pre-composition value on blur. If blur precedes `compositionend`, retain its intent and use the finalized input only while that intent, editing identity, authority and conflict checks remain valid; otherwise keep the finalized draft unsaved. Revalidate connection, field lock and editability at the commit boundary, not merely through the input's rendered `disabled` attribute.
4. Give each field save an explicit local result and attempt identity. [use-config.ts:82](../../../../apps/desktop/src/windows/home/pages/settings/use-config.ts#L82) currently catches failures and resolves `Promise<void>`; a resolved promise or `finally` therefore cannot mean successful save. Clear dirty/conflict state only after a confirmed current save whose submitted draft identity is still current. A refusal, timeout, retired scope, or further typing while the save runs preserves the draft. Prevent a second simultaneous field submission; a later edit does not become an automatically replayed write. This needs a hook/field outcome contract, not a wire-schema change.

[ConfigSetParamsSchema:59](../../../../packages/shared/src/config-schema.ts#L59) contains only `key` and `value`; there is no expected revision. The explicit overwrite action makes a **known** conflict deliberate but cannot prevent an unseen concurrent writer between observation and `config.set`. A preflight read or frontend token must not be described as server-side compare-and-swap. Secret knobs remain read-only on this surface.

### Coordination review outcome

No blocking contradiction remains in the reviewed design for separating hidden-read retirement from mutation ownership, allowing equal-data metadata commits, protecting newer pushes/writes, distinguishing retired StrictMode requests from current owners, or treating window blur separately from hidden/minimized state.

Carry two precise assertions into the executable plan: a successful bare response may cover only the invalidation state captured by its still-current read, never blindly clear a later dirty counter; a failed attempt must not reschedule itself merely because that counter remains dirty. A later independent invalidation/demand can authorize another bounded attempt. Subscription health alone also does not make a snapshot current: observed-but-unapplied hidden invalidations still require one reconciliation on return. These make sections 2-3 testable without changing their intended policy.

This review adds planning guidance only. Save ordering, native blur/composition ordering, and conflict controls remain unverified until implementation and targeted WebView2 checks.
