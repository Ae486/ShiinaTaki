# core/agents/
- chat-agent.ts — AI SDK v7 streaming chat loop (model + store + memory injected); per turn assembles memory context + binds tools; yields text deltas, persists each turn
- conversation-store.ts — SQLite-backed conversation store (repo + onAppend injected); replays the window as ModelMessages
