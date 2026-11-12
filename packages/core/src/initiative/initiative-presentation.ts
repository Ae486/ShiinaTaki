/**
 * INPUT: existing Avatar tools/vocabulary/subscriptions and Core governance
 * OUTPUT: original-generation presentation binding for a same-Attempt delivery continuation
 * POS: core/initiative — no direct avatar publication; uses ordinary governed tool Effects and outcomes
 */
import type { Tool } from "ai";
import type { CoreToolGovernanceAdapter } from "../governance/core-tool-governance-adapter.ts";
import type { AvatarVocabulary } from "../avatar/avatar-vocabulary.ts";
import type { AvatarSubscriptions } from "../avatar/avatar-subscriptions.ts";
import type { AvatarOutcomes } from "../avatar/avatar-outcomes.ts";
import type { Logger } from "../logging/logger.ts";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import type { InitiativePresentationBinding } from "./initiative-runtime.ts";
import { createAvatarTools } from "../avatar/avatar-tools.ts";

export function captureInitiativePresentation(input: {
  characterId: string; vocabulary: AvatarVocabulary; subscriptions: AvatarSubscriptions;
  outcomes: AvatarOutcomes; logger: Logger; governance: CoreToolGovernanceAdapter; effects: EffectLifecycleService;
}): InitiativePresentationBinding {
  const vocab = input.vocabulary.get(input.characterId);
  const generation = input.subscriptions.generation(input.characterId);
  const current = () => input.vocabulary.get(input.characterId) === vocab
    && input.subscriptions.generation(input.characterId) === generation;
  const tools = createAvatarTools({ ...input, vocab });
  return {
    isCurrent: current,
    accepts: (presentation) => Boolean(vocab?.[presentation.kind === "expression" ? "expressions" : "motions"].includes(presentation.name)),
    async execute(presentation, turn) {
      if (!current()) return "failed";
      const governed = input.governance.wrap(tools, { signal: turn.signal, runId: turn.runId, attemptId: turn.attemptId,
        effects: input.effects, toolObserver: turn.toolObserver });
      const name = presentation.kind === "expression" ? "avatar_set_expression" : "avatar_play_motion";
      const execute = (governed[name] as Tool<{ name: string }> | undefined)?.execute;
      if (!execute) return "failed";
      const result: unknown = await execute({ name: presentation.name }, { toolCallId: `delivery:${turn.runId}`, messages: [], abortSignal: turn.signal, context: undefined });
      if (result && typeof result === "object" && "ok" in result && result.ok === true) return "completed";
      if (result && typeof result === "object" && "state" in result && result.state === "outcome_unknown") return "outcome_unknown";
      return "failed";
    },
  };
}
