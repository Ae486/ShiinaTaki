/**
 * INPUT: existing Core repositories, execution owners and trusted domain work bindings
 * OUTPUT: closed service/executor ports and disposable queue/controller state
 * POS: core/harness — shared delegation composition; durable truth stays in the four existing record families
 */
import type { ToolSet } from "ai";
import type { ContextMaterial, SubagentInitialContext, SubagentInput, SubagentProposal, SubagentToolSelection,
  SubagentWorkToken } from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import type { SubagentRepo } from "../db/subagent-repo.ts";
import type { SubagentInputRepo } from "../db/subagent-input-repo.ts";
import type { SubagentExecutionRepo } from "../db/subagent-execution-repo.ts";
import type { RunMessageRepo } from "../db/run-message-repo.ts";
import type { RunRepo } from "../db/run-repo.ts";
import type { RunService, RunExecutionContext } from "./run-service.ts";
import type { EffectLifecycleService } from "./effect-lifecycle-service.ts";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";
import type { ChatAgent } from "../agents/chat-agent.ts";
import type { TurnRegistry } from "../agents/turn-registry.ts";
import type { TurnQueue } from "../agents/turn-queue.ts";
import type { ConversationStore } from "../agents/conversation-store.ts";
import type { ToolMaterialSink } from "./subagent-tool-materials.ts";

export type WorkCurrentness = { state: "current" } | { state: "unavailable" | "retired" | "superseded"; reason: string };
export type WorkPhase = "model_intent" | "result" | "parent_admission" | "publication";
export interface OwnedSubagentExecution {
  runId: string; attemptId(): string; token(): SubagentWorkToken; signal: AbortSignal;
  context: RunExecutionContext; materials: ToolMaterialSink;
}
export interface SubagentWorkBinding {
  parentRunId: string;
  /** Omitted only by a fresh authenticated user continuation, never by automatic recovery. */
  parentToolNames?: readonly string[];
  source?: SubagentWorkToken["source"];
  scheduling?: "independent" | "yieldable_character_background";
  checkCurrent?(token: SubagentWorkToken, phase: WorkPhase): WorkCurrentness;
  prepareExecution?(execution: OwnedSubagentExecution): Promise<string>;
  validateAndPropose?(execution: OwnedSubagentExecution): Promise<SubagentProposal>;
  onCommittedResult?(completionId: string): void | Promise<void>;
}
export interface DelegateWork {
  characterId: string; operationKey: string; label: string; subagentId?: string;
  initialContext: SubagentInitialContext; direction: string; materials: ContextMaterial[];
  completionPolicy: "record_only" | "request_parent"; lifetimeMinutes: number; toolSelection?: SubagentToolSelection;
}
export interface SubagentDependencies {
  db: Database; children: SubagentRepo; inputs: SubagentInputRepo; executions: SubagentExecutionRepo; messages: RunMessageRepo;
  runRepo: RunRepo; runs: RunService<TurnInteractive>; effects: EffectLifecycleService; agent: ChatAgent;
  turns: TurnRegistry; queue: TurnQueue; store: ConversationStore; historyBudget(): number;
  changed(characterId: string, subagentId: string): void;
  reportError(code: string): void;
  mainTools?(characterId: string, runId: string, attemptId: () => string): ToolSet;
}
export interface BoundSubagentWork {
  root: SubagentInput; binding: SubagentWorkBinding; deferred?: string; resume: boolean;
}
export interface ActiveSubagentWork {
  characterId: string; subagentId: string; workInputId: string; controller: AbortController;
  runId?: string; yielded: boolean;
}
export interface SubagentState {
  deps: SubagentDependencies; bindings: Map<string, BoundSubagentWork>; active: Map<string, ActiveSubagentWork>;
  work: Set<Promise<void>>; closing: boolean; scheduled: boolean; schedule(): void;
  completionHint(): void;
}

export function checkWorkCurrent(state: SubagentState, bound: BoundSubagentWork, token: SubagentWorkToken, phase: WorkPhase): WorkCurrentness {
  if (Date.now() >= Date.parse(bound.root.workExpiresAt)) return { state: "retired", reason: "expired" };
  if (phase !== "model_intent" && state.deps.inputs.latestWorkSeq(token.workInputId) !== token.throughWorkSeq) {
    return { state: "superseded", reason: "superseded" };
  }
  try { return bound.binding.checkCurrent?.(token, phase) ?? { state: "current" }; }
  catch { return { state: "unavailable", reason: "source_unavailable" }; }
}

export function assertWorkCurrent(state: SubagentState, bound: BoundSubagentWork, token: SubagentWorkToken, phase: WorkPhase): void {
  const result = checkWorkCurrent(state, bound, token, phase);
  if (result.state !== "current") throw new Error(`SUBAGENT_${result.state.toUpperCase()}`);
}
