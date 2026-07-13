# PRD — Live2D renderer selection spike (GitHub issue #13)

Time-boxed spike executing the renderer decision tree from `docs/TECH-STACK.md`. Deliverable is a **decision + evidence**, not production code. AFK: the tree has no free variables.

## Objective

Build a minimal PixiJS 8 harness running inside the Tauri WebView2 window, load one Cubism 2 (moc) and one Cubism 3+ (moc3) model from the taki asset set, exercise motions / expressions / hit-testing, then lock the renderer per the decision tree and write the outcome back into `docs/TECH-STACK.md`.

## Decision tree (no free variables)

1. Primary `untitled-pixi-live2d-engine` renders BOTH moc + moc3 (motions, expression swap, hit-test) → **lock it**.
2. Its Cubism 2 path fails → determine whether the model set's moc3 assets require a Cubism **5** runtime specifically:
   - NO → adopt fallback `pixi-live2d-display-lipsyncpatch` (accept PixiJS 7 pin, no Cubism 5);
   - YES → primary is mandatory: patch/escalate its Cubism 2 path (STOP-ON-BLOCKED if not feasible — write `docs/devlog/blocked.md`).
3. Record chosen library + pinned versions in `docs/TECH-STACK.md` (edit the renderer decision section in place).

## Test assets (locked by user 2026-07-13)

- Source: `models/taki.zst` (git-ignored, copyrighted — NEVER commit/bundle). Verified to contain BOTH formats.
- Extraction (tooling verified on this machine): `tar --zstd -xf models/taki.zst --force-local -C models/extracted/taki <costume-dirs>` — extract INSIDE `models/` so everything stays git-ignored.
- Suggested picks: `live_default/` or `casual/` (Cubism 2: `model.json` + `model.moc`) and `live_01/` or `casual_spring_01/` (Cubism 3+: `.model3.json` + `.moc3`).
- These are the exact models BANDORI-PET-REV drives, so model-side capabilities (mouth/head params, motions) are already proven; the spike verifies the **renderer side** only.

## Acceptance criteria (issue #13 + increments)

Original:
- [ ] A moc AND a moc3 model both render in the WebView2 harness with a visible motion, an expression swap, and a working hit-test
- [ ] Decision tree executed; chosen library + pinned versions recorded in `docs/TECH-STACK.md`
- [ ] Cubism runtimes vendored via a download script, git-ignored; nothing proprietary committed or hotlinked
- [ ] Short spike report noting idle GPU/CPU behavior and large-atlas load concerns
- [ ] If fallback chosen: the "does moc3 need Cubism 5?" determination documented with evidence

Increments (2026-07-13, all [v1/M4]):
- [ ] Verify raw parameter get/set on the chosen renderer (`internalModel.coreModel` / `setParameterValueById` equivalent) on BOTH Cubism generations — gate for head tracking / lip-sync / future param features
- [ ] Verify the built-in lip-sync path loads (`model.speak` lineage) — activation ships with TTS (#31), here we only prove the wheel exists
- [ ] Observe: do taki's manifests define hit areas (Cubism 2 mocs likely don't) — outcome decides #16's custom hit-area increment
- [ ] Observe: do moc3 models need framing-scale compensation (BANDORI used 1.35x) — outcome feeds #14

## Deliverables & placement

- Harness: `apps/desktop/src/renderer/` (framework-free TS, NO React imports) + a minimal dev entry. Mark every file's POS header `experimental / spike — not in production path`. Keep it small; it seeds #14's real renderer module but does not have to be final.
- Vendor script: `scripts/vendor-live2d-runtimes.mjs` downloading `live2dcubismcore.min.js` (+ `live2d.min.js` for Cubism 2.1, from the dylanNew/live2d mirror — vendor locally, never hotlink). Output dir MUST be git-ignored (add `.gitignore` entry in the same change).
- Spike report: `{TASK_DIR}/research/spike-report.md` (evidence: what loaded, what failed, console output, idle CPU/GPU notes, increment observations).
- `docs/TECH-STACK.md` renderer section updated in place with the locked choice + pinned versions.

## Constraints

- **Never code library APIs from memory** — verify against installed `node_modules` types / current docs first (PixiJS 8 init is async; Cubism core registers via side-effect script).
- GPLv3 clean-room: BANDORI is pattern reference only; no code copying.
- `models/**` and vendored runtimes must never appear in `git status` as tracked files — if they do, stop and fix `.gitignore` first.
- Anti-sprawl: file <= 300 lines, fn <= 50; INPUT/OUTPUT/POS headers; update each touched dir's `index.md`.
- Visual correctness is a MANUAL check: queue it in `docs/devlog/manual-checks.md`; automated assertions cover load success, hit-test return values, and param get/set round-trips (log to console / expose a simple in-page status readout).

## Research inputs (read before coding)

- `.trellis/tasks/archive/2026-07/07-07-live2d-renderer-selection/research/renderer-comparison.md` — full candidate matrix, lineage, risks
- `.trellis/tasks/archive/2026-07/07-07-reference-research/research/live2d-presentation-analysis.md` — BANDORI feature patterns (esp. §6 lip-sync, §3 hit-test)
- `docs/TECH-STACK.md` — the section this spike writes back into
