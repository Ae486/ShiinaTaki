# T5 (Memory + Context) — owner-ratified decisions from the pre-立项 grill

> Grill run 2026-07-26 during T3b implementation. These are BINDING inputs for the T5 PRD; each records
> the reasoning so 立项 does not re-litigate. Research bank: `t5-context-management-survey.md`
> (Claude Code / OpenClaw / Hermes / OpenAI + AI SDK v7), `t5-memory-systems-survey.md` (Letta / mem0 /
> Zep — in flight at time of writing).

## The framing ruling (everything below inherits from this)

**R0 — Memory is the product; compaction is a nice-to-have.** Owner: "陪伴型 agent 应该着重于记忆，压缩
属于是锦上添花… 侧重点不是摘要，而是提取有意义的信息放进对应的记忆。摘要要做，但不是保证 agent 质量最
重要的部分。" Memory and the context window are complements: memory carries long-term consistency, the
window carries short-term coherence. Every priority call in T5 resolves in favour of extraction quality
over summarization sophistication. The research supports this independently: Hermes' 3,521-line
compressor is almost entirely reliability scaffolding accreted from incidents, while the cheap wins
(informative tool-result one-liners, dedupe) are ~150 lines and serve extraction directly.

## Ratified — context

**R1 — Context is measured in TOKENS, never in message count.** Today `REPLAY_WINDOW = 200` messages,
which bears no relation to token size: 200 chat messages may be 8k tokens, 200 messages carrying
screenshot descriptions and exec output may be 80k. Mechanism, in three tiers, none provider-locked:
(1) each model slot DECLARES its `contextTokens`; (2) the previous response's real usage back-calibrates
a rolling correction factor over our own estimator; (3) with no usage available, fall back to pure
character estimation. Message count survives ONLY as a hard backstop against a broken estimator.
Provider-specific pre-flight token counting (Anthropic `count_tokens`, local tiktoken) is REJECTED as a
primary mechanism — provider lock-in, hard rule.

Two verified facts that constrain the implementation:
- Usage is inherently POST-HOC. It cannot decide what to include in the request that produces it. The
  estimator decides; usage only calibrates. This is not a compromise, it is the only possible shape.
- **We get no streaming usage today.** `@ai-sdk/openai-compatible` only sends `stream_options:
  {include_usage: true}` when explicitly configured, and `main.ts` does not configure it. Enabling it is
  a one-line change of unverified gateway compatibility — so the design MUST degrade to pure estimation
  when usage is absent, never fail.

**R2 — An overflow error RECALIBRATES the declared window; it does not trigger compaction.**
Leader-added patch to R1, owner-consistent. A `contextTokens` declared too high means our estimator
never warns and the upstream rejects the request — pre-compaction never gets a chance. On an overflow
error, lower that slot's effective window to ~90% of the observed usage and retry once. A
misconfiguration then costs exactly one failed request, ever, and self-heals. OpenClaw's
overflow-TRIGGERED compaction was considered and rejected by the owner: it reintroduces exactly the user
wait that R5 exists to eliminate.

**R3 — The summary enters as a MESSAGE at the head of the replayed history (the Claude Code shape),
replacing the dropped prefix.** Owner: "按 claude code 之类的处理方式，摘要直接进上下文，作为连贯性保证."
Landing site: `conversation-store.history()` is already the single storage→model-view transform, so the
substitution happens in one function and the STORED timeline is untouched — ADR 0005's append-only,
never-truncated-by-context-limits guarantee survives intact, and scroll-back still shows the real
conversation. The summary text is PERSISTED as one overwritable per-character record carrying the seq
range it covers (so it survives a restart instead of forcing a re-summarize or losing coherence), and it
is NOT a timeline row — the user must never see a machine summary in their chat history.

**R4 — Old tool results are folded before conversation text is touched.** Decay gradient:
tool-result → tool-call arguments → long assistant prose → user's own words (folded LAST, always — that
is the relationship itself). A fold keeps the call trace and the size, drops the payload; Hermes'
format is the model: `[read_file] read config.py from line 1 (1,200 chars)`. Keeping the trace matters
so she knows she already looked and does not repeat the call.

Leader correction recorded: folding does NOT solve the stale-data problem ("she read config.ts 30 turns
ago, the file changed, she now answers confidently from the old copy") — it only stops her from *seeing*
the stale copy. The real fix is at the TOOL layer: Claude Code tracks read files by mtime with an
explicit content-hash fallback on Windows (timestamps there can change without content changing).
OpenClaw, Hermes, Codex and the OpenAI Agents SDK do not address it at all. → deferred with trigger:
observing her answer from a stale tool result in practice.

**R5 — Pre-compact in the background at ~80%; the wall-hit fallback is HARD TRUNCATION, not synchronous
compaction.** Compaction never blocks a user turn. In the rare case a single input blows the window
outright, drop oldest rather than summarize: the request goes through, some coherence is lost, nothing
hangs. Deliberate trade under R0 — coherence is the nice-to-have, working is the floor. Reuses the
existing per-character turn serialization and the auto-memory mutex; no new concurrency mechanism.
A synchronous compaction would make the user watch an unexplainable ten-second pause (she cannot say
"I am compacting my context" — that is exactly the machine narration the base prompt forbids).

## Ratified — memory

**R6 — The per-turn automatically-injected RETRIEVED block is REMOVED.** This is the largest change in
T5. Owner's reasoning: keyword retrieval injects too much noise to be worth pushing every turn; removing
the noise would require semantic retrieval; semantic retrieval is too expensive to run on every turn;
therefore semantic retrieval belongs on the agent-initiated path where it runs rarely and with a
purposeful query. Memory reaches the model by exactly two paths afterwards:

| Path | Contents | Why this path |
| --- | --- | --- |
| **Deterministic push** (no search) | user identity card, pinned block (rule-selected: promises + high-importance profile), persona, time lines, perception | rule-based, no judgement needed, cannot miss |
| **Agent-initiated pull** | episodic / contextual memories via `memory_search` | whether it is relevant depends on the moment — that is a judgement |

The retrieval engine is NOT retired: it moves to serving `memory_search` only. Any future semantic
retrieval is added on the pull path. Dead after this change: `RECALL_WINDOW`, `RETRIEVED_BUDGET`,
`RETRIEVED_LIMIT`, and the assembler's retrieved section.

**R7 — Identity facts live in a user-editable card injected as prompt text, fully separate from the
agent-owned `profile` layer.** Owner's proposal, leader-endorsed. The card is the user's; the agent
reads it and never writes it; on conflict the card wins. This is the same mechanism `persona-provider.ts`
already uses for the assistant layer and per-character persona cards — one more card in the same loader,
zero new machinery. It deliberately bypasses the entire unreliable chain (which layer? what importance?
did retrieval hit?).

The card covers what the user will actually type in a panel (name, form of address, timezone, occupation,
hard preferences). It does NOT cover facts that arise in conversation ("I'm travelling next week"), so it
is the FLOOR, not the whole answer — R9's write-path fix is still required.

**R8 — `episodes` decay by importance tier; decay means ARCHIVE, not delete.** Files are the source of
truth and disk is cheap, so a misjudged archive is recoverable while a delete is not. Retention across
the registry, whose `retention` field currently has NO consumer anywhere in the tree (only its own unit
test reads it — the same class of hole T3b just closed for screenshot frames):

| Layer | Action |
| --- | --- |
| `activity` | hard delete after its rolling window (machine-written, high volume, zero sentimental value) |
| `intentions` | archive on expiry (small volume, archiving costs nothing) |
| `episodes` | archive below the importance cut after N days; above it, permanent |

This will be the THIRD isomorphic sweeper (attachment GC, ambient-frame GC already exist) — extract the
shared shape rather than copy it a third time.

**R9 — Write-time dedupe AND a scheduled tidy pass; both, with the tidy pass on a schedule.**
On a near-duplicate hit, REINFORCE the existing entry (raise importance, refresh recency) instead of
inserting a new row.

Owner's insight, recorded because it is load-bearing beyond dedupe: **a duplicate write is itself
evidence that recall FAILED for that item.** Had the memory been in context, she would not have needed
to write it again. So reinforcing on a duplicate hit is a self-correcting loop — and it is a strictly
better proxy signal than recall counts for the "adjust importance after the fact" question, because a
recall count only proves the entry was injected, while a duplicate write proves it was *absent* and
*needed*.

Note for 立项: the `writePolicy` enum already contains a `"consolidation"` value that NO layer uses and
NO code implements — the design anticipated this and the implementation never landed.

Where the literature stands on this ruling (survey §8.1), reported because it is NOT a consensus position:
- **Silence** from Letta, LangMem, A-MEM, MemoryBank, Generative Agents.
- **Contradiction** from mem0: both the v2 NOOP verdict and the v3 MD5 suppression discard the duplicate
  and keep no counter.
- **Closest agreement** from Graphiti: an exact-fact match appends the new episode's id to the existing
  edge, and a reranker can order by mention count — mechanically the same write-frequency→read-ranking
  loop, framed as provenance rather than as recall failure.
- **Warning worth heeding**: mem0 BUILT a full LLM operation-classifier (extract, then diff ADD/UPDATE/
  DELETE/NOOP against neighbours) and REMOVED it, stating the model "spends its capacity on understanding
  the input rather than diffing against existing state". Our dedup must stay lexical/normalised-string,
  not a second model call on the write path.
- **Honesty requirement** (Elastic is the only source to name it): reinforcing on retrieval rewards
  "recently tried" rather than "recently effective". If we reinforce on exposure we must document that it
  is exposure. The duplicate-write signal is better precisely because it evidences ABSENCE plus NEED, but
  the exposure caveat still applies to any recall-count term we add later.

**R10 — Memory entries are written in FIRST PERSON, from her point of view, preserving the user's own
wording.** Today's prompt opens `"You are a memory summarizer"` and yields minutes-of-meeting prose
("用户表达了负面情绪"). Two reasons to change, and the second is the decisive one:

1. Persona continuity — what she "remembers" should be a memory, not a third-party report about herself.
   This matters more once T4 burns these entries as heartbeat fuel.
2. **Retrieval hit rate.** Under R12 there is exactly ONE search attempt. The user later asks "你还记得
   我那天很烦吗" — a first-person entry says "他那天说很烦" and matches on 很烦; a third-person entry says
   "用户表达了负面情绪" and shares no substring at all. Persona quality and retrieval quality are the same
   lever here.

So: keep the user's actual words ("很烦", not "负面情绪"; "卡住了", not "遇到技术障碍"). Hallucination risk
is the known cost — mitigate with an explicit "write only what appears in the transcript; do not infer or
fill in" clause, the same family as the existing no-tool-result-no-claim floor.

The episodic prompt, the flush prompt and any future compaction prompt MUST share one person/wording
convention. They are currently two unrelated texts and would otherwise become three, giving her memory
three different voices.

**R11 — A separate UTILITY model slot for background work (memory writes, tidy passes, compaction),
falling back to the main model when unconfigured.** Today every background call — episodic writes every
20 messages, the flush turn (up to 8 steps), and everything R5/R9 adds — runs on the main model with no
budget, no throttle and no visibility, and episodic and flush can fire in the same pass. R6 makes this
worse, not better: with the retrieved block gone, memory quality is the sole pillar, so write-side work
GROWS. Isomorphic with the existing vision slot, so it is an extension of a known pattern, not a new
concept; it also lets background work run on a different provider entirely, which is a
provider-agnostic gain. Background token spend must be reportable (the media-usage method is precedent),
and multiple background tasks in one trigger run serially.

Independent support from research: OpenClaw's memory flush runs on a separate cheap model that
deliberately does not inherit the session's fallback chain.

**R12 — When to search is taught by PROMPT ONLY; one search attempt, no retry.** No deterministic
keyword assist.

**Leader correction after reading Nocturne's shipped prompt — the original framing here was weaker than
it should have been.** This entry first centred on "'I don't remember' is the trigger to search, not the
answer": the moment she is about to say she is unsure is the moment she must search first. That rule is
still correct and still in, but it is an EPISTEMIC trigger — it requires her to first notice a gap, which
is precisely the step that failed in the observed defect (she did not know she did not know).

Nocturne's primary trigger is a PATTERN-MATCH instead, and it does not depend on introspection at all:
"**IF the user mentions a topic that should exist in your memory** → read memory first, then reply." She
predicts the store's contents from the topic rather than detecting an absence in herself. Its section
header is itself the policy — "Reading — Remember First, Then Speak" — and it separates the two tools by
confidence: know where it is → read it; unsure → search by keyword, and "**Don't guess URIs**".

So the trigger set, strongest first: the user raises a topic her memory plausibly covers (primary,
pattern-match, no self-awareness required); a memory's own recall trigger matches the conversation (this
is what makes R14's index and the indexed `disclosure` field actionable — the INDEX fires the retrieval,
not her recollection of content); she is about to say she does not remember (the epistemic backstop); the
user uses an anaphor (上次 / 之前 / 还记得吗); an unrecognized proper noun; she is about to state a fact
about the user from impression. Non-triggers: the present moment, anything already in the pinned block or
the card, small talk.

Two further mechanisms worth taking from the same prompt: a **blocking, verified boot read** ("your first
and only action must be… and read the output… do not proceed until you have successfully read and
confirmed"), and the framing that reading memory is *remembering*, not *looking something up in a
database* — which removes the framing under which searching feels like an optional extra step.

**Over-searching is ours to solve.** Nocturne has no budget, no cooldown, no "you already read this" — the
survey confirms **no surveyed system addresses it at all**. Our only bounding forces today would be the
IF-conditioned triggers themselves. 立项 must decide whether a guard is needed, knowing there is no prior
art to copy.

Placement follows the T4 split: **"never answer from impression about the user's past — search"** is a
truthfulness floor and belongs in the non-editable base prompt (same family as "never claim a tool ran
without a tool-result"); the tone ("your relationship is continuous; you may not still see the old
wording") belongs in the user-editable assistant layer. Machine self-narration ("I searched my memory
store", "my context window") remains forbidden.

**Derived consequence, owner-acknowledged**: forbidding a retry makes that ONE attempt load-bearing, and
Chinese keyword retrieval frequently misses on first try. Owner: "要求就是检索/rag 模块要做好。记忆模块也
要做好。"

At the time of ratification this looked like it forced semantic retrieval (and with it an embedding
dependency in tension with the hard rule). **The memory survey resolved that**: two sourced, embedding-free
techniques close most of the gap inside our existing stack —

- **Application-layer CJK segmentation** written into an auxiliary FTS5 column (Nocturne's `search_terms`,
  MIT, in-tree). Working Chinese BM25 on SQLite FTS5 with no custom tokenizer extension and no embedder.
- **Index the `disclosure` field as a natural-language recall TRIGGER**, not just as the keyword gate it
  is today. The decisive property: the trigger is phrased in the *question's* vocabulary ("when the user
  asks who they are"), while the content is phrased in the *fact's* vocabulary ("the user's name is X") —
  which is exactly the bridge that failed. We already have the column; it simply is not in the index.

Independently confirmed by the same survey: **none of Letta, mem0 or Graphiti degrades to keyword-only**
(mem0 v3's BM25 is a boost over semantic candidates — with the embedder off the candidate set is empty;
Letta raises an error without an embedding config; Graphiti needs the embedder even for node dedup). So
under the provider-agnostic hard rule all three retrieval architectures are disqualified as-is, and the
embedding-free path is not a fallback but the main line.

**R20 — The always-visible tier is REWRITABLE BLOCKS; the searchable tier stays rows.** Storage shape
follows the tier, and the two answers are different — this is what every surveyed system does, and we were
doing it in only one place.

Today `selectPinned` gathers ROWS and renders them as a bullet list. Letta's core memory is a labelled
free-text BLOCK the agent rewrites wholesale (`core_memory_replace`, `memory_rethink`); its archive is rows.
Nocturne's always-read boot node is a document. Rows are right where FTS, per-item scoring, dedup and decay
apply; blocks are right where the content must be EDITED and COMPRESSED rather than accumulated.

Three reasons this matters for us specifically:
- **CRUD shape, which is what makes R18 work.** Correcting a fact in row form is search → take the id →
  archive → write new: four steps she can complete halfway. In block form it is read the block, change the
  sentence, write the block back: one step that cannot half-fail. The contradiction rule the owner just
  ratified is far more likely to actually hold in block form.
- **Only blocks can INTEGRATE.** Three scattered rows stay three rows forever; a block can be rewritten
  into one truer sentence. The owner's "是否需要整合" has no answer in row form.
- **We already have one block and are about to add another.** The user identity card (R7) is a block; R14's
  "what I know" index is inherently a block (an index is a document, not a row set). The concept is already
  at the door — R20 admits it instead of special-casing it twice.

Scope note for 立项: this needs a block store + a block-write tool, and it changes what `selectPinned` is
for. It does NOT change the searchable tier, the layer registry, or the retrieval path.

**R21 — Entry granularity stays "one entry = one thing WITH its context"; do not go atomic.**
Leader call, owner did not object. mem0 stores atomic facts ("Sky is blue"); Nocturne stores structured
multi-part nodes. R6+R12 settle it for us: with exactly ONE search and no retry, **the value of a single hit
matters more than precision of matching**. An atomic fact returns an isolated point; a sentence-with-context
returns something she can actually use. Our current episodic shape is already right — keep it.

**R22 — Inter-entry LINKS are deferred, with a trigger.** Nocturne auto-binds glossary keywords to nodes
(deterministic string matching, no model, no vectors); Letta Code uses `[[name]]` links described as "the
synapses of your memory: they should strengthen with use". Both would partially compensate for the no-retry
rule by letting one hit surface its neighbours.

Deferred because the cheap version does not deliver and the effective version costs a new concept:
- Re-searching with the hit's own content (zero cost) **fails the actual case** — "他说想去海边" shares no
  terms with "他不喜欢人多的地方", which is precisely why a link would have been needed.
- Nocturne's keyword binding needs a GLOSSARY, and maintaining it is the real cost (auto-extracting it is
  another model call).
- Letta's `[[name]]` form is genuinely cheap (a regex, a table, a join) but depends on her remembering to
  write links — the same prompt-reliability question as everything else on the pull path.

And R20 removes part of the need: a block holds related things together by construction, so the gap only
remains in the searchable tier. **Trigger**: observing her return a partial answer because a hit lacked its
adjacent context. Then take the `[[name]]` form — small, and it needs no glossary.

**R18 — On a contradiction, CORRECT the old entry; never let two conflicting versions coexist.**
The largest gap the lifecycle review exposed. The owner's four-stage model (create → organize → retrieve →
maintain) implies GRADUAL change — priorities drift, things age out. But memory's sharpest failure is
SUDDEN: a new fact directly contradicts an old one. January "我不吃辣", June "最近开始吃辣了" — today both
rows are written and both persist forever.

Why R6 makes this worse rather than better: with per-turn injection gone she performs ONE search and sees
ONE result set. Previously several entries were injected and she could weigh them; now whichever row the
search returns IS the answer. Contradictory data is no longer diluted — it is decisive.

Owner's ruling: **a prompt rule, no new machinery.** The tools already suffice — `memory_search` returns
each hit's `id` and `memory_archive` takes an id, so "archive the old, write the new" is already
expressible. What is missing is the policy: nothing tells her that superseding is preferable to appending.
`memory_archive`'s description says only "when it is outdated or was a mistake" and never defines outdated.
Adopt Nocturne's framing verbatim in spirit: "**always prefer to overwrite/correct the old node rather
than write a new patch. Wrong memories are more dangerous than no memories** — don't let two conflicting
versions coexist in your brain."

**Leader addition (flagged for objection, not separately ratified): the user's correction is the trigger.**
When the user says 不对 / 你搞错了 / 不是这样, that is not merely a conversational correction — it is a
signal ABOUT THE MEMORY STORE, and the highest-quality signal available, because it comes from the user
rather than from the model's own guess. Today it is discarded entirely. Nocturne treats it as a write
trigger and it costs nothing but prompt text. It belongs with R18 because it is precisely *when* she learns
an entry is wrong.

**R19 — Work experience becomes memory only through her own deliberate write.** Owner: "要，但只靠她主动
写." Today every write source reads a CONVERSATION transcript (episodic writer, flush writer) or an image —
so what she DOES produces no memory unless it happens to be discussed. She can walk the same dead end
repeatedly.

No new automatic extraction path (that was the alternative and was declined): the prompt teaches her to
record it herself when she learns something reusable — an approach that failed, a technique that worked, a
constraint discovered. Nocturne's structural format is the model for what such an entry should contain —
[Baseline] what I usually do here / [Deviation] what I did differently / [Outcome] what verifiably changed /
[Reusable judgment] the rule to apply next time — because it separates EXPERIENCE from EVENT. Do not adopt
its "missing any element = a wasted draft" strictness wholesale; that is calibrated for a work-only agent
and would be hostile to a companion's emotional memories.

Scope note the owner already weighed: this pays off in proportion to how much real work she does. It is
prompt-only, so the cost is near zero either way.

**R15 — The write gate is a BEHAVIOUR-CHANGE test, silence is the normal outcome, and every skip is
logged.** Replaces the current quota. Today's episodic prompt asks for "1 to 3 episode summaries" every
20 messages — that is a production quota, and a quota manufactures low-value memories on a schedule
whether or not anything happened. The lowest tier is therefore largely self-inflicted at creation.

The quota is a NAMED defect in the literature (arXiv 2606.03787, verbatim): "episodes are stored at fixed
temporal intervals… **No principled criterion distinguishes observations worth remembering from redundant
ones.** A robot exploring for hours at a fixed storage rate accumulates thousands of episodes, most
recording nothing new, **while a brief but important event may fall between storage intervals**." Note the
second half — a quota does not only manufacture noise, it also MISSES the rare thing.

The replacement test, on which three independent production systems converge — and none of them asks
whether the content is important, interesting, or new:
- ChatGPT `bio`: worth saving if it is "**likely to change your future responses in similar situations**"
- Nocturne: "a memory's value lies in **whether it can change behavior**, not in whether it is 'important'
  or 'new'… it's dead data"
- engram-lite: "**Would this be useful to recall in a future, different conversation?**"

Adopt also ChatGPT's explicit two-sided shape — a "when NOT to save" list (short-lived, trivial, redundant,
overly personal, content the user is merely asking you to translate or rewrite) — and its one override:
when the user explicitly asks you to remember something, save it even if it looks trivial or already known.
mem0 is the counter-example and shows why wording matters: "you CAN return an empty list" is permission,
not preference, and its few-shot examples teach extracting "Sky is blue" / "Grass is green".

**Skip logging is not optional.** mem0 issue #3009 is users unable to tell a deliberate skip from a bug,
because a skip is silent. If silence becomes the normal outcome we must log the skip decision, or we lose
the ability to distinguish "nothing was worth writing" from "the writer is broken" — and we will file that
bug against ourselves.

**R16 — Promotion up the ladder is AGENT-DRIVEN via prompt first; a background counter is a later,
explicitly experimental addition.** Owner: "优先'提示词教她自己钉'，再考虑加上后台计数策略." This matches
the evidence exactly: no shipped system in the survey promotes on a usage counter — Letta is agent-driven
pinning, mem0's graduation is a service-side consolidation, and automatic counter-based promotion exists
only in a research prototype (6h batch, top-20%) and one low-provenance project (7 days + >=3 retrievals).
Building the counter version means being ahead of the shipped field, so it ships later, behind a flag,
with a rollback — not as a known-good pattern.

The prompt rule is load-bearing, not decorative. The documented failure when it is absent (secondary
analysis of the MemGPT default): "without explicit instructions in the system prompt ('if you find
yourself repeatedly looking up the same fact, pin it to core memory'), the model won't promote on its own,
and you'll end up with a **recall-thrashing** pattern where every turn calls `recall_search` for the same
fact." That is the READ-path twin of R9's duplicate-write signal, and it is observable in exactly the same
way — so if we later build the counter, the two signals (repeated write, repeated search) are one
mechanism seen from both sides.

**R17 — Spot maintenance: fix a memory when you touch it.** Adopted from Nocturne, which has no equivalent
in any other surveyed system: whenever she reads a memory for any reason and notices a defect (missing
recall trigger, wrong priority, outdated content), she repairs it then and there. Its justification is the
argument: "If you read a node during conversation and notice a problem but don't fix it, **the next you
won't remember ever seeing that problem**." This makes the tidy pass partly continuous instead of loading
all of it onto the scheduled job, and it costs nothing — she is already holding the entry.

**R14 — The pinned block carries an INDEX of what is known, not bulk memory content; a background pass
recomputes it.** Owner-ratified after the survey. Letta Code states the rule directly: memory blocks are
"your most valuable context real estate: reserve them for durable knowledge that shapes who you are and
how you act, plus the indexes that let you discover everything else… Do NOT write memories that are easily
derivable from searching. Prefer compact indexes and behavioral rules over bulk content." This is the
missing half of R6: with per-turn retrieval gone, an in-context index is what converts "she cannot see the
memory" into "she knows it exists and can go get it" — it makes R12's triggers actionable instead of blind.

Population is offline, not per-turn: Letta's sleep-time agent "dredges related archival memories into a
shared block that primary references — passive context enrichment without explicit retrieval." That is
deterministic push whose CONTENT was computed by a background job — fully compatible with R6, and it rides
R11's utility slot. Recomputing per turn was rejected: it costs a query every turn and churns the prompt
prefix.

**R13 — Every number is exposed in the settings panel for now; converge after real use.**
Owner: "当前阶段先全部在面板给出，待测试后再选择有意义的项." T5 delivers the configurability + protocol
surface; the panel UI itself is #26. Consequence for scope: every exposed value needs validation and a
fail-closed default, or a mistyped value crashes the core. The convergence pass needs its own trigger
condition recorded in `deferred-decisions.md`, otherwise the panel stays permanently complex.

Leader correction recorded: the earlier "budgets should be a PERCENTAGE of the window" claim is void
for the pinned block. Percentages made sense for the retrieved block (how much to pull is adjustable);
the pinned block's content is naturally bounded (promises + high-importance profile + card), so its
budget is a SAFETY VALVE, not a target — an absolute number is correct, just currently set low now that
it is the only automatic memory.

## Leader calls awaiting objection (decided to avoid over-asking; overturn freely at 立项)

- **The automatic writer picks its layer instead of hard-coding `episodes`.** Choosing the layer is part of
  the same judgement R15 already asks it to make ("will this change future behaviour"), and the current
  hard-code is a listed defect. Constraint: it may NOT mint pinned-level importance. Reaching the always-
  visible rung stays deliberate — the user's card (R7), her own explicit pin (R16), or the tidy pass. An
  automatic writer that could pin would reintroduce the noise R6 was removed to stop, one rung higher up
  where it costs the most.
- **The scheduled tidy pass has named defect classes, detected by SQL, repaired by the model.** R9 ratified
  that it exists but never said what it does. Proposed classes, all cheaply detectable and all observed in
  our own data: stale (past its tier's window), near-duplicate, missing recall trigger (`disclosure` empty
  — which under R12 means it can never fire the index), and misfiled layer. Nocturne's other two classes
  (crowded parents, orphans) presuppose a hierarchy we do not have. Detection must stay deterministic so
  the pass costs nothing when the store is clean.
- **Organizing has two legs, not one stage.** The owner's model lists 归档整理 as a stage; in practice R17
  (fix it when you touch it, continuous, free) and R9 (scheduled batch scan) are both organizing, and the
  continuous leg is the more timely one. Recorded so 立项 does not build the scheduled pass alone and
  consider the stage done.

## Defects found during the grill (verified in code, not theorized)

- **The automatic write path is structurally incapable of producing an always-available memory.**
  `episodic-writer.ts` hard-codes the `episodes` layer and clamps importance to 3–7;
  `pinned-block.ts::isPinnedEligible` admits `profile` only at importance >= 9 and admits `episodes`
  never. This is the root cause of the owner's real failure: the user stated their name, it was
  auto-written to `episodes`, and ~200 turns later she could not answer "who am I" until told to search.
- **`memory_write`'s tool description gives an importance instruction for `relationship` only** ("the
  user saying 记住/我们约定 → relationship, importance 10") and none for `profile` — so a
  self-initiated profile write also lands below the pinned threshold.
- **The recall query was the last 5 messages' full text, including her own long replies** — after a
  300-word answer, ~98% of the query was her own words, and bm25 discriminates poorly on long queries.
  Moot under R6, but it explains the second half of the name failure.
- **Perception context never reached the recall query** (it enters via `instructionsExtra`, not history).
  Also moot under R6, but T4 must be aware: a heartbeat turn has NO user input, so if it needs memory
  driven by what she can see, that wiring does not exist today.
- **`retention` in the layer registry has no consumer.** Covered by R8.
- **`writePolicy: "consolidation"` is declared and unused.** Covered by R9.
- FTS5 trigram matching cannot bridge "我是谁" → "用户的名字是 pleia". No amount of query tuning fixes
  this; it is the motivation for R10 and for the semantic-retrieval open item.

## Open items (deliberately unresolved, with what unblocks them)

- **Post-hoc importance adjustment** — owner queued it for research rather than deciding blind. R9's
  duplicate-write signal is the leading candidate. Note the hard observability limit: we can see that an
  entry was injected or matched a search; we CANNOT see whether the model actually used it.
  Unblocked by: `t5-memory-systems-survey.md` §D.
- ~~Semantic retrieval vs the provider-agnostic hard rule~~ — **CLOSED by the memory survey.** See R12:
  application-layer CJK segmentation plus an indexed `disclosure` trigger close the gap without an
  embedder, and no surveyed system offers a usable keyword-only degraded mode anyway. Semantic retrieval
  reverts to a genuinely optional enhancement on the pull path, not a prerequisite.
- **The panel-number convergence trigger** (R13).
- **Enabling streaming usage** (R1) — needs an empirical check against real gateways, not a decision.
- **The chosen pull-only shape is UNMEASURED in the literature.** The survey states plainly that nobody
  publishes a memory-tool invocation rate, and nobody has ablated agent-initiated retrieval against
  automatic retrieval. R6 + R12 are therefore a reasoned bet, not an evidenced one. The mitigations we
  already hold are R14 (she can see what exists) and R10 (entries phrased in the user's own words so the
  one permitted search can hit). 立项 should decide what observable would tell us the bet went wrong —
  e.g. logging how often she searches versus how often a search would have helped.
- ~~Nocturne's proactive-recall system prompt is unread~~ — **CLOSED**: read in the follow-up round, and it
  reshaped R12 (pattern-match over introspection) and supplied R15's write gate. Survey §11.1 quotes the
  load-bearing lines. Clean-room rewrite per the repo's reference policy, never a port.
- **An over-search guard has no prior art** (R12). Nobody in the survey bounds how often an agent may
  search. If 立项 decides we need one, it is original work.
- **The archived tier's purpose is thin.** Four uses are sourced (rollback/audit, evidence under a lesson,
  point-in-time query, re-extraction with a better prompt later) and only Nocturne's re-parenting rule —
  a distilled-away original is deleted "if it serves as a representative case study, move it under the
  higher-level insight as supporting evidence" — makes an archived item keep earning. **Nobody publishes
  evidence that archives are ever read.** So archive-not-delete stands (a misjudged archive is
  recoverable), but 立项 should not build features assuming the archive gets used.
- **No system publishes what fraction of turns produce zero memories.** R15 makes silence normal without a
  reference point for what "normal" looks like — another reason the skip log is mandatory, since it is the
  only way we will learn our own rate.
