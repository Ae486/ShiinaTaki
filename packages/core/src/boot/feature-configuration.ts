/**
 * INPUT: effective configuration and application observations after storage is open
 * OUTPUT: basic-plane construction settings with explicit unavailable feature observations
 * POS: core/boot — invalid feature inputs preserve recovery access; admissions still validate their own policy
 */
import type { ConfigApplicationTracker } from "../config/config-application.ts";
import { loadAgentConfig } from "../config/agent-config.ts";
import { loadAmbientScreenshotConfig } from "../config/ambient-screenshot-config.ts";
import { loadAttachmentConfig } from "../config/attachment-config.ts";
import { ContextConfigEnvironmentSchema, loadContextConfig } from "../config/context-config.ts";
import { ServerConfigSchema } from "../config/server-config.ts";

export const CONTEXT_CONFIG_KEYS = Object.keys(ContextConfigEnvironmentSchema.shape);
export const AMBIENT_CONFIG_KEYS = ["TAKI_AMBIENT_SCREENSHOT", "TAKI_AMBIENT_SCREENSHOT_RETENTION"];

export function loadFeatureConfiguration(env: Record<string, string | undefined>, application: ConfigApplicationTracker) {
  function parse<T>(keys: string[], read: () => T, unavailable: () => T): T {
    try { const value = read(); application.mark(keys, "applied"); return value; }
    catch {
      application.mark(keys, "unavailable", { activeValue: null,
        message: "Invalid configuration. Update this setting to enable the affected feature." });
      return unavailable();
    }
  }
  const contextEnvironment: Record<string, string> = {};
  for (const [key, schema] of Object.entries(ContextConfigEnvironmentSchema.shape)) {
    contextEnvironment[key] = String(parse([key], () => schema.parse(env[key]), () => schema.parse(undefined)));
  }
  return {
    // These defaults only compose model-independent objects; AgentRuntime independently rejects invalid admission.
    contextConfig: loadContextConfig(contextEnvironment),
    agentConfig: parse(["TAKI_MAX_STEPS"], () => loadAgentConfig(env), () => loadAgentConfig({})),
    ambientConfig: parse(AMBIENT_CONFIG_KEYS, () => loadAmbientScreenshotConfig(env),
      () => ({ enabled: false, retention: { mode: "keep" as const } })),
    // Invalid retention must not delete existing bytes. Media reads also check the unavailable observation.
    attachmentConfig: parse(["TAKI_ATTACHMENT_TTL_DAYS"], () => loadAttachmentConfig(env),
      () => ({ ttlDays: Number.POSITIVE_INFINITY, ttlMs: Number.POSITIVE_INFINITY })),
    logLevel: parse(["TAKI_LOG_LEVEL"], () => ServerConfigSchema.shape.logLevel.parse(env.TAKI_LOG_LEVEL),
      () => ServerConfigSchema.shape.logLevel.parse(undefined)),
    promptDir: parse(["TAKI_PROMPT_DIR"], () => ServerConfigSchema.shape.promptDir.parse(env.TAKI_PROMPT_DIR),
      () => ServerConfigSchema.shape.promptDir.parse(undefined)),
    trustLoopbackOperator: parse(["TAKI_TRUST_LOOPBACK_OPERATOR"],
      () => ServerConfigSchema.shape.trustLoopbackOperator.parse(env.TAKI_TRUST_LOOPBACK_OPERATOR), () => false),
  };
}
