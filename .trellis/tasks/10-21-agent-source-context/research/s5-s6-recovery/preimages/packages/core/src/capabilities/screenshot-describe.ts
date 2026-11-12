/**
 * INPUT:  a vision-slot LanguageModel (TAKI_VLM_*) + a screenshot's raw base64 bytes, mediaType, and an optional
 *         caller focus prompt
 * OUTPUT: createScreenshotDescriber(deps) -> describe({dataBase64, mediaType, prompt?}) => Promise<string | null> — a
 *         faithful textual description of the screen, or null (empty reply / VLM failure; warn + degrade, never throws)
 * POS:    core/capabilities — the OPTIONAL screenshot→VLM bridge (reuses #17's vision slot); wired only when the
 *         slot is configured. The text model reads the description in the tool result; pixels never reach it.
 */
import { ToolLoopAgent, type LanguageModel } from "ai";
import type { EffectLifecycle } from "@taki/shared";
import { createRunObservabilityModel } from "../agents/run-observability-telemetry.ts";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";

// Mirrors image-description-writer's faithful-and-concise posture; a screenshot's readable text and application
// context are what the text model needs to answer "what's on my screen".
const DESCRIBE_PROMPT =
  "You describe screenshots for an assistant that cannot see images. Describe the visible screen faithfully, " +
  "concisely and objectively — applications, windows, notable content, and any readable text that matters. " +
  "Reply with ONLY the description, at most 200 words.";

// The caller focus is APPENDED to the base framing, never a replacement — the guardrails (objective,
// only-the-description, 200-word cap) survive any caller-supplied prompt (T2b research §3.6).
function composeInstructions(prompt: string | undefined): string {
  const focus = prompt?.trim();
  return focus ? `${DESCRIBE_PROMPT}\n\nFocus especially on: ${focus}` : DESCRIBE_PROMPT;
}

export interface ScreenshotDescriberLogger {
  warn(obj: object, msg: string): void;
}

export interface ScreenshotDescriber {
  describe(input: { dataBase64: string; mediaType: string; prompt?: string }, execution?: {
    signal?: AbortSignal; runId: string; attemptId: string; effects: EffectLifecycleService;
    onCommitModelIntent?: (effect: EffectLifecycle) => void;
  }): Promise<string | null>;
}

export function createScreenshotDescriber(deps: {
  model: LanguageModel;
  logger: ScreenshotDescriberLogger;
}): ScreenshotDescriber {
  return {
    async describe({ dataBase64, mediaType, prompt }, execution) {
      try {
        if (execution?.signal?.aborted) return null;
        const observed = createRunObservabilityModel({ model: deps.model, lifecycle: execution?.effects,
          runId: execution?.runId, attemptId: execution?.attemptId, onCommitModelIntent: execution?.onCommitModelIntent });
        const agent = new ToolLoopAgent({ model: observed.model, instructions: composeInstructions(prompt),
          ...(observed.observability ? { telemetry: { isEnabled: true, recordInputs: false, recordOutputs: false,
            integrations: [observed.observability.telemetry] } } : {}) });
        const result = await agent.generate({
          abortSignal: execution?.signal,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Describe this screenshot." },
                // FilePart with RAW base64 (ImagePart is @deprecated in v7; a data-URL prefix throws — research r1).
                { type: "file", mediaType, data: dataBase64 },
              ],
            },
          ],
        });
        observed.observability?.assertHealthy();
        if (execution?.signal?.aborted) return null;
        const text = result.text.trim();
        return text.length > 0 ? text : null;
      } catch (error) {
        // A failed description degrades to a plain screenshot result (path + dims) — it never blocks the tool.
        const message = error instanceof Error ? error.message : String(error);
        deps.logger.warn({ err: message }, "screenshot description failed; dropped");
        return null;
      }
    },
  };
}
