# M5 Proactivity Survey — OpenClaw, Hermes, and transferable patterns

> Research for TakiAgent's M5 (proactivity) milestone. Maps how shipping agent
> products implement proactivity, then ranks what to borrow for our stack:
> headless TS Agent Core (AI SDK v7 tool loop) + croner scheduler + sensing layer
> + Heartbeat / Proactive Utterance + Rust Permission Gate.
> Vocabulary follows `CONTEXT.md` exactly (Heartbeat, Proactive Utterance,
> Sampling, Sensitivity Tier, Privacy Pause, Memory Layer, Capability, Permission Gate).
> Every non-obvious claim carries a source; see the Sources section.

---

## 0. TL;DR

- **OpenClaw** is the closest analog to our design and the source of our
  "Heartbeat" concept. Its proactivity is not one feature but a **five-mechanism
  automation stack** (cron / heartbeat / inferred commitments / hooks / standing
  orders) plus a **background-task ledger** and a **markdown workspace the agent
  reads and edits itself**. We already mirror the heartbeat core; the biggest
  un-borrowed ideas are **Inferred Commitments** and the **workspace-file
  self-editing model with its guardrails**.
- **Hermes** is confidently identified: **Hermes Agent by Nous Research** (open
  source, MIT, released Feb 2026). Its differentiators are a **closed learning
  loop** (auto-authored `SKILL.md` procedural memory) and **smart approvals** (an
  auxiliary LLM triages destructive commands). "Codex Smart Approvals" is a
  separate, parallel reference — OpenAI Codex's approval/sandbox modes — not part
  of Hermes.
- **Claude Code** contributes the cleanest **deterministic hook** model (zero-LLM
  event→action, can hard-deny even in bypass mode) — a direct match for our `Hook`
  primitive and multi-channel delivery.

---

## 1. OpenClaw proactivity architecture map

OpenClaw (formerly Clawdbot / Moltbot; mascot "Molty"; npm-installable "gateway"
runtime) frames proactivity as **"pick the right mechanism"**, documented in a
single decision page. The five mechanisms plus the task ledger:

### 1.1 The automation decision matrix (the "beyond heartbeat.md" part)

| Mechanism | Timing | Session context | Creates task record? | Best for |
| --- | --- | --- | --- | --- |
| **Scheduled Tasks (Cron)** | Exact (cron exprs, one-shot `--at`) | Fresh/isolated *or* shared | Always | Reports, precise reminders, background jobs |
| **Heartbeat** | Approximate (default 30m) | Full main-session | Never | Inbox/calendar/notification sweeps |
| **Inferred Commitments** | Due-based, short-lived | Scoped to agent+channel | via heartbeat | "Check in after your interview" follow-ups |
| **Hooks** | Event-driven | n/a (scripts) | n/a | Run script on session reset / compaction / message flow |
| **Standing Orders** | Always-on | Injected every session | n/a | Persistent authority + compliance rules |
| **Background Tasks** | — (ledger, not scheduler) | — | is the record | Audit/inspect all detached work |
| **Task Flow** | — (orchestration) | — | coordinates tasks | Durable multi-step flows |

Guidance OpenClaw gives operators: **cron for precise timing or isolated
execution; heartbeat when the work benefits from full session context and
approximate timing is fine.** (Sources: docs.openclaw.ai/automation.)

### 1.2 Heartbeat internals we already mirror (confirmed, for completeness)

Periodic main-session turn; default `30m` (bumped to `1h` under Anthropic
OAuth/token auth); prompt sent verbatim: *"Read HEARTBEAT.md if it exists. Follow
it strictly. Do not infer or repeat old tasks. If nothing needs attention, reply
HEARTBEAT_OK."* Silent-by-default via the **`HEARTBEAT_OK` ack** (stripped when it
appears at start/end and remaining text ≤ `ackMaxChars`, default 300). Tool-capable
runs can instead call a structured **`heartbeat_respond`** tool with
`notify:false` (silent) or `notify:true`+`notificationText` (alert) — **the
structured tool response takes precedence over the text sentinel**. Skips as
`empty-heartbeat-file` (checklist blank) or `no-tasks-due`. Defers while cron work
is active/queued (`skipWhenBusy` also defers on the agent's own subagent lanes).
Restricted to `activeHours` (local tz). (Sources: docs.openclaw.ai/gateway/heartbeat.)

### 1.3 Trigger surface — the ways an OpenClaw agent "wakes"

Beyond cron and heartbeat, OpenClaw agents wake from: **incoming messages**,
**CLI invocation**, **file-system change monitors**, **inbound API webhooks**,
**agent-to-agent** messages, **boot**, and explicit **system events**. The
documented programmatic wake is `openclaw system event --mode now --text "..."`
(and `npx openclaw trigger --stdin`) — the sanctioned path for an external script
to nudge the agent. Completed **background tasks enqueue a system event that
triggers an immediate heartbeat wake**, so results surface promptly instead of
waiting for the next tick. (Sources: YouTube "Ways to Trigger Agents in OpenClaw";
GitHub issues #39298, #2804; docs.openclaw.ai/automation/tasks.)

### 1.4 Inferred Commitments (highest-value un-borrowed idea)

*"Opt-in, short-lived follow-up memories. OpenClaw infers them from normal
conversations, scopes them to the same agent and channel, and delivers due
check-ins through heartbeat. Exact user-requested reminders still belong to
cron."* Documented use cases: *"check in after a mentioned interview"*, *"gentle
care check-in after user context"*. This is the mechanism that turns passive
conversation into **later, reason-backed proactivity without the user asking** —
exactly our "unsaid thoughts that surface when the mood fits." (Sources:
docs.openclaw.ai/automation; /concepts/commitments.)

### 1.5 Delivery / multi-channel routing (run ≠ delivery)

The **run** and its **delivery** are decoupled. Heartbeat/task config carries
`target` (`none` | `last` | `<channel id>`), `to` (recipient), and `accountId`
(multi-account). Two delivery paths: **direct** (to the originating channel via
`requesterOrigin`) or, if that fails/absent, **session-queued** — the update is
parked as a system event in the requester's session and surfaces on the next
heartbeat (triggering an immediate wake). Group/channel completions route back
*through the requester session* so the parent agent writes the visible reply.
`directPolicy: "block"` runs the turn but suppresses DM sends. Background tasks
carry per-task **notify policies**: `done_only` (default) / `state_changes` /
`silent`. (Sources: docs.openclaw.ai/automation/tasks; /gateway/heartbeat.)

### 1.6 Cost-control mechanisms (proactivity's hidden bill)

`isolatedSession: true` (fresh session, ~100K → 2-5K tokens/run, ~40x cut);
`lightContext: true` (bootstrap only the checklist); cheaper `model` override
(Haiku, or local `ollama/llama3.2:1b`); skip-when-empty / no-tasks-due; keep the
checklist tiny. (Sources: docs.openclaw.ai/gateway/heartbeat; sfailabs guide.)

---

## 2. OpenClaw learning / self-editing mechanisms

### 2.1 The workspace is the agent — plain markdown, no DB

An OpenClaw agent's entire "brain" is a folder of markdown files re-read at
session start; **the files are the agent** (editable in any text editor,
git-versionable, copy-to-clone). The canonical set and load order:

| File | Role | Mutability |
| --- | --- | --- |
| `SOUL.md` | Persona + **constitution**: trust boundaries, tool limits, what needs approval, security invariants, cost + memory rules | Should almost never change |
| `AGENTS.md` | Session logic, checklists, **standing orders**; boot sequence ("do your homework, don't ask permission"). **Security rules here outrank SOUL.md** | Stable |
| `USER.md` | Stable facts about the user, loaded every session | Occasional |
| `IDENTITY.md` | Agent's self-image | Rare |
| `TOOLS.md` | Tool config; secrets referenced as `$ENV_VAR`, **never inline** | As needed |
| `MEMORY.md` | Curated long-term memories (main-session only) | Grows, curated |
| `memory/YYYY-MM-DD.md` | Daily short-term notes / interaction log | Daily |
| `HEARTBEAT.md` | Heartbeat-only checklist | As needed |

(Sources: stack-junkie; capodieci/Medium; ai-coding.wiselychen.com; contextstudios.)

### 2.2 Self-editing — the agent writes its own standing instructions

The agent **can edit these files itself**: in chat ("Add a rule to AGENTS.md…";
"Rewrite HEARTBEAT.md to focus on inbox follow-ups") or **proactively** if the
prompt authorizes it ("If the checklist becomes stale, update HEARTBEAT.md").
This is the mechanism by which an OpenClaw agent tunes its own proactivity over
time. But it is guarded, because LLMs default to clobbering:

- **The MEMORY.md overwrite disaster** — a documented failure where the agent used
  a *write* (not edit/append) and replaced 20+ curated entries with one line. The
  community fix is **multi-layered reinforcement**: a warning header *inside* the
  file + a rule in SOUL.md + an instruction in AGENTS.md + an automated guard/backup
  (git auto-sync every ~12h). *"A single instruction isn't enough."* (Source: trilogyai.)
- **Path-escape enforcement** — `resolveAgentWorkspaceFilePath()` runs
  `assertNoPathAliasEscape`: each file's realpath must stay strictly inside the
  workspace root; symlinks resolving outside are **silently rejected**. (Source: trilogyai.)
  *(We already have the equivalent path-escape core from M3 #11.)*
- **Secrets never in workspace files** — they are plain text and become prompt
  context; reference env/secret-manager instead. (Sources: capodieci; elegantsoftware.)
- **Bounded, curated memory** — memory files bloat and inflate every-session read
  cost; AGENTS.md prescribes periodic consolidation that few operators actually do.
  (Source: ai-coding.wiselychen.com.)

### 2.3 Skills as acquired capability

OpenClaw installs skills from **ClawHub** (`openclaw skill install`), lazy-loaded
on demand. The most-downloaded proactivity skill, "Proactive Agent" (a **WAL /
Working-Action-List** queue that adds event+keyword triggers on top of time),
shows the community layering richer proactivity as installable packs rather than
core. (Sources: contextstudios; imclaw.ai lesson 15.)

---

## 3. Hermes — identity + mechanisms

### 3.1 Identity verdict: HIGH confidence

**Hermes = Hermes Agent by Nous Research.** Open source, **MIT-licensed**,
self-hosted, released **February 2026**. Same category as Claude Code / Codex /
OpenClaw; works with any LLM provider (OpenRouter, Anthropic, OpenAI, DeepSeek,
local, 15+); runs on Linux/macOS/WSL; connects to 16+ messaging platforms; Docker
isolation. Core loop is `AIAgent` in `run_agent.py` (synchronous orchestration:
provider selection, prompt construction, tool execution, retries, compression,
persistence). (Sources: petronellatech; nousresearch/hermes-agent GitHub;
dev.to/arshtechpro; engineeratheart/Medium.)

**On "Hermes + Codex Smart Approvals":** these are **two separate references**,
both about *smart permission approval*, which is why the operator paired them.
Hermes ships an `approvals.mode: smart` feature (below). "Codex Smart Approvals"
refers to **OpenAI Codex's** own approval/sandbox modes — a distinct product.
There is no "Hermes Codex" product. (Confidence: high on Hermes; the Codex half is
inferred from naming — flagged as such. Disambiguating evidence if needed: whether
the operator meant Codex's `--ask-for-approval`/sandbox tiers vs Hermes's
auxiliary-LLM classifier.)

### 3.2 The closed learning loop (Hermes's headline differentiator)

Learning here means **agent-context learning, not model retraining** — no weight
updates. The loop: *do work → notice a reusable procedure / preference / fact /
lesson → save it as memory, a skill, a file, or session history → load it next
time → improve the next run.* Two stores, deliberately split:

- **Memory = facts.** Two small curated files injected into the system prompt at
  session start: `MEMORY.md` (~2,200 chars — environment facts, conventions,
  lessons) + `USER.md` (~1,375 chars — preferences, communication style). ~1,300
  tokens total, ~15-20 entries. The agent **self-manages**: adds when it learns,
  replaces when facts change, **consolidates when full**. **Security scanning runs
  on memory entries to prevent prompt injection.** Plus full-text search over all
  past sessions in SQLite (recall from weeks ago). Described as a 4-layer system:
  episodic + procedural + user-model + always-on context. (Sources: dev.to/arshtechpro;
  claude-code issue #57830.)
- **Skills = procedures.** After a complex task, the agent calls
  `skill_manage(create)` to write a `SKILL.md` (procedure + known pitfalls +
  verification steps) into `~/.hermes/skills/`. **Creation triggers:** ≥5 tool
  calls, *or* it hit errors/dead-ends and found the working path, *or* the user
  corrected its approach, *or* it discovered a non-trivial workflow. Skills are
  directories (`SKILL.md` + optional references/templates/scripts), YAML
  frontmatter + markdown, **progressive disclosure** to minimize tokens, and
  follow the **agentskills.io open standard** (portable to other runtimes). Skills
  **self-improve** during use and can be retired. Hub install from skills.sh +
  GitHub. (Sources: dailydoseofds masterclass; securityboulevard; dev.to; X/@akshay_pachaar.)

The distinction that matters for us: *"knowing a pod crashed is useless without
the exact sequence of commands that fixed it"* — **facts vs procedures are
different memory layers.**

### 3.3 Smart approvals (the permission-side mechanism)

`approvals.mode` has three modes; the default `smart` sends shell commands flagged
as destructive (`rm -rf`, `git reset --hard`, …) to an **auxiliary LLM** that
assesses risk:

- **`smart`** — auto-approve a low-risk command once, **deny** high-risk, **prompt
  when uncertain** (default).
- **`manual`** — always prompt.
- **`off`** — skip all prompts (`--yolo`).

Complemented by **secret redaction** (default on) and **PII redaction** (hashes
user IDs, strips phone numbers from session context *before it reaches the
model*). (Sources: petronellatech; nousresearch/hermes-agent bundled skill doc.)

### 3.4 Proactivity in Hermes

Hermes has no distinct "heartbeat"; proactivity is **cron + the learning loop**.
The canonical community recipe — *"Every morning, ask my one big priority, update
your memories about me, and recommend how you can help"* — literally **sets a cron
job** and leans on memory + skills to personalize. Scheduling/autonomy is listed
as one of its five pillars ("works while you sleep"). (Sources: WorldofAI +
"blowing me away" YouTube transcripts; atalupadhyay.)

---

## 4. Ranked borrow list

Each item: **pattern → why it fits → adaptation → lands in** (sensing / heartbeat /
scheduler / memory-learning / permissions). Ordered by value-to-effort for M5.

### B1. Inferred Commitments → our `intentions` layer + Proactive Utterance  ★ top pick
- **Why it fits:** This is the missing engine behind "unsaid thoughts that surface
  when the mood fits." It converts ordinary conversation into *later, reason-backed*
  proactivity without the user asking — the essence of a Companion vs an assistant.
- **Adaptation:** During a normal turn, an `intentions` writer (per-character
  Memory Layer we already have) records opt-in, short-lived, due-dated follow-ups
  scoped to this Character. Heartbeat surfaces due ones **subject to rate limits +
  quiet hours**. Exact user reminders ("remind me at 5pm") go to the **croner**
  scheduler, not intentions — keep the split OpenClaw draws.
- **Lands in:** memory-learning + heartbeat.

### B2. `HEARTBEAT.md`-style user-editable checklist in the Workspace  ★
- **Why it fits:** Our Heartbeat already "reviews a small stable checklist." OpenClaw
  proves the checklist should be a **tiny, user-owned, plain file**, not code.
- **Adaptation:** A `heartbeat.md` (or a typed equivalent) in
  `%USERPROFILE%\.takiagent\workspace`, surfaced read-only-ish in the Proactivity
  settings group. Keep it tiny; encode **silence criteria** per line.
- **Lands in:** heartbeat.

### B3. Skip-when-empty + due-only `tasks:` block  ★
- **Why it fits:** Directly implements our "Skipped when there is nothing to check"
  and is the single biggest cost lever for a BYO-API user.
- **Adaptation:** No model call when the checklist is empty (`empty-heartbeat-file`
  analog) or when no interval task is due (`no-tasks-due`). Persist per-task
  last-run timestamps so intervals survive Core restarts. Merges cleanly with croner.
- **Lands in:** heartbeat + scheduler.

### B4. Structured silent-ack contract (prefer a tool over a string sentinel)
- **Why it fits:** We need the "all-quiet ack is never shown to the user" behavior.
- **Adaptation:** In the AI SDK v7 tool loop, expose a `heartbeat_respond` tool
  (`notify:false` silent | `notify:true`+text alert) as the **primary** signal;
  keep a `HEARTBEAT_OK` string only as a fallback. Structured return is cleaner and
  less leak-prone than parsing sentinels out of free text.
- **Lands in:** heartbeat.

### B5. Cron-vs-Heartbeat split with a decision table
- **Why it fits:** We are building *both* croner and Heartbeat; OpenClaw's table
  prevents them from overlapping (precise/isolated = cron; context-aware/approximate
  = heartbeat; all cron runs are recorded, heartbeats are not).
- **Adaptation:** Adopt the routing rule in our scheduler/heartbeat docs verbatim.
- **Lands in:** scheduler + heartbeat.

### B6. Isolated / light-context / cheap-model heartbeat runs
- **Why it fits:** A full-context heartbeat every N minutes is the classic
  token/battery bomb; our users bring their own (often paid) API.
- **Adaptation:** Offer per-heartbeat `isolatedSession` (fresh minimal context) and
  a **cheaper model override** (a small/local model for the "does anything need
  attention?" gate; escalate to the main model only when it does).
- **Lands in:** heartbeat.

### B7. Busy-deferral + system-event wake (run/delivery decoupling)
- **Why it fits:** Matches "deferred while a real conversation turn is in flight"
  and avoids interrupting the user mid-exchange.
- **Adaptation:** Heartbeat defers while a live turn or a Capability call is in
  flight. A finished long-running Capability (Shell/Node side) posts a **system
  event** to Core that may trigger a heartbeat rather than pushing a raw message —
  keep the run and the (rate-limited, quiet-hours-aware) delivery separate. Note
  OpenClaw's own bug (#8997: background completion interrupting an active turn) as
  the failure to design against.
- **Lands in:** heartbeat + sensing.

### B8. Facts-vs-procedures memory split + bounded, self-consolidating memory (Hermes)
- **Why it fits:** We have layered memory already; Hermes validates **capping and
  consolidating** each layer and separating *facts* (`profile`/`relationship`) from
  *procedures* (skills/`intentions`), with **security scanning against injection**.
- **Adaptation:** Enforce per-layer char/entry budgets with an agent-run
  consolidation pass; treat sensed content and recalled memory as **untrusted data,
  never instructions**; scan entries before persisting.
- **Lands in:** memory-learning.

### B9. Agent-authored skills as procedural memory (Hermes learning loop)
- **Why it fits:** Our skills loader exists (M2). The loop — recognize a solved
  non-trivial workflow, write it down, reload it — is a low-risk form of "learning"
  with no weight updates.
- **Adaptation:** Let the agent draft a skill after error-recovery / user-correction
  / multi-step success, but **gate the write behind an Approval** and the Workspace
  path-escape core. Adopt YAML-frontmatter + progressive disclosure so skills stay
  cheap to index. (Watch the "useless skill sprawl" failure mode — require a
  retire/prune path.)
- **Lands in:** memory-learning.

### B10. Deterministic hooks for reflexes + notification routing (Claude Code)
- **Why it fits:** Exactly our `Hook` primitive (deterministic event→action, zero
  LLM, zero token cost). Claude Code's model is the cleanest reference: matcher-filtered
  events, and a `PreToolUse`-style hook can **hard-deny even in bypass mode** — a
  policy the user cannot override by changing permission mode.
- **Adaptation:** Reserve LLM turns (Heartbeat) for judgment; use Hooks for reflexes
  (idle-motion return, avatar state on Capability start/finish) and for **delivery
  fan-out** (a Notification-style hook routes a Proactive Utterance to tray/phone
  Node). Keep the Rust Permission Gate authoritative; a hook may add a deny, never a
  fail-open allow.
- **Lands in:** sensing (triggers) + permissions + delivery.

### B11. Optional "smart approval" pre-classification (Hermes) — cross-cutting, adjacent to M5
- **Why it fits:** Reduces approval fatigue for proactivity that wants to *act*
  (not just speak), aligning with our Exec `allowlist` default.
- **Adaptation:** An **advisory** classifier may pre-sort a Capability request
  (auto-allow trivially-safe / auto-deny obviously-destructive / prompt-when-unsure)
  **before** the Rust gate — but the gate stays the sole authority and defaults
  deny-by-default. LLM classification is never permitted to fail-open. (Ties to our
  Session-11 dismiss-fail-open finding: the safest option must occupy the default slot.)
- **Lands in:** permissions (note for the M5↔Permission-Gate seam).

---

## 5. Anti-patterns & warnings

**Cost traps**
- Full-conversation-context heartbeat every 30m ≈ ~100K tokens/run; short intervals
  multiply that and drain laptop battery. → isolated/light context, cheap/local gate
  model, sane cadence (default no tighter than 30m), skip-when-empty. (Source: sfailabs; heartbeat docs.)
- Bloated checklists burn tokens and rarely improve results — cap the number of items.

**Annoyance / notification-fatigue traps**
- **Vague checklist items always fire.** *"Check email"* alerts every tick; the item
  must carry a condition: *"only if a VIP emailed in the last hour."* Documented
  anti-patterns: *"Ask me if I need anything"*, *"Update project status."* (Source: learnopenclaw.)
- Without a silent-ack + rate limits + quiet hours, proactivity degrades into spam.
  We already have `Proactive Utterance` rate limits + quiet hours + one-click
  **Privacy Pause** — these are load-bearing, not optional polish.

**Privacy traps**
- **Secrets in workspace/markdown leak into prompt context.** Keep secrets in
  **Windows Credential Manager** (our invariant 5), reference indirectly. (Source: capodieci.)
- Sensing is the sharp edge: window titles and especially screenshots are sensitive.
  Our **Sensitivity Tier** (screenshots off by default, opt-in) + **sensitive-process
  skip list** + Privacy Pause are the mitigations. Borrow Hermes's **PII redaction**
  (hash IDs / strip phone numbers) before any sensed text enters a prompt.
- **Prompt injection via sensed or recalled content.** A malicious window title or a
  poisoned memory entry is untrusted input. Hermes security-scans memory entries;
  we should treat all sensed/recalled content as data, never instructions.

**Correctness / safety traps**
- **Memory-overwrite:** an LLM will *write* over a curated memory file unless told
  not to at multiple reinforcement points. → in-file header + layered rules +
  automated backup/versioning. (Source: trilogyai.)
- **Self-editing runaway:** an agent editing its own HEARTBEAT/skills/standing orders
  can drift or self-grant authority. Keep the "constitution" (persona + security
  rules) effectively immutable and **outranking** persona files; gate every
  self-write; provide a prune/retire path for skills.
- **Permission fail-open:** never let a smart-approval classifier (or a dismissed
  dialog) resolve to the most-permissive choice — the Rust gate defaults deny; the
  safest option owns the default slot. (Our own Session-11 finding.)
- **Interrupting the user:** background completions must not barge into an active
  turn (OpenClaw #8997). Decouple run from delivery; defer while busy.

---

## Sources

OpenClaw — automation & heartbeat
- https://docs.openclaw.ai/automation
- https://docs.openclaw.ai/automation/tasks
- https://docs.openclaw.ai/gateway/heartbeat
- https://github.com/openclaw/openclaw/blob/main/docs/gateway/heartbeat.md
- https://docs.openclaw.ai/reference/templates/HEARTBEAT
- https://github.com/openclaw/openclaw/issues/39298 (system event = programmatic wake)
- https://github.com/openclaw/openclaw/issues/2804 (system events → heartbeat re-runs)
- https://github.com/openclaw/openclaw/issues/8997 (background completion interrupts active turn)
- https://www.joumenharzli.com/blog/proactive-ai-agents-the-architecture-behind-openclaw
- https://sfailabs.com/guides/openclaw-heartbeat-scheduling
- https://www.contextstudios.ai/blog/the-complete-openclaw-guide-how-we-run-an-ai-agent-in-production-2026
- https://learnopenclaw.org/workspace-heartbeat.html
- https://imclaw.ai/en/lessons/15 (Proactive Agent / WAL skill)
- https://www.youtube.com/watch?v=Ht8s4ZGjygo (trigger types)

OpenClaw — workspace files / self-editing / guardrails
- https://www.stack-junkie.com/blog/openclaw-workspace-architecture
- https://capodieci.medium.com/ai-agents-003-openclaw-workspace-files-explained-soul-md-agents-md-heartbeat-md-and-more-5bdfbee4827a
- https://ai-coding.wiselychen.com/en/openclaw-architecture-deep-dive-context-memory-token-crusher
- https://trilogyai.substack.com/p/how-to-manage-your-openclaw-memory (overwrite disaster, path-escape check)
- https://www.elegantsoftwaresolutions.com/blog/openclaw-workspace-markdown-files-guide
- https://www.reddit.com/r/openclaw/comments/1r2kfs0/ (soul/user/memory separation)

Hermes Agent (Nous Research)
- https://github.com/nousresearch/hermes-agent (repo; bundled skill doc: approvals.mode, redaction)
- https://petronellatech.com/blog/hermes-agent-ai-guide (approval modes, Docker isolation, learning loop)
- https://dev.to/arshtechpro/hermes-agent-a-self-improving-ai-agent-that-runs-anywhere-2b7d (memory caps, skills dir, AIAgent loop)
- https://www.dailydoseofds.com/p/hermes-agent-masterclass (skill_manage triggers)
- https://securityboulevard.com/2026/06/8-self-evolving-skills-hermes-agent-writes-on-its-own (agentskills.io, self-prune)
- https://engineeratheart.medium.com/hermes-agent-an-openclaw-alternative-with-memory-skills-and-a-real-learning-loop-e9ab7e2b4b84
- https://atalupadhyay.wordpress.com/2026/04/26/hermes-openclaw-ai-agents-autonomous-ai-workflows
- https://github.com/anthropics/claude-code/issues/57830 (4-layer memory summary)
- https://github.com/NousResearch/hermes-agent/issues/500 (proactive context loop feature discussion)

Claude Code (cross-product)
- https://code.claude.com/docs/en/hooks-guide
- https://code.claude.com/docs/en/hooks
- https://code.claude.com/docs/en/agent-sdk/hooks.md (Notification → Slack/PagerDuty routing; auto-approve read-only tools)
- https://claudelab.net/en/articles/claude-code/claude-code-hooks-complete-guide-2026
