# core/agents/
- chat-agent.ts — AI SDK v7 streaming chat loop (model + store + memory + optional autoMemory injected); per turn assembles memory context + binds tools; yields text deltas, persists each turn, fires auto-writes detached
- conversation-store.ts — SQLite-backed conversation store (repo + onAppend injected); exports REPLAY_WINDOW; replays the window as ModelMessages
