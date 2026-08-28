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
import { canonicalMemoryMigration017 } from "./017-canonical-memory.ts";
import { mcpDesiredServersMigration018 } from "./018-mcp-desired-servers.ts";
import { skillPackagesMigration019 } from "./019-skill-packages.ts";
import { parallelFoundationConvergenceMigration020 } from "./020-parallel-foundation-convergence.ts";
import { memoryLegacyMigration021 } from "./021-memory-legacy-migration.ts";
import { hindsightConnectionSetupMigration022 } from "./022-hindsight-connection-setup.ts";
import { hindsightInitialCutoverMigration023 } from "./023-hindsight-initial-cutover.ts";
import { harnessRunsMigration024 } from "./024-harness-runs.ts";
import { runEventsMigration025 } from "./025-run-events.ts";
import { runEffectsMigration026 } from "./026-run-effects.ts";
import { effectApprovalRefMigration027 } from "./027-effect-approval-ref.ts";
import { recoveryAdmissionMigration028 } from "./028-recovery-admission.ts";
import { scheduledTasksMigration029 } from "./029-scheduled-tasks.ts";
import { scheduledOccurrenceCharacterMigration030 } from "./030-scheduled-occurrence-character.ts";
import { runUsageDetailsMigration031 } from "./031-run-usage-details.ts";

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
  canonicalMemoryMigration017,
  mcpDesiredServersMigration018,
  skillPackagesMigration019,
  parallelFoundationConvergenceMigration020,
  memoryLegacyMigration021,
  hindsightConnectionSetupMigration022,
  hindsightInitialCutoverMigration023,
  harnessRunsMigration024,
  runEventsMigration025,
  runEffectsMigration026,
  effectApprovalRefMigration027,
  recoveryAdmissionMigration028,
  scheduledTasksMigration029,
  scheduledOccurrenceCharacterMigration030,
  runUsageDetailsMigration031,
];
