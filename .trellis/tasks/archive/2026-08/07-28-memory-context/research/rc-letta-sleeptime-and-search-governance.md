# Research: Letta sleep-time recipe (clean-room) + search-frequency governance

- **Query**: (A) What does Letta's sleep-time compute ACTUALLY do, precisely enough to clean-room adapt — and does any deterministic detection feed it? (B) Does anything in the field govern how often an agent searches memory?
- **Scope**: mixed — local source tree `references/letta-main` (Apache-2.0, patterns only, never ported), `references/nocturne_memory-main` (MIT, same stance), plus web
- **Date**: 2026-07-28
- **Tool constraint honoured**: all web via `mcp__exa__web_search_exa`. No native WebSearch/WebFetch.
- **Not duplicated here**: `.trellis/workspace/pleia/t5-memory-systems-survey.md` §1 (Letta A–H) and §0.1 (A7/A11/A12/A14). This document verifies §1.C against the real implementation, adds what §1 could not see (the actual prompt text, the exact input payload, termination wiring, the deterministic-signal question), and answers the health-report-vs-raw-material question.
- **Binding context assumed**: `t5-decisions.md` R0–R22. Every adaptation below cites the R it rides on.

---

## PART A — The verified Letta sleep-time recipe

### A1. One-line answer to the decision-critical question

**Letta hands the model raw material with essentially no deterministic pre-analysis.** The only machine-computed facts in the sleep-time agent's context are (a) per-block `chars_current` / `chars_limit`, and (b) view-only line numbers for precise editing. There is no defect list, no staleness scan, no duplicate detector, no health report anywhere in the path. Detection is 100% model judgment over a conversation transcript. (Evidence: A3 below; the full input payload is assembled at `references/letta-main/letta/groups/sleeptime_multi_agent_v4.py:216-253` and contains nothing else.)

### A2. The recipe, verified against source

| Element | What Letta actually does | Source |
| --- | --- | --- |
| **Trigger** | A turn counter on the *group*, bumped after every foreground step; the sleep-time agent runs when `turns_counter % sleeptime_agent_frequency == 0`. Default frequency **5**. If frequency is `None`, it runs **every** turn. Skipped entirely if the foreground step produced no response messages. | `letta/groups/sleeptime_multi_agent_v4.py:138-151`; default set at `letta/server/server.py:783-786` |
| **Where it fires** | Inside the foreground `step()`/`stream()` wrapper, *after* the user-facing response is complete — `stream()` even puts it in a `finally` so it survives `GeneratorExit`. Dispatched as a detached `safe_create_task` with its own `Run` row (`run_type: "sleeptime_agent_send_message_async"`, status created→running→completed/failed). The user never waits. | `:65-82`, `:126-129`, `:170-199`, `:211-214`, `:269-288` |
| **Input data** | Exactly the *new* conversation slice: messages `after=last_processed_message_id` and `before=response_messages[0].id`, concatenated with the current response messages, each run through `stringify_message`, joined with `\n`. A high-water mark (`get_last_processed_message_id_and_update_async`) guarantees no re-processing and no gaps. On failure to fetch priors it silently continues with just the latest messages. | `:152-154`, `:216-231` |
| **How the input is framed** | Wrapped in a `<system-reminder>` block and delivered as a **`role: "user"` message**, verbatim: *"You are a sleeptime agent - a background agent that asynchronously processes conversations after they occur. IMPORTANT: You are NOT the primary agent. You are reviewing a conversation that already happened between a primary agent and its user: - Messages labeled \"assistant\" are from the primary agent (not you) - Messages labeled \"user\" are from the primary agent's user. Your primary role is memory management. Review the conversation and use your memory tools to update any relevant memory blocks with information worth preserving. Check your memory_persona block for any additional instructions or policies."* then `Messages:\n{transcript}`. | `:233-253` |
| **System prompt** | `sleeptime_v2` (selected by agent type). Quoted in full in A4. | `letta/services/helpers/agent_manager_helper.py:206-209`; `letta/prompts/system_prompts/sleeptime_v2.py` |
| **Policy slot** | A per-agent `memory_persona` block, seeded from a 5-line text file, referenced by the system-reminder as "additional instructions or policies" — i.e. the *editable* policy layer sits in a memory block, not in the system prompt. | `letta/server/server.py:764-768`; `letta/personas/examples/sleeptime_memory_persona.txt` |
| **Tools** | `BASE_SLEEPTIME_TOOLS = ["memory_replace", "memory_insert", "memory_rethink", "memory_finish_edits"]`. Archival/conversation-search tools are present in the list but **commented out**. The primary agent gets the complement: `BASE_SLEEPTIME_CHAT_TOOLS = ["send_message", "conversation_search", "archival_memory_search"]` — search but no edit. | `letta/constants.py:132-146` |
| **Termination** | `memory_finish_edits` is a no-op function; the loop end is enforced by a **tool rule**: it gets `TerminalToolRule`, every other memory tool gets `ContinueToolRule`. So the model literally cannot stop except by calling finish. Step ceiling is the ordinary `DEFAULT_MAX_STEPS = 50`. | `letta/services/agent_manager.py:480-485`; `letta/functions/function_sets/base.py:520-527`; `letta/constants.py:75` |
| **Model** | Text sleep-time agent **inherits the primary's `llm_config`** in code. The "use a stronger model" advice is documentation/blog only, not a default. (The *voice* variant does hard-code one: `LLMConfig.default_config("gpt-4.1")`.) | `letta/server/server.py:771` vs `:806`; blog: use a larger/slower model for sleep-time since it is "less latency constrained" — https://www.letta.com/blog/sleep-time-compute/ |
| **Where output lands** | Shared **memory blocks**, not new records: the sleep-time agent is created with `block_ids=[b.id for b in main_agent.memory.blocks]`, so its edits mutate the primary's in-context memory directly and "anytime" (primary reads whenever, never waits). | `letta/server/server.py:762`; blog (anytime semantics) |
| **Deterministic input** | `chars_current` / `chars_limit` per block, plus `1→` line-number prefixes with an explicit "do NOT include line numbers in tool calls" warning (line numbering is enabled only for sleeptime/memgpt_v2/letta_v1 agent types **on Anthropic models**). Nothing else. | `letta/schemas/memory.py:154-165`, `:175-200`, `:696-712`; `letta/constants.py:246` |

### A3. Evidence that there is no health-check stage

Four independent checks, all negative:

1. The entire input payload is constructed in one place (`sleeptime_multi_agent_v4.py:216-253`) and contains only the transcript + the framing reminder.
2. `grep` for `sleeptime|sleep_time` across `letta/` returns no analyzer, scanner, diagnostic or report module — the hits are agent classes, group managers, prompts, tool lists, schemas and REST plumbing.
3. Letta has **no write-time dedup at all** (survey §1.A, re-confirmed): archival insert embeds and inserts unconditionally; blocks are free text. There is therefore nothing to report on.
4. Letta has **no scoring/decay/usage columns** (survey §1.D) — no staleness or importance signal exists to compute a report *from*. Its only quantitative memory-health notion is the block budget, which is exactly what it surfaces.

The *structural* control Letta does apply is on the **tool graph**, not on the data: the primary agent is denied edit tools and the sleep-time agent is denied search tools; the loop shape is forced by `Init/Child/Continue/Terminal` rules. The strongest example is the voice variant, which pins an exact sequence — `InitToolRule(store_memories)` → `ChildToolRule(store_memories → rethink_user_memory)` → `ContinueToolRule(rethink_user_memory)` → `TerminalToolRule(finish_rethinking_memory)` (`letta/agents/voice_sleeptime_agent.py:86-91`), with the prompt restating it: *"You MUST ONLY output tool calls in the specified sequence: First `store_memories` (once), then one or more `rethink_user_memory` calls, and finally `finish_rethinking_memory` (once)."* (`letta/prompts/system_prompts/voice_sleeptime.py:74`).

**Read this as the actual design principle: Letta constrains the PROCESS deterministically and leaves the JUDGMENT entirely to the model.**

### A4. The prompt, verbatim (load-bearing lines)

`letta/prompts/system_prompts/sleeptime_v2.py` — the whole thing is 30 lines; these are the operative ones:

- Role: *"You run in the background, organizing and maintaining the memories of an agent assistant who chats with the user."* (:5)
- Tool granularity doctrine: *"Use your precise tools to make narrow edits, as well as broad tools to make larger comprehensive edits… you can use your `rethink` tool to reorganize the entire memory block at a single time."* (:14-15)
- The goal statement: *"You goal is to make sure the memory blocks are comprehensive, readable, and up to date."* (:16)
- Absolute-time rule: *"be precise when referencing dates and times (for example, do not write \"today\" or \"recently\", instead write specific dates and times, because \"today\" and \"recently\" are relative, and the memory is persisted indefinitely)."* (:17)
- Loop rule: *"You should continue memory editing until the blocks are organized and readable, and do not contain redundant and outdate information, then you can call a tool to finish your edits."* (:20)
- **The permission to do nothing**: *"If there are no meaningful updates to make to the memory, you call the finish tool directly. Not every observation warrants a memory edit, be selective in your memory editing, but also aim to have high recall."* (:24-25)
- Line-number caveat (:28).

The `memory_persona` seed (`letta/personas/examples/sleeptime_memory_persona.txt`, 5 lines, in full):
> *"I am an expert conversation memory agent that can do the following: - Consolidate memories into more concise blocks - Identify patterns in user behavior - Make inferences based on the memory. I manage the memory blocks such that they contain everything that is important about the conversation."*

Note what is **absent** from both: any enumeration of defect classes, any threshold, any "check for duplicates" instruction. The only named defects are "redundant and outdate information" in one clause.

The richer, *task-decomposed* prompt is the voice variant (`voice_sleeptime.py:60-66`), whose refinement principles are the best single source of adaptable wording: **Integrate** (merge new facts), **Update** ("Remove or correct outdated or contradictory information"), **Organize** ("Group related information logically (e.g., preferences, background details, ongoing goals, interaction styles)"), **Infer Sensibly** ("Add light, well-supported inferences… but do not invent unsupported details"), **Be Precise** (absolute dates), **Be Comprehensive & Concise** ("Aim for high recall and readability").

### A5. Tool semantics (what each verb actually means)

| Tool | Signature | Semantics |
| --- | --- | --- |
| `memory_replace` | `(label, old_string, new_string)` | Exact-string replace, raises if not found. Docstring explicitly forbids using it for large rewrites: *"Do NOT attempt to replace long strings, e.g. do not attempt to replace the entire contents of a memory block."* Empty `new_string` = delete. Rejects line-number prefixes with a structured `ValueError`. |
| `memory_insert` | `(label, new_string, insert_line=-1)` | Line-addressed insert; `-1` = append, `0` = prepend. Append-only ⇒ concurrency-safe. |
| `memory_rethink` | `(label, new_memory)` | **Whole-block rewrite.** *"Use this tool to make large sweeping changes (e.g. when you want to condense or reorganize the memory blocks), do NOT use this tool to make small precise edits."* Creates the block if absent. Last-writer-wins. |
| `memory_finish_edits` | `()` | Returns `None`. Pure loop-exit signal (see termination row above). |

Source: `letta/functions/function_sets/base.py:311-527`.

### A6. Bonus finding — Letta's own markdown-files-as-truth mode

Relevant because our substrate is markdown-files-as-truth. Letta ships an opt-in (`git-memory-enabled` tag) block store where **git is the source of truth and Postgres is a cache**: each block is serialized to `<label>.md` with frontmatter carrying `description`, `limit`, `read_only`, `metadata`, and every edit is a commit with an author and a message (`letta/services/block_manager_git.py:1-8,27-40`; `letta/services/memory_repo/memfs_client_base.py:230-256`). This is a direct precedent for "block = file, edit = commit" and for keeping the frontmatter budget next to the content.

### A7. Numbers

| Quantity | Value | Source |
| --- | --- | --- |
| `sleeptime_agent_frequency` default | **5** primary steps (code default; docs recommend 5 or 10, "too often can be expensive… and has diminishing returns") | `server.py:785`; docs.letta.com sleeptime |
| Frequency = `None` | runs on **every** foreground step | `sleeptime_multi_agent_v4.py:144` |
| Max steps for the sleep-time run | `DEFAULT_MAX_STEPS = 50` | `constants.py:75` |
| Voice variant trigger | message-buffer thresholds `DEFAULT_MAX_MESSAGE_BUFFER_LENGTH = 30`, `MIN = 15` (summarizer inside the agent uses 20/10) | `constants.py:89-90`; `voice_sleeptime_agent.py:60-65` |
| Voice sleep-time model | hard-coded `gpt-4.1` | `server.py:806` |
| LoCoMo, Letta Filesystem, gpt-4o-mini | **74.0%** vs mem0's reported 68.5% graph variant; agent forced to `search_files` first, loops until it calls `answer_question`; "What it searches for and how many times it calls tools is up to the agent" | https://www.letta.com/blog/benchmarking-ai-agent-memory/ (caveat: self-reported, LLM-as-judge GPT-4.1, adversarial questions excluded — https://agentmemorybenchmark.ai/dataset/locomo) |

---

## PART A2 — Clean-room adaptation map onto our substrate

Take the **shape**, not the code. Every row cites the binding decision it serves.

| Letta element | Our equivalent | Notes / deltas |
| --- | --- | --- |
| Sleep-time agent = separate agent, separate tools, shares the blocks | A background **tidy pass** on the R11 utility model slot, with its own tool set, writing the same store the foreground agent reads | R11 already ratified the slot; "background tasks run serially" is already a constraint |
| Trigger = counter mod N on foreground steps | R9's write-count trigger (~40 writes/character) + explicit operator WS call + croner wall-clock later | Letta's counter is on *agent steps*; ours is on *memory writes*, which is strictly better targeted — a chat turn that writes nothing cannot dirty the store. Adopt Letta's guard verbatim in spirit: **if nothing new happened since the last pass, do not dispatch at all** (`:147-150`) |
| High-water mark `last_processed_message_id` | A `last_tidied_at` / `last_tidied_seq` per character | Non-optional. It is what makes the pass idempotent and bounded; without it every pass re-reads the whole store |
| Input = new transcript slice only | Input = the **entries written since the last pass** (plus, see A3-answer, a bounded candidate set) | Our raw material is already extracted entries, not raw chat — strictly less noisy than Letta's input |
| Framing as a `role: "user"` system-reminder, "you are NOT the primary agent" | Same shape. Our version must also say she is not talking to the user and must produce **no user-visible text** | The base prompt forbids machine self-narration; a tidy pass that emits chat would violate it |
| System prompt `sleeptime_v2` | Our tidy-pass prompt. Port the six voice-variant refinement principles (A4) + the two absolutes: **absolute dates only** and **"if there are no meaningful updates, finish immediately"** | The "not every observation warrants an edit" clause is the direct analogue of R15's behaviour-change gate; keep one voice across episodic writer / flush / tidy per R10 |
| `memory_persona` block = editable policy | Our assistant-layer card / settings text | Keeps the policy user-tunable without touching the base prompt |
| `memory_rethink` (whole-block rewrite) | **The block-write tool R20 already requires.** Rethink ≙ read block → rewrite block → write back | R20's argument (a correction in block form "cannot half-fail") is exactly why Letta gives the *background* agent the rethink tool and the foreground agent none |
| `memory_replace` / `memory_insert` (precise edits) | Our row-level ops on the searchable tier: reinforce / archive-and-supersede (R18) / set `disclosure` / re-file layer | Keep the docstring discipline: precise tools for narrow edits, block rewrite for sweeping ones. It is the cheapest defence against a runaway rewrite |
| `memory_finish_edits` + `TerminalToolRule` | An explicit `finish` tool that ends the pass, plus a hard step cap | Do **not** rely on the model "just stopping". Letta enforces exit structurally, and this is a two-line rule. Our cap should be far below 50 |
| Tool asymmetry (primary: search-only; sleep-time: edit-only) | Partially ours already; the tidy pass should hold **maintenance verbs the foreground agent does not have** | Guards against the foreground agent doing bulk reorganisation mid-conversation, which R17 (spot fixes) deliberately keeps narrow |
| Output lands in shared blocks, read "anytime" | Tidy pass writes the R14 pinned index block + repairs rows | This is A12/R14 already: "deterministic push whose CONTENT was computed by a background job" |
| `chars_current` / `chars_limit` in the rendered block | Our layer-over-budget number, rendered next to the block | Cheap, and it is the one deterministic signal Letta *does* pass — see the answer below |
| Model = inherits primary's config | R11 utility slot, falls back to main model when unconfigured | Identical shape. The "stronger model" advice is guidance, not a default — do not treat it as a requirement |

### The OPEN question — health report as INPUT, or raw material with no pre-analysis?

**Answer: give the model a deterministic health report, but as a CANDIDATE SET plus evidence — never as a verdict, and never as the only input.** Letta's design does not argue against this; it is silent on it, for a reason that does not apply to us.

Why Letta is not evidence against a health report:

- Letta has nothing to report. No dedup, no importance, no decay, no usage counters (A3, points 3–4). "Pure model judgment over raw material" is not a considered rejection of deterministic detection — it is the only option a store with no per-item metadata has. Our store has `importance`, `createdAt`, `layer`, `disclosure`, FTS5 and (per R9) reinforcement counts. We can compute what Letta cannot.
- Letta's input is *bounded by construction*: one transcript slice since the high-water mark, ~5 turns of material. It never faces "which of my 4,000 rows are broken?" Our tidy pass does. Handing a growing store to the model as undifferentiated raw material does not scale, and R9's whole justification for the scheduled pass is that a pull-only store degrades as it grows.
- Letta *does* pass the one deterministic signal it has — the block budget — into the model's context, unprompted. That is a health number, delivered exactly the way the report should be: as a fact next to the material, not as an instruction.

Why the report must not become a verdict — Nocturne, which is the actual prior art here, is explicit about the split:

- Detection is SQL: `get_diagnostics()` computes stale / crowded / orphaned / duplicate-alias with per-priority thresholds, entirely in the data layer (`references/nocturne_memory-main/backend/db/graph.py:438-495`). Rendering is a plain markdown report ending in "No issues found. Memory system is healthy." when clean (`backend/system_views.py:397-500`).
- The report is **pulled** as a resource (`system://diagnostic/<domain>`, `backend/mcp_server.py:395-405`), not pushed.
- And the audit skill instructs the model to *re-diagnose each reported item itself*: for every stale node, "first ask yourself one question: **why was it not read?** Before you answer that, go read its content, its disclosure, its parent position. Use your own judgment to infer the cause, then choose the sub-skill based on your diagnosis. The following are patterns you might find, but they are only crutches for thinking, not an exhaustive list" (`docs/skills/memory-audit/SKILL.md:41`, translated; original Chinese). The skill also says explicitly not to scan the whole tree — start from what the conversation touched, what diagnostic reported, a weighted-random node, or the index (`SKILL.md:34-47`).

So the two systems are not in conflict; they answer different questions. Letta answers *"how do I get a model to rewrite a block well?"* (process constraints + a permission to do nothing). Nocturne answers *"how do I stop the model wasting a whole pass deciding where to look?"* (SQL narrows the search space; the model still decides what the defect is).

**Concrete recommendation for our five-defect checklist:**

1. Run the SQL for all five classes (stale / near-duplicate / missing recall-trigger / misfiled layer / layer-over-budget). Detection stays deterministic so **a clean store costs zero tokens** — the pass must be able to exit without a model call at all, which is the property Letta gets from `if not last_response_messages: return`.
2. Feed the model the report as **evidence + candidates**, with each item's actual content, `disclosure`, layer, importance and the threshold it crossed — the way Nocturne prints `Priority: N | Stale for: ~M days (Threshold: T days)`. Not "this is a duplicate", but "these two are lexically near-identical; here they are".
3. Two of the five are *facts*, not hypotheses, and can be stated as such: **missing recall-trigger** (`disclosure` empty is a boolean, and under R12 it means the entry can never fire the index) and **layer-over-budget** (arithmetic — this is Letta's `chars_current`/`chars_limit`, verbatim). Present them flatly.
4. Three are *hypotheses* and must be phrased as questions: **stale** ("why was this never recalled?"), **near-duplicate** ("are these the same thing, or a real distinction?"), **misfiled** ("does this belong where it is?"). Letta's rethink doctrine covers the repair; Nocturne's "ask why first" covers the diagnosis.
5. Also give the pass the material Letta gives it — the entries written since the last high-water mark — so a fresh mistake is caught before it ages into a defect. The report covers the *accumulated* store; the recent slice covers the *new* store. They are complementary, and Letta only has the second.
6. Do **not** let the SQL prescribe the action. No auto-archive, no auto-merge. R8 (archive not delete) plus a model-chosen repair keeps every action reversible.

**Cost note this earns**: a report-driven pass is bounded by the number of *defects*, not by store size, which is what makes croner wall-clock scheduling affordable later. A raw-material pass over a growing store is not.

---

## PART B — Search-frequency governance

### B1. What the adaptive-retrieval literature actually governs

The owner's suspicion is half right. The mechanism is not obsolete and it is not over-engineered — but **none of it governs "how often should this agent call its memory-search tool"**. All of it governs *"should this generation step be grounded in retrieval"*, at the token or query level, inside a RAG pipeline where retrieval is architectural rather than agent-initiated.

| Work | What it actually governs | Signal it needs | Portable to prompt-only? |
| --- | --- | --- | --- |
| **Self-RAG** (arXiv 2310.11511) | Per-segment decision to retrieve, via `Retrieve` reflection tokens emitted by the model itself; threshold on the normalized probability of `Retrieve=Yes` | **Trained model** with an expanded vocabulary + a critic model to build the training corpus | **No.** Requires training |
| **FLARE** | Mid-generation re-query "when it encounters an uncertain token" — any token below a probability threshold | Token **logprobs** during decoding | **No.** No logprobs on our path |
| **DRAGIN** (arXiv 2403.10081) | Same timing question, refined: token entropy × attention-weighted importance × influence on subsequent tokens (RIND), plus attention-based query formulation (QFS) | Logprobs **and** attention weights | **No.** Attention weights are not exposed by any hosted API |
| **Adaptive-RAG** (arXiv 2403.14403) | Per-query routing into no-retrieval / single-step / multi-step | A **trained T5-large classifier** over query complexity | **No** as built. The *idea* — route by question shape — is what R12's trigger list already does in prompt form |
| **Adaptive Retrieval** (Mallen et al. 2023) | Retrieve only when the query's entity frequency falls below a threshold | An entity-popularity corpus | No |
| **Rowen / SeaKR** | Consistency across languages/models; internal-state uncertainty | Multiple generations, or internal states | No (Rowen is prompt-expressible but costs N generations per turn) |
| **TARG** (arXiv 2511.09803) | Single up-front gate from a short no-context draft prefix (k=20), using top-1/top-2 logit margin | **Prefix logits** — training-free but not logit-free | **No** |

Two honest findings from that same literature, both of which cut *against* building a guard:

- ACL 2025 `2025.acl-long.319` (AdaRAGUE) measured self-knowledge directly and found "most adaptive retrieval methods **may lack the ability to accurately identify self-knowledge, exhibiting near-zero correlation and random predictions**", singling out DRAGIN as dominating downstream tasks while performing poorly on self-knowledge. The decision quality of these gates is worse than their benchmark scores suggest.
- TARG's own baseline table includes **"Self-Eval Gate (prompt-based uncertainty)"** — the only prompt-only member of the family — and it is reported as a baseline that the logit-based margin beats. So the one portable variant is also the weakest one in its own paper. This is direct evidence that a prompt-based "should I search?" meta-step is not worth a turn.

**And note the direction of the whole field: every one of these methods exists to make agents retrieve LESS often (Always-RAG → 5–25% retrieval rate) because retrieval was architectural and unconditional.** Our R6 already removed unconditional retrieval. We are starting where they are trying to arrive. Adding a frequency guard on top of a pull-only design is solving the same problem twice, from the wrong side.

### B2. Framework-level tool-call governance

Budgets exist everywhere; **none is memory-search-specific**, and none is a cooldown between turns.

- **Letta tool rules** — the closest and the most portable. `MaxCountPerStepToolRule(tool_name, max_count_limit)` removes the tool from `available_tools` once it has been called N times **in the current step**, and renders into the prompt as `<tool_rule>\n{tool}: at most {N} use(s) per response\n</tool_rule>` (`references/letta-main/letta/schemas/tool_rule.py:315-345`). Note the two properties: it is per-**step**, not per-session, and the constraint is *both* enforced and told to the model. Also relevant: `InitToolRule` (`run_first`), `TerminalToolRule` (`exit_loop`), `RequiredBeforeExitToolRule`. The community best-practice guide applies `archival_memory_search: run_first` ("always check before inserting") — a *mandate to search*, not a limit on searching (https://forum.letta.com/t/sleeptime-agents-for-memory-consolidation-best-practices-guide/154).
- **Microsoft Agent Framework** — three orthogonal knobs, useful vocabulary: `max_iterations` (LLM roundtrips), `max_function_calls` (total invocations per request), `max_invocations` (lifetime cap on a specific tool instance, never auto-reset). https://github.com/microsoft/agent-framework/blob/de39be9e/python/samples/02-agents/tools/control_total_tool_executions.py
- **Generic production guidance** — `max_steps` / `max_seconds` / `max_tool_calls` / `max_usd` as a run-level budget layer with an explicit stop reason and an audit log (https://www.agentpatterns.tech/en/governance/budget-controls); token-bucket rate limiting is framed as protecting *dependencies*, explicitly not the same thing as a run budget (https://microsoft.github.io/agent-governance-toolkit/tutorials/policy-as-code/03-rate-limiting/). Glean's agent docs give the only retrieval-flavoured advice found: "If your agent is running out of tool calls before it finishes, break the work into **fewer, broader queries** rather than many narrow ones" (https://docs.glean.com/agents/concepts/limits-and-best-practices).
- **Nothing anywhere** implements a cooldown, a per-session search quota, or a "you already searched for this" suppressor.

### B3. Memory products' own guidance

- **mem0** documents *when to use* search in prose (context retrieval, personalization, fact checking, decision support) and tuning knobs (`top_k` 20, `threshold` 0.1, `rerank`) — no frequency guidance at all (https://docs.mem0.ai/core-concepts/memory-operations/search).
- **mem0's Claude Code plugin** goes the opposite way: a `UserPromptSubmit` hook that "searches relevant memories before each message; skips short prompts" — automatic per-turn retrieval with a length filter, i.e. exactly the design R6 removed (https://docs.mem0.ai/integrations/claude-code).
- **NVIDIA NeMo auto-memory-wrapper** ships `retrieve_memory_for_every_response: true` as the default — again architectural per-turn retrieval, not governance.
- **Nocturne** is the only system found with anything resembling a frequency rule, and it is a rule to search **more**, expressed as prompt text: "IF the user mentions a topic that should exist in your memory → `read_memory` first, then reply"; "IF you're unsure of a memory's URI → use `search_memory` with keywords. Don't guess URIs"; and the one genuinely count-based rule anywhere in the sweep — "**IF you've been replying for more than 15 turns**… immediately `read_memory` your core identity node to recalibrate" (`docs/system_prompt_en.md:34-37`). That 15-turn rule is a *floor*, not a ceiling, and it targets a specific pinned node rather than search.

### B4. Verdict

**The tentative conclusion stands, and the sweep strengthens it rather than merely failing to overturn it.** No standalone search-frequency guard is warranted.

- The survey's claim was accurate in substance: nothing governs *how often an agent searches memory*. What exists is (a) trained/logit-based gates for a different problem (unconditional RAG), and (b) generic run budgets that count all tool calls alike.
- The mechanism is not obsolete — adaptive retrieval is active research through 2026 — but it is **inapplicable**: every effective variant needs logprobs, attention, or a trained classifier. The single prompt-only variant (Self-Eval Gate) is its own paper's weak baseline, and the field's own measurement work reports near-random self-knowledge for most of these gates.
- It would be over-engineered *for us specifically*: adaptive retrieval exists to cut an always-on retrieval rate down to 5–25%. R6 already set ours to 0% by default. A guard on top would be a second brake on a system that has no accelerator.
- Keep, unchanged: prompt trigger/non-trigger lists (R12), the existing step caps, promotion-on-repeat (R16 — pin the fact rather than rate-limit the lookup; note R16 already frames repeated-search and repeated-write as "one mechanism seen from both sides"), and a **search log** for observation. The log is the load-bearing item: R12's open question is "what observable would tell us the bet went wrong", and the log is the only instrument that answers it in either direction — over-searching *or* under-searching.

**If 立项 decides a guard is needed anyway**, the cheapest defensible form — and the only one with prior art — is Letta's `MaxCountPerStepToolRule` shape: a per-**turn** cap (not a cooldown, not a session quota), enforced by removing the tool from the offered set after N calls, **and stated in the prompt in the same words as the enforcement** ("at most N use(s) per response"). Cost: one counter in the tool loop, one prompt line. It bounds a thrashing loop inside a single turn without ever preventing a search that a new turn justifies. Explicitly do **not** build: cooldowns across turns (they suppress the legitimate second question), query-similarity suppression (it re-introduces the "you already asked that" failure mode that R9 reinterprets as a *recall-failure signal* worth reinforcing, not silencing), or any confidence gate.

---

## OMITTED — could not verify

- **Whether Letta's shipped sleep-time agent is *recommended* to run on a stronger model by default.** The code inherits the primary's `llm_config` (`server.py:771`); "stronger model" appears only in blog prose. Anyone quoting the survey's §1.C "runs on a different, stronger model" should read it as documentation guidance, not observed default behaviour.
- **The sleep-time compute paper's exact conversational-memory prompt.** The paper's own experiments are Stateful GSM-Symbolic / AIME with `rethink_memory` + `finish_rethinking` over math contexts; the appendix prompts recovered are the math ones. The "re-organize and consolidate memories… Prioritize the new information over existing memories" line quoted in survey §1.C was not re-verified in this pass and is carried at the survey's confidence, not raised.
- **Any published memory-search invocation rate.** Confirmed absent again this round — no system publishes how often its agent calls a memory tool, so there is no baseline against which to calibrate a guard even if we wanted one.
- **Whether `sleeptime_agent_frequency` counts user turns or agent steps in practice.** The counter is bumped once per foreground `step()`/`stream()` call (`:141`), which is one *request*, not one LLM roundtrip — but DeepWiki describes it as "user turns". Not decision-relevant for us (our trigger is write-count), noted so nobody re-derives it.
- **Nocturne's "every 30–50 new memories" cadence.** Cited in survey §0.1 (A6); `grep` over `docs/` in the local tree did not locate that string. Either it lives outside the shipped docs or the survey took it from a secondary source. Treat as unverified.
