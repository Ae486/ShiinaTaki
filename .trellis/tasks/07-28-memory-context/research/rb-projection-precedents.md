# Research: Projection precedents — volatile-context placement, eager folding, naming

- **Query**: verify how professional agent systems handle three context-shape questions; judge leader proposals P1/P2/P3 adversarially
- **Scope**: mixed (local surveys first, then external docs/source)
- **Date**: 2026-07-28
- **Method**: local surveys read in full before any web call; web via exa only. Every load-bearing claim carries a URL or `file:line`. Unverifiable claims are in §OMITTED.

---

## §0 — What the local surveys already answered (cited, not re-researched)

`.trellis/workspace/pleia/t5-context-management-survey.md`:

| Sub-q | Already answered | Where |
| --- | --- | --- |
| B | Claude Code's four tool-result paths incl. **time-based microcompact** and `cache_edits` microcompact | `:57-72` |
| B | OpenClaw cache-TTL pruning: TTL gate → size gate → soft-trim → hard-clear; **"tool results containing image blocks are skipped entirely"** | `:144-168` |
| B | Hermes `_prune_old_tool_results` (dedupe / summarize / arg-truncate), runs inside `compress()` | `:260-281` |
| B | Anthropic API defaults: `clear_tool_uses` trigger 100K / keep 3; `compact_20260112` trigger 150K | `:121-122` |
| B | Sub-question D verdict: **only Claude Code addresses stale data, and at the tool layer** (`readFileState` + mtime guard), not the context layer | `:98-107`, `:652-654` |
| C | ADR-0005-equivalent separation is mainstream: OpenClaw "full history stays on disk, compaction only changes what the model sees"; Agents SDK `session_input_callback` persists only new-turn items | `:31`, `:374` |
| C | AI SDK v7 seam = `prepareStep` + `pruneMessages`; `pruneMessages` **removes the call with the result** (no blank-the-payload mode) | `:435-516` |

`.trellis/workspace/pleia/time-awareness-survey.md`:

| Sub-q | Already answered | Where |
| --- | --- | --- |
| A | Hermes date-in-cached-prefix incident + PR #40881 fix (ephemeral wall-clock line appended after the cached prefix) | `:56-60` |
| A | Hermes gateway `message_timestamps.py:1-6` — per-message timestamp rendered once, **stripped from storage** so replay never accumulates | `:47-49` |
| A | OpenClaw: system prompt carries **timezone only, no clock value, "for cache stability"**; envelope timestamps `[Signal +1555 Sun 2026-01-18 00:19:42 PST]`; `session_status` is the pull | `:66-69` |
| A | Anthropic cache mechanics: exact-prefix byte match; render order `tools → system → messages`; change at level N invalidates N and below; per-turn facts belong "dead last, after the last breakpoint" | `:81-85` |
| A | `datetime.now()` in the system prompt = canonical anti-pattern; basedash moved the date out of system into a per-turn message | `:83` |
| A | Our own state: DeepSeek-class automatic prefix caching applies to us | `:121` |

What the local surveys did **not** answer, and what this bank adds: Claude Code's `<env>` / `<system-reminder>` channel mechanics; Codex CLI's `<environment_context>` placement and persistence choice; OpenAI/DeepSeek first-party cache guidance text; whether any system folds **eagerly, independent of pressure** (it does — OpenClaw's replay view, which the earlier survey missed); and the naming survey.

---

## §A — Volatile-context placement across real systems

### A1. Claude Code — dynamic content rides the MESSAGE channel, never the system prompt

The system prompt is byte-identical across all users on a version, because Anthropic shares one cached prefix globally:

> "The system prompt is the same for every Claude Code user on the same version. That's what makes the shared prompt cache work — all users share the same cached prefix... If your CLAUDE.md went into the system prompt, every user with a different CLAUDE.md would need a separate cache. The economics of the product would break."
> — <https://www.claudecodecamp.com/p/inside-claude-code-s-system-prompt>

So per-user and per-turn content goes into `messages`:

- **Injection point**: `prependUserContext()` in `src/utils/api.ts` (lines 449-474) prepends a `<system-reminder>`-wrapped `isMeta` user message containing CLAUDE.md + `# currentDate\nToday's date is <date>.` — <https://claude-wiki.com/system-prompt-assembly.html>
- **The date is memoized once at session start**, not re-rendered per turn: the placement table lists `CLAUDE.md + date | messages[0] | Never — memoized once at session start` — <https://github.com/Windy3f3f3f3f/how-claude-code-works/blob/main/en/docs/03-context-engineering.md>
- **Truly per-turn reminders** (TodoWrite nudge, agent-roster changes, empty-file warnings, mid-execution side questions, and **memory staleness annotations — "this memory was written N days ago"**) are injected as attachment messages or appended into tool results, *at the point of relevance* — <https://www.shloked.com/writing/claude-code-source-patterns>, <https://rastrigin.systems/blog/claude-code-part-2-system-prompt/>
- **Explicit design trade-off recorded**: "System reminders in user messages | Preserves prompt cache, but inflates every turn's input tokens" — claude-wiki.com
- **Turn-boundary hygiene**: `smooshSystemReminderSiblings` merges adjacent system-reminder text blocks into the neighbouring `tool_result` so injection never creates an extra Human/Assistant turn boundary — Windy3f3f3f3f doc
- **Cost of the channel**: the system prompt must carry a line teaching the model what the tag means — *"Tool results and user messages may include `<system-reminder>` tags... They are automatically added by the system, and bear no direct relation to the specific tool results or user messages in which they appear."* — rastrigin.systems. Letta ships the same line: *"Tool results and user messages may include `<system-reminder>` tags. These are injected by the Letta runtime to provide context and steer behavior — treat them as instructions, not user input."* (<https://github.com/letta-ai/letta-code/blob/e902ed95/src/agent/prompts/letta.md>)

**`<env>` block**: system-prompt-resident but frozen — *"Block 2 is mostly static, but Claude Code splices in a snapshot at conversation start (working directory, OS, git status). Runtime nudges come later via `<system-reminder>` in messages."* — rastrigin.systems. (Same page's summary table lists "Environment info (git status, branch, OS)" under *Dynamic*; the prose is the more specific claim. Flagged as a minor internal disagreement.)

### A2. Codex CLI — `<environment_context>` is a `role=user` message, appended never rewritten

OpenAI's own account of the loop:

> "A message with `role=user` that describes the local environment in which the agent is currently operating... `<environment_context><cwd>/Users/mbolin/code/codex5</cwd><shell>zsh</shell></environment_context>`"
> "When possible, we handle configuration changes that happen mid-conversation by **appending a new message to `input`** to reflect the change rather than modifying an earlier message... If the current working directory changes, we insert a new `role=user` message with the same format as the original `<environment_context>`."
> — <https://openai.com/index/unrolling-the-codex-agent-loop/>

The struct carries exactly our class of volatile data — `cwd`, `shell`, **`current_date`**, **`timezone`**, `network`, `subagents` (<https://github.com/openai/codex/blob/d807d44a/codex-rs/core/src/environment_context.rs>), and the update path emits **nothing when nothing changed**:

```rust
if prev_context.equals_except_shell(&next_context) { return None; }
Some(ContextualUserFragment::into(EnvironmentContext::diff_from_turn_context_item(prev, &next_context)))
```
— <https://github.com/openai/codex/blob/178c3d30/codex-rs/core/src/context_manager/updates.rs>

**Counter-evidence to P1's "never persisted"**: Codex moved these messages *from* request-time injection *into* persisted conversation history, deliberately:

> "Currently, we use request-time logic to determine the user_instructions and environment_context messages. This means that neither of these values can change over time as conversations go on... we're migrating these to save these messages to the rollout file instead. This is simpler for the client, and allows us to append additional environment_context messages to each turn if we want."
> "Tested locally with a few turns, confirmed model could reference environment context and cached token metrics were reasonably high."
> — <https://github.com/openai/codex/pull/2243>

Both properties hold together because the message is *appended and then never touched* — a persisted append is as cache-stable as an ephemeral tail line, and it additionally gives the model a time-series it can reason over.

### A3. Hermes — chose the SYSTEM-PROMPT tail, not the message tail

PR #40881 appends the wall-clock line to an **ephemeral system-prompt block**: *"Rebuilt on every API request (always fresh), Never persisted to the session DB, Appended after the cached system prompt prefix (KV cache stays warm)"* (time-awareness-survey `:56-60`).

This is a genuine data point against P1's *specific* placement — but it is **not transferable to our wire**. It works only because Anthropic caching is breakpoint-based (`cache_control` marks where the cached prefix ends), so "after the cached prefix" is a real position. Under OpenAI/DeepSeek **automatic** prefix caching there is no breakpoint: the match runs from token 0 and the system message is `messages[0]`, so "system-prompt tail" sits *before the entire history*.

Hermes' other half supports P1 exactly: the gateway path puts timestamps in the message and strips them before storage — *"persisted message content should stay clean so replay does not accumulate `[timestamp] [timestamp] ...` prefixes across turns"* (`gateway/message_timestamps.py:1-6`, via time-awareness-survey `:47-49`).

### A4. Provider cache guidance — do the docs say static-first / dynamic-last?

**OpenAI — yes, verbatim:**
> "Cache hits are only possible for exact prefix matches within a prompt. To realize caching benefits, place static content like instructions and examples at the beginning of your prompt, and put variable content, such as user-specific information, at the end."
> — <https://developers.openai.com/api/docs/guides/prompt-caching>

> "Move volatile content (e.g., user input, dynamic values, session-specific data) to the end. Even small changes in early tokens will invalidate exact prefix matching and prevent cache hits."
> Causes of lower caching include: "Adding in a space, timestamp or other dynamic content."
> "**Tip: Use metadata** — We've seen customers accidentally invalidate their cache by including a timestamp early in their request for later lookup/debugging. Move that to `metadata` where it will not impact the cache!"
> — <https://developers.openai.com/cookbook/examples/prompt_caching_201>

The same cookbook cites Codex as the reference implementation: *"system instructions, tool definitions, sandbox configuration, and environment context are kept identical and consistently ordered between requests... The agent loop appends new messages (rather than modifying earlier ones) when runtime configurations change mid-conversation."*

**DeepSeek — mechanism is official; the "dynamic last" phrasing is third-party.** Official (<https://api-docs.deepseek.com/guides/kv_cache/>): enabled by default, prefix-only matching, cache prefix units persisted at request boundaries / detected common prefixes / fixed token intervals, **64-token storage unit**, best-effort, cleared "within a few hours to a few days", `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` in `usage`. The official page states the constraint (*"only the repeated **prefix** part can trigger a cache hit"*) but does not itself phrase a static-first rule; that phrasing comes from third-party guides (<https://deepseekai.guide/api/deepseek-api-context-caching/>, <https://deepseek-usa.ai/docs/deepseek-context-caching/>) — sourced but not first-party.

**Anthropic** — already sourced in the local survey: render order `tools → system → messages`, change at level N invalidates N and everything below, per-turn facts belong after the last breakpoint (time-awareness-survey `:81-85`).

### A5. The decisive arithmetic for our wire

Current placement is `packages/core/src/agents/chat-agent.ts:250-269`: `[BASE_SYSTEM_PROMPT, dayDate, assembledMemory, skillsExtra, renderCurrentTime(now)]` joined into one system string. The header comment justifies the tail placement with the "stable-early / volatile-late" rule.

On a breakpoint-less prefix cache the system string is `messages[0]`. Everything after it — **the entire replayed history, up to 200 messages** — is suffix. A minute-granularity line at the system-prompt tail therefore invalidates the prefix at roughly token *N_system*, forcing recomputation of the whole history on every turn. With R6 removing the retrieved-memories block, the *only* remaining reason the system prompt varies per turn is that volatile set; moving it out makes the system prompt byte-stable within a calendar day and pushes the invalidation point from `|system|` to `|system| + |history|`.

---

## §B — Eager handling of stale state-snapshot tool results

The question is PRESSURE-triggered vs AGE/CLASS-triggered. Both exist. The mechanisms sort cleanly:

| Mechanism | Trigger class | Eager? | Stated rationale |
| --- | --- | --- | --- |
| Anthropic `clear_tool_uses_20250919` | **Pressure** (`trigger` = input_tokens, default 100K; or `tool_uses` count) | No | context size |
| Anthropic `compact_20260112` | **Pressure** (default 150K, server min 50K) | No | context size |
| OpenClaw cache-TTL pruning | TTL gate **then** pressure (`softTrimRatio` 0.30 / `hardClearRatio` 0.50) | No | cache economics + size |
| Hermes `_prune_old_tool_results` | **Pressure** (runs inside `compress()`) | No | context size |
| Claude Code time-based microcompact | **Age** (gap since last assistant msg > `gapThresholdMinutes`) | Semi | **cache already dead** |
| Anthropic computer-use demo `_maybe_filter_to_n_most_recent_images` | **Class** (images), count-window | **Yes** | image token cost — *disabled when caching is on* |
| **OpenClaw idempotent replay view** | **Class + age** (image/media blocks older than the 3 most recent completed turns) | **Yes, explicitly separate from pressure pruning** | stop stale payloads **busting prompt caches** |

### B1. Anthropic's first-party context editing is pressure-gated, and warns about exactly P2's cost

<https://platform.claude.com/docs/en/build-with-claude/context-editing>:

| Option | Default | Meaning |
| --- | --- | --- |
| `trigger` | 100,000 input tokens | "Once the prompt exceeds this threshold, clearing will begin." |
| `keep` | 3 tool uses | oldest cleared first, most recent preserved |
| `clear_at_least` | none | "Ensures a minimum number of tokens is cleared each time... **This helps determine if context clearing is worth breaking your prompt cache.**" |
| `exclude_tools` | none | never cleared |
| `clear_tool_inputs` | `false` | keeps the tool call visible; only the result is cleared |

> "**Tool result clearing**: Invalidates cached prompt prefixes when content is cleared. To account for this, clear enough tokens to make the cache invalidation worthwhile... You'll incur cache write costs each time content is cleared."

There is **no age-based or class-based option** in the API surface. `clear_at_least` exists *because* a small clear is a net loss.

### B2. The one age-triggered fold in production fires only when the cache is already cold

Claude Code's `timeBasedMCConfig.ts` header, verbatim from two independent mirrors (<https://github.com/leaf-kit/claude-analysis/blob/main/src/services/compact/timeBasedMCConfig.ts>, <https://github.com/antonoly/claude-code-anymodel/blob/main/services/compact/timeBasedMCConfig.ts>):

> "Triggers content-clearing microcompact when the gap since the last main-loop assistant message exceeds a threshold — **the server-side prompt cache has almost certainly expired, so the full prefix will be rewritten anyway.** Clearing old tool results before the request shrinks what gets rewritten."
> `gapThresholdMinutes: 60` — "60 is the safe choice: the server's 1h cache TTL is guaranteed expired for all users, **so we never force a miss that wouldn't have happened.**"
> Defaults: `{ enabled: false, gapThresholdMinutes: 60, keepRecent: 5 }`

And the mutual-exclusion comment in `microCompact.ts` (<https://github.com/claude-code-best/claude-code/blob/632f3e19/src/services/compact/microCompact.ts>):

> "Cached MC (cache-editing) is skipped when this fires: **editing assumes a warm cache, and we just established it's cold.**"

The warm-cache counterpart deletes results **server-side via `cache_edits`** without touching local message content — Anthropic built a dedicated API specifically to avoid the prefix invalidation a naive in-place fold causes. We have no equivalent on an OpenAI-compatible wire.

Observed GrowthBook values across multiple independent machines: `tengu_slate_heron: {"enabled": false, "gapThresholdMinutes": 60, "keepRecent": 5}` — <https://github.com/anthropics/claude-code/issues/42542>. It is a gated rollout, not default behaviour.

### B3. The eager class-based fold exists — and Anthropic turns it off when caching is on

`computer-use-demo/computer_use_demo/loop.py` (<https://github.com/anthropics/claude-quickstarts/blob/main/computer-use-demo/computer_use_demo/loop.py>):

```python
def _maybe_filter_to_n_most_recent_images(messages, images_to_keep, min_removal_threshold):
    """
    With the assumption that images are screenshots that are of diminishing value as
    the conversation progresses, remove all but the final `images_to_keep` tool_result
    images in place, with a chunk of min_removal_threshold to reduce the amount we
    break the implicit prompt cache.
    """
```

That is P2's exact hypothesis ("state snapshots decay; keep the latest"). But:

```python
if enable_prompt_caching:
    betas.append(PROMPT_CACHING_BETA_FLAG)
    _inject_prompt_caching(messages)
    # Because cached reads are 10% of the price, we don't think it's
    # ever sensible to break the cache by truncating images
    only_n_most_recent_images = 0
```

Anthropic's own reference implementation **disables the eager class fold whenever prompt caching is enabled**, on explicit cost grounds. The `min_removal_threshold` chunking exists solely to reduce cache breakage, and produces a known modulo bug where the filter silently no-ops (<https://github.com/anthropics/claude-quickstarts/issues/266>, <https://github.com/anthropics/claude-quickstarts/issues/118>).

### B4. The precedent that DOES match P2: OpenClaw's idempotent replay view

<https://docs.openclaw.ai/concepts/session-pruning>:

> "OpenClaw also builds a separate **idempotent replay view** for sessions that persist raw image blocks or prompt-hydration media markers in history.
> - It preserves the **3 most recent completed turns byte-for-byte** so prompt cache prefixes for recent follow-ups stay stable. This count includes all completed turns, not just image-bearing ones, so text-only turns consume the window too.
> - In the replay view, older already-processed image blocks from `user` or `toolResult` history are replaced with `[image data removed - already processed by model]`.
> - Older textual media references such as `[media attached: ...]`, `[Image: source: ...]`, and `media://inbound/...` are replaced with `[media reference removed - already processed by model]`. **Current-turn attachment markers stay intact** so vision models can still hydrate fresh images.
> - **The raw session transcript is not rewritten**, so history viewers can still render the original message entries and their images.
> - **This is separate from normal cache-TTL pruning above.** It exists to stop repeated image payloads or stale media refs from busting prompt caches on later turns."

Implementation and history: `pruneProcessedHistoryImages()` in `src/agents/pi-embedded-runner/run/history-image-prune.ts`, called from `run/attempt.ts` before image loading and before the compaction precheck; shipped in `2026.2.26`, extended from `user` to `toolResult` messages in `2026.4.22` / PR #43045 — <https://github.com/openclaw/openclaw/issues/39573>, <https://github.com/openclaw/openclaw/issues/41789>, <https://github.com/openclaw/openclaw/pull/43045>.

Every design property that differs from P2 is deliberate:
- fold boundary **lags the tail by 3 completed turns**, not 1 item — so the mutation never lands in the cache-hot region;
- the fold is **idempotent** — re-running it produces identical bytes, so the folded prefix converges and stops churning;
- the folded class is **already-processed payloads** (images/media the model has described), not "state snapshots" as a semantic category;
- the stated goal is **cache preservation**, not correctness.

The earlier local survey recorded OpenClaw as skipping images entirely (`t5-context-management-survey.md:164`) — that is now stale; the skip was a reported bug (#41789, #15045) fixed in `v2026.4.22`.

### B5. Nobody folds for correctness

Across all seven mechanisms, no stated rationale is "the old value is wrong". The surveyed correctness patterns are:

1. **Annotate, don't remove.** Claude Code stamps each loaded memory file with "this memory was written N days ago" (shloked.com). Hermes labels compacted asks *"These are STALE — the agent must NOT act on them unless the latest user message explicitly requests it"* (t5 survey `:327`) and injects a TEMPORAL ANCHORING rule rewriting completed actions into dated past-tense facts (`:316`).
2. **Guard at the tool layer.** Claude Code's `readFileState` + mtime/content check refuses a write against a stale read (t5 survey `:98-107`).

Both cost zero cache: they add text at injection time or at the tool boundary, they never rewrite history.

One more consideration specific to us: our screenshots are **already VLM-described to text** before they reach the timeline (`packages/core/src/memory/image-description-writer.ts`, `packages/core/src/perception/`). The universal motivation for eager image folding — 1,600 tokens/image (Claude Code `IMAGE_TOKEN_ESTIMATE`, Hermes `_IMAGE_TOKEN_ESTIMATE`; OpenClaw `IMAGE_CHAR_ESTIMATE = 8,000` chars) — does not apply to a text describe of a few hundred tokens. The cache cost of the mutation is unchanged; the benefit is roughly an order of magnitude smaller.

---

## §C — Naming precedent for the stored-vs-view seam

| System | Term for the transform | Evidence |
| --- | --- | --- |
| **OpenClaw** | **"replay view"** (idempotent; "the raw session transcript is not rewritten"); pruning is "in-memory only — it does not modify the on-disk session transcript" | <https://docs.openclaw.ai/concepts/session-pruning> |
| LangGraph | two channels: `pre_model_hook` returns **`llm_input_messages`** (view only) vs `messages` + `RemoveMessage` (mutates checkpointed state) | <https://docs.langchain.com/oss/python/langgraph/add-memory>, <https://github.com/langchain-ai/langgraph/pull/4059> |
| OpenAI Agents SDK | `to_input_list()` = *"an **input-item view** of this run"*; merge seam `session_input_callback`; final seam `call_model_input_filter` → `ModelInputData` | <https://openai.github.io/openai-agents-python/results/>, <https://openai.github.io/openai-agents-python/running_agents/> |
| OpenAI Agents SDK (impl) | *"we still need to persist only the items that belong to the new turn"* — `prepare_input_with_session` | <https://github.com/openai/openai-agents-python/blob/fea17ef5/src/agents/run_internal/session_persistence.py> |
| Letta | transcript→context is **"compiled into the context window"** / "compiled kernel context"; "projection" is used, but for memory→MemFS (*"The MemFS is a git-backed **projection** of your memory"*) | <https://github.com/letta-ai/letta-code/blob/e902ed95/src/agent/prompts/letta.md>, <https://www.letta.com/blog/guide-to-context-engineering/> |
| Claude Code | no single noun; the step is `prependUserContext()` / `appendSystemContext()`, transcript file vs assembled request | <https://claude-wiki.com/system-prompt-assembly.html> |
| Codex | `ContextManager` renders a **diff of "World State"** into `ContextualUserFragment` items | <https://deepwiki.com/openai/codex/3.3-turn-execution-and-prompt-construction> |

**There is no authoritative industry term.** "View" is the most common word (OpenClaw, Agents SDK); "projection" has CQRS/database pedigree and is used by Letta for a *different* seam. OpenClaw's **"replay view"** is the only first-party name for the identical seam with the identical invariant, and it already rhymes with our `REPLAY_WINDOW` / `history()` vocabulary (`packages/core/src/agents/conversation-store.ts:14`).

The LangGraph JS bug `#1316` is worth noting as prior art on how this seam fails: returning the view channel without an override reducer made `llmInputMessages` accumulate (`[a] → [a,a,b] → [a,a,b,a,b,c] → ...`), silently defeating trimming — <https://github.com/langchain-ai/langgraphjs/issues/1316>. The fix was `reducer: (_, right) => right`. Any named seam needs "the view is recomputed, never accumulated" as an explicit property.

---

## Verdicts

### P1 (placement: volatile set → in-flight message tail, never persisted) — **CONFIRMED**

Direct precedent: Claude Code (all dynamic content in `messages` via `<system-reminder>`, explicitly to protect the shared system-prompt cache), Codex (`<environment_context>` as a `role=user` message, appended never rewritten), OpenClaw (envelope timestamps in the message; system prompt deliberately carries timezone-only). First-party provider guidance from OpenAI states the rule verbatim, including "move that timestamp to `metadata`". The claim that "volatile-late should mean late in the REQUEST, not late in the system prompt" is correct on our wire specifically, because breakpoint-less prefix caching (DeepSeek, OpenAI) makes the system string `messages[0]` — the current tail placement (`chat-agent.ts:250-269`) invalidates the entire replayed history, not "≈ 0".

**Strongest counter-evidence found:**
1. **Hermes chose the system-prompt tail, not the message tail** (PR #40881, "appended after the cached system prompt prefix"). Valid there, non-transferable here: it depends on an explicit `cache_control` breakpoint. Cost if we copied it anyway: full-history invalidation every turn.
2. **Codex deliberately PERSISTS its environment messages** rather than injecting ephemerally (PR #2243: moved *from* request-time logic *to* rollout storage, "allows us to append additional environment_context messages to each turn"). "Never persisted" is not the surveyed default — it is one of two viable shapes. The persisted-append variant is equally cache-stable (append-only, never rewritten) and additionally gives the model a readable time-series; its cost is unbounded growth of stamp messages. Hermes' gateway path (`message_timestamps.py`) and OpenClaw's replay view both back the ephemeral variant, so P1's choice is defensible — but it is a choice, and the ADR should say why, not assume.
3. **The message channel is not free.** It requires a base-prompt line teaching the model that injected blocks are system-added and not user speech (Claude Code and Letta both ship one — ours landed in `9f41646`), turn-boundary hygiene when injecting next to tool results (`smooshSystemReminderSiblings`), and a strip-before-persist rule or replay accumulates stamps (Hermes' stated reason). If the injected block ends up inside the persisted user message, P1's cache win is inverted.

### P2 (eager fold of old state-snapshot tool results, independent of compaction pressure) — **CONFIRMED as a mechanism, CONTRADICTED on two specifics**

The mechanism class is real and first-party: OpenClaw's **idempotent replay view** is exactly "an eager, class-based, age-based fold of already-processed payloads, explicitly separate from pressure-based pruning, with the stored transcript untouched." Anthropic's computer-use demo is a second instance for the image class. So "eager folding exists in the wild" is CONFIRMED and P2 is not inventing a category.

**Contradicted specifics:**

1. **"Only the latest per class keeps its payload" — contradicted by every precedent.** All of them keep a byte-stable recent *window*, and all of them say why it is a window: OpenClaw keeps **3 most recent completed turns byte-for-byte** *"so prompt cache prefixes for recent follow-ups stay stable"*; Claude Code `keepRecent: 5`; Anthropic API `keep: 3 tool uses`; computer-use `images_to_keep` with `min_removal_threshold` chunking *"to reduce the amount we break the implicit prompt cache"*. Keeping exactly one puts the mutation boundary at the tail: every new state snapshot demotes the previous one, rewriting bytes in the cache-hot region on the turn that mattered most. Cost: with ambient screenshot sampling, that is a prefix break per sampling interval. Alternative and its cost: a lagged window (fold everything older than the last N snapshots per class) costs N snapshots' worth of tokens and buys an idempotent, converging prefix. This also puts P2 in direct tension with P1 — P1's whole payoff is "the prefix cache covers system + entire history", and an unlagged P2 mutates that history every turn.

2. **"Stale state snapshots are wrong, not just big" — UNSOURCED as a motivation.** Not one of the seven surveyed mechanisms cites correctness. OpenClaw's is cache; Claude Code's time-based is cache; Anthropic's API is size; computer-use is image token cost. The surveyed answer to staleness is **annotate** (Claude Code memory-age stamps; Hermes' `Historical`-prefixed sections and TEMPORAL ANCHORING rule) or **guard at the tool layer** (Claude Code `readFileState` + mtime), never fold. Cost of the annotate alternative: near-zero cache impact (text added at injection time), no history mutation, but the old payload keeps costing tokens. Cost of the tool-layer alternative: doesn't apply to perception snapshots, which have no write-back path to guard.

3. **Weakened economics in our case specifically.** Every precedent's eager fold targets images at 1,600 tokens each (Claude Code / Hermes constants; OpenClaw's `IMAGE_CHAR_ESTIMATE = 8,000`). Our screenshots are already VLM-described to text before they reach the timeline, so the payload being folded is roughly an order of magnitude smaller while the cache cost of the mutation is identical. The class most worth folding by the surveyed logic — raw images — is the one we do not carry.

**Fact-class results folding only under pressure**: consistent with everything surveyed; no counter-evidence found.

### P3 (name the seam in an ADR: "Replay Projection") — **CONFIRMED as a seam, UNSOURCED as a term**

The seam is universal and every system enforces the same invariant (OpenClaw "the raw session transcript is not rewritten"; Agents SDK persists only new-turn items even when the callback rewrites history; LangGraph splits `llm_input_messages` from `messages`; our ADR 0005). No authoritative industry noun exists. The nearest first-party name for the identical seam is OpenClaw's **"replay view"**; "projection" is used by Letta for memory→MemFS, not for transcript→model input. Both halves of the proposed coinage have precedent, just not together — so the ADR should cite "replay view" as the prior art rather than present the name as standard. The one property worth importing verbatim from the precedents is **idempotence** (OpenClaw states it in the name; LangGraph JS `#1316` is the bug you get without it): the view is recomputed from storage each turn, never accumulated.

---

## §OMITTED — not sourced, do not cite as fact

- **Whether Claude Code's `<env>` block is truly frozen at session start.** rastrigin.systems' prose says snapshot-at-start; the same page's summary table lists environment info as Dynamic. Not resolved. The `# currentDate` line's session-start memoization *is* sourced (Windy3f3f3f3f placement table).
- **Whether OpenClaw's replay view runs on non-Anthropic providers.** The docs place it under Session pruning, which is `off` by default outside Anthropic-family auth; the replay view is described as "separate from normal cache-TTL pruning", but the gating is not stated. Matters for us as a portability question.
- **OpenClaw's replay-view source is cited by issue/PR review comments, not read.** `history-image-prune.ts` line numbers (`:3`, `:63`) and `attempt.ts:2362` come from the maintainer's closing review of #39573/#41789. Not independently verified against the tree.
- **All Claude Code source citations remain third-party mirrors** (leaf-kit, antonoly, claude-code-best). Two mirrors agree verbatim on `timeBasedMCConfig.ts`, which is high confidence, but it is not vendor-published.
- **Whether time-based microcompact is enabled for anyone.** Every observed GrowthBook dump shows `enabled: false`; one interception study logged 0 microcompact events across 4,700 calls over 8 days. Its *existence* is sourced; its *production behaviour* is not.
- **DeepSeek's own docs do not state a static-first/dynamic-last rule.** The mechanism (prefix-only, 64-token unit, best-effort, hours-to-days retention) is official; the placement guidance is third-party inference from that mechanism. The frequently repeated "~1,024-token practical minimum for V4" is third-party only.
- **No measured token/latency delta for our prompt sizes.** All cache reasoning here is structural. The break-even for P2 (fold savings vs cache-write cost) is unmeasured and depends on our sampling cadence and describe length.
- **Whether our provider actually reports `prompt_cache_hit_tokens`.** Not checked in this pass; the t5 survey's §6 finding that we create the provider without `includeUsage` (`packages/core/src/main.ts:103-107`) means we may have no way to measure any of the above today.
- **Hermes PR #40881 merge status.** Only the PR page was read (carried over from time-awareness-survey §OMITTED).
