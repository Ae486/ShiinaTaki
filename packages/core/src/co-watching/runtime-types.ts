/**
 * INPUT: existing Core authorities and retained source/work handles for one explicit acceptance
 * OUTPUT: typed internal composition state for Co-Watching adapters
 * POS: core/co-watching — process-local bindings only; canonical execution/delivery stays in existing repositories
 */
import type { BrowserPlaybackView, CoWatchingAnalysis, CoWatchingFailure, CoWatchingPlan,
  CoWatchingSession, CoWatchingStart, CoWatchingAnalysisRequest, PreparedPublicationEdit } from "@taki/shared";
import type { ChatAgent } from "../agents/chat-agent.ts";
import type { TurnQueue } from "../agents/turn-queue.ts";
import type { TurnRegistry } from "../agents/turn-registry.ts";
import type { RunAdmissionResult } from "../db/run-repo.ts";
import type { RunDeliveryRepo } from "../db/run-delivery-repo.ts";
import type { DeliveryCoordinator } from "../delivery/delivery-coordinator.ts";
import type { PreparedPublicationOwner } from "../delivery/prepared-publication.ts";
import type { PreparedPublicationSourceOwner } from "../delivery/prepared-publication-source.ts";
import type { RunService } from "../harness/run-service.ts";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";
import type { BrowserPlaybackSources } from "../perception/browser-playback-sources.ts";
import type { SkillsLoader } from "../skills/skills-loader.ts";
import type { Logger } from "../logging/logger.ts";
import type { CoWatchingCatalog } from "./analysis-catalog.ts";
import type { CoWatchingNative } from "./native-result.ts";
import type { SubagentService } from "../harness/subagent-service.ts";
import type { CoWatchingChildWork } from "./child-adapter.ts";

export interface CoWatchingAnalysisTools {
  serverId: string; submit: string; lookup: string; status: string; result: string; isCurrent(): boolean;
}

export interface CoWatchingDependencies {
  catalog: CoWatchingCatalog; sources: BrowserPlaybackSources; runs: RunService<TurnInteractive>;
  queue: TurnQueue; turns: TurnRegistry; agent: ChatAgent; deliveries: RunDeliveryRepo; delivery: DeliveryCoordinator;
  workspaceRoot: string; skills: SkillsLoader; logger: Logger;
  subagents?: SubagentService;
  resultTool(serverId: string): { toolKey: string; isCurrent(): boolean } | undefined;
  analysisTools?(): CoWatchingAnalysisTools[];
  targetReady(characterId: string): boolean;
  onChanged(characterId: string): void;
}
export interface CoWatchingBinding {
  id: string; request: CoWatchingStart; analysis?: CoWatchingAnalysis; playback: BrowserPlaybackView;
  analysisRequest?: CoWatchingAnalysisRequest; analysisTools?: CoWatchingAnalysisTools; submitAnalysis?: boolean;
  submissionAllowed?: boolean;
  analysisPoll?: ReturnType<typeof setTimeout>; analysisFailures?: number;
  skillRevision: string; nativeTool: { toolKey: string; isCurrent(): boolean }; expiresAt: string; revision: string;
  status: CoWatchingSession["status"]; reason: CoWatchingFailure | null; closed: boolean;
  lifetime: AbortController; controller?: AbortController; deadline?: ReturnType<typeof setTimeout>;
  /** Greatest real observed position during this acceptance; rewinding cannot reopen an elapsed timing window. */
  furthestPositionSeconds: number | null;
  source?: PreparedPublicationSourceOwner; owner?: PreparedPublicationOwner; root?: RunAdmissionResult;
  interactive: TurnInteractive; native?: CoWatchingNative; plan?: CoWatchingPlan; edit?: PreparedPublicationEdit;
  child?: CoWatchingChildWork;
  pending?: string; yieldRequested?: boolean; workRequired: boolean; working: boolean; publishing: boolean;
  settledCandidates: Set<string>; sent: Map<string, { text: string; momentId: string }>;
  committed: Map<string, { text: string; momentId: string }>;
}
export interface CoWatchingRuntimeState {
  deps: CoWatchingDependencies; sessions: Map<string, CoWatchingBinding>; closing: boolean;
  scheduled: boolean; work: Set<Promise<void>>; schedule(): void;
}
