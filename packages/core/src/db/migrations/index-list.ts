/**
 * INPUT:  the numbered migration modules
 * OUTPUT: MIGRATIONS — the explicit, ordered list handed to openDatabase (no fs/glob discovery)
 * POS:    core/db/migrations — the single registry of migrations; append each new NNN module here in version order
 */
import type { Migration } from "../migration-runner.ts";
import { timelineMigration001 } from "./001-timeline.ts";
import { memoryMigration002 } from "./002-memory.ts";
import { memoryAutoStateMigration003 } from "./003-memory-auto-state.ts";
import { timelinePartsMigration004 } from "./004-timeline-parts.ts";
import { privacyPauseMigration005 } from "./005-privacy-pause.ts";
import { memoryOriginMigration006 } from "./006-memory-origin.ts";
import { memoryEventsMigration007 } from "./007-memory-events.ts";
import { memoryFtsUnicode61Migration008 } from "./008-memory-fts-unicode61.ts";
import { memoryEventsCountMigration009 } from "./009-memory-events-count.ts";

export const MIGRATIONS: Migration[] = [
  timelineMigration001,
  memoryMigration002,
  memoryAutoStateMigration003,
  timelinePartsMigration004,
  privacyPauseMigration005,
  memoryOriginMigration006,
  memoryEventsMigration007,
  memoryFtsUnicode61Migration008,
  memoryEventsCountMigration009,
];
