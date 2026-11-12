/**
 * INPUT: actual turn identity, captured tools, role selection and trusted tool factories
 * OUTPUT: governed immutable executable lookup with captured Skill disclosure bundles
 * POS: core/agents — shared Agent tool assembly; indirect extension calls retain the same selected membership
 */
import type { TimelineEntry, ContextContentOrigin } from "@taki/shared";
import type { AgentRunContext, ChatAgentDeps, TurnContext } from "./chat-agent.ts";
import { mergeToolSets } from "./tool-set-assembly.ts";
import { bindCapturedSkillLoad } from "./tool-disclosure.ts";
import { restrictInitiativeTools } from "./initiative-context.ts";
import { bindCapturedToolExecution } from "../governance/captured-tool-execution.ts";
import { bindExecutableToolSelection } from "../governance/executable-tool-selection.ts";
import type { ForegroundInboxContext } from "./foreground-inbox.ts";
import { contentOrigin } from "./context-attribution.ts";

export function assembleTurnTools(deps: ChatAgentDeps, attempt: { characterId: string; primary: boolean; userEntry?: TimelineEntry; runContext?: AgentRunContext; inbox?: ForegroundInboxContext }, turn?: TurnContext) {
  const bundles = (deps.skillTools?.({ characterId: attempt.characterId, userEntry: attempt.userEntry, turn }) ?? [])
    .filter((bundle) => attempt.runContext?.toolDisclosure?.skills[bundle.skillName] !== undefined);
  const coreTools = mergeToolSets(
    attempt.runContext?.memoryTools ?? deps.memory.createTools(attempt.characterId),
    typeof deps.coreTools === "function" ? deps.coreTools(attempt.primary, attempt.characterId) : deps.coreTools ?? {},
    attempt.primary && attempt.userEntry
      ? deps.primaryTools?.({ characterId: attempt.characterId, userEntry: attempt.userEntry, turn }) ?? {} : {},
    attempt.inbox?.tools ?? {},
    turn?.workContext?.tools ?? (attempt.runContext?.selectedContext ? turn?.decisionCollector?.tools ?? {} : deps.characterTools?.(attempt.characterId) ?? {}),
    ...bundles.map((bundle) => bundle.tools),
  );
  const interactive = turn && (turn.connection || (turn.runId && turn.attemptId && deps.effectLifecycle))
    ? { connection: turn.connection, signal: turn.signal, runId: turn.runId, attemptId: turn.attemptId, effects: deps.effectLifecycle, toolObserver: turn.toolObserver }
    : undefined;
  const extra = turn?.connection && deps.turnTools
    ? deps.turnTools({ ...turn, connection: turn.connection })
    : deps.extraTools ?? {};
  const capturedTools = turn?.runId && turn.attemptId && deps.effectLifecycle
    ? bindCapturedToolExecution(attempt.runContext?.tools ?? {}, { runId: turn.runId, attemptId: turn.attemptId,
      effects: deps.effectLifecycle, signal: turn.signal, toolObserver: turn.toolObserver })
    : attempt.runContext?.tools ?? {};
  const tools = mergeToolSets(
    deps.coreToolGovernance?.wrap(coreTools, interactive) ?? coreTools,
    extra,
    capturedTools,
  );
  const captured = bindCapturedSkillLoad({ tools, snapshot: attempt.runContext?.toolDisclosure, capturedTools });
  const eligible = turn?.workContext ? turn.workContext.selectTools(captured)
    : attempt.runContext?.selectedContext ? restrictInitiativeTools(captured, attempt.runContext.selectedContext) : captured;
  // Apply before disclosure and SDK construction so neither a later Skill load nor an unsolicited model call
  // can restore an omitted tool. Original captured closures remain available to their trusted Run owner.
  const selectedTools = turn?.allowedToolNames === undefined ? eligible
    : Object.fromEntries(Object.entries(eligible).filter(([name]) => turn.allowedToolNames?.includes(name)));
  const toolOrigins = new Map<string, ContextContentOrigin>();
  for (const name of Object.keys(selectedTools)) toolOrigins.set(name,
    name in capturedTools ? contentOrigin(attempt.runContext?.tools?.[name]) ?? "unknown"
      : name in extra ? contentOrigin(extra[name]) ?? "unknown" : "builtin");
  return { tools: turn?.workContext ? bindExecutableToolSelection(selectedTools) : selectedTools, bundles, toolOrigins };
}
