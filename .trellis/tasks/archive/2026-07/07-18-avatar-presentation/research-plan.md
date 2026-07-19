# T1 Research Plan — dispatch brief for the research agent

> Persisted at the M4→M5 session handoff: the T1 research dispatch was interrupted before any findings landed. The incoming Leader re-dispatches THIS brief verbatim to a research agent (trellis-research type; heavier model tier; background). Findings must FRONT-LOAD implementation: every brief ends with exact files to touch, exact insertion points (file:line), ranked options with ONE recommendation, and defined tests — an impl agent must be able to write code immediately without re-deriving anything.

Read first: this task's `prd.md`, `docs/devlog/m5.md` (blueprint §T1), `CONTEXT.md` (use terms exactly: Idle Motion / Hook / Heartbeat).

## HARD TOOL RULES (include verbatim in the dispatch prompt)
Web search ONLY via `mcp__exa__web_search_exa` / `mcp__tavily-remote__tavily_search`; page fetch via `mcp__tavily-remote__tavily_extract` / `mcp__exa__web_fetch_exa`. Native WebSearch/WebFetch are FORBIDDEN (operator directive). Local code via Read/Glob/Grep. Never code external-library claims from memory — verify in `node_modules` types or fetched docs.

## Workstream A — tool-reply discipline (1c; the priority)

Current mechanism (verified, do not re-derive): every avatar tool call ends a ToolLoopAgent step; the `{ok:true}` result forces another generation step; the model pads (filler, self-conversation drift). Key files: `packages/core/src/agents/chat-agent.ts` (agent construction ~line 84-93: instructions, tools, stopWhen, toolApproval — construction is EDITABLE; the stream loop/persistTurn/finally are D1-FROZEN), `packages/core/src/avatar/play-motion-tool.ts` + `set-expression-tool.ts` (descriptions + `{ok:true}` results), `packages/core/src/avatar/avatar-vocabulary.ts` (render → instructionsExtra), `packages/core/src/agents/base-prompt.ts`.

1. Verify in the INSTALLED `ai@7.0.17` types (`node_modules/.pnpm/ai@7.0.17*/node_modules/ai/dist/index.d.ts`) what step-control levers exist on ToolLoopAgent/stream: `stopWhen` composition (isStepCount + custom predicates over step content?), `prepareStep`/`activeTools`/`toolChoice` per-step controls, anything that lets a turn END when the last step had tool calls but no meaningful text, or that constrains which tools are available after N steps. Quote exact API names + signatures.
2. Web research (exa/tavily): how do agent runtimes prevent "forced continuation after fire-and-forget tool calls"? AI SDK v5-v7 guidance on stopWhen/step control for presentation-type tools; OpenClaw/Hermes/Claude Code tool-result design conventions (empty/`null` results? explicit "no reply needed" markers? prompt rules); documented tool-result taxonomies (fire-and-forget vs informational).
3. Deliver `research/ra-tool-reply-discipline.md`: (a) the levers table (verified API surface); (b) ranked fix options — prompt rules in the vocabulary/base-prompt section (draft the EXACT English prompt text), tool-description tweaks (draft exact wording), structural stopWhen/step predicate (exact code sketch + D1-freeze compliance analysis — construction-level only), per-turn avatar-call budget; (c) ONE recommended combination; (d) the taxonomy paragraph to sediment into `.trellis/spec/` (name the target file — check the backend spec index); (e) tests (mock-model scripts that reproduce the filler pattern and pin the fix).

## Workstream B — live vocabulary defect trace (1b)

Find WHERE the Pet UI calls avatar.report and WHAT list it extracts: Grep `apps/desktop/src` for `reportAvatar`/`avatar.report`/vocabulary; trace the data source (raw model settings JSON? the loaded Live2D model's manifest? pre- or post- `settings-prune`?) and WHEN it fires (initial load only? every `switchCostume`?). Key suspects: `apps/desktop/src/windows/pet/` hooks, `apps/desktop/src/renderer/live2d/` (settings-prune.ts, costume-switch.ts), `apps/desktop/src/lib/ws-client.ts` reportAvatar. Cross-check core side: `packages/core/src/server/methods/avatar-report.ts` + `avatar-vocabulary.ts`. Deliver `research/rb-vocabulary-report-trace.md`: the exact defect (file:line), the pruned-inventory data source to use instead (#18's costumeResolution/settings-prune outputs — name the exact function/value), the re-report trigger point in the switch path, fix spec + tests.

## Workstream C — Idle Motion + proximity engine facts (1a/D17)

1. Motion-finish detection: does `untitled-pixi-live2d-engine` expose a motion-complete event/promise/callback? Verify in node_modules (Glob the package, read its .d.ts/source) — exact API. If none, what polling/wrapper pattern works (motion manager state)?
2. Idle conventions: do our BanG Dream models define an Idle motion group (check `models/` settings JSONs for both generations + what #18's import data shows)? What does the engine do when NO motion is playing (does it auto-play an idle group by name convention)?
3. Current one-shot sites: `apps/desktop/src/renderer/live2d/click-reactions.ts` + avatar-commands (`{loop:false}` discipline) — where does "motion ended" currently go (nowhere = last-frame freeze)?
4. BANDORI reference (`references/BANDORI-PET-REV-main`, GPLv3 — patterns only, NEVER copy code): how does it schedule idle motions + mouse-proximity reactions (which files, what pattern: timers? distance threshold? cooldown)?
5. Deliver `research/rc-idle-motion-and-proximity.md`: engine API facts (quoted), idle-group reality per model generation, the scheduler design (module file name, state shape, random-interval policy, priority interaction with click/avatar-command motions, ticket/isStale safety, extraction-friendly internals but NO generic hook bus), proximity design (cursor source — the gaze path already polls the cursor; reuse it, threshold + cooldown), tests.

## Workstream D — module health notes (Q1 contract)

While reading, record debt observed in the traversed modules (`packages/core/src/avatar/`, `apps/desktop/src/renderer/live2d/`, `apps/desktop/src/windows/pet/`, chat-agent instruction path): stale headers, duplication, orphans, size-cap risks. Deliver `research/rd-module-health.md` — one line per finding, file:line, severity (fix-in-T1 if the file will be touched / note-only otherwise).

Persist ALL findings under `.trellis/tasks/07-18-avatar-presentation/research/`. Modify nothing else. Final message: <=30 lines — per-workstream verdict + the one recommended 1c fix combination + any blocker.
