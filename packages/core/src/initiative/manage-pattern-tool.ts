/**
 * INPUT: the actual primary user row, active Run/Attempt and Core Pattern service
 * OUTPUT: one source-bound authoring/management tool; proposals always await operator confirmation
 * POS: core/initiative — thin Agent adapter, never an approval writer or autonomous policy evaluator
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { InteractionPatternDefinitionSchema, type TimelineEntry } from "@taki/shared";
import type { TurnContext } from "../agents/chat-agent.ts";
import type { InteractionPatternService } from "./patterns/pattern-service.ts";
import type { InteractionPatternActor } from "./patterns/pattern-source.ts";

const InputFields = z.strictObject({
  action: z.enum(["list", "read", "history", "propose", "pause", "resume", "retire", "rollback"])
    .describe("Read current habits or carry out the user's requested proposal/management action. Confirmation is a user card action."),
  patternId: z.string().min(1).max(200).nullable().describe("An ID returned by list/read; null only for listing or a new proposal. Never invent or show it to the user."),
  expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()
    .describe("Current version from read for changes; zero for a new proposal; null for reads. A conflict requires rereading."),
  definition: InteractionPatternDefinitionSchema.nullable().describe("Complete supported definition for propose; null otherwise. Store the interaction purpose, not fixed dialogue."),
  revisionId: z.string().min(1).max(200).nullable().describe("Accepted revision returned by history for rollback; null otherwise. Rollback creates a reviewable candidate."),
  listAfter: z.string().min(1).max(200).nullable()
    .describe("For list, the previous response's nextAfter to continue, or null for the first page. Null for other actions. Never invent or display cursors."),
  historyBefore: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()
    .describe("For history, the previous response's nextBefore to continue, or null for the first page. Null for other actions. Never invent or display cursors."),
});
type PatternToolInput = z.infer<typeof InputFields>;
const Input = InputFields.refine(validOperation, "Supply only the fields required by the selected action; unused fields must be null.");

function validOperation(input: PatternToolInput): boolean {
  if ((input.action !== "list" && input.listAfter !== null)
    || (input.action !== "history" && input.historyBefore !== null)) return false;
  if (input.action === "list" || input.action === "read" || input.action === "history") {
    return input.expectedVersion === null && input.definition === null && input.revisionId === null
      && (input.action === "list" ? input.patternId === null : input.patternId !== null);
  }
  if (input.expectedVersion === null) return false;
  if (input.action === "propose") {
    return input.definition !== null && input.revisionId === null
      && (input.patternId === null ? input.expectedVersion === 0 : input.expectedVersion > 0);
  }
  if (input.patternId === null || input.expectedVersion < 1 || input.definition !== null) return false;
  return input.action === "rollback" ? input.revisionId !== null : input.revisionId === null;
}
interface Dependencies {
  service: InteractionPatternService; characterId: string; userEntry: TimelineEntry; turn?: TurnContext;
}

export function createManagePatternTool(input: Dependencies): ToolSet {
  if (!input.turn?.runId || !input.turn.attemptId || input.turn.turnKind === "non-primary") return {};
  return { manage_interaction_pattern: tool({
    description: "Read and manage the current Character's interaction habits when the user asks in this conversation. "
      + "Use list/read/history to obtain current bindings, then propose a supported purpose and conditions or make the user's explicit lifecycle change. "
      + "For unsupported conditions such as stress or emotion, ask which supported observation the user wants; do not invent a sensor. "
      + "New rules, revisions and rollbacks produce concrete review cards and remain inactive until the user confirms; this tool cannot confirm them or grant permissions. "
      + "When the user requests creation and the supported fields are clear, actually call propose. Listing or describing a candidate does not save it. "
      + "Only claim that a review card exists after an applied/duplicate result contains its candidate revision; on refusal, explain it instead. "
      + "Report stored state accurately. Do not invent when a revision was created or modified; omit relative dates unless established by returned timestamps. "
      + "Continue list with nextAfter and history with nextBefore. A missing pattern or empty page is a read result, not a saved proposal; retain exact IDs, versions and candidate revisions for later actions. "
      + "Use schedule_task for an explicit scheduled reminder instead. Read a conflict or refusal and clarify; never retry an unseen revision or display internal IDs.",
    inputSchema: Input,
    execute(params, options) {
      try {
        if (input.turn?.signal?.aborted) return refused("source_stale");
        const parsed = Input.safeParse(params);
        return parsed.success ? runPatternOperation(input, parsed.data, options.toolCallId) : refused("invalid_request");
      } catch { return refused("operation_failed"); }
    },
  }) };
}

function runPatternOperation(deps: Dependencies, params: PatternToolInput, callId: string): unknown {
  const { service, characterId } = deps;
  if (params.action === "list") return { ok: true, ...service.list({ characterId, after: params.listAfter, limit: 25 }) };
  if (params.action === "read") return params.patternId
    ? { ok: true, pattern: service.get({ characterId, patternId: params.patternId }) } : refused("invalid_request");
  if (params.action === "history") return params.patternId
    ? { ok: true, ...service.history({ characterId, patternId: params.patternId, before: params.historyBefore, limit: 25 }) } : refused("invalid_request");
  const actor = primaryActor(deps, callId);
  if (!actor) return refused("source_stale");
  if (params.expectedVersion === null) return refused("invalid_request");
  const base = { characterId, commandId: callId, expectedVersion: params.expectedVersion };
  if (params.action === "propose") {
    if (!params.definition || params.revisionId !== null) return refused("invalid_request");
    return outcome(service.propose({ ...base, patternId: params.patternId, definition: params.definition }, actor));
  }
  if (!params.patternId || params.definition !== null) return refused("invalid_request");
  if (params.action === "rollback") return params.revisionId
    ? outcome(service.rollback({ ...base, patternId: params.patternId, revisionId: params.revisionId }, actor)) : refused("invalid_request");
  if (params.revisionId !== null) return refused("invalid_request");
  return outcome(service.changeState({ ...base, patternId: params.patternId, action: params.action }, actor));
}

function primaryActor(input: Dependencies, toolCallId: string): InteractionPatternActor | undefined {
  const { runId, attemptId } = input.turn ?? {};
  if (!runId || !attemptId || !input.service.registerPrimarySource({ characterId: input.characterId, runId, attemptId,
    userTimelineSeq: input.userEntry.seq, userTimelineId: input.userEntry.id })) return undefined;
  return { kind: "agent", runId, attemptId, toolCallId };
}

function refused(reason: string) {
  return { ok: false, code: "PATTERN_REFUSED", reason, message: "The interaction habit was not changed. Read the current state or clarify the user's request." };
}
function outcome(result: ReturnType<InteractionPatternService["propose"]>) {
  return result.status === "refused" ? { ...result, ...refused(result.reason) } : { ok: true, ...result };
}
