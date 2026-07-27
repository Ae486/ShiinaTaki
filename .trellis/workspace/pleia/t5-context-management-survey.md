# T5 — Context management & memory extraction: cross-system survey

- **Date**: 2026-07-26
- **Scope**: mixed (local reference code on disk + official docs + web)
- **Question**: our agent stores every turn in full fidelity and replays the newest 200 timeline rows each turn (`packages/core/src/agents/conversation-store.ts:14` `REPLAY_WINDOW = 200`). No token accounting, no compaction. How do Claude Code / OpenClaw / Hermes / OpenAI handle this, and what is framework-provided vs hand-built?
- **Owner constraint applied throughout**: memory extraction is the priority, compaction is secondary. Findings are weighted by how much they help *"extract the meaningful, drop the rest"*, not by summarization sophistication.

### Source classes used below

| Tag | Meaning |
| --- | --- |
| **[code]** | Read from real source on this machine (`H:\TakiAgent\references\`, `H:\TakiAgent\node_modules\`) — highest confidence |
| **[docs]** | Official vendor documentation |
| **[mirror]** | Deobfuscated/mirrored Claude Code source on GitHub — consistent across ≥2 independent mirrors, but not vendor-published |
| **[community]** | User-observed behavior (GitHub issues, proxy interception). Directionally useful, numbers may be flag-gated and drift |

---

## Executive summary

### What we should copy

1. **Two separate mechanisms, not one.** Every mature system splits *tool-result pruning* (cheap, mechanical, no LLM, in-memory only) from *conversation compaction* (expensive, LLM, persisted). OpenClaw states the split as a table [docs]; Claude Code calls them microcompact vs autocompact [mirror]; Hermes runs pruning as a "cheap pre-pass" inside compress() [code]. **Pruning alone recovers most of the space and requires zero LLM calls and zero token accounting.** For us it is also ADR-0005-safe by construction: it only changes the replay projection.

2. **Never drop the tool *call* when you drop the tool *result*.** Universal across all four. Anthropic's own cookbook states the rationale explicitly: *"keeping the `tool_use` record so the model still knows it made the call, but dropping the bulky payload… If the agent does need the data, it just calls the tool again."* [docs]. Hermes goes one better: instead of a generic placeholder it writes an **informative one-liner** derived from the call args (`[read_file] read config.py from line 1 (1,200 chars)`) [code, `agent/context_compressor.py:700-848`]. That one-liner is nearly free and preserves the *fact* of the action — which is exactly the "extract the meaningful" objective.

3. **Dedupe repeated tool results, newest wins.** Hermes hashes tool-result content (md5, first 12 hex, only for content ≥200 chars) and replaces older identical copies with `[Duplicate tool output — same content as a more recent call]` [code, `context_compressor.py:1637-1661`]. This is the *only* mechanism any of the four has that partially addresses the stale-data problem (sub-question D), and it is ~15 lines.

4. **The pre-compaction memory flush is real, is OpenClaw's, and our `flush-writer.ts` already matches it.** OpenClaw: a *silent agentic turn* fired at `contextWindow - reserveTokensFloor - softThresholdTokens` that tells the model to write durable notes, with a `NO_REPLY` token so the user never sees it, run **once per compaction cycle**, tracked in the session row [docs]. Our `packages/core/src/memory/flush-writer.ts` is the same shape (silent tool-enabled turn, output discarded). The gaps vs OpenClaw are: (a) they gate on a *token* threshold, we gate on the row-count window edge; (b) they support a **separate cheap/local model for the flush turn** that does not inherit the session's fallback chain; (c) they have `forceFlushTranscriptBytes` as a byte-based backstop for when token counters are stale. (b) is the highest-value cheap addition for us.

5. **Compaction only changes what is REPLAYED.** OpenClaw states it directly — *"The full conversation history stays on disk. Compaction only changes what the model sees on the next turn"* [docs]. This is identical to our ADR 0005. Good: our constraint is not exotic, it is the mainstream design.

6. **The summary must be fenced as REFERENCE-ONLY.** Hermes's `SUMMARY_PREFIX` [code, `context_compressor.py:86-115`] plus its `_SUMMARY_END_MARKER` exist because of *named production failures*: weak models read the summary's quoted "## Active Task" as fresh user input (#11475, #14521), or regurgitate an assistant-role summary as their own output (#33256), or — after an over-strong REFERENCE-ONLY framing — stopped calling tools for 7 consecutive turns (#65848 class). They keep a frozen copy of every historical prefix so re-compaction can strip the old one. If we ever do summarization, this prefix-engineering is the part to steal; the summary template is the part to shrink.

### What we should NOT copy

1. **Claude Code's threshold arithmetic.** `contextWindow - min(maxOutputTokens, 20_000) - 13_000` [mirror] requires knowing the model's context window AND max output tokens per model. We are provider-agnostic against an arbitrary OpenAI-compatible endpoint that does not reliably advertise either. Any design keyed on "the model's context window" is a config burden we would have to maintain per model, forever.

2. **Provider-side context management.** Anthropic's `clear_tool_uses_20250919` / `compact_20260112` context edits [docs] and OpenAI's `POST /v1/responses/compact` [community/code] are both genuinely excellent and both **disqualified as a primary mechanism** by our hard provider-agnostic rule. Codex's own experience is the cautionary tale: when GPT-5.5's advertised window (400K) diverged from the effective compaction window (~258K), auto-compaction fired too late and sessions entered a documented retry death-spiral [community]. Report them as options; do not build on them.

3. **Hermes's full compaction machinery.** `context_compressor.py` is **3,521 lines** with 8 layers of anti-thrash state, a summary-failure cooldown, a static-fallback summary path, iterative summary updates, cross-session contamination guards, and three frozen historical prompt prefixes. Every one of those layers exists because of a numbered production incident. That is the honest cost of LLM summarization as a *reliable* subsystem. Given the owner has ranked compaction second, this is the strongest argument for shipping pruning + flush first and deferring summarization entirely.

4. **A 9-section (Claude Code) or 13-section (Hermes) summary template.** Both target coding-agent continuity (files, line numbers, test status, working directory). We are a desktop companion agent. The sections that transfer are roughly: unfulfilled user ask (verbatim), durable preferences/decisions, resolved questions, open blockers. The rest is coding-agent furniture.

5. **`pruneMessages` alone as the whole answer.** It is real and free (see §5), but it is a *mechanical* filter — it removes whole tool-call/result parts by position or tool name. It cannot summarize, cannot dedupe, and cannot preserve "what the call did". Use it as the wire-level enforcement layer, not as the strategy.

### The one thing to verify before writing any code

**We are almost certainly not receiving streaming token usage today.** `packages/core/src/main.ts:103` calls `createOpenAICompatible({ name, baseURL, apiKey })` with **no `includeUsage`**, and `@ai-sdk/openai-compatible@3.0.5` only emits `stream_options: { include_usage: true }` when that flag is set [code]. Most OpenAI-compatible servers return no usage on a stream without it. Details and exact file:line in §6.

---

## §1 — Claude Code

Sources: mirrored source on GitHub (two independent mirrors agree), Anthropic's official context-engineering cookbook, and a GitHub issue thread with proxy-intercepted request bodies. Where these disagree I say so.

### A. Tool-result handling

Tool results are treated **completely differently** from prose. There are at least four distinct paths [mirror + community]:

| Path | LLM? | What it does |
| --- | --- | --- |
| `applyToolResultBudget()` | No | Aggregate cap across *all* tool results; over budget → older results replaced. Runs **before** microcompact in the request pipeline [community] |
| Per-tool size caps | No | Individual result truncated at write time [community] |
| Time-based microcompact | No | If the gap since the last assistant message exceeds a threshold, content-clear all but the most recent N compactable tool results [mirror] |
| Cached microcompact | No | Uses the `cache_edits` API to delete old tool results **server-side** without invalidating the cached prefix; does **not** modify local message content [mirror] |

- **Placeholder**: `'[Old tool result content cleared]'` — exported as `TIME_BASED_MC_CLEARED_MESSAGE` [mirror, `src/services/compact/microCompact.ts`].
- **Is the call kept?** Yes. The clearing walks `user` messages and rewrites only `tool_result` blocks, leaving the assistant's `tool_use` block untouched [mirror]. Anthropic's cookbook confirms this is the design intent [docs].
- **Which tools are clearable**: shell tools, Glob, Grep, file-read, web-fetch, web-search [mirror, `apiMicrocompact.ts` `TOOLS_CLEARABLE_RESULTS`]. Notably file-*write* is excluded from that list.
- **Floor**: `keepRecent = Math.max(1, config.keepRecent)`, with an explicit comment that `slice(-0)` returns the full array and clearing *all* results leaves the model with zero working context [mirror].
- **Prose is never touched by microcompact.** Only full compaction touches conversation text.

### B. Compaction trigger

Token threshold, computed from the model's window [mirror, consistent across mirrors]:

```
reservedForSummary   = min(model maxOutputTokens, 20_000)   // MAX_OUTPUT_TOKENS_FOR_SUMMARY
effectiveWindow      = contextWindow - reservedForSummary
autoCompactThreshold = effectiveWindow - 13_000             // AUTOCOMPACT_BUFFER_TOKENS
```

- Checked **after each query-loop iteration**, so it is synchronous with the turn boundary, not background. The user waits (the compaction call is described as 5–10s, with a 30s keepalive heartbeat for remote sessions) [community blog].
- **Circuit breaker**: `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`; after 3 consecutive failures it stops attempting for the rest of the session, counter resets on success [mirror].
- **Recursion guards**: `querySource === 'session_memory' || 'compact'` returns immediately — forked agents doing compaction must not themselves trigger compaction, or you deadlock [mirror].
- A three-tier cascade runs in order: session-memory compact (zero LLM cost, tried first) → microcompact → full compact [mirror].

### C. Compaction product

- Model is called with `maxTurns=1`, **extended thinking disabled**, `maxOutputTokensOverride: 20000`, and **tools disabled** — the prompt contains `"Respond with TEXT ONLY. Do NOT call any tools. Tool calls will be REJECTED and will waste your only turn — you will fail the task."` [mirror].
- Output is a `<thinking>`-style analysis block (a scratchpad, **stripped after extraction**) plus a `<summary>` block, structured into **9 sections**: Primary Request and Intent / Key Technical Concepts / Files and Code Sections / Errors and Fixes / Problem Solving / All User Messages / Pending Tasks / Current Work / Optional Next Step [mirror, `src/services/compact/prompt.ts`].
- **Replaces** the model-facing history. Post-compaction the conversation is: boundary marker → summary message → (partial compact only) verbatim kept messages → re-injected attachments → session-start hook results [mirror].
- A `SystemCompactBoundary` marker is inserted carrying `preTokens`, `messagesSummarized`, `trigger: 'manual'|'auto'`, and `preservedSegment` UUIDs [mirror].
- **Survives restart**: yes — the summary message includes the transcript file path, telling the model it can go read the full transcript if it needs pre-compaction detail [community blog]. That is an interesting cheap trick: the summary carries a pointer to the ground truth.
- A `PreCompact` hook lets users inject custom instructions into the summary prompt [mirror].

### D. Stale-data problem

**This is the one system that genuinely addresses it, and it does so outside the context system.** [mirror, well-corroborated]

- `readFileState` is a session-level map: absolute path → `{ content, timestamp (mtime), offset, limit }`. `Read` writes it; `Edit`/`Write` read it.
- Before writing, the tool compares `getFileModificationTime(path)` against `lastRead.timestamp`. If the file is newer, it refuses: `'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.'` (`FILE_UNEXPECTEDLY_MODIFIED_ERROR`).
- There is a **Windows-specific fallback we should note**: the source comments that *"on Windows timestamps can change without content changes (cloud sync, antivirus, etc.)"*, so for full reads it compares content as a fallback before erroring [mirror]. A known open bug (#25623) is that mtime-only detection false-positives on IDE autosave; the requested fix is a content hash.
- **Compaction interaction**: `compactConversation` explicitly **clears `readFileState`** and then re-injects recently-read files, the plan file, and skills as attachments [mirror]. So after compaction the file baseline is deliberately reset rather than carried forward stale.

**Read for us**: staleness is solved at the *tool* layer (a read-before-write guard keyed on mtime+content), not at the context layer. That is a much smaller, provider-agnostic mechanism than anything in compaction — and it is orthogonal to T5.

### E. Numbers

| Constant | Value | Source |
| --- | --- | --- |
| `AUTOCOMPACT_BUFFER_TOKENS` | 13,000 | [mirror] |
| `MAX_OUTPUT_TOKENS_FOR_SUMMARY` | 20,000 (rationale: p99.99 of compact summary output = 17,387 tokens) | [mirror] |
| `WARNING_THRESHOLD_BUFFER_TOKENS` / `ERROR_THRESHOLD_BUFFER_TOKENS` | 20,000 each | [mirror] |
| `MANUAL_COMPACT_BUFFER_TOKENS` | 3,000 | [mirror] |
| `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES` | 3 | [mirror] |
| Worked example, 200K window, maxOutput ≥ 20K | 180K effective → **167K** trigger | [mirror + docs-adjacent] |
| Worked example, Sonnet 3.5 (200K window, 8192 maxOutput) | 191,808 effective → **178,808** ≈ 89.4% | [mirror gist] |
| `IMAGE_TOKEN_ESTIMATE` | 1,600 tokens/image | cross-cited by Hermes [code] as *"Matches Claude Code's IMAGE_TOKEN_ESTIMATE constant"* |
| Anthropic API `clear_tool_uses_20250919` defaults | `trigger` 100K input tokens, `keep` 3 tool uses | **[docs]** |
| Anthropic API `compact_20260112` defaults | `trigger` 150K, server-side minimum 50K | **[docs]** |
| Aggregate tool-result budget (`tengu_hawthorn_window`) | 200,000 tokens | [community] flag-gated |
| Per-tool result caps (`tengu_pewter_kestrel`) | global 50K, Bash 30K, Grep 20K | [community] flag-gated |
| Session-memory compact retention | ~40K tokens of recent messages | [community] |
| Context-collapse mode thresholds | commit at 90%, blocking spawn at 95% | [mirror], feature-gated |

Two mirrors also cite `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE` (1–100) which trades the fixed 13K buffer for a percentage, always clamped to the fixed-buffer value as a maximum.

⚠️ **Contradiction to record**: one 2026 blog claims the reserve is "33,000 tokens hardcoded, ≈83.5% of a 200K window". That number is reconcilable as `13K + 20K` (autocompact buffer + warning buffer), i.e. it is the *warning display* threshold, not the compaction threshold. The source-level 13K/20K split is better attested. Prefer the mirror numbers.

### F/G

See §5 and §6. Claude Code is 100% hand-built — it is not on a third-party agent framework. Token accounting: `tokenCountWithEstimation(messages)` — a **hybrid**: real API usage (`input_tokens + cache_* + output_tokens`) from the previous response where available, char/4 heuristic for messages added since [mirror, corroborated by the deep-dive].

---

## §2 — OpenClaw

Sources: official docs site + GitHub source. This is the system our `flush-writer.ts` cites by name, and the docs are unusually explicit.

### A. Tool-result handling

OpenClaw calls it **session pruning**, and the docs draw the contrast as a table [docs]:

| | Pruning | Compaction |
| --- | --- | --- |
| What | Trims tool results | Summarizes conversation |
| Saved? | No (in-memory, per-request) | Yes (persisted in transcript) |
| Scope | Tool results only | Entire conversation |

Mechanism, `cache-ttl` mode, evaluated **before each LLM call** [docs]:

1. **TTL gate** — skip entirely until the prompt-cache TTL has expired (default 5m). Preserves cache reuse for nearby turns.
2. **Size gate** — estimate context/window ratio; below `softTrimRatio` (0.3), skip and keep the TTL clock running.
3. **Soft-trim** oversized tool results: keep head + tail (1500 chars each, capped 4000 combined), insert `...`, and **append a note with the original size**.
4. **Hard-clear** if ratio ≥ `hardClearRatio` (0.5) **and** ≥ `minPrunableToolChars` (50,000) of prunable tool content remains: replace content with `[Old tool result content cleared]`.
5. Reset the TTL clock **only if pruning actually changed the context**.

Two invariants regardless of thresholds [docs]:
- The most recent `keepLastAssistants` (default 3) assistant turns are never pruned.
- Nothing before the session's first user message is ever pruned (protects bootstrap reads like `SOUL.md` / `USER.md`).

Also: **only `toolResult` messages are eligible**; user and assistant messages are never modified; **tool results containing image blocks are skipped entirely** (never trimmed or cleared); `tools.{allow,deny}` scopes which tool names are prunable. If there aren't enough assistant messages to establish the cutoff, pruning is skipped.

Is the call kept? Yes — only the `toolResult` entry's content is rewritten.

**Notable default**: pruning is **off by default for non-Anthropic providers**. The bundled Anthropic plugin auto-enables it (mode `cache-ttl`, ttl `1h` for OAuth / `1h` for API key) only for fields the user has not set. That is a strong signal: OpenClaw treats pruning primarily as a *prompt-cache economics* feature, and only secondarily as a context-space feature.

### B. Compaction trigger

Four distinct entry points [docs]:

1. **Overflow recovery** — the model returns a context-overflow error; compact, then retry. OpenClaw matches *dozens* of provider-specific overflow strings (`request_too_large`, `context length exceeded`, `input exceeds the maximum number of tokens`, Bedrock's `input token count exceeds the maximum number of input tokens`, `ollama error: context length exceeded`, …). When the provider reports the attempted token count it forwards that real count into compaction; when the provider confirms overflow but exposes no parseable count, it passes a **minimally over-budget synthetic count**.
2. **Threshold maintenance** — after a successful turn, when current context exceeds the model window minus built-in headroom for prompts and the next model output.
3. **Preflight local compaction** — `maxActiveTranscriptBytes` (bytes or `"20mb"`) triggers compaction before opening the next run once the active transcript reaches that size. A cost guard for local reopen, not archival.
4. **Mid-turn precheck** (default **off**) — after a tool result is appended and before the next model call, estimate prompt pressure. If it no longer fits, it does **not** compact inline; it raises a structured signal, stops the submission, and lets the outer loop recover (truncate oversized tool results if that's enough, else compact and retry).

Synchronous with the run loop. Silent by default (`notifyUser` opt-in).

**This is the single most provider-agnostic trigger design of the four**: overflow-error recovery needs no knowledge of the model's context window at all. It is reactive rather than predictive, but it cannot be wrong about a window it doesn't know.

### C. Compaction product

- Older turns → a persisted `compaction` **entry in the transcript** (append-only SQLite, entries have `id` + `parentId`). Recent messages kept intact. Future turns see the summary + everything after `firstKeptEntryId` [docs].
- **Persistent, survives restart** — explicitly contrasted with pruning, which is per-request only [docs].
- `keepRecentTokens` default **20,000** governs the recent tail kept in rebuilt context. Manual `/compact` without an explicit keep budget is a **hard checkpoint** — rebuilt context starts from the summary alone.
- **Tool-pair integrity at the split point**: *"OpenClaw keeps assistant tool calls paired with their matching `toolResult` entries when it picks a compaction split point. If the point lands inside a tool block, OpenClaw moves the boundary so the pair stays together"* [docs]. Our `history()` currently solves the mirror-image problem by dropping leading orphan tool rows (`conversation-store.ts:66-69`) — same class of bug, opposite end.
- Summarization is **chunked**: `chunkMessagesByMaxTokens`, iterating with the running summary threaded through as `previousSummary`, with `retryAsync` (3 attempts, 500ms–5s, 0.2 jitter) per chunk [code, `src/agents/compaction.ts`].
- **Security invariant worth stealing**: `// SECURITY: never feed toolResult.details into summarization prompts` — `stripToolResultDetails()` runs before chunking [code].
- Progressive fallback: full summarization → summarize only non-oversized messages and note the oversized ones as `[Large {role} (~N K tokens) omitted from summary]` → final fallback `"Context contained N messages (M oversized). Summary unavailable due to size limits."` [code].
- `truncateAfterCompaction` rotates the active transcript to a compacted successor.
- Pluggable: `plugins.slots.contextEngine` can replace assembly, `/compact`, and subagent context lifecycle hooks entirely.

### The pre-compaction memory flush (the thing our code cites)

Fully documented [docs], and the config surface is small:

| Key | Default | Notes |
| --- | --- | --- |
| `enabled` | `true` | |
| `model` | unset | **exact** provider/model override for the flush turn only (e.g. `ollama/qwen3:8b`); does **not** inherit the session's fallback chain, so local housekeeping cannot silently fall back to a paid model |
| `softThresholdTokens` | `4,000` | gap below the compaction threshold that triggers the flush |
| `forceFlushTranscriptBytes` | unset | force a flush at this transcript byte size even if token counters are stale; `0` disables |
| (related) `reserveTokensFloor` | `20,000` in the documented example | |

- Trigger: session token estimate crosses `contextWindow - reserveTokensFloor - softThresholdTokens`.
- **Silent**: the built-in prompt and system prompt both include a `NO_REPLY` / `no_reply` hint so nothing is delivered to the user. The prompts explicitly say the model *may* reply but usually `NO_REPLY` is correct.
- **Once per compaction cycle**, tracked in the session row (`memoryFlushAt`, `memoryFlushCompactionCount`).
- **Skipped** when the workspace is read-only (`workspaceAccess: "ro"` or `"none"`), and for CLI backends and heartbeat turns.
- Two prompts: a user prompt plus a system-prompt append.
- The default `memory-core` plugin writes to `memory/YYYY-MM-DD.md`; the active memory plugin owns prompt/path policy.
- Lives at `src/auto-reply/reply/memory-flush.ts` + `agent-runner-memory.ts` — notably **not** on the public `session_before_compact` extension hook.
- Failure mode is graceful: if the flush is exhausted the reply still continues, with a "degraded" notice when `notifyUser` is on.

Memory layout it flushes into [docs]: `MEMORY.md` = curated durable layer, loaded at session start, truncated in-context if it exceeds the bootstrap budget (file on disk stays intact) — an explicit signal to move detail down. `memory/YYYY-MM-DD.md` = working layer, indexed for `memory_search`/`memory_get`, **not** injected every turn. Distillation from daily → `MEMORY.md` happens periodically via the heartbeat flow.

### D. Stale-data problem

**Not addressed for tool results.** Pruning replaces old results with placeholders — which incidentally removes the wrong data rather than marking it — but there is no staleness marker, no mtime tracking, no re-read hint. The docs' only nod is in troubleshooting: *"Context feels stale after compaction? Use `/compact Focus on <topic>` to guide the summary, or enable the memory flush so notes survive."* [docs] — which is about summary quality, not data freshness.

### E. Numbers

| Constant | Value | Source |
| --- | --- | --- |
| `compaction.keepRecentTokens` | 20,000 | [docs] |
| `compaction.reserveTokensFloor` | 20,000 (documented example) | [docs] |
| `memoryFlush.softThresholdTokens` | 4,000 | [docs] |
| `contextPruning.ttl` | `5m` (Anthropic auto-default `1h`) | [docs] |
| `contextPruning.keepLastAssistants` | 3 | [docs] |
| `contextPruning.softTrimRatio` | 0.30 | [docs] |
| `contextPruning.hardClearRatio` | 0.50 | [docs] |
| `contextPruning.minPrunableToolChars` | 50,000 | [docs] |
| `contextPruning.softTrim` | `{ maxChars: 4000, headChars: 1500, tailChars: 1500 }` | [docs] |
| `contextPruning.hardClear.placeholder` | `[Old tool result content cleared]` | [docs] |
| Token estimation | **chars ≈ tokens × 4** | [docs] |
| Context-window fallback chain | model registry → provider override → `agents.defaults.contextTokens` → **200,000** | [docs] |
| `SUMMARIZATION_OVERHEAD_TOKENS` | 4,096 | [code] |
| `pruneHistoryForContextShare` `maxHistoryShare` | 0.5 | [code] |
| `isOversizedForSummary` | single message > **50%** of context window | [code] |
| `FALLBACK_TRANSCRIPT_BYTES_PER_TOKEN` | 4 | [code] |
| `TRANSCRIPT_OUTPUT_READ_BUFFER_TOKENS` | 8,192 | [code] |
| Transcript replay cap in flush estimation | `maxMessages: 200, maxBytes: 1MB` | [code] |

### F/G

Hand-built on their own runtime. Token accounting is a **layered fallback** [code, `agent-runner-memory.ts`]:
`deriveContextPromptTokens({ lastCallUsage })` (real provider usage) → local `estimateMessagesTokens(messages)` → `Math.ceil(byteSize / 4)` from the transcript file size. Flush gating projects the *next* input as `basePromptTokens + lastOutputTokens + promptTokenEstimate`, i.e. previous prompt + previous completion + current user prompt estimate. When the two disagree they take `Math.max(usagePromptTokens, estimatedMessageTokens)` — deliberately pessimistic.

**That `max(real, estimate)` pattern is directly transplantable to us** and is the single best answer to "what do we do when the provider doesn't report usage".

---

## §3 — Hermes

Sources: the MIT-licensed tree at `H:\TakiAgent\references\hermes-agent-main\` [code]. Everything below is read from source, not blog posts. Cross-reference: `.trellis/workspace/pleia/hermes-memory-analysis.md` already covers Hermes's *memory* architecture (MemoryProvider seam, MEMORY.md/USER.md, skills-as-procedural-memory, curator) for T5/D28 — this section deliberately covers only the *context* side and does not repeat it.

**Architecture note first**: Hermes has a formal **pluggable `ContextEngine` ABC** (`agent/context_engine.py`, 231 lines) selected by `context.engine` in config, default `"compressor"`. The engine owns: deciding when to compact, doing it, optionally exposing its own tools to the agent (`lcm_grep`, `lcm_describe`, `lcm_expand` are the cited example), and tracking token usage. Lifecycle: `on_session_start` → `update_from_response(usage)` after every call → `should_compress()` after every turn → `compress()` → `on_session_end` (real boundaries only, not per-turn). **This maps 1:1 onto our invariant 7 (features are pluggable modules through a registry).**

### A. Tool-result handling

`_prune_old_tool_results()` [code, `context_compressor.py:1565-1725`] — "cheap pre-pass, no LLM call", three passes:

**Pass 1 — dedupe (runs over the WHOLE list, ignores the protected tail).** md5 of tool-result content (first 12 hex), only for content ≥200 chars, walking **backward** so the newest copy wins; older identical copies become `[Duplicate tool output — same content as a more recent call]`. Multimodal/list/non-string contents are skipped (can't be hashed).

**Pass 2 — summarize old results (before the prune boundary only).**
- List-shaped content (base64 screenshots): image parts stripped, lightweight text placeholder kept. The comment is pointed: *"Without this, an old computer_use screenshot (~1MB base64 + ~1500 real tokens) survives every compression pass forever."*
- `{_multimodal: True}` envelopes → `[screenshot removed] {text_summary[:200]}`
- String content >200 chars → `_summarize_tool_result(tool_name, tool_args, content)`, a per-tool one-liner built from the *call args* joined by `tool_call_id`:
  - `[terminal] ran \`npm test\` -> exit 0, 47 lines output` (exit code regex-extracted from the result JSON)
  - `[read_file] read config.py from line 1 (1,200 chars)`
  - `[search_files] content search for 'compress' in agent/ -> 12 matches`
  - `[web_extract] https://… (+2 more) (4,096 chars)`
  - generic fallback: `[{tool}] {k1}={v1} {k2}={v2} (N chars result)`
- The whole thing is wrapped in a bare `except` with the comment *"a summary must never crash compression — which retries on the same history and would crash-loop"*, and `_str_arg()` coerces non-string LLM-emitted arg values because `len()`/slicing on a bool crashes compaction.

**Pass 3 — truncate tool_call ARGS in assistant messages (before the boundary).** Args >500 chars are shrunk *inside the parsed JSON structure* (head 200 chars per string), because *"otherwise downstream providers 400 on every subsequent turn until the broken call falls out of the window."* Rationale: `write_file` with 50KB of content survives result-pruning entirely without this.

**Is the call kept when the result is dropped? Yes** — the assistant `tool_calls` entry always survives; only its args may be shrunk, and always to still-valid JSON.

**Boundary**: token-budget walk backward, with `protect_tail_count` acting as a hard **minimum floor** in count-space (there is a long comment explaining that doing the `max()` in index-space inverts the direction and silently truncates a generous budget back to the floor — a real bug they fixed).

### B. Compaction trigger

`should_compress(prompt_tokens)` → `tokens >= threshold_tokens and not blocked` [code].

`_compute_threshold_tokens(context_length, threshold_percent, max_tokens)`:
```
effective_window = context_length - (max_tokens or 0)   # provider reserves output from the same window
pct_value        = int(effective_window * threshold_percent)
floored          = max(pct_value, MINIMUM_CONTEXT_LENGTH)   # 64_000
if floored >= effective_window:                              # degenerate small-window case
    return min(int(effective_window * 0.85), effective_window - 1)
return floored
```
Plus `_effective_threshold_percent`: models under **512K** get their percent floored at **0.75** (raise-only). The stated reason is directly relevant to us: at a 50% trigger a 128K–262K model compacts with only ~64–131K consumed, and *"the incompressible floor (system prompt + tool schemas + protected tail + rolling summary) eats most of the reclaimed headroom, so compaction re-fires every 1-2 turns and the session spends most of its wall-clock summarizing."*

Runs **twice per turn** with two different measures: a rough preflight estimate before the call, and the real provider count after the response. `should_defer_preflight_to_real_usage()` exists because the rough estimator deliberately overestimates schema-heavy requests, so after a compressed call fits, provider `prompt_tokens` is trusted over the rough number — but only while rough growth stays under `max(4096, threshold * 0.05)`.

**Anti-thrash (three independent latches)** [code]:
- `_ineffective_compression_count >= 2` → block. Judged in `update_from_response()`, **not** in `should_compress()`, and the comment explains exactly why: `should_compress` runs twice per turn with two different measures, and the rough one can dip below the threshold and reset the strike every turn, re-opening the loop. Effectiveness is defined as *"did the prompt get under the threshold?"*, not *"did the message list shrink?"* — because with 50+ tools the system prompt + schemas alone are 20–30K tokens, an incompressible floor.
- `_fallback_compression_streak >= 2` → block.
- `_summary_failure_cooldown_until` — 600s cooldown after a transient summary failure, because without it every subsequent turn re-fires compaction and the CLI appears frozen.

Manual `/compress <focus>` passes `force=True`, clearing the cooldown.

### C. Compaction product

- Auxiliary (cheap/fast) model by default, `summary_model` override, falling back to the main model on failure.
- **Crucially: `max_tokens` is deliberately NOT sent** on the summary call. The comment is worth quoting: *"the output cap must never truncate a summary… the Anthropic Messages wire and NVIDIA NIM forward it — a hard cap there cut summaries mid-section (thinking models burn the cap on reasoning first), producing truncated/thinking-only summaries and compaction loops."* `summary_budget` is prompt-level guidance only (`Target ~N tokens`).
- Budget: `content_tokens * 0.20`, floored at `_MIN_SUMMARY_TOKENS` 2,000, ceiling `_SUMMARY_TOKENS_CEILING` 10,000, with the max scaling as 5% of the model's context window.
- **13-section template** [code, `context_compressor.py:2142-2215`]: Historical Task Snapshot / Goal / Constraints & Preferences / Completed Actions / Active State / Historical In-Progress State / Blocked / Key Decisions / Resolved Questions / Historical Pending User Asks / Relevant Files / Historical Remaining Work / Critical Context.
  - Four headings are deliberately prefixed **"Historical"** to stop them reading as active instructions.
  - `## Completed Actions` uses a fixed line format: `N. ACTION target — outcome [tool: name]`.
  - `## Critical Context` says: *"NEVER include API keys, tokens, passwords, or credentials — write [REDACTED] instead."*
  - **TEMPORAL ANCHORING rule** (injected when today's date resolves): *"When an action has already been carried out, phrase it as a completed, dated, past-tense fact rather than an open instruction… rewrite 'email John about the proposal' as 'Sent the proposal email to John on {date}.' Never leave a finished action worded as if it still needs doing, and never invent a date for work that has not happened yet."* — **directly relevant to our just-shipped time-awareness work.**
- **Iterative update**: on the second and later compactions the prompt is a *different* prompt that takes `PREVIOUS SUMMARY` + `NEW TURNS TO INCORPORATE` and instructs the model to move items In Progress → Completed, answered → Resolved Questions, and remove only clearly-obsolete information.
- Output post-processing: `strip_think_blocks()` (otherwise a thinking model's trace is stored in `_previous_summary` and re-fed into every subsequent iterative-update prompt, compounding bloat), then `redact_sensitive_text()` — *"the summarizer LLM may ignore prompt instructions and echo back secrets verbatim."* Empty/whitespace-only content is treated as a hard failure, because some OpenAI-compatible proxies return HTTP 200 with empty content and that would silently wipe the compacted turns.
- Placement: a standalone summary message, or — in the alternation corner case — merged into the first tail message wrapped in `[PRIOR CONTEXT — for reference only; not a new message]` … `[END OF PRIOR CONTEXT — COMPACTION SUMMARY BELOW]`.
- **Persistence**: `COMPRESSED_SUMMARY_METADATA_KEY = "_compressed_summary"`, underscore-prefixed **on purpose** because wire sanitizers strip leading-underscore keys before the request leaves the process — *"Strict OpenAI-compatible gateways (Fireworks, Mistral, Moonshot/Kimi, opencode-go) reject payloads carrying unknown keys with 'Extra inputs are not permitted', poisoning every subsequent request in the session."* **This is a direct warning for us**: we are on an OpenAI-compatible wire; any metadata we attach to messages must be stripped before send.
- Survives restart via the session DB (`bind_session_state`, `_flush_messages_to_session_db`), with `_strip_persistence_markers()` as a single terminal sweep enforcing that no assembled message leaves `compress()` carrying a `_db_persisted` marker.

### D. Stale-data problem

**Partially, and only by accident.** The dedupe pass (A/Pass 1) keeps only the newest full copy when the same file is read 5×, which *is* the right outcome for a re-read file. But:
- There is no mtime tracking, no staleness marker, no re-read hint.
- Every use of the word "stale" in `context_compressor.py` refers to **stale tasks/instructions**, not stale data — `## Historical Pending User Asks` is explicitly labelled *"These are STALE — they were from the compacted turns. The agent must NOT act on them unless the latest user message explicitly requests it."*
- `agent/file_safety.py` has no mtime/freshness logic (grepped: zero hits).

So: nobody except Claude Code solves D, and Claude Code solves it outside the context system.

### E. Numbers

| Constant | Value |
| --- | --- |
| `ContextEngine` base defaults | `threshold_percent` 0.75, `protect_first_n` 3, `protect_last_n` 6 |
| `ContextCompressor.__init__` defaults | `threshold_percent` **0.50**, `protect_first_n` 3, `protect_last_n` **20** |
| `_SMALL_CTX_WINDOW_LIMIT` / `_SMALL_CTX_THRESHOLD_PERCENT` | 512,000 / 0.75 (raise-only floor) |
| `MINIMUM_CONTEXT_LENGTH` | 64,000 |
| `_MIN_CTX_TRIGGER_RATIO` | 0.85 (degenerate-window path) |
| `_MIN_SUMMARY_TOKENS` / `_SUMMARY_RATIO` / `_SUMMARY_TOKENS_CEILING` | 2,000 / 0.20 / 10,000 |
| `_CHARS_PER_TOKEN` | 4 |
| `_IMAGE_TOKEN_ESTIMATE` | 1,600 (`_IMAGE_CHAR_EQUIVALENT` = 6,400 chars) |
| Dedupe / prune minimum content size | 200 chars |
| tool_call args truncation trigger / head kept | >500 chars / 200 chars |
| `_SUMMARY_FAILURE_COOLDOWN_SECONDS` | 600 |
| `_FALLBACK_SUMMARY_MAX_CHARS` / `_FALLBACK_TURN_MAX_CHARS` | 8,000 / 700 |
| `_MAX_TAIL_MESSAGE_FLOOR` | 8 |
| `_AUTO_FOCUS_MAX_TURNS` / `_TURN_MAX_CHARS` / `_MAX_CHARS` | 3 / 260 / 700 |
| Anti-thrash latches | ineffective ≥ 2, fallback streak ≥ 2 |
| Preflight tolerated rough growth | `max(4096, threshold_tokens * 0.05)` |
| Focus-topic budget share | 60–70% of the summary budget |
| `_TOOLS_TOKENS_CACHE_MAX` | 256 |

### F/G

Hand-built, but behind a pluggable ABC. Token accounting is **primarily provider `usage`**, with a rough local estimator for preflight:
- `update_from_response(usage)` reads `prompt_tokens` / `completion_tokens` / `total_tokens` (legacy keys always present) plus optional canonical buckets `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`.
- `estimate_request_tokens_rough(messages, system_prompt=, tools=)` = `(len+3)//4` per text bucket + `_estimate_tools_tokens_rough(tools)`, with a note that *"With 50+ tools enabled, schemas alone can add 20-30K tokens — a significant blind spot when only counting messages."* Tool-schema token counts are memoized by `id(tools)` in a 256-entry insertion-ordered cache because *"repeated `str(tools)` conversions are CPU-heavy and can stall GUI event loops under GIL pressure."*
- `context_breakdown.py` produces a Cursor-style UI breakdown across 8 categories (system_prompt, tool_definitions, rules, skills, mcp, subagent_definitions, memory, conversation) using **the same char/4 heuristic** so the displayed numbers align with the compression thresholds, and prefers `last_prompt_tokens` (measured) over the estimate when available.

**No provider-specific tokenizer anywhere in the compaction path.** Hermes is the closest analogue to our constraints and it uses char/4 + provider usage. That is a strong endorsement of the cheap path.

---

## §4 — OpenAI (Agents SDK / Codex / Responses API)

### 4a. Agents SDK (Python) — Sessions

**What the framework gives you** [docs]:
- `Session` protocol: `get_items(limit)` / `add_items(items)` / `pop_item()` / `clear_session()`. That is the whole surface.
- Runner behavior: before each run it retrieves history and prepends it to the input; after each run it stores all new items (user input, assistant responses, tool calls).
- **`SessionSettings(limit=N)`** — retrieve only the most recent N *items* (default `None` = all). This is the only built-in truncation, and it is item-count based, exactly like our `REPLAY_WINDOW = 200`.
- **`RunConfig.session_input_callback(history, new_input)`** — customize the merge before the model call. Docs: *"Use this when you need custom pruning, reordering, or selective inclusion of history without changing how the session stores items."* Importantly, *"the SDK still persists only items that belong to the new turn. Reordering or filtering old history therefore does not cause old session items to be saved again as fresh input."* — i.e. **the SDK enforces exactly our ADR 0005 separation: store ≠ replay.**
- `call_model_input_filter` for a final pass immediately before the model call.
- Built-in backends: `SQLiteSession`, `AsyncSQLiteSession`, `RedisSession`, `SQLAlchemySession`, `MongoDBSession`, `DaprSession`, `OpenAIConversationsSession`, `AdvancedSQLiteSession`, `EncryptedSession`, `OpenAIResponsesCompactionSession`.
- `AdvancedSQLiteSession` ships a **`turn_usage` table** (`requests`, `input_tokens`, `output_tokens`, `total_tokens`, `input_tokens_details` JSON, `output_tokens_details` JSON, keyed by `(session_id, branch_id, user_turn_number)`), populated by an explicit `store_run_usage()` call after each run. That is a clean, provider-agnostic schema for per-turn token accounting and is worth copying verbatim as a table shape.

**A. Tool-result handling**: none. Sessions store `TResponseInputItem`s uniformly; tool results are not special-cased, not capped, not truncated. Anything of the sort is yours to write.

**B/C. Compaction**: no built-in summarization in the base sessions. The official cookbook ("Context Engineering — Short-Term Memory Management with Sessions") is explicit that you implement it yourself, and provides two reference classes:
- `TrimmingSession` — keeps the last N *user turns* (a turn = a user message and everything up to the next user message, including tool calls/results). Trims on **both** write and read (*"so even if you bypassed a write, reads won't leak old turns"*). In-memory.
- `SummarizingSession` — two knobs, `context_limit` (max real user turns before summarizing) and `keep_last_n_turns` (kept verbatim). Everything older is compressed into a **synthetic user→assistant pair**: user = `"Summarize the conversation we had so far."`, assistant = the generated summary, tagged `metadata.synthetic == True`. It releases the lock during the (slow) summarization then **re-checks the condition before applying** so concurrent arrivals don't cause a stale rewrite.

`OpenAIResponsesCompactionSession` is a *wrapper* around another session backend that calls the server-side `responses.compact` endpoint, with `should_trigger_compaction` and `compaction_mode` ∈ `{"previous_response_id", "input", "auto"}` — `"input"` rebuilds the compaction request from current session items when the response chain is unavailable. **OpenAI-only**; the docs warn not to wrap `OpenAIConversationsSession` with it.

**D. Stale-data**: not addressed.

**E. Numbers**: `SessionSettings(limit)` default `None`. No published thresholds — by design, since the SDK doesn't compact.

**Community signal worth recording**: issue #1539 ("Context window management on long sessions") asks for *"a native compact, similar to what Claude Code does"*; an earlier `keep_last_n` PR (#660) was closed for inactivity. The maintainers' answer is the three options above (input filters / custom session / manual). Filed 2025-08; `OpenAIResponsesCompactionSession` is the eventual (OpenAI-hosted) answer.

### 4b. Codex CLI [code on GitHub + community]

**B. Trigger** — three phases: **pre-turn** (before sending a new user message, if accumulated tokens already exceed the threshold), **mid-turn** (at a tool-loop boundary when context grew past threshold during the chain), and **manual `/compact`** (which accepts custom instructions: `/compact Focus particularly on the authentication refactor`).

Threshold: `effective_auto_compact_limit = min(model_auto_compact_token_limit, context_window * 0.90)` — you can lower it, you **cannot** raise it above 90%; values above the cap are silently ignored (introduced v0.100.0, OpenAI closed the resulting issue #11805 as "not planned").

**C. Product** — two paths:
- **Remote (OpenAI-hosted)**: `POST /v1/responses/compact` returns an opaque AES-encrypted blob (`ResponseItem::Compaction { encrypted_content }`). The client never inspects it. Retained messages are budgeted at `RETAINED_MESSAGE_TOKEN_BUDGET = 64_000` and truncated from the back.
- **Local fallback** (custom/non-OpenAI provider): appends a summarization prompt as a user message and stores the reply as a user-role message prefixed with `SUMMARY_PREFIX`.

Post-compaction history is exactly: (re-injected initial context) + up to `COMPACT_USER_MESSAGE_MAX_TOKENS = 20_000` of the **most recent user messages** (oldest-first after a reverse-walk, with the boundary message truncated to fit) + the summary. *"Everything else — previous assistant responses, tool call results, file contents read in earlier turns — is discarded."*

Placement rule for re-injected initial context [code]: before the last *real* user message; if none remain, before the summary; if no user messages, before the last compaction item — *"the model is trained to see the compaction summary as the last item in history after mid-turn compaction."*

On `ContextWindowExceeded` while compacting, it removes the **oldest** history item and retries — *"Trim from the beginning to preserve cache (prefix-based) and keep recent messages intact."*

Codex emits an explicit user-facing warning after compaction: *"Heads up: Long threads and multiple compactions can cause the model to be less accurate. Start a new thread when possible."*

**A. Tool results**: `tool_output_token_limit` config caps individual tool/function output contributions at write time (example value 16,000). No fold/elide of old results — they're simply discarded wholesale at compaction.

**D. Stale data**: not addressed.

**G. Token accounting**: `ContextManager::estimate_token_count`. Instructive bug: after remote compaction the estimator counted the whole `encrypted_content` blob as prompt text, pushing the estimate over the window and rendering "0% context left"; the fix caps the blob's estimate at 10% of the effective window, max 25K tokens.

**The cautionary tale**: with GPT-5.5 advertising 400K but having an effective ~258.4K compaction window, auto-compaction (keyed on the advertised number) fired too late, the compact endpoint failed on the oversized payload, and the retry used the *same* oversized context — a documented death spiral. Mitigation was to manually set `model_auto_compact_token_limit` to ~60% of the *effective* window. **This is precisely the failure mode our provider-agnostic rule protects us from, and it is why an overflow-error-triggered path (OpenClaw's) is strictly safer than a threshold-only path.**

---

## §5 — F: framework-provided vs self-built (decision-critical)

### The verdict

| System | Framework | What context management came free |
| --- | --- | --- |
| Claude Code | none (own runtime) | nothing — 100% hand-built |
| OpenClaw | none (own runtime) | nothing — 100% hand-built, but exposed as a pluggable `contextEngine` slot |
| Hermes | none (own runtime) | nothing — 100% hand-built, behind a pluggable `ContextEngine` ABC |
| OpenAI Agents SDK | the SDK itself | item-count truncation + merge hooks; **no summarization, no token budgeting, no tool-result handling** |
| **Us (AI SDK v7)** | **`ai@7.0.17`** | **`pruneMessages` + `prepareStep` message override — and that is all** |

**Nobody gets compaction for free.** The most any framework provides is a seam.

### What AI SDK v7.0.17 actually ships (verified against installed source, not memory)

Verified at `H:\TakiAgent\node_modules\.pnpm\ai@7.0.17_zod@4.4.3\node_modules\ai\`.

**1. `pruneMessages` — exported from `'ai'`.** Source: `src/generate-text/prune-messages.ts` (196 lines). Signature verified at `dist/index.d.ts:6920-6932`:

```ts
function pruneMessages({ messages, reasoning, toolCalls, emptyMessages }: {
  messages: ModelMessage[];
  reasoning?: 'all' | 'before-last-message' | 'none';                  // default 'none'
  toolCalls?: 'all' | 'before-last-message' | `before-last-${number}-messages` | 'none'
            | Array<{ type: 'all' | 'before-last-message' | `before-last-${number}-messages`;
                      tools?: string[] }>;                              // default []
  emptyMessages?: 'keep' | 'remove';                                    // default 'remove'
}): ModelMessage[]
```

What it does, from reading the implementation:
- Filters `reasoning` parts out of assistant messages.
- Filters `tool-call`, `tool-result`, `tool-approval-request`, `tool-approval-response` parts, positionally (`before-last-N-messages`) and/or by tool name (the array form).
- **Removes the pair, not just the result.** It scans the kept trailing window, collects `keptToolCallIds` / `keptApprovalIds`, and drops anything outside that set. So unlike every system in §1–§4, this removes the *call* along with the *result*. There is no "keep the call, blank the payload" mode.
- Correctly resolves approval-response → tool-name across messages via global maps (an explicit bug-fix comment about orphaned approval responses).
- Drops messages whose content is empty after pruning (default).

**Limitations vs what we need**: no size cap, no truncation of a *single* oversized result, no dedupe, no placeholder text, no summarization, no token counting. It is a positional/name-based part filter.

**2. `prepareStep` — the sanctioned context-management seam.** From the bundled v7 docs, `docs/03-agents/04-loop-control.mdx:183-225`, section literally titled **"Context Management"**:

> *"Long-running agents can accumulate large tool results, reasoning parts, and assistant messages. Use `prepareStep` to mutate the message state that will be used by later steps. This is useful for compaction, and you decide when compaction should happen."*
>
> *"The `messages` value contains the messages that will be sent for the current step. When you return a `messages` override from `prepareStep`, that changed list becomes the base for later steps."*
>
> *"The `pruneMessages` helper provides a built-in way to remove selected messages. You can use it inside `prepareStep` when you want a simple compaction strategy."*

The doc's own example — and this is the whole of the framework's token-accounting story:

```ts
const COMPACTION_THRESHOLD = 100_000;
const estimateTokens = (messages: ModelMessage[]) => JSON.stringify(messages).length / 4;

const agent = new ToolLoopAgent({
  model, tools,
  prepareStep: async ({ messages }) => {
    if (estimateTokens(messages) > COMPACTION_THRESHOLD) {
      return { messages: pruneMessages({ messages, reasoning: 'all',
                                         toolCalls: 'before-last-3-messages',
                                         emptyMessages: 'remove' }) };
    }
  },
});
```

followed by: *"The token estimator above is intentionally simple and only demonstrates one way to decide when to compact."*

**`prepareStep` is available on `ToolLoopAgent`** — confirmed at `dist/index.d.ts:5096` inside `ToolLoopAgentSettings`: `prepareStep?: PrepareStepFunction<...>`. Its argument object (`dist/index.d.ts:1621-1651`) provides `steps`, `stepNumber`, `model`, `instructions`, `initialInstructions`, `messages`, `initialMessages`, with the doc comment *"The messages that will be sent to the model for the current step. If you return a `messages` override, those messages carry forward to later steps."* There is also `responseMessages` for rebuilding a step from discrete pieces.

We already use `ToolLoopAgent` (`packages/core/src/memory/flush-writer.ts:31`), so this seam is available with no dependency change.

**3. What v7 does NOT ship** (searched `dist/index.d.ts` for `compact*`, `summariz*`, `trim*`, `truncat*`, `contextManage*`, `slidingWindow*` — only `prune*` and `prepareStep` matched):
- No summarization helper.
- No token counter or tokenizer.
- No context-window registry / model metadata.
- No threshold or budget abstraction.
- No sliding-window or message-trimming helper beyond `pruneMessages`.
- `docs/03-agents/06-memory.mdx` covers memory only as **three approaches**: Anthropic's provider-defined `memory_20250818` tool (provider lock-in), third-party memory *providers* (Letta / Mem0 / Supermemory / Hindsight / MongoDB — all external services), or **"Custom Tool — the most flexible… This requires the most upfront work but gives you full ownership of how memory works, with no provider lock-in and no external dependencies."** Our `memory_write` tool is already exactly the third option, which the SDK's own docs frame as the no-lock-in choice.

### Read for us

The framework gives us a **seam and a filter**, not a strategy. The division that falls out:

| Layer | Source |
| --- | --- |
| Where to intervene | free — `prepareStep` on `ToolLoopAgent` |
| Removing whole tool call/result parts safely (pairing, approvals, empty messages) | free — `pruneMessages` |
| Deciding *when* | ours |
| Counting tokens | ours (see §6) |
| Keeping the call while blanking the result | ours — `pruneMessages` cannot do this |
| Per-result size caps / head+tail soft-trim | ours |
| Dedupe of repeated results | ours |
| Informative one-line result summaries | ours |
| Any summarization | ours |
| Persisting a summary / replay projection | ours (and ADR-0005-constrained) |

---

## §6 — G: token accounting (decision-critical)

### Does AI SDK v7 surface per-call usage on BOTH paths? **Yes.**

Verified in `dist/index.d.ts` of the installed `ai@7.0.17`:

| Path | Field | Type | Location |
| --- | --- | --- | --- |
| `generateText` / `agent.generate()` | `usage` | `LanguageModelUsage` | `dist/index.d.ts:7501-7502` region (`GenerateTextResult`) |
| | `totalUsage` | `LanguageModelUsage` | same |
| | `steps[].usage` | per-step | `StepResult` |
| `streamText` / `agent.stream()` | `usage` | `PromiseLike<LanguageModelUsage>` | `dist/index.d.ts:2781` (`StreamTextResult`) |
| | `totalUsage` | `PromiseLike<LanguageModelUsage>` | `dist/index.d.ts:2790` |
| | `steps` | `PromiseLike<Array<StepResult<...>>>` | `dist/index.d.ts:2804` |
| stream parts | `finish-step` part carries `usage` | `LanguageModelUsage` | `dist/index.d.ts:3037` |
| | `finish` part carries `totalUsage` | `LanguageModelUsage` | `dist/index.d.ts:3050` |
| callbacks | `onFinish` / `onEnd` / `onStepFinish` / `onStepEnd` on both `streamText` and `generateText` | | `dist/index.d.ts:3503`, `4680` |

`LanguageModelUsage` shape (`dist/index.d.ts:321-371`) — **every field is `number | undefined`**:

```ts
type LanguageModelUsage = {
  inputTokens: number | undefined;
  inputTokenDetails: { noCacheTokens, cacheReadTokens, cacheWriteTokens };  // each number | undefined
  outputTokens: number | undefined;
  outputTokenDetails: { textTokens, reasoningTokens };
  totalTokens: number | undefined;
  raw?: JSONObject;   // "the usage information in the shape that the provider returns"
};
```

**The `| undefined` is load-bearing**: the SDK's own type system tells us a provider may report nothing. Any accounting we build must handle `undefined` as the normal case, not the error case.

### Does the OpenAI-compatible provider need an explicit option for STREAMING usage? **Yes — and we are not setting it.**

Verified in `@ai-sdk/openai-compatible@3.0.5`:

- `src/openai-compatible-provider.ts:87` — the provider setting, with doc comment `/** Include usage information in streaming responses. */`:
  ```ts
  includeUsage?: boolean;
  ```
  It is optional with **no default**, and is threaded to both chat and completion models at `src/openai-compatible-provider.ts:173` and `:184`.

- `src/chat/openai-compatible-chat-language-model.ts:441-444` — the only place `stream_options` is ever emitted:
  ```ts
  const body = this.transformRequestBody({
    ...args,
    stream: true,
    // only include stream_options when in strict compatibility mode:
    stream_options: this.config.includeUsage ? { include_usage: true } : undefined,
  });
  ```
  Identical logic in `src/completion/openai-compatible-completion-language-model.ts:262-265`.

- **Our call site**, `packages/core/src/main.ts:103-107`:
  ```ts
  const provider = createOpenAICompatible({
    name: "taki-provider",
    baseURL: providerConfig.baseUrl,
    apiKey: providerConfig.apiKey,
  });
  ```
  No `includeUsage`. The vision provider at `main.ts:111` is likewise bare.

**Consequence**: on the streaming path, `stream_options: { include_usage: true }` is not sent. Most OpenAI-compatible servers only emit the final usage chunk when asked, so `result.usage` / `totalUsage` will very likely resolve with `inputTokens: undefined`. The non-streaming path is unaffected — usage comes back in the response body regardless.

**Caveat we should not paper over**: the SDK's own comment is *"only include stream_options when in strict compatibility mode"*. Setting `includeUsage: true` sends an extra body field to the upstream server. Strict gateways that reject unknown fields could 400 — this is exactly the class of failure Hermes documents for unknown top-level *message* keys (*"Extra inputs are not permitted"* from Fireworks / Mistral / Moonshot / opencode-go). It is likely fine (`stream_options` is standard OpenAI), but it is a **provider-agnosticism risk that must be a config toggle, not a hardcoded `true`**, and it must degrade to the estimator when usage is absent.

### How the four systems know the context size before sending

| System | Method |
| --- | --- |
| Claude Code | **Hybrid**: real API usage (`input_tokens + cache_* + output_tokens`) from the previous response, char/4 heuristic for messages added since (`tokenCountWithEstimation`) [mirror] |
| OpenClaw | **Layered fallback**: provider usage → local `estimateMessagesTokens` → `transcriptBytes / 4`; takes `max(usage, estimate)` when both exist; projects next input as `prevPrompt + prevOutput + currentPromptEstimate` [code] |
| Hermes | **Provider usage primary** (`update_from_response`), rough char/4 + tool-schema estimate for preflight; deliberately overestimates schema-heavy requests then defers to real usage once a compressed call is proven to fit [code] |
| Codex | Local `ContextManager::estimate_token_count` [code] |
| AI SDK v7 | **Nothing.** The docs' own example is `JSON.stringify(messages).length / 4` |

**Not one of them uses a provider-specific tokenizer or a count-tokens endpoint in the compaction hot path.** Universally: previous-response usage as the anchor + a char/4 estimator for the delta. Both are provider-agnostic. This resolves the constraint cleanly — the disqualified option (provider tokenizer) is not what anyone actually does anyway.

### What we already have

`packages/core/src/memory/token-estimator.ts` already implements a **better-than-char/4** estimator: CJK codepoints count ~1 token/char, everything else ~1 token / 4 chars, with a `fitToBudget(items, budget, textOf)` helper that always keeps the first item. Its header notes the constants live in one place *"so calibration against real provider `usage` is a two-line tweak"* — i.e. the file was written anticipating exactly this. For a Japanese-capable companion agent, plain char/4 would **underestimate CJK-heavy history by ~4×**; this file already avoids that trap and is the right foundation.

Gaps vs the four systems: it estimates text only. It does not account for (a) tool JSON schemas — Hermes measures these at 20–30K tokens with 50+ tools and calls ignoring them *"a significant blind spot"*; (b) images — both Claude Code and Hermes use a flat **1,600 tokens per image**, which matters for us since we ship screenshots and user image attachments; (c) message/role envelope overhead.

---

## §7 — OMITTED / not sourced

Every sub-question I could **not** source. This list is deliberately complete.

### Claude Code

- **A — exact per-tool caps as official behavior.** `tengu_hawthorn_window: 200000`, `tengu_pewter_kestrel: {global: 50000, Bash: 30000, Grep: 20000}` come from a GitHub issue where users dumped their own GrowthBook flag cache and intercepted request bodies. They are **[community]**, server-flag-gated, and different users reported different observations (one team logged 261 budget events in a session; another logged 0 microcompact events across 4,700 calls over 8 days). **Not sourced** as vendor-documented values. The Anthropic *API* defaults (100K trigger / keep 3 tool uses; 150K compact trigger / 50K minimum) ARE official [docs] and should be preferred as the citable numbers.
- **A — whether Claude Code caps a tool result at write time vs. only in the pipeline.** `applyToolResultBudget()` is described as running "before microcompact in the request pipeline" [community]; I found no source distinguishing write-time truncation from pre-request truncation. **Not sourced.**
- **B — whether compaction is truly synchronous.** The mirror shows `autoCompactIfNeeded` awaited in the query loop (synchronous), but one 2026 blog claims that since v2.0.64 "auto-compact executes instantly" via "a faster model for the summarization step". The mirror shows the summary using `mainLoopModel`. These conflict; I could not resolve it. **Not sourced.**
- **E — the 33,000-token reserve figure.** One blog states it as hardcoded; the source-level constants are 13,000 + 20,000. I offer the reconciliation above as *inference*, not sourced fact.
- **C — how much context compaction actually frees.** "~40-60%" appears in one deep-dive with no measurement methodology. **Not sourced.**
- **General caveat**: all Claude Code source citations are from **third-party mirrors** (`claude-code-best`, `zackautocracy`, a deobfuscation gist). Two mirrors agreeing verbatim raises confidence substantially, but this is not vendor-published source and versions drift fast.

### OpenClaw

- **B — the numeric "built-in headroom for prompts and the next model output"** used by threshold maintenance. Docs say it exists and is capped against the model window; the actual formula is **not sourced**.
- **C — the compaction summary's section structure.** Unlike Claude Code and Hermes, I found no published template or prompt text for `generateSummary` / `buildCompactionSummarizationInstructions`. Sub-question C is **partially unanswered** for OpenClaw: I can say where the summary goes and how it persists, but not what it contains.
- **A — `contextPruning` behavior for non-Anthropic providers in practice.** Docs say pruning is off by default outside Anthropic and one mirror says it is *"only active for Anthropic API calls (and OpenRouter Anthropic models)"* while the main docs present it as generally configurable. Whether enabling `cache-ttl` on a generic OpenAI-compatible provider actually prunes is **not sourced**, and it matters for us.
- **G — `deriveContextPromptTokens` internals** (which usage field it prefers, cache handling). Read the call sites, not the implementation. **Not sourced.**
- **D — nothing found.** Confident negative.
- **Version drift risk**: several OpenClaw doc mirrors (`docs.openclaw.ai`, `docs2.openclaw.ai`, `openclaw-ai.com`, `docs.claw.so`) disagree on details (e.g. `cacheRetention` vs `cacheControlTtl`, `*.jsonl` vs SQLite transcripts). I preferred `docs.openclaw.ai` + the GitHub source where they conflicted.

### Hermes

- **Confidence here is highest** — all from source on disk. Two gaps:
- **C — I did not read `_build_static_fallback_summary` (lines 1839–2033)** or `trajectory_compressor.py` (1,574 lines) or `agent/conversation_compression.py`. The deterministic no-LLM fallback summary's exact content is **not sourced**.
- **B — the `plugins/context_engine/` directory** (the LCM alternative engine referenced by the ABC) was not read. Whether a shipped non-summarization engine exists there is **not sourced**.
- **The `hermes-agent-main` tree on disk is a snapshot** of unknown vintage; issue numbers in comments run to #65848 (Jul 2026), so it is recent, but I did not verify it against upstream HEAD.

### OpenAI

- **4a/B — `OpenAIResponsesCompactionSession.should_trigger_compaction` default threshold.** Referenced in the docs, value **not sourced**.
- **4a/C — what `responses.compact` actually produces.** It returns an opaque encrypted blob (per Codex source). The summary's structure, prompt, and sections are server-side and **not sourced** — likely unknowable.
- **4b — the Codex `SUMMARIZATION_PROMPT` text** (`templates/compact/prompt.md`) and `SUMMARY_PREFIX`. Referenced by `include_str!` in the source I read; the template files themselves were **not read**. Sub-question C for the Codex local-fallback path is therefore structurally described but not quoted.
- **4b — `tool_output_token_limit` default.** 16,000 appears in a blog's example config; whether that is the default or the author's chosen value is **not sourced**.
- **4b — the ~258,400 effective GPT-5.5 window.** [community], single source. Treat as illustrative of the failure mode, not as a fact about any model.

### AI SDK v7 (§5/§6)

- **Whether `includeUsage: true` is safe against arbitrary OpenAI-compatible gateways.** The SDK's own comment (*"only include stream_options when in strict compatibility mode"*) implies it is not universally safe, but I found **no list** of which gateways reject it. This needs an empirical check against our actual provider before it is turned on. **Not sourced — and this is the one gap that blocks a decision.**
- **Whether any AI SDK v7 *provider* implements server-side context management passthrough** (e.g. `@ai-sdk/anthropic` exposing `context_management.edits` / `clear_tool_uses_20250919` via `providerOptions`). We do not use `@ai-sdk/anthropic`, so I did not check. **Not sourced**, and out of scope under the provider-agnostic rule anyway.
- **Whether `pruneMessages` is re-exported from `@ai-sdk/react` / UI packages** or is core-only. The reference doc for it is filed under `07-reference/02-ai-sdk-ui/`, which is odd, but the implementation lives in `src/generate-text/` and it is exported from `'ai'`. The doc placement looks like a filing error; **not confirmed**.
- **Version pinning**: everything in §5/§6 is verified against **`ai@7.0.17`** and **`@ai-sdk/openai-compatible@3.0.5`** exactly as installed. `packages/core/package.json` declares `^7.0.17` / `^3.0.5`, so a minor bump could add helpers (or move `pruneMessages`). Re-verify against `node_modules` before implementing, per the repo's standing rule.

### Cross-cutting: sub-question D

**Only Claude Code addresses stale tool results, and it does so at the tool layer (`readFileState` + mtime/content guard), not the context layer.** OpenClaw, Hermes, Codex, and the OpenAI Agents SDK: **nothing found** — no staleness markers, no re-read hints, no invalidation. Hermes's newest-copy-wins dedupe is the closest thing and it is incidental. For us this means: if stale perception data matters (a screenshot description that no longer reflects the screen, a memory row edited after it was replayed), **there is no prior art to copy** and it would be original design. Given the owner's ranking, that argues for deferring D explicitly rather than inventing it inside T5.

---

## Appendix — our current state, for the record

| Fact | Location |
| --- | --- |
| Replay window: newest 200 rows, no token budget | `packages/core/src/agents/conversation-store.ts:14` (`REPLAY_WINDOW = 200`) |
| ADR 0005 noted in-code as "compaction/token-budgeting is a later concern" | `conversation-store.ts:12` |
| Leading orphan `tool` rows dropped from replay (window can strand a tool row whose call fell outside) | `conversation-store.ts:66-69` |
| Full multi-part fidelity persisted per turn (assistant tool-call parts + tool-result messages) | `conversation-store.ts:23-27` (`appendTurn`) |
| Pre-compaction flush, cited as "OpenClaw pattern", silent tool-enabled turn, output discarded, `MAX_STEPS = 8` | `packages/core/src/memory/flush-writer.ts` |
| Flush treats the `REPLAY_WINDOW` boundary AS the context edge | `conversation-store.ts:13` |
| Token estimator with CJK regime + `fitToBudget`, written for calibration against real usage | `packages/core/src/memory/token-estimator.ts` |
| Provider created **without** `includeUsage` | `packages/core/src/main.ts:103-107` (and `:111` for vision) |
| Already on `ToolLoopAgent` (so `prepareStep` is available today) | `flush-writer.ts:31` |
| Installed versions verified | `ai@7.0.17`, `@ai-sdk/openai-compatible@3.0.5` |

Related prior research in this workspace (not repeated above): `hermes-memory-analysis.md` (Hermes memory/learning architecture vs ours, for T5/D28), `m5-tool-governance-survey.md`, `t4-prompt-design-survey.md`.
