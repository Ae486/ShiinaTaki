/**
 * INPUT:  process env (TAKI_MAX_STEPS)
 * OUTPUT: loadAgentConfig(env) -> { maxSteps } — per-turn agent-loop tuning, zod-validated with defaults
 * POS:    core/config — boot-time agent behaviour config (D11 config-ization; extend as more knobs land)
 */
import { z } from "zod";

export const DEFAULT_MAX_STEPS = 10;

export const AgentConfigSchema = z.object({
  // The tool-loop step cap per turn: how many model round-trips (call -> observe -> decide) one turn may take. Too
  // low truncates multi-step tasks; too high spends tokens on a runaway loop. Bounded so a typo can't uncap it.
  maxSteps: z.coerce.number().int().min(1).max(50).default(DEFAULT_MAX_STEPS),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export function loadAgentConfig(env: Record<string, string | undefined>): AgentConfig {
  return AgentConfigSchema.parse({ maxSteps: env.TAKI_MAX_STEPS });
}
