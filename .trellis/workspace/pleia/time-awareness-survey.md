# Research: Agent Time-Awareness (push vs pull)

- **Query**: How do authoritative agent systems give the LLM a sense of time (current datetime, message ages, memory ages, durations)? Test the owner's hypothesis: "no per-message injection — just a lightweight get-current-time tool + prompt guidance."
- **Scope**: mixed (local Hermes checkout + external: OpenClaw, Claude Code, ChatGPT, Letta/MemGPT, prompt-caching economics)
- **Date**: 2026-07-21
- **Owner**: PLeiA. Workspace research bank (no task yet).

> Rule: every claim below carries a source (local `file:line` or URL). Unsourced ideas are quarantined in §OMITTED.

---

## TL;DR of the evidence

Every authoritative system studied uses a **hybrid**, and all of them landed there by explicitly rejecting one of the two extremes:

- **Day-granularity date lives in the (cache-stable) system prompt** — Claude Code, ChatGPT, Hermes, OpenClaw, Letta.
- **Fine-grained wall-clock time is NOT put in the cached prefix** — it is either (a) fetched by a tool on demand, or (b) injected in a *non-cached* position (per-turn ephemeral block, or per-message envelope). The reason is uniformly cited as prompt-cache stability.
- **Pull-only (tool + guidance, no injection at all) is a documented failure mode.** The exact "good morning at 3 PM / wrong weekday after a day-boundary" bug is reported repeatedly, and at least one system (Hermes) shipped a follow-up PR to *add* per-turn time injection specifically because pull-only drifted.

---

## Findings

### 1. LOCAL Hermes (`references/hermes-agent-main`, MIT) — what it actually does

Hermes has a **dedicated timezone clock module but NO dedicated `get_time` tool**; it uses the shell `date` command as the pull mechanism, and injects **date-only** into the cached system prompt.

**a) Timezone-aware clock helper** — `references/hermes-agent-main/hermes_time.py:122-133`
- `now()` returns a tz-aware datetime resolved from `HERMES_TIMEZONE` env → `config.yaml timezone` key → server local (`hermes_time.py:37-79`). Resolved once and cached (`hermes_time.py:96-107`) explicitly because it "used to run inside the FIRST system prompt build, on the time-to-first-token critical path" (`hermes_time.py:50-53`).

**b) Date-only in the system prompt, with an explicit cache rationale** — `references/hermes-agent-main/agent/system_prompt.py:502-517`
```
timestamp_line = f"Conversation started: {now.strftime('%A, %B %d, %Y')}"
```
The comment is the load-bearing evidence (`system_prompt.py:504-509`):
> "Date-only (not minute-precision) so the system prompt is byte-stable for the full day. Minute-precision changes invalidate prefix-cache KV on every rebuild path (compression boundary, fresh-agent gateway turns, session resume...). **The model can still query the exact wall-clock time via tools when it actually needs it.** Credit: @iamfoz (PR #20451)."
- The whole prompt is assembled once and cached on `agent._cached_system_prompt`, only rebuilt after compression, to "maximize prefix cache hits" (`system_prompt.py:526-539`). Layers are ordered stable→volatile; the date sits in the volatile tail (`system_prompt.py:479-517`).

**c) The pull mechanism = shell `date`, driven by prompt guidance** — `references/hermes-agent-main/agent/prompt_builder.py:414-422`
```
<act_dont_ask>
...
- 'What time is it?' → run `date` (don't guess)
```
Also in skills preprocessing, inline `!` + backtick `date +%Y-%m-%d` snippets are expanded (`agent/skill_preprocessing.py:17`). No tool named `get_time` exists (grep for `get_current_time|get_time|"time"` tool defs returned nothing under `tools/`).

**d) Per-message timestamps in the GATEWAY (channel) surface** — `references/hermes-agent-main/gateway/message_timestamps.py:1-6`
> "Gateway messages need timestamps in the LLM context for temporal awareness, but persisted message content should stay clean so replay does not accumulate `[timestamp] [timestamp] ...` prefixes across turns."
- Format: `[Tue 2026-04-28 13:40:53 CEST]` (`message_timestamps.py:15-21`), rendered exactly once, stripped from storage. So Hermes DOES timestamp inbound messages — but only on the gateway (Telegram/Signal-style) path, not in the base agent loop.

**e) Compaction re-anchors time** — `references/hermes-agent-main/agent/context_compressor.py:2093-2139`
- The summarizer prompt is handed the current date and a "TEMPORAL ANCHORING" rule that rewrites pending-sounding actions into "dated, past-tense facts" ("Sent the proposal email to John on {date}") so a resumed conversation does not re-issue completed actions. Date-only, and explicitly noted as a mid-conversation (non-cached) message so it "never affects prompt-cache stability" (`context_compressor.py:2094-2098`).

**f) Cron/scheduler uses `hermes_time.now()`** for wall-clock scheduling intent (`cron/scheduler.py:46`, `cron/jobs.py:643-649` — DST-aware "local wall-clock intent"), but this is scheduling machinery, not prompt content.

**g) DIRECT evidence against pull-only — Hermes moved to hybrid.** External: `https://github.com/NousResearch/hermes-agent/pull/40881` (2026-06-07, "feat: inject current wall-clock time on every API turn"):
> "Long-running gateway sessions span multiple days but the system prompt timestamp ('Conversation started: Wednesday, June 03, 2026') is frozen at session creation time. After a day boundary, the agent loses temporal awareness — **says 'good morning' at 3 PM, gets the weekday wrong, and drifts hours off without realizing it.**"
> Fix: add `Current wall-clock time: Sunday, June 07, 2026 08:25 +0800` to the **ephemeral** system-prompt block on every API turn — "Rebuilt on every API request (always fresh), Never persisted to the session DB, Appended *after* the cached system prompt prefix (KV cache stays warm)."

> **CAVEAT (verify at 立项):** the LOCAL checkout is PRE-#40881. Grep for `Current wall-clock`/`wall-clock time:` finds nothing in `agent/`; the local `ephemeral_system_prompt` (`agent/agent_init.py:411`, `agent/conversation_loop.py:559-560,899-900`) is an operator-supplied prompt appended after the cached prefix, NOT an auto-injected clock line. So the local tree = "date-only cached + `date` shell pull"; the upstream PR = "date-only cached + per-turn wall-clock in the append-after-cache slot." The two together are the clearest single-project push-vs-pull data point we have: they tried pull-only-ish and added push.

### 2. OpenClaw — heartbeat/cron + system prompt time handling

OpenClaw uses **timezone-only in the system prompt (no live clock, for cache stability), a `session_status` tool as the pull, and per-message envelope timestamps.**

- **System prompt**: a "Current Date & Time" block with **the time zone only, no clock value** — `https://docs.openclaw.ai/concepts/timezone`:
  > "System prompt — A small `Current Date & Time` block with the time zone only (no clock value, for cache stability)... The system prompt deliberately omits the live clock to keep prompt caching stable across turns. **When the agent needs the current time, it calls `session_status`.**"
  Confirmed on the system-prompt page: "To keep the prompt cache-stable, it now only includes the time zone (no dynamic clock or time format). Use `session_status` when the agent needs the current time; the status card includes a timestamp line." (`https://openclaw-ai.com/en/docs/concepts/system-prompt/`).
- **Per-message envelopes carry timestamps**: `[Signal +1555 Sun 2026-01-18 00:19:42 PST] hello`; tool payloads always carry `timestampMs`/`timestampUtc` (`https://docs.openclaw.ai/concepts/timezone`). So OpenClaw *does* push per-message time — but on the channel envelope, outside the cached prefix.
- **Heartbeat** (`https://docs.openclaw.ai/gateway/heartbeat`): periodic main-session turns (default `30m`, `1h` on Anthropic OAuth). Default prompt sent verbatim: "Read HEARTBEAT.md if it exists... If nothing needs attention, reply HEARTBEAT_OK." `activeHours` are evaluated in the configured timezone (agent isn't told the clock in the prompt; the *scheduler* gates on time). A `## Heartbeats` system-prompt section is injected only when heartbeats are enabled.
- **Cron** (`https://docs.openclaw.ai/automation/cron-jobs`): precise scheduling; one-shot `--at`, `--every`, cron expr with `--tz`. Main-session cron enqueues a `System:` event line consumed on the next heartbeat. This is the model OpenClaw uses instead of per-message injection for "wake me at time T".

### 3. Claude Code / Anthropic practice — day-granularity date + caching economics

- **Claude Code injects day-granularity date** into the environment block: `Today's date: ${TODAY_DATE}` (`https://github.com/tallesborges/agentic-system-prompts/blob/main/agents/claude-code/system-prompt.md`; leak also shows `## currentDate\nToday's date is 2026-02-20.` at `https://github.com/asgeirtj/system_prompts_leaks/blob/0bc4c25f/Anthropic/claude-code.md`).
- **The pull-only gap is heavily documented as a real defect**:
  - `https://github.com/anthropics/claude-code/issues/50499` — "models often operate without knowing the current date"; proposes structured datetime injection at session start AND **re-injection at every compaction boundary** and on `--continue`/`--resume` (which carry the stale original date). Real-world case: stale multi-day sessions report a 3–5-day-old file as "today's post" ~every other time-sensitive question.
  - `https://github.com/anthropics/claude-code/issues/30062`, `#24182`, `#34530`, `#55793` — all report: can't tell morning from evening, "good morning" at 4 PM, wrong weekday, can't estimate elapsed time; `date` exists but "Claude doesn't do this proactively" (this is the pull-only failure stated plainly).
  - Community fixes inject time via `SessionStart`/`UserPromptSubmit` hooks: `cast-time` injects `Date/Time/Timezone/Time-of-day bucket` once per session (`https://github.com/ek33450505/cast-time`, `https://dev.to/edwardkubiak/claude-is-blind-to-time-heres-the-fix-anthropic-didnt-ship-5eom`). Note: SessionStart-only drifts on long sessions → the docs themselves recommend *also* running `date` for precision → hybrid.
- **Prompt-caching economics (the cost of pushing fine-grained time)** — the "pull" side of the tradeoff is defended by cache math:
  - Cache is an **exact-prefix byte match**; one changed byte anywhere in the prefix invalidates everything after it (`https://platform.claude.com/docs/en/build-with-claude/prompt-caching`; `https://github.com/anthropics/skills/blob/main/skills/claude-api/shared/prompt-caching.md`).
  - Render order is `tools → system → messages`; a change at level N invalidates N and everything below (`prompt-caching.md`, docs "What invalidates the cache" table).
  - **A `datetime.now()` in the system prompt is the canonical anti-pattern** — it makes every request a cache miss AND pays the ~1.25× write premium each turn (worse than no caching): "Request 2: the timestamp differs, so the prefix hash differs... No cache hit. You pay for a fresh cache write on every request and never get a read" (`platform.claude.com/.../prompt-caching`). Independent write-ups: `https://www.basedash.com/blog/how-a-timestamp-was-busting-our-prompt-cache` (moved the date out of system into a per-turn `<current_date_utc>` message), `https://tanayshah.dev/blog/anthropic-prompt-cache-production-patterns/` (or **quantize the timestamp to the cache TTL granularity** so it changes once per 5 min), `https://hexisteme.github.io/notes/nondeterministic-system-prompt-voids-llm-cache.html`, `https://alatirok.com/prompt-caching-agents-breakpoints/`.
  - Classification rule (all sources agree): never-changes → early/before breakpoint; per-session → after global prefix; **per-turn/per-request (timestamps, IDs) → dead last, after the last breakpoint** — "a fact injected at turn 5 invalidates nothing before turn 5" (`prompt-caching.md`).
  - Anthropic-specific mitigation now exists: mid-conversation `{"role":"system"}` messages (Opus 4.8 / Fable 5 / Mythos 5) let you add fresh system context without invalidating the cached prefix (`platform.claude.com/.../prompt-caching`, "Mid-conversation system messages").

### 4. Other majors

- **ChatGPT** puts BOTH cutoff and current date in the system prompt, plus an explicit relative-time directive — `https://github.com/asgeirtj/system_prompts_leaks/blob/main/OpenAI/gpt-5.4-thinking.md` (and o4-mini, gpt-5.2/5.3):
  > `Knowledge cutoff: 2025-08` / `Current date: 2026-04-14` ... "Very important: The user's timezone is X. The current date is <date>. Any dates before this are in the past... if the user references relative dates like 'today/tomorrow/yesterday'... use absolute/exact dates."
  Granularity is **day** (+ timezone name), not seconds. It anchors relative-time reasoning without a live clock.
- **Letta / MemGPT** — memory metadata block injects current time AND memory ages, and recall is time-labeled:
  - `https://github.com/letta-ai/letta/blob/main/letta/prompts/prompt_generator.py` — `compile_memory_metadata_block` emits `<memory_metadata>` with `- The current system date is: {get_local_time_fast(timezone)}`, `- Memory blocks were last modified: {timestamp}`, and counts of recall/archival memories ("use tools to access them"). This block is recompiled (mid-context), not a frozen prefix.
  - **Heartbeat** is core MemGPT: "your brain is run at regular intervals (timed heartbeat events)... you can also request heartbeat events when you run functions" (`https://github.com/letta-ai/letta/blob/main/letta/prompts/system_prompts/memgpt_v2_chat.py`, `https://github.com/cpacker/MemGPT/blob/.../memgpt_chat.txt`). Note Letta V1 **deprecated heartbeats** in favor of native reasoning + explicit `letta cron` for future actions (`https://www.letta.com/blog/letta-v1-agent/`, `https://github.com/letta-ai/letta-code/blob/.../src/agent/prompts/letta.md` — "To act across time, you must create future invocations explicitly... use `letta cron`. Do NOT ever commit to future actions without creating a cron").
  - Relative-time rendering ("3 days ago") in recall: Letta labels stored messages with timestamps; the "X previous messages... stored in recall memory" metadata is the retrieval hook. (Absolute timestamps, not "N days ago" strings, in the code sampled.)

### 5. PUSH vs PULL — synthesized with citations

**Documented pull-only failure mode** (agent doesn't realize it doesn't know the time, so never fetches):
- Hermes PR #40881: pull-only-ish froze at session start → "good morning at 3 PM, wrong weekday, drifts hours" → they added push.
- Claude Code issues #30062 / #24182 / #34530 / #50499: `date` is available but "Claude doesn't do this proactively"; wrong greetings, wrong session-continuity assumptions; the ask is *ambient* awareness, not a tool.
- The structural reason: nothing in a pull-only design *prompts the check*. Time-conditioned behavior (greeting, "has this deadline passed", "user was away 8h") never triggers because the model has no signal that time has advanced. This is exactly the "unknown unknown" — you can't decide to call a tool for a fact you don't know you're missing.

**Documented push cost** (why nobody pushes a live clock into the cached prefix):
- Fine-grained timestamp in the system prefix = guaranteed cache miss every turn + write-premium (§3 sources). This is why every system that DOES push time puts it **outside the cached prefix**: OpenClaw envelope, Hermes ephemeral append-after-cache block, Letta recompiled metadata block, ChatGPT day-granularity only.

**Hybrid shapes actually shipped (all cited above):**
- **A — Cached day-date + pull tool for precision.** Claude Code, ChatGPT, local Hermes. Cheapest; enough for date reasoning; loses time-of-day and drifts on long/compacted sessions (the exact complaints in §3).
- **B — Cached day-date (or tz-only) + per-turn/per-message time push in a non-cached slot + pull tool.** OpenClaw (tz-only prefix + envelope timestamps + `session_status`), Hermes-after-#40881 (day-date prefix + wall-clock ephemeral line + `date`). Best coverage of the "good morning" class of bug; the per-turn line is cheap because it sits after the breakpoint.
- **C — Push time only at boundaries.** Re-inject datetime at session start, at each compaction boundary, and on resume (Claude Code #50499 proposal; Hermes compaction temporal-anchoring `context_compressor.py:2093-2139`). Complements A/B; cheap; directly fixes the stale-after-compaction bug.
- **Quantization trick** (`tanayshah.dev`): if you must keep time in a cached position, round it to the cache TTL (e.g. 5-min buckets) so it only invalidates once per bucket.

---

## §6 Recommendations for OUR stack (sourced, ranked)

Our current state (grounding):
- `packages/core/src/agents/chat-agent.ts:246-258` — `composeInstructions` is rebuilt **every turn** = `BASE_SYSTEM_PROMPT` + assembled memory + skills. No date/time anywhere.
- `packages/core/src/memory/assembler.ts:46,76-78` — assembler computes `now` but only for active/expiry filtering; `renderBlock` renders memory as `- ${content}` with **no createdAt/age**.
- `packages/core/src/agents/conversation-store.ts:14` — `REPLAY_WINDOW = 200` messages replayed as multi-part ModelMessages; entries carry `createdAt` (`db/timeline-repo.ts:78,126`) but it's never rendered.
- DeepSeek-class providers use **automatic prefix caching** (disk KV cache keyed on the request prefix) — so the exact-prefix-match economics of §3 DO apply to us even though we assemble per turn: a per-second timestamp at the FRONT of instructions would kill DeepSeek cache reuse across turns. (This is why the ranking mirrors what the majors chose; provider caching semantics per §3 sources.)

**Rank 1 — Shape B (hybrid: cached day-date + per-turn time in a non-cached position + a `get_current_time` tool).** Strongest evidence backing (OpenClaw + Hermes-after-#40881 both converged here after rejecting the alternatives).
- Injection points: (i) **day-granularity date** as the LAST line of the stable `BASE_SYSTEM_PROMPT`/persona region so the cache prefix is byte-stable per day; (ii) **`Current time: <HH:MM tz, weekday>`** appended to the very end of the assembled instructions OR as the first line of the per-turn user message — after any stable/cacheable prefix — so it refreshes each turn without invalidating the DeepSeek prefix cache (mirrors Hermes ephemeral append-after-cache, `PR #40881`; basedash "move the date into the per-turn context message").
- Granularity: date = day; time = minute (+ IANA tz + weekday). Never seconds in any cached position.
- Cache impact: near-zero — the volatile line is after the stable prefix (§3 classification rule).
- Tool: define `get-current-time` (returns ISO + tz + weekday) as the precision path, per our one-tool-per-file convention (`x-tool.ts` → `xTool`). Keep it even with push (Claude Code docs recommend both — push for ambient awareness, tool for exact scheduling).
- Memory-age rendering: render retrieved/pinned memory as `- (3 days ago) ${content}` computed from `createdAt` vs now (Letta labels ages; our `assembler.ts` already has `now` and `createdAt` in hand — cheap). Use relative for recent, absolute date past ~7d.
- T4 heartbeat/cron: heartbeat turns MUST inject the current wall-clock time + weekday in the (non-cached) turn payload — the heartbeat's whole purpose is time-conditioned action, and OpenClaw/MemGPT both make the scheduler, not the model's memory, the time authority. Cron "wake" events carry their fire-time as a system line (OpenClaw pattern).

**Rank 2 — Shape A (cached day-date + `get-current-time` tool only) = the owner's pull-only hypothesis, judged honestly.**
- Honest verdict: **viable as a v0 but under-powered as the target**, and the evidence is against it as an endpoint. The day-date in the prompt is NOT "pull-only" — it's already a small push, and it's the part that carries most of the value (date reasoning, "latest" caution — ChatGPT/Claude Code prove day-date alone is worth shipping). The *pure* pull half (agent calls the tool when it needs time) has a specific, repeatedly-documented failure: the agent doesn't call it for time-of-day-conditioned behavior because nothing tells it time moved (Hermes #40881; Claude Code #30062/#24182 — `date` exists, model "doesn't do this proactively"). For a **desktop companion** whose entire charm is time-appropriate greetings and "you've been away a while," this failure mode hits the core product, not an edge case. Recommendation: ship A as step 1 (date line + tool), but plan B's per-turn time line before any time-conditioned persona behavior or T4 heartbeat lands.
- Cost side is genuinely in A's favor (zero cache churn), which is why A survives as the floor.

**Rank 3 — Boundary-only push (Shape C) as a complement, not a standalone.**
- Re-stamp time into (i) the compaction/summary record and (ii) any session-resume/first-post-gap turn (Claude Code #50499; Hermes `context_compressor.py`). We already have a compaction/flush path (`memory/auto-memory.ts`, `flush-writer`); adding a dated temporal-anchor line there is cheap and kills the stale-after-compaction bug. Do this regardless of A vs B.

**Explicit non-recommendation:** do NOT put minute/second time in `BASE_SYSTEM_PROMPT` or anywhere in the stable prefix — it breaks DeepSeek prefix caching every turn for no benefit over the append-after-prefix placement (§3, unanimous).

---

## §OMITTED (unsourced — do not cite)

- Exact DeepSeek context-caching TTL / minimum-prefix numbers and whether DeepSeek keys the cache identically to Anthropic — not verified against DeepSeek docs in this pass; §3 caching mechanics are Anthropic/OpenAI-sourced and applied by analogy. Verify DeepSeek's caching doc at 立项.
- Whether Hermes PR #40881 is actually merged into `main` (only the PR page was read; the local checkout does not contain it).
- Whether Letta renders literal "N days ago" strings anywhere (sampled code shows absolute timestamps; the relative-rendering claim for Letta is inferred, not seen).
- Any quantitative token/latency delta for our specific prompt sizes — not measured.
- Our exact BASE_SYSTEM_PROMPT contents / whether persona region is today byte-stable across turns (would need to read `base-prompt.ts` + persona provider to confirm the cache-prefix assumption).
