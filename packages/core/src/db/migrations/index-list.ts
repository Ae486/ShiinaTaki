import { modelProfilesMigration070 } from "./070-model-profiles.ts";
import { modelProfileSecretsMigration071 } from "./071-model-profile-secrets.ts";
import { searchProjectionPolicyMigration072 } from "./072-search-projection-policy.ts";
/**
 * INPUT:  the numbered migration modules
 * OUTPUT: MIGRATIONS — the explicit, ordered list handed to openDatabase (no fs/glob discovery)
 * POS:    core/db/migrations — the single registry of migrations; append each new NNN module here in version order
 */
import type { Migration } from "../migration-runner.ts";
import { memoryTidyReviewsMigration067 } from "./067-memory-tidy-reviews.ts";
import { maintenanceMonitorMigration068 } from "./068-maintenance-monitor.ts";
import { delegationSchemaConvergenceMigration069 } from "./069-delegation-schema-convergence.ts";
import { cacheUsageWindowMigration066 } from "./066-cache-usage-window.ts";
import { auxiliaryModelUsageMigration065 } from "./065-auxiliary-model-usage.ts";
import { primaryConversationSourcesMigration064 } from "./064-primary-conversation-sources.ts";
import { subagentProgressMigration063 } from "./063-subagent-progress.ts";
import { agentConversationOrderMigration060 } from "./060-agent-conversation-order.ts";
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
import { conversationCompactionLifecycleMigration032 } from "./032-conversation-compaction-lifecycle.ts";
import { hindsightReplicaSyncMigration033 } from "./033-hindsight-replica-sync.ts";
import { hindsightReplicaSchedulerMigration034 } from "./034-hindsight-replica-scheduler.ts";
import { pendingMemoryMigration035 } from "./035-pending-memory.ts";
import { memoryTimelineConvergenceMigration036 } from "./036-memory-timeline-convergence.ts";
import { hindsightLocalCoverageMigration037 } from "./037-hindsight-local-coverage.ts";
import { hindsightSourceEvidenceMigration038 } from "./038-hindsight-source-evidence.ts";
import { hindsightCurrentStateMigration039 } from "./039-hindsight-current-state.ts";
import { hindsightCutoverConvergenceMigration040 } from "./040-hindsight-cutover-convergence.ts";
import { canonicalMemoryMaintenanceMigration041 } from "./041-canonical-memory-maintenance.ts";
import { hindsightApplicationStateMigration042 } from "./042-hindsight-application-state.ts";
import { hindsightIngestionMigration043 } from "./043-hindsight-ingestion.ts";
import { hindsightApplicationCommandsMigration044 } from "./044-hindsight-application-commands.ts";
import { hindsightPolicyWorkMigration045 } from "./045-hindsight-policy-work.ts";
import { hindsightRuntimeAdmissionMigration046 } from "./046-hindsight-runtime-admission.ts";
import { hindsightMemoryWritesMigration047 } from "./047-hindsight-memory-writes.ts";
import { memoryOperationsMigration048 } from "./048-memory-operations.ts";
import { initiativeDeliveryMigration049 } from "./049-initiative-delivery.ts";
import { initiativeModelOpportunitiesMigration050 } from "./050-initiative-model-opportunities.ts";
import { initiativeFeedbackMigration051 } from "./051-initiative-feedback.ts";
import { interactionPatternsMigration052 } from "./052-interaction-patterns.ts";
import { initiativeWakePolicyMigration053 } from "./053-initiative-wake-policy.ts";
import { initiativeIntentionsMigration054 } from "./054-initiative-intentions.ts";
import { initiativeBackoffMigration055 } from "./055-initiative-backoff.ts";
import { subagentConversationsMigration056 } from "./056-subagent-conversations.ts";
import { sourceContextMigration057 } from "./057-source-context.ts";
import { agentInboxMigration058 } from "./058-agent-inbox.ts";

import { subagentPresentationMigration061 } from "./061-subagent-presentation.ts";

import { subagentInboxResumeMigration062 } from "./062-subagent-inbox-resume.ts";

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
  conversationCompactionLifecycleMigration032,
  hindsightReplicaSyncMigration033,
  hindsightReplicaSchedulerMigration034,
  pendingMemoryMigration035,
  memoryTimelineConvergenceMigration036,
  hindsightLocalCoverageMigration037,
  hindsightSourceEvidenceMigration038,
  hindsightCurrentStateMigration039,
  hindsightCutoverConvergenceMigration040,
  canonicalMemoryMaintenanceMigration041,
  hindsightApplicationStateMigration042,
  hindsightIngestionMigration043,
  hindsightApplicationCommandsMigration044,
  hindsightPolicyWorkMigration045,
  hindsightRuntimeAdmissionMigration046,
  hindsightMemoryWritesMigration047,
  memoryOperationsMigration048,
  initiativeDeliveryMigration049,
  initiativeModelOpportunitiesMigration050,
  initiativeFeedbackMigration051,
  interactionPatternsMigration052,
  initiativeWakePolicyMigration053,
  initiativeIntentionsMigration054,
  initiativeBackoffMigration055,
  subagentConversationsMigration056,
  sourceContextMigration057,
  agentInboxMigration058,
  agentConversationOrderMigration060,
  subagentPresentationMigration061,
  subagentInboxResumeMigration062,
  subagentProgressMigration063,
  primaryConversationSourcesMigration064,
  auxiliaryModelUsageMigration065,
  cacheUsageWindowMigration066,
  memoryTidyReviewsMigration067,
  maintenanceMonitorMigration068,
  delegationSchemaConvergenceMigration069,
  modelProfilesMigration070,
  modelProfileSecretsMigration071,
  searchProjectionPolicyMigration072,
];
