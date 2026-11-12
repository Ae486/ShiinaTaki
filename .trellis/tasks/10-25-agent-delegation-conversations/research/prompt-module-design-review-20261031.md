# Research: Prompt module design for main agents, workers, dynamic events, and compaction

- Query: Does TakiAgent have a system-prompt concept, and what small prompt-module design would coherently cover main-agent delegation, worker roles, dynamic event handling, and compaction without copying Claude Code or adding a new framework?
- Scope: mixed (bounded local composition review plus public catalog and official documentation)
- Date: 2026-10-31

## Findings

### Executive conclusion

TakiAgent already has a real system-prompt concept, but it is a composition rather than one file. The primary Agent receives a stable code-owned floor plus day, assembled assistant/persona/memory blocks, extra capabilities, run-specific instructions, and a late private-inbox section. Child workers receive their own worker instructions and run context instead of the Companion persona. Idle inbox handling has a separate Companion-facing instruction path, and private task compaction already uses a dedicated Utility prompt.

The evidenced gap is therefore not "create a system prompt" or "move every prompt into Markdown." It is **incomplete primary-Agent delegation guidance across the existing prompt surfaces**. The product requirements already define coordination responsibilities; the model-facing instructions do not express them as one coherent workflow. `prompt/README.md` calls `prompt/` the single home for injectable prompt content, while the same document correctly acknowledges code-owned `BASE_SYSTEM_PROMPT`; protocol and tool-selection instructions also live beside runtime/tool code. That is not inherently defective. That README is an incomplete whole-system map; the request audit and this report document the additional surfaces.

The smallest recommendation is to add one concise, code-owned **main delegation policy** at the existing primary composition seam, keep worker and Utility prompts separate, and make foreground/idle event guidance explicit at the existing dynamic inbox seam. Do not create a prompt registry, centralize all text, duplicate tool schemas in the system prompt, import the catalog's large prompts, or add hot reload.

### Files found

| File | One-line description |
| --- | --- |
| `packages/core/src/agents/agent-attempt.ts:63-66,90-112,288-306` | Constructs primary/child/initiative instructions, installs tools, and rebuilds late inbox instructions in `prepareStep`. |
| `packages/core/src/memory/persona-provider.ts:11-40` | Loads the shared assistant layer once and caches each character persona on first use. |
| `packages/core/src/memory/canonical-memory-assembly.ts:31-37` | Freezes assistant layer, persona, emotion, blocks, and pinned memory for one admitted Run. |
| `prompt/system/assistant-layer.md:1-78` | User-editable global Companion capability/personality card; covers genuine tool use, perception, memory, avatar behavior, truthfulness, and permission boundaries, but not delegation workflow. |
| `prompt/README.md:3-37` | Describes `prompt/` as the editable prompt home while explicitly reserving mechanics/safety for code-owned `BASE_SYSTEM_PROMPT`. |
| `packages/core/src/agents/private-task-summarizer.ts:24-46` | Dedicated Utility prompt that preserves task, constraints, decisions, evidence, sources, negation, unknowns, and open work while keeping exact history separately retrievable. |
| `.trellis/tasks/10-25-agent-delegation-conversations/research/prompt-design-public-research-20261030.md` | Completed narrow study of worker completion/wait/message semantics; it should not be reopened as a broad prompt rewrite. |
| `.trellis/tasks/10-25-agent-delegation-conversations/research/eight-foreground-prompt-stack-audit-20261030.md` | Captured the actual foreground prompt stack and showed an ordering ambiguity when eight final events arrived before the first acknowledgement. |

### Source classification and limits

1. **Catalog fact:** the owner-supplied [Claude Code prompts catalog](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/) classifies translated material into stable task/tool behavior, coordinator mode, teammate communication, subagent roles, tool descriptions, dynamic reminders, and compaction/session memory. The relevant section titles are listed below. The page says it is based on an alleged source-map snapshot and gives source-like file names, but it does not provide a primary repository URL, commit, package hash, or independently verifiable snapshot. Treat it as a dated third-party transcription and taxonomy, never as authenticated current hidden prompts.
2. **Official product behavior:** Anthropic's public documentation confirms that system prompts shape behavior; different surfaces, identities, and permission models need matching prompts; subagents have separate contexts and focused custom system prompts; descriptions guide delegation; tool descriptions should state when and when not to use a tool; typed notification and compaction lifecycle events exist; and compaction replaces older history with a summary. These public behaviors support modular boundaries, not the catalog's exact wording.
3. **TakiAgent hypothesis:** prompt placement, salience, or historical queued acknowledgements may contribute to the observed foreground omission, but the captured request does not prove causation. Any wording or placement change must be reviewed and tested against captured provider requests; it is not a demonstrated repair merely because it resembles another product.

### Reusable pattern 1: stable foundation, role module, and dynamic state are different layers

**Catalog evidence**

- [`1.4 任务执行区块`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#1-4-%E4%BB%BB%E5%8A%A1%E6%89%A7%E8%A1%8C%E5%8C%BA%E5%9D%97) groups durable task-execution norms: inspect before changing, diagnose failures, stay in scope, and avoid premature abstraction.
- [`1.6 工具使用区块`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#1-6-%E5%B7%A5%E5%85%B7%E4%BD%BF%E7%94%A8%E5%8C%BA%E5%9D%97) separates general tool-use and dependency-aware parallelism rules from individual tool schemas.
- [`1.10 其他动态区块`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#1-10-%E5%85%B6%E4%BB%96%E5%8A%A8%E6%80%81%E5%8C%BA%E5%9D%97) describes reminders, environment facts, retained-result warnings, and other request-varying sections as dynamic material.
- [`附录：提示词组装架构`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#%E9%99%84%E5%BD%95%E6%8F%90%E7%A4%BA%E8%AF%8D%E7%BB%84%E8%A3%85%E6%9E%B6%E6%9E%84) is useful as a classification aid, not a template to copy.

**Official corroboration**

- Anthropic, [Modifying system prompts — "How system prompts work" and "Decide on a starting point"](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts.md#how-system-prompts-work), says prompts should match the product's surface, identity, and permission model. Its ["Cache the static part of a custom prompt"](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts.md#cache-the-static-part-of-a-custom-prompt) section explicitly distinguishes stable instructions from per-request context.
- OpenAI, [Prompting — "Refine your prompt" and "Prompts in your application"](https://developers.openai.com/api/docs/guides/prompting), independently recommends putting durable role guidance in system instructions, task-specific detail in user input, and maintaining production prompts as named, code-managed modules with typed dynamic inputs and tests.

**TakiAgent application**

- Preserve the existing stable composition and caching behavior. `persona-provider.ts:26-39` and `canonical-memory-assembly.ts:31-37` mean file edits are not proof that an already admitted/live request changed; verification must inspect a newly captured provider request after the relevant restart/admission boundary.
- Do not put lifecycle invariants into the user-editable persona card. Persona should color expression; primary delegation/event obligations are runtime protocol and belong in a code-owned module.
- Keep late inbox/event facts dynamic through `agent-attempt.ts:98-112`; do not bake current event bodies into a stable base prompt.

### Reusable pattern 2: main coordinator and worker need asymmetric contracts

**Catalog evidence**

- [`3.2 协调器模式（Coordinator Mode）`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#3-2-%E5%8D%8F%E8%B0%83%E5%99%A8%E6%A8%A1%E5%BC%8F%EF%BC%88Coordinator-Mode%EF%BC%89) assigns a coordinator distinct duties: choose work units, brief workers with sufficient context, communicate with existing workers, and integrate notifications.
- [`3.3 队友通信附加指令`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#3-3-%E9%98%9F%E5%8F%8B%E9%80%9A%E4%BF%A1%E9%99%84%E5%8A%A0%E6%8C%87%E4%BB%A4) makes inter-agent delivery explicit rather than assuming ordinary prose reaches teammates.
- [`4.1 默认 Agent 提示`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#4-1-%E9%BB%98%E8%AE%A4-Agent-%E6%8F%90%E7%A4%BA), [`4.2 通用 Agent`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#4-2-%E9%80%9A%E7%94%A8-Agent%EF%BC%88General-Purpose%EF%BC%89), [`4.3 探索 Agent`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#4-3-%E6%8E%A2%E7%B4%A2-Agent%EF%BC%88Explore%EF%BC%89), [`4.4 规划 Agent`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#4-4-%E8%A7%84%E5%88%92-Agent%EF%BC%88Plan%EF%BC%89), and [`4.5 验证 Agent`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#4-5-%E9%AA%8C%E8%AF%81-Agent%EF%BC%88Verification%EF%BC%89) use narrow role prompts with capability and output boundaries rather than giving every worker the entire main-agent prompt.

**Official corroboration**

- Anthropic, [Create custom subagents — overview and "Write subagent files"](https://code.claude.com/docs/en/sub-agents.md), says each subagent runs in its own context with a custom system prompt, tool access, and permissions, and returns its result. It also says the subagent description drives delegation and should remain short while detail moves into the worker prompt.

**TakiAgent application**

TakiAgent already follows the worker half: children use `work.instructions` plus run context and date, without the Companion persona. The missing half is a concise primary-only delegation policy. It should define the main Agent's responsibilities, not repeat the worker completion protocol:

1. delegation acknowledgement is not a result;
2. brief a new worker with goal, scope, relevant context/evidence, constraints, ownership, and requested report shape;
3. do not invent, predict, or publicly claim worker findings before accepted evidence arrives;
4. continue useful foreground work instead of polling;
5. when delivered events are already present, treat their current state as newer than historical queued acknowledgements, inspect/handle the relevant events, synthesize them against the user's request, and place any user-facing result in the actual public reply;
6. private event disposition is not itself public delivery.

This module should apply only to the primary Agent path. Do not inject it into children, the source-owned branch, the idle Companion handler, or the private summarizer.

### Reusable pattern 3: keep tool selection semantics beside the tool; reserve the system module for cross-tool policy

**Catalog evidence**

- [`5.1 Agent Tool`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#5-1-Agent-Tool%EF%BC%88Agent-%E5%B7%A5%E5%85%B7%EF%BC%89) puts delegation/fork choice, context briefing, and "do not guess results" close to the delegation tool.
- [`5.15 Brief / SendUserMessage Tool`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#5-15-Brief-SendUserMessage-Tool%EF%BC%88%E5%8F%91%E9%80%81%E7%94%A8%E6%88%B7%E6%B6%88%E6%81%AF%E5%B7%A5%E5%85%B7%EF%BC%89) distinguishes model-visible/internal text from the channel the user actually reads and describes acknowledgement/checkpoint/result timing.

**Official corroboration**

- Anthropic, [Implement tool use — "Best practices for tool definitions"](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use#best-practices-for-tool-definitions), calls detailed descriptions the most important tool-performance factor and recommends explaining what the tool does, when it should and should not be used, parameters, behavior, and caveats. It also recommends fewer related tools where consolidation reduces selection ambiguity.

**TakiAgent application**

- Preserve separate SDK schemas/descriptions and current lazy disclosure. Do not paste every delegation/inbox tool description into a new main system module.
- Put local selection rules in the owning tool description: acknowledgement versus result, progress versus blocking input versus completion, read versus handle, and private disposition versus public delivery.
- Put only **cross-tool ordering and ownership** in the primary policy: what the main Agent owes the user after delegation, how already-arrived events affect the same turn, and which state is authoritative.
- The worker completion protocol study already established the worker-side `message` / `needs_input` / `complete_subagent` state machine. This report does not recommend another rewrite of it.

### Reusable pattern 4: dynamic events need typed, scene-specific guidance, not generic persona prose

**Catalog evidence**

- [`1.10 其他动态区块`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#1-10-%E5%85%B6%E4%BB%96%E5%8A%A8%E6%80%81%E5%8C%BA%E5%9D%97) treats system reminders and volatile context as injected dynamic sections.
- [`3.2 协调器模式`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#3-2-%E5%8D%8F%E8%B0%83%E5%99%A8%E6%A8%A1%E5%BC%8F%EF%BC%88Coordinator-Mode%EF%BC%89) separately describes a task-notification system instead of relying only on the coordinator's general identity.
- [`5.15 Brief / SendUserMessage Tool`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#5-15-Brief-SendUserMessage-Tool%EF%BC%88%E5%8F%91%E9%80%81%E7%94%A8%E6%88%B7%E6%B6%88%E6%81%AF%E5%B7%A5%E5%85%B7%EF%BC%89) differentiates normal replies, proactive notifications, and progress checkpoints by delivery intent.

**Official corroboration**

- Anthropic, [Hooks reference — event table and "Notification"](https://code.claude.com/docs/en/hooks.md#notification), exposes distinct lifecycle signals including `agent_needs_input`, `agent_completed`, `SubagentStop`, `PreCompact`, and `PostCompact`. This proves typed public lifecycle events exist in Claude Code; it does **not** prove how its hidden model prompt phrases or positions them.

**TakiAgent application**

- Retain the existing late inbox injection and `prepareStep` rebuild. The dynamic block should carry event truth plus an explicit mode-specific action contract.
- Foreground mode should say what must happen before ending this turn when relevant completed/input events are already supplied, including actual public reply obligations. Idle mode should retain its separate private-handler/publication path. A generic reference to "the current execution mode" is weaker than naming the concrete branch at composition time.
- Old queued tool results remain historical facts, but a supplied final/input event is newer state. State precedence belongs in the dynamic event contract, not in character persona.
- The earlier eight-result failure makes this a justified A/B candidate, not a proven root cause. Compare captured requests and outcomes with only the mode-specific wording/placement changed. Do not rewrite historical tool results or add an automatic runtime handoff on prompt evidence alone.

### Reusable pattern 5: compaction is a separate Utility contract; resume behavior is a consumer rule

**Catalog evidence**

- [`6.1 会话压缩（Compact）`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#6-1-%E4%BC%9A%E8%AF%9D%E5%8E%8B%E7%BC%A9%EF%BC%88Compact%EF%BC%89) separates a no-tools summarization turn, a structured continuity record, and post-compaction direct-resume guidance.
- [`6.2 Session Memory`](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/#6-2-Session-Memory%EF%BC%88%E4%BC%9A%E8%AF%9D%E8%AE%B0%E5%BF%86%EF%BC%89) separates durable current state, task specification, files, workflow, corrections, results, and next work. Its large template is an example of fields, not a size target for TakiAgent.

**Official corroboration**

- Anthropic, [How the agent loop works — "Automatic compaction"](https://code.claude.com/docs/en/agent-sdk/agent-loop.md#automatic-compaction), says compaction summarizes older history, retains recent exchanges/key decisions, emits a `compact_boundary`, and may lose early specific instructions; persistent rules should therefore be re-injected rather than trusted to a one-time early message.
- Anthropic, [Context window — "What survives compaction"](https://code.claude.com/docs/en/context-window.md#what-survives-compaction), distinguishes summarized conversation from startup content that reloads and shows subagents as a way to keep large reads out of the main context.

**TakiAgent application**

- Keep `PRIVATE_TASK_SUMMARY_INSTRUCTIONS` as a dedicated Utility prompt. Its existing preservation set is already stronger and more source-aware than the generic catalog outline for this product: task, constraints, decisions/reasons, findings, completed actions, evidence references, unresolved work, next actions, sender/source, negation, unknowns, failures, and exact-history fallback.
- Do not copy the catalog's full summary template or move lifecycle policy into the summarizer without a failing witness. A summary records state; it should not grant authority, declare completion, or execute the next step.
- If direct-resume behavior needs reinforcement, put it in the consuming main/worker scene module after a compaction boundary, not in the summary facts themselves: continue the unfinished task from retained state without reciting the summary or asking the user to restate known information.
- Keep exact retained history retrieval separate from summary projection. No evidence in the reviewed failure shows compaction caused the eight-result omission.

### Minimal recommendation for owner review

This turn is design analysis. The boundaries below are candidates for coordinator review, not new approval requirements; subsequent work remains governed by the owner's existing authorization and latest direction. The proposed design is intentionally small:

| Module | Audience / insertion seam | Owns | Explicitly does not own |
| --- | --- | --- | --- |
| Existing stable base | All applicable Agent runs through current base/memory composition | Truthfulness, source interpretation, permissions, durable behavior floors | Current inbox contents or worker-specific completion protocol |
| Existing assistant layer + persona | Primary Companion, frozen through current persona/memory assembly | Capability identity, relationship/personality expression, genuine usefulness | Delegation lifecycle invariants, event state precedence, compaction authority |
| **New concise main delegation policy** | Primary foreground Agent only, composed through the existing `composeInstructions`/run-instructions seam | Delegation briefing, acknowledgement/result distinction, no invented findings, no polling, main synthesis/public-delivery responsibility | Worker execution details, tool schemas, event bodies, Utility summarization |
| Existing worker policy | Child only through `work.instructions` | Role/scope, check-in, wait, completion, report contract | Companion persona and primary public-delivery decisions |
| Refined dynamic inbox mode block | Existing late `state.inbox.instructions` and `prepareStep` rebuild | Current typed event facts, foreground-versus-idle action, newer-state precedence, per-event handling | Stable persona or generic delegation tutorial |
| Existing private summarizer | Utility slot only | Faithful compact state projection | New instructions, completion grants, user-visible reply, automatic next action |

Suggested validation for a subsequent bounded change:

1. a short design review of exact audience and ownership for every sentence;
2. a prompt-composition test proving the main module is primary-only and worker/idle/Utility branches remain unchanged;
3. captured provider-request comparison after the true restart/admission boundary, because prompt cards are cached/frozen;
4. deterministic assertions for dynamic foreground versus idle instructions;
5. a bounded real-model A/B replay of the already captured same-turn final-event scenario before claiming placement or wording repaired it;
6. no new hot reload, registry, framework, model route, forced tool choice, or compaction format unless separate evidence justifies it.

### External references

All pages below were fetched and read on 2026-10-31.

- Third-party classification/transcription: [Claude Code prompts catalog](https://xdlkc.github.io/2026/04/01/claude-code-prompts-catalog/), shown as published 2026-04-01 and updated 2026-10-29. Relevant exact section titles: `1.4 任务执行区块`, `1.6 工具使用区块`, `1.10 其他动态区块`, `3.2 协调器模式（Coordinator Mode）`, `3.3 队友通信附加指令`, `4.1-4.5 子 Agent 系统提示词`, `5.1 Agent Tool`, `5.15 Brief / SendUserMessage Tool`, `6.1 会话压缩（Compact）`, `6.2 Session Memory`, and `附录：提示词组装架构`.
- Official Anthropic: [Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts.md), especially `How system prompts work`, `Decide on a starting point`, and `Cache the static part of a custom prompt`.
- Official Anthropic: [Create custom subagents](https://code.claude.com/docs/en/sub-agents.md), especially the overview, description guidance, and `Write subagent files`.
- Official Anthropic: [Implement tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use), especially `Best practices for tool definitions`.
- Official Anthropic: [Hooks reference](https://code.claude.com/docs/en/hooks.md), especially the event table and `Notification`.
- Official Anthropic: [How the agent loop works](https://code.claude.com/docs/en/agent-sdk/agent-loop.md), especially `The context window` and `Automatic compaction`.
- Official Anthropic: [Context window](https://code.claude.com/docs/en/context-window.md), especially `What survives compaction`.
- Official OpenAI: [Prompting](https://developers.openai.com/api/docs/guides/prompting), especially `Refine your prompt` and `Prompts in your application`.

### Related specs

- `.trellis/spec/backend/agent-runtime.md` — stable truthfulness floor, complete tool evidence, source interpretation, and request-level verification.
- `.trellis/spec/backend/shared-agent-delegation.md` — private reusable child context, controls, completion, and publication boundaries.
- `.trellis/spec/backend/private-worker-context.md` — child pressure compaction and retained evidence.
- `.trellis/spec/backend/private-agent-inbox.md` — continuing events, input waits, exact receipts, reconciliation, and private/public boundaries.
- `.trellis/spec/backend/tool-design.md` — tool description/schema/behavior governance.
- `.trellis/spec/backend/tool-disclosure.md` — current lazy tool disclosure and exact schema availability.
- `.trellis/spec/backend/compaction-harness.md` — projection-only compaction, summary quality, source preservation, and authority boundaries.

## Caveats / Not Found

- The legacy `.trellis/.current-task` file points to `.trellis/tasks/09-03-avatar-presentation-lab`, but it is not the current root session's authority. The coordinator verified `task.py current --source`: `.trellis/tasks/10-25-agent-delegation-conversations`, source `session:codex_01a18bce-da73-7f02-985a-b6d8f180dd28`. This report belongs to that existing task; no new task was created.
- The catalog is not an official Anthropic source and does not authenticate current Claude Code hidden prompts. No recommendation depends on its wording alone.
- Official docs establish public features and design considerations, not the exact private prompt implementation behind the catalog.
- The report did not re-run paid models, modify runtime/config/tests, or re-investigate the completed worker completion protocol.
- The observed main-Agent omission proves that relevant results were present and unhandled; it does not prove attention, prompt order, persona, or event placement caused the behavior.
- `prompt/README.md` language is incomplete as a whole-system map, but its Markdown-versus-code split is not itself a requirement violation. A documentation map may be useful later; this research does not authorize editing it.
- Prompt-card edits are cached at construction/first use and memory assembly freezes admitted content. Verification must inspect the actual newly composed request; editing a default file is not acceptance evidence.
- No evidence supports a new prompt registry, blanket prompt centralization, new hot reload, larger compaction template, forced tool call, or automatic runtime fallback.
