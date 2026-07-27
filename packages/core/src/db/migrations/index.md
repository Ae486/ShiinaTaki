# core/db/migrations/
- 001-timeline.ts — migration 1: timeline_messages table + (character_id, seq DESC) index
- 002-memory.ts — migration 2: memory_entries metadata + memory_fts trigram virtual table (rebuildable index)
- 003-memory-auto-state.ts — migration 3: memory_auto_state (per-character episodic/flush auto-write watermarks)
- 004-timeline-parts.ts — migration 4: timeline_messages rebuild — 'tool' role + nullable parts JSON column (D1 fidelity)
- 005-privacy-pause.ts — migration 5: privacy_pause_state (one row: the persisted Privacy Pause + its absolute deadline)
- index-list.ts — the explicit ordered MIGRATIONS registry (no fs/glob discovery)
