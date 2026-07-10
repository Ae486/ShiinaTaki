# core/db/migrations/
- 001-timeline.ts — migration 1: timeline_messages table + (character_id, seq DESC) index
- 002-memory.ts — migration 2: memory_entries metadata + memory_fts trigram virtual table (rebuildable index)
- index-list.ts — the explicit ordered MIGRATIONS registry (no fs/glob discovery)
