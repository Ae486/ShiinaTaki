# Batch 5 design — visual pass + icons + spec update (final batch)

Contract for implement/check. Parent: prd.md (style-reference section: BANDORI = design/layout
reference, GPLv3 clean-room — read to learn layout/organization, NEVER transcribe code, class
names, or asset files) + check-b3 concern 3 (wheel sizing with icons) + concern 1 (wheel-on-wheel
right-click jitter). Scope: `apps/desktop/src` + `.trellis/spec/frontend/` (the update-spec step).
FROZEN: packages/*, apps/cli, e2e, all page/store/ws LOGIC (this batch changes PRESENTATION and
one wheel event line; pure modules and their tests must not change behavior).

## Components

1. **Icon set** — `src/lib/icons/` self-made inline-SVG glyph components (zero deps, we own the
   copyright): `chat / settings / costume / home / operations / perception` + `index.md`. Simple
   geometric 24×24 stroke glyphs (speech bubble, gear, hanger/shirt, house, wrench/sliders, eye).
   Owner will replace with hand-drawn art later — components take `className` so the swap is
   per-file content only.
2. **Wheel visual** — icon buttons (icon above a small label) on the ring; revisit
   `WHEEL_SIZE_PX`/radius so 4 items with icons sit with comfortable margins (adjust the constant
   + placement tests accordingly); subtle appear transition (CSS only, no timers); suppress
   re-summon when right-clicking ON the wheel itself (stopPropagation in the wheel's own
   onContextMenu — check-b3 concern 1, one line + test tweak).
3. **Home shell visual** — left menu: fixed ~220px, app title header, icon+label rows from the
   registry, active row highlighted (rounded bg + accent border), hover states; right pane:
   consistent page header (page label) + content area with max-width and consistent padding.
   BANDORI's organization (grouped left nav, card-based right content) is the reference shape.
4. **Page polish** — apply the shared `page-card.tsx` look consistently: card titles, definition
   rows, button styles (primary/danger for media.clear confirm), badge styles (重启生效 amber,
   env 锁定 slate, 已设置/未设置), form controls (uniform input/select/toggle styling via
   Tailwind). No logic edits: presentation classes + small markup only; pure-module tests stay
   byte-green; component tests may update markup assertions (list each with why).
5. **Spec update (the trellis-update-spec step)** — rewrite `.trellis/spec/frontend/chat-window.md`
   to describe the CURRENT reality (home window shell + pages + the chat PAGE; window topology
   pet/home/main-legacy; the openHome seam; capability-per-window). Rename to `home-window.md` if
   the spec index references allow (update the spec index.md accordingly); otherwise update in
   place with a corrected title.

## TDD / verification rows

1 icons: each glyph renders an svg with viewBox + className passthrough (static-markup tests);
2 wheel: placement tests updated to the new constant, all four corners still clamp; wheel-on-wheel
contextmenu does NOT re-summon (new assertion) while stage contextmenu still does; 3 shell: menu
renders icon+label per registry row, active row carries the highlight class + aria-current
(existing test extended); 4 pages: existing pure-module tests byte-green (behavior frozen); any
markup-assertion updates listed with why; 5 spec: the updated spec file accurately names the new
paths (self-review against the tree — check verifies).

## Gates

pnpm -r typecheck / -w lint / -r test (desktop 217±markup-test deltas; core 1167 / shared 210 /
cli 32 byte-stable) + `pnpm --filter @taki/desktop build`. No tauri dev (owner's visual pass
follows). Do NOT commit.
