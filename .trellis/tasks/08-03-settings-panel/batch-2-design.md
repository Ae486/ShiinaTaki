# Batch 2 design — home window + chat migration + ws-client split (frontend)

Contract for implement/check. Parent: prd.md (owner-ratified topology + batch plan) +
research/rs-panel-scoping.md §4/§5/§6. Everything in `apps/desktop/src` (+ tauri.conf/capabilities);
packages/core, packages/shared, apps/cli, e2e are FROZEN this batch.

## Product recap (owner rulings this batch implements)

One home window, single instance: left menu / right page content. Chat is a PAGE of home; the
standalone chat window RETIRES with zero behavior regression (streaming timeline, attachments,
VLM describe, cancel-retract, toasts). Bubble-bar's enter-chat button navigates to home@chat.
Wheel arrives in batch 3 — this batch only ships the opener it will call.

## Components

1. **Home entry**: `home.html` + Vite input (match how chat.html/pet are registered) +
   `src/windows/home/main.tsx` (bootstrap mirror of the retiring chat main).
2. **Capability**: `src-tauri/capabilities/home.json` — chat.json is the template (core:event:default;
   home also builds its own WS like every window). Grant ONLY what home uses (batch-4 pages add
   their own perms when they land — do not pre-grant).
3. **Home shell** (`src/windows/home/`):
   - `pages.ts` — the PAGE REGISTRY (owner's maintainability constraint): ordered rows
     `{id, label, component}` (icon slot added in batch 5). Adding a page = one row.
   - `home-store.ts` — zustand, one store per domain (existing style): `currentPage` as a
     discriminated union of registered ids + `navigate(id)`.
   - `home-shell.tsx` — left menu rendered FROM the registry, right side renders the current
     page's component. Minimal styling this batch (BANDORI-referenced polish is batch 5);
     structure must already be the two-pane shape.
4. **Navigation from outside** (the seam batch 3's wheel + the bubble button share):
   `src/lib/open-home-window.ts` — `openHome(pageId)`: window absent → create with
   `home.html?page=<id>`; present → emit a namespaced Tauri event (`home:navigate`, payload zod-ish
   validated at the listener) + `setFocus`. Home listens and drives `navigate()`. Single instance
   ALWAYS (label constant; creating twice must be impossible by construction — reuse-by-label).
5. **Chat migration**: move `chat-window.tsx`'s BODY into `windows/home/pages/chat-page.tsx`
   (component + its hooks/stores move under home or stay in a shared lib dir per existing layout
   conventions — smallest honest move, no rewrite); colocated tests MOVE with their files and stay
   green unmodified where possible (a moved import path is not a behavior change; assertion edits
   ARE and need a why). Retire: `windows/chat/main.tsx`, `chat.html`, its Vite input,
   `capabilities/chat.json`, `lib/open-chat-window.ts`. Retarget the single call site
   (`chat-bubble.tsx:44`) to `openHome("chat")`.
6. **ws-client split + D29** (`src/lib/ws-client.ts`, 258/300 — forced):
   - Split along existing seams (e.g. frame parse + subscription routing vs request methods) into
     ≤2 new modules, each headered; no behavior change beyond D29.
   - **D29 fix (comes due, deferred-decisions row)**: a mid-turn socket close must SETTLE the
     in-flight `chat()` — route the close into the pending turn's error path (structured code, e.g.
     the existing error-frame shape with a `CONNECTION_LOST`-style reason) so callers' awaits
     resolve; pin with a transport-faithful test (close mid-turn → chat() rejects/errors, never
     hangs). Update docs/deferred-decisions.md D29 row to DONE (cite this task) — the ONE docs file
     this batch may touch.
   - Add `config.list`/`config.set` request methods + `config.changed` subscription handler
     (one line each per research §6; zod-validate inbound via @taki/shared schemas). No UI yet.

## TDD rows

1 page registry: rows render as menu, unknown id impossible at type level, navigate switches the
pane; 2 openHome: absent→create-with-query, present→event+focus (mock tauri api at the seam, the
packaged-build spec's transport-faithful discipline), double-open impossible; 3 home main.tsx boots
from `?page=` param; 4 chat page: the MOVED tests all green (list any assertion that had to change,
with why); 5 bubble button: navigates home@chat (old opener gone — grep proves zero references);
6 D29: mid-turn close settles chat() with the structured error, post-close send fails cleanly, and
the pre-existing "rejects pending JSON-RPC requests" behavior is unchanged; 7 config methods:
round-trip against a mock server frame, changed-push dispatches to a registered handler;
8 ws-client split: both new modules under caps, public surface via index-of-module unchanged for
existing callers (imports updated, no barrel files).

## Gates

pnpm -r typecheck / -w lint / -r test — desktop count may MOVE (files relocated) but must not drop
net coverage: report old→new test-file mapping + final count vs 143 with the delta explained.
core 1160 / shared 207 / cli 32 byte-stable. `pnpm --filter @taki/desktop build` (vite) must succeed
WITH the new home input and WITHOUT chat.html. NO tauri dev/packaged run — the leader does the
visual pass. Do NOT commit.
