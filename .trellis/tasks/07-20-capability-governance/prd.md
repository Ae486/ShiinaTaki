# T2b — Tool & capability governance

M5 task (blueprint T2 split, part B). The governance/safety half of T2 (T2a was the tool-design standard). Owner-aligned 2026-07-20: **full scope** — all six items + the screenshot describe-prompt enhancement — as **Core-side mechanism + `@taki/shared` protocol + `.trellis/spec` governance contract**. **Settings-panel UI stays in #23 (T6).**

## Hard constraint (BANGCLAW, owner-directed 2026-07-20)

Front-load a **龙虾(OpenClaw, web) + 马(Hermes, local `references/hermes-agent-main`)** permission / capability / approval architecture research pass BEFORE design — every design rule cites its source, zero invented rules (same discipline as T2a). Registries / permission-levels / approval-classes MUST be authored EXTENSIBLE for future file/process/script capability breadth — do not hard-code today's handful such that later growth is painful to graft on. Where a governance decision would box out that future (e.g. D36 agent-authored code), flag it, do not silently cross it. Implementation is GATED on the research.

## Scope (full — 6 items, Core-side)

1. **D3 argv[0] security fix** — resolve exec `argv[0]` against a PATH that EXCLUDES cwd, to an absolute path; a cwd-local same-named executable must never match the allowlist (deferred **D3**, "must-fix before exec auto-run ships"). Bypass-immune floor.
2. **NL authorization governance** — codify the red line: a grant expressed in conversation ALWAYS routes through the existing Approval flow (once / session / always / deny) into the SAME store the permissions panel manages; the agent NEVER self-authorizes (defends against self-authorization + injection amplification). Verify no bypass path exists today; pin with a fail-closed test. (Principle + no-bypass proof — low code volume.)
3. **Permission Level presets** — a relaxed / standard / strict global preset that bulk-sets every Capability's policy; a convenience VIEW over per-Capability grants, NEVER a second enforcement path; the most permissive level still writes the audit log and cannot lift the hard blocklist (CONTEXT Permission Level). Core-side policy + protocol only; UI → #23.
4. **Directory-root explicit authorization** — authorization granularity for file RW outside the Workspace (dir roots / allowlist), on the `(capability, argClass)` model.
5. **Pipe / shell-mode approval class** — classify exec compound/pipe commands as an argClass in the `(capability, argClass)` model (`permission-authorization.md`); the risky class stays always-ask, never persisted, bypass-immune.
6. **Screenshot describe-prompt parameter** — let the VLM describe step accept a caller-supplied prompt (small capability enhancement).

## Boundary

- Core-side mechanism + `@taki/shared` protocol (zod, Rust serde mirror where a message crosses the wire) + `.trellis/spec` governance contract. **Settings-panel UI (Permission Level selector, allowlist editor, audit viewer) → #23 (T6).** T2b builds no UI.
- Extensibility is a binding design constraint (BANGCLAW): the level / class / registry shapes must accommodate later file/process/script capabilities without a rewrite.
- Every enforcement path crosses the single Rust Permission Gate (invariant 1); Permission Level is never a second authority.

## Design decisions (owner-ratified 2026-07-20 brainstorm)

### Permission Level presets — the FACTORY DEFAULT projection (user-editable)
The table below is the default `projectLevel(level)` output, **not hard-coded** — every cell is user-editable via the settings panel (registry-driven, research §5). Default level = `standard`.

| capability / argClass | strict | standard (default) | relaxed (yolo) |
|---|---|---|---|
| fixed-risk (screenshot / process-list / clipboard-read) | ask | auto | auto |
| clipboard-write | ask | auto | auto |
| exec `simple-allowlisted` | ask | auto | auto |
| exec `compound` / `shell-reentry` / `allowlist-miss` | ask | ask | **auto** |
| shell-open `url-safe` | ask | auto | auto |
| shell-open `local-exec` / `local-file` | ask | ask | **auto** |
| fs-write in-Workspace (plain data) | auto | auto | auto |
| fs-write authorized dir-root | ask | ask (once/session) | auto |
| fs-write outside any root | ask | ask | **auto** |
| skill/hook script write (executable code — stricter than plain files) | ask | ask | **auto** |
| sensitive sub-target (`.env`/`id_rsa`/`.git`/`.ssh`) | **deny** | **deny** | **deny** |
| self-escalation surface (edit gate/policy/Level/permission files) | **deny** | **deny** | **deny** |
| catastrophic command (`rm -rf /`/`mkfs`/`format`) | **deny** | **deny** | **deny** |

- **relaxed = yolo**: everything outside the deny floor runs with NO prompt. Sourced: Hermes `--yolo` with hardline-below-yolo [H-APR:333-357].
- All tiers **always audit**; **stricter-wins** (an explicit per-capability override or the floor beats the Level); a floor class is never auto in any tier.
- **The three deny rows are the floor, DENY-BY-DEFAULT but user-configurable via the panel** — changing a deny-by-default cell raises a prominent second-confirm (not a plain toggle); the user owns the consequence.
- **The agent can NEVER change any permission config (Level, projection, floor, blocklist).** That path exists ONLY in the panel (operator-role) — it is the agent's self-escalation blocklist. Floor immovability is *against the agent* (anti-injection / anti-model-error), not against the user.
- **managed-floor seam reserved** (research §3.3): a future managed deployment can pin a ceiling the user also cannot cross; v1 personal build does not enable it.
- **Fixed-risk standard factory default revised (owner-ratified 2026-07-21, batch D)**: the `fixed-risk (screenshot/process-list/clipboard-read)` and `clipboard-write` rows' **standard** posture is shipped as **`ask`**, not the table's `auto` — a gated/sensitive capture or read should not auto-run with no approval at the default tier; `relaxed`(yolo) still runs them with no prompt (honoring yolo). These remain user-editable factory defaults (#23 can set them back to `auto`). Fixed-risk is now name-keyed AND Level-projected (was name-keyed-only), closing the gap where `relaxed` still prompted them.

### skill/hook authoring — D36 re-ruling (see deferred-decisions D36)
The agent MAY write skill/hook script files (relaxed: silent; standard/strict: ask). Binding floor: **a skill/hook carries no permission of its own — every capability call inside it is governed by the current Level + floor + Gate at execution time** (yolo runs it; drop to `standard` and its risky calls ask again — never a permanent backdoor). A skill that edits the permission system still hits the self-escalation floor. skill/hook paths (`workspace/skills`, `hooks`) are physically disjoint from permission files (`config`/`gate-decisions`).

### Level × scope × allowlist are ORTHOGONAL (impl MUST NOT conflate — write into spec)
Three layers, stricter-wins composed; the existing `once/session/always` (DecisionStore) and exec allowlist are **UNCHANGED**:
1. **classification** (allowlist / scheme / path-root) → which `(capability, argClass)` this request is.
2. **Permission Level projection** → that class's baseline posture auto/ask/deny in the active tier.
3. **once/session/always** → the memory scope of the user's answer, ONLY when layer 2 = ask.

Floor classes are never-persisted (existing `gate.rs` exec/local-shell-open never-persist), so no `always` record is ever produced for the dangerous region — no "old always vs new floor" conflict. Tightening the Level supersedes a looser stored `always` (stricter-wins).

## Exclusions

- Settings-panel UI → **#23** (T6 settings group).
- Broad capability expansion (file/process/script breadth) → later milestones; T2b only lays extensible foundations.
- Provider strict enablement → **D40** (owned by T2a).
- Agent-authored executable code (skill/hook files) → **D36** (flag if approached, do not cross).

## Acceptance (refined after research)

1. Research bank exists; EVERY design rule cites an authoritative source (龙虾 / 马 / Claude Code / Codex / MCP); zero invented rules (owner hard constraint).
2. D3 argv[0] fix landed + a deny-default RED-proof test (cwd-hijack attempt blocked).
3. NL-authorization red line codified in spec + a no-bypass fail-closed test.
4. Permission Level presets + directory-root auth + pipe/shell-mode class implemented Core-side, ALL crossing the single Permission Gate; per-`(capability, argClass)` memory, structurally no cross-class leakage.
5. Screenshot describe-prompt parameter wired end-to-end.
6. Gates green: `pnpm -r typecheck/test/lint` + `cargo clippy -- -D warnings`.
7. All new mechanisms authored extensibly (BANGCLAW); D36 boundary flagged, not crossed.

## Manual-check note

T1's queued manual checks (64-75) plus any new T2b visual/side-effect checks are surfaced to the owner AFTER dispatch, per owner instruction 2026-07-20.
