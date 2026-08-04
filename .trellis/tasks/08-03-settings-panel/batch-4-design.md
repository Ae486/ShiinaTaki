# Batch 4 design — pages: knobs / operations / perception / costume (+D46; D38 assessed after)

Contract for implement/check. Parent: prd.md §5 (owner: ALL pages in v1, organize later) +
research/rs-panel-scoping.md §3/§7/§8. Scope: `apps/desktop` + a SMALL named core/shared addition
(memory.status method). FROZEN: apps/cli, e2e, everything in packages/* not named below, the
batch-1 config plane internals, chat page tree, wheel internals (wheel-items.ts gains ONE row).

## Cross-cutting decisions (leader-ruled)

- **Costume switching seam = Tauri window event** (home page commands, pet window executes):
  `emitTo("pet", "pet:costume-switch", {costumeId})`; pet listens (validated payload, unknown
  drops with breadcrumb — the home:navigate listener is the template) and drives the EXISTING
  `useCostumeSwitch` path, so persistence/degrade/badge behavior is unchanged. Presentation-only
  command; state-of-record still flows through pet's existing WS persist. Both windows already
  hold `core:event:default` (emit-to + listen verified in batch 2).
- **D46 rides the operations page** (media.usage/media.clear WS methods ALREADY exist — cheap).
- **D38 (idle-pool editor) is NOT in this batch**: it needs its own core-side persistence design
  (inv. 2 single-writer + WS + pool injection). Assessed after batch 4 lands — schedule-permitting
  it becomes a small batch 4b, else its deferred-decisions row gets a panel-era trigger update.
  (Owner pre-approved elastic deferral "挤不下最后延".)
- Every new page = one `pages.ts` registry row + one directory under `windows/home/pages/`.
  Wheel gains ONLY the `settings` row (owner's four-icon wheel: 对话/设置/换装/主页 complete);
  operations/perception are reachable via the home menu.
- No DOM test env exists: test at store/pure-logic seams (batch 2/3 precedent).

## Components

1. **Core `memory.status` method (the one backend addition)**: operator-only, params
   `{characterId}`, returns COUNTS-ONLY status the operations page renders: window slots
   (per slot: factor, effectiveWindow, updatedAt) from window-state-repo + conversation summary
   (present?, throughSeq, textChars, updatedAt) from summary-repo + auto-memory watermarks
   (lastFlushSeq, tidy pending-writes count) from memory-auto-repo. Shared schema
   (`MEMORY_METHODS.status` + result zod), method file per memory-tidy.ts pattern, register in
   config… registry line in main.ts. NO memory CONTENT ever crosses (summary text length only).
   Rust untouched.
2. **Knobs page** `pages/settings/`: `use-config.ts` (list on mount, set, config.changed refresh —
   the batch-2 plumbing), `settings-page.tsx` + per-kind editor `knob-field.tsx` (boolean toggle /
   int-number input / enum select / string input, driven by `input.kind` metadata), badges:
   `restart to apply` (apply==="restart"), `env 锁定` (envLocked, editor disabled), secret rows
   render set/not-set only (no editor v1). Save per-row via config.set; the FIVE refusal reasons
   render as readable inline errors; success shows the apply verdict. Grouped by the registry
   order (server order preserved — no client re-sorting).
3. **Operations page** `pages/operations/`: tidy trigger button (memory.tidy {characterId="taki"
   from active-character source}) rendering `{status, defects}` counts; memory status card
   (memory.status); storage section (media.usage display + media.clear button WITH a confirm
   step — destructive). All request methods that are missing from ws-client-methods get added
   there (one line each, zod-validated inbound).
4. **Perception page** `pages/perception/`: pause toggle (perception pause get/set), perception/
   activity card display (perception.card), and a "retention/screenshot knobs live in settings"
   pointer row. ONLY what existing perception.* methods + the knob registry already expose —
   anything lacking a server surface is LISTED in the report, never invented client-side.
5. **Costume page** `pages/costume/`: migrate CharacterPanel's content (costume list via existing
   character-costumes/costume-resolution WS methods, availability badges, import entry via
   character-import) into the page; switching emits the pet event; pet-side listener hook.
   RETIRE the pet-window CharacterPanel + the batch-3 bridge: wheel costume row retargets to
   `openHome("costume")`; grep-prove CharacterPanel gone. Costume reachability holds every commit.
6. **Registry/wheel updates**: pages.ts rows [chat, settings, operations, perception, costume]
   (menu order; chat stays default); wheel-items adds `settings` → `openHome("settings")`.

## TDD rows

1 memory.status: result schema counts-only (a test asserts no `text`/content field), repo-backed
values round-trip, operator-role pinned; 2 use-config: list populates, set success updates row,
each refusal reason maps to its message, config.changed refreshes the one key; 3 knob-field: kind→
editor mapping pure fn tested for all four kinds + disabled-when-env-locked + secret masking;
4 operations: tidy invocation + defects render model, media.clear requires confirm (state-machine
test), status card maps the schema; 5 perception: pause round-trip + card mapping; 6 costume page:
list/resolution mapping, switch emits the validated payload, import path wired; 7 pet listener:
valid payload drives switchCostume, garbage dropped with breadcrumb, listener lifecycle clean;
8 registry: five rows, order pinned, wheel has exactly four items; 9 CharacterPanel retirement:
grep zero references (report the grep).

## Gates

pnpm -r typecheck / -w lint / -r test (desktop 179+, core 1160+, shared 207+; cli 32 byte-stable)
+ `pnpm --filter @taki/desktop build` + core boot smoke (applied [1..13] unchanged — no migration
this batch; ws listening; clean kill). Do NOT commit. Leader/owner visual pass covers the pages.
