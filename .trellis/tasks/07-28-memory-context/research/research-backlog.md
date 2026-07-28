# T5 Research Backlog — deferred topics, batched when triggered

> Created 2026-07-28 (owner directive: register now, research later in one concentrated pass — do NOT
> research these during T5 kickoff). When a topic fires: dispatch `trellis-research` sub-agents; web via
> `mcp__exa__*` / `mcp__tavily-remote__*` ONLY (native WebSearch/WebFetch forbidden); pass `model`
> explicitly. Model roster as of 2026-07-28: **Opus 5** (replaces Opus 4.8) and **Fable 5**.

## RB-1 — Usage-signal importance adjustment (post-hoc, read-side counters)

**Question.** Should a memory's importance adjust dynamically from usage signals (search hits, injection
exposure, duplicate writes)? Which signal, what formula, and which consumer (pinned-block selection /
decay-archive tier / ranking tiebreak only)?

**Already sourced — do not re-research** (`.trellis/workspace/pleia/t5-memory-systems-survey.md`):
- §8.1: duplicate-write-as-recall-failure (ratified T5-R9); Graphiti provenance-append precedent; mem0
  explicitly contradicts (NOOP/MD5 discard, no counter).
- §11.2: promotion table — NO shipped system promotes on a usage counter; only a research prototype
  (arXiv 2605.08538: 6h batch, top-20%, sigmoid activation half-life 168h) and low-provenance AgentOS
  (7 days + >=3 retrievals). Counter-based promotion = ahead of the shipped field, experimental-only (T5-R16).
- §0.1 A5: Nocturne priority-tiered staleness (`3.5 * 2^prio` days) — arithmetic, no counter.
- §0.2 R3/R6: decay maths must not enter similarity ranking without a closed loop; exposure != effective
  (Elastic `last_success_at` is the only honest precedent).

**Gaps to research when triggered:**
- Re-scan the field: has any shipped system landed counter-based promotion/demotion since 2026-07?
- Read-hit logging schema: what to record per `memory_search` hit (id, query, turn kind, was-it-injected)
  so injected-vs-used stays distinguishable (hard observability limit: we can never see model-side USE).
- Decay/reinforcement formula calibration for a companion cadence (MemoryBank `S += 1` Ebbinghaus family)
  vs our importance tiers; interaction with T5-R8 archive sweeper.
- Unification with T5-R9: repeated write (absence+need) and repeated search (recall-thrashing, MemGPT
  failure mode) are one mechanism seen from write/read sides — one design, two triggers.
- Rollback story per T5-R16 (behind a flag, reversible).

**Trigger:** T5 ships + skip-log/search-log telemetry accumulates real data; or the owner 立项s the
T5-R16 counter experiment. Whichever first.

## RB-2 — Stale tool-result invalidation at the tool layer (T5-R4 deferred half)

**Question.** Folding old tool results stops the model *seeing* stale data but does not *refresh* it.
Claude Code tracks read files by mtime with a content-hash fallback on Windows; OpenClaw/Hermes/Codex/
OpenAI Agents SDK do not address it at all (context survey §1D). What is the minimal tool-layer design
for us (which tools, what freshness key, what re-read policy)?

**Trigger:** observing her answer confidently from a stale tool result in practice (recorded in
t5-decisions T5-R4 with this exact trigger).
