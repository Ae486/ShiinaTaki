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
import { memoryTidyStateMigration010 } from "./010-memory-tidy-state.ts";
import { slotWindowStateMigration011 } from "./011-slot-window-state.ts";
import { conversationSummaryMigration012 } from "./012-conversation-summary.ts";
import { configMigration013 } from "./013-config.ts";
import { governancePolicyMigration014 } from "./014-governance-policy.ts";
import { approvalMigration015 } from "./015-approval.ts";
import { timelineInputScrubMigration016 } from "./016-timeline-input-scrub.ts";
import { mcpDesiredServersMigration017 } from "./017-mcp-desired-servers.ts";

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
  memoryTidyStateMigration010,
  slotWindowStateMigration011,
  conversationSummaryMigration012,
  configMigration013,
  governancePolicyMigration014,
  approvalMigration015,
  timelineInputScrubMigration016,
  mcpDesiredServersMigration017,
];
