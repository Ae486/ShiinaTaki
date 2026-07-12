# core/agents/
- chat-agent.ts — AI SDK v7 streaming chat loop (model + store + memory + optional autoMemory/extraTools/instructionsExtra/approval); per turn prepends the base prompt + assembles memory context + skills list + binds memory/skills/MCP tools behind the toolApproval gate; yields text deltas, persists the FULL turn (tool-calls + results + text), abort-aware partial-text persist, fires auto-writes detached
- base-prompt.ts — BASE_SYSTEM_PROMPT: the stable identity + tool-use + "never claim a tool ran without a tool-result" truthfulness floor (anti-hallucination), prepended before memory context
- conversation-store.ts — SQLite-backed conversation store (repo + onAppend injected); exports REPLAY_WINDOW; appendUser/appendAssistant/appendTurn (full-turn fidelity); replays the window as multi-part ModelMessages
- turn-mapping.ts — maps AI SDK response messages <-> TimelineEntry (tool-call/result parts persist + replay); conversation-store's only consumer
- turn-queue.ts — per-characterId async mutex serializing turns (append user -> stream -> append turn commits before the next send); concurrent across characters
- turn-registry.ts — per-character AbortController registry (begin/end/cancel); the cancellation seam shared by chat.send + chat.cancel
