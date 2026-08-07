# Batch 6 design — costume boundary restoration + SWR loading (defect batch)

Contract for implement/check. Parent: `research/rs-costume-defect.md` (sections A/B/C/D/E — read it
first, it holds the file:line chain) + the owner's real-machine report (2026-08-04). Scope:
`apps/desktop/src` ONLY. FROZEN: packages/*, apps/cli, e2e, and every non-costume page's LOGIC
(they get the SWR hook wired, nothing else).

## The defect (owner-reported, research-confirmed)

One failed costume switch wedges ALL later switches with no error, no cancel, no recovery short of
reloading the pet window. Three mechanisms stack:
1. `windows/pet/use-costume-switch-event.ts:15` destructures ONLY `switchTo` — `switchingId`,
   `error`, `cancelSwitch`, `refresh` are computed and thrown away, so nothing is renderable and
   the guard-release handle is unreachable.
2. The single-flight guard (`use-costume-switch.ts:100`, released only in the `finally` at :84-89)
   sits behind FOUR awaits of which only the renderer load is timeout-bounded
   (`resolve-switch-report.ts:26/27/36/45`); `rpc.request` has no per-request deadline, so a
   half-open socket wedges it forever.
3. A rejected `character.costumes` wipes `state.files` to `{}` (:107-109) and only a fresh
   `connected` transition restores it — and neither window reconnects.
Regressions against recorded acceptance: manual checks **#74** (highlight must stay on the
pre-switch costume after a timeout — broken by the home page's optimistic `setSelected`) and
**#75** (per-row spinner, other rows clickable, Cancel, recovery without reopening — lost whole).

## Part 1 — bidirectional costume protocol (the fix)

- **New event pet→home**: `pet:costume-result` carrying `{costumeId, phase: "started" | "succeeded"
  | "failed" | "cancelled", reason?}` (zod-shaped in `lib/costume-switch-event.ts` beside the
  existing command; malformed payload dropped with a breadcrumb — the established listener rule).
- **New event home→pet**: `pet:costume-cancel` `{costumeId}` → pet calls the EXISTING
  `cancelSwitch` (do not reimplement cancellation; the hook already owns it).
- **Pet side** (`use-costume-switch-event.ts`): consume the FULL hook — emit `started` on accept,
  `succeeded`/`failed(reason)` when the hook's state settles, `cancelled` when cancel wins; a
  command arriving while a switch is in flight must emit `failed(reason:"busy")` rather than a
  silent return (research: today it silently returns).
- **Home side** (`use-costume-page.ts` + `costume-page.tsx`): selection follows the RESULT, never
  the click (fixes #74 — the highlight stays put until `succeeded`); the clicked row shows a
  pending indicator with a **Cancel** button (fixes #75); `failed` renders the reason inline and
  clears pending so the next click works (fixes the wedge from the UI side).
- **Home-side deadline** (belt AND braces — the wedge must be impossible even if the pet never
  answers): a timeout in the home page clears pending and shows "no response — try again". Value
  in one named constant; MUST be longer than the renderer-load timeout the pet already applies
  (research says 30s) so a normal slow switch never trips it first.
- **Failure-does-not-empty**: the home page keeps the last good costume list when a refresh
  rejects (renders the stale list + an error line + a manual **Refresh** button) instead of
  rendering an empty page. The pet-side `EMPTY` wipe (:107-109) is pet-internal — leave that code
  alone this batch; the home page must simply not depend on it.
- **Self-diagnosing**: a `console.warn` on the busy-rejection and on any dropped/ignored command
  (research: today all three mechanisms are traceless).

## Part 2 — same-class sweep result

Research verdict: costume is the ONLY surface with dropped edges (import, chat move, tidy, media
clear, perception pause, config load/set all intact). Nothing else to repair. The cross-cutting
"no reconnection anywhere" gap PRE-DATES this task → the leader registers it as a deferred row
(D59); this batch only softens it where the fix already lands (manual Refresh on the costume page).

## Part 3 — stale-while-revalidate loading

- One shared hook `lib/use-cached-fetch.ts`: `useCachedFetch(key, load, {schema, persist})` —
  render the last-good value instantly, refresh in the background, expose `{data, loading, error,
  refresh}`. Persisted entries go through the SAME zod schema on read, so a drifted/corrupt cache
  entry is DROPPED, never trusted.
- Wire: costume list (persist), config.list (persist — see privacy line), memory.status +
  media.usage (persist, counts only), perception card (**MEMORY ONLY, never localStorage** —
  it carries foreground-window titles, which is exactly what Privacy Pause and retention bound),
  perception pause state (**always fresh, no cache** — a stale "not paused" is worse than a
  placeholder).
- Privacy guard in code, not just in comments: the persist path refuses keys not on an explicit
  allow-list, and a test pins that `perception.card`/pause are not persistable.
- Config caveat from research: config.list values are safe today because secrets are masked
  server-side (`value: null`), but the persist path must additionally strip any entry with
  `secret: true` — cheap insurance for invariant 5, pinned by a test.
- Staleness must be visible: a small "刷新中…" marker while a background refresh runs over cached
  data (research + owner intent: never let the operator act on a silently-stale number).

## TDD rows

1 protocol shapes: result/cancel payload parse + garbage rejection (both directions); 2 pet side:
started→succeeded emits in order; failure emits `failed` with reason; in-flight command emits
`failed(busy)` not silence; cancel command drives the existing cancelSwitch and emits `cancelled`;
3 home reducer (pure): click→pending (selection UNCHANGED), succeeded→selection moves + pending
clears, failed→error shown + pending clears + next click accepted, cancelled→clean reset, timeout→
same as failed with its own message; 4 list resilience: refresh rejection keeps the previous list
and surfaces the error + refresh action; 5 cached fetch: cache hit renders before load resolves,
schema-mismatch cache entry is dropped, error keeps stale data visible, refresh() re-runs;
6 persist allow-list: perception card/pause never persisted (test), secret-flagged config entries
stripped before write; 7 regression pins for the two manual checks: #74 (highlight stays put on
failure/timeout) and #75 (pending indicator + cancel reachable + other rows clickable).

## Gates

pnpm -r typecheck / -w lint / -r test (desktop 234+; core 1167 / shared 210 / cli 32 byte-stable) +
`pnpm --filter @taki/desktop build`. No tauri dev (owner's real-machine pass is the acceptance:
force a switch failure, confirm error shown + cancel works + subsequent switches succeed). Do NOT
commit.
