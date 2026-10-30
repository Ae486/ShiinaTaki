/**
 * INPUT: an admitted viewing opportunity, its captured tools and the existing privacy/vision owners
 * OUTPUT: bounded screened evidence only after exact native media access and a real Host capture
 * POS: core/co-watching — source adapter over governed MCP, ambient capture and the same Run Effects
 */
import { randomUUID } from "node:crypto";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { ExtensionCallResultSchema, ExtensionDiscoverResultSchema, ScreenshotOutputSchema } from "@taki/shared";
import type { TurnContext } from "../agents/chat-agent.ts";
import { fenceUntrusted } from "../agents/untrusted-fence.ts";
import type { ScreenshotDescriber } from "../capabilities/screenshot-describe.ts";
import type { EffectLifecycleService } from "../harness/effect-lifecycle-service.ts";
import type { Logger } from "../logging/logger.ts";
import { observeAmbientFrame } from "../perception/ambient-observation.ts";
import type { AmbientShotStore } from "../perception/ambient-shot-store.ts";
import { screenForegroundNow } from "../perception/foreground-screen.ts";
import type { PerceptionLayer } from "../perception/perception-layer.ts";
import { scrubPii } from "../perception/pii-scrub.ts";
import { createScreenContext } from "../perception/screen-context.ts";
import { probeMediaAccess } from "./media-access-probe.ts";
import type { ViewingInvitationEvidence, ViewingInvitationPreparation } from "./viewing-invitation-source.ts";

interface Dependencies {
  ownerHostId: string;
  nativeTarget(): { serverId: string; isCurrent(): boolean } | undefined;
  enabled(): boolean;
  perception: { pause: Pick<PerceptionLayer["pause"], "isPaused">; isSensitive: PerceptionLayer["isSensitive"];
    evidence: Pick<PerceptionLayer["evidence"], "generation" | "isCurrent"> };
  describe?: ScreenshotDescriber;
  effects: EffectLifecycleService;
  store: AmbientShotStore;
  dropRawAfterDescribe: boolean;
  logger: Logger;
}

export function createViewingInvitationEvidence(deps: Dependencies) {
  return async (input: ViewingInvitationPreparation, turn: TurnContext): Promise<ViewingInvitationEvidence | undefined> => {
    const target = deps.nativeTarget();
    if (!target || !deps.describe || !turn.runContext || !turn.runId || !turn.attemptId || !deps.enabled()) return;
    const epoch = deps.perception.evidence.generation();
    const isCurrent = () => deps.enabled() && !turn.signal?.aborted && input.isCurrent() && target.isCurrent()
      && !deps.perception.pause.isPaused() && deps.perception.evidence.isCurrent(epoch) && Date.now() < input.expiresAt;
    if (!isCurrent()) return;
    const media = input.source.source.media;
    const probe = await probeMediaAccess({ context: turn.runContext, ownerHostId: deps.ownerHostId, serverId: target.serverId,
      videoUrl: `https://www.bilibili.com/video/${media.bvid}?p=${media.page}`, signal: turn.signal, isCurrent });
    if (!isCurrent() || probe.source.bvid !== media.bvid || probe.source.cid !== media.cid || probe.source.page !== media.page) return;
    const route = async (capability: string) => {
      const output = await capturedCapability({ input, turn, isCurrent }, capability);
      return output === undefined ? { ok: false as const, code: "DENIED" as const, message: "Viewing evidence unavailable" }
        : { ok: true as const, output };
    };
    const screened = await screenForegroundNow({ route, isSensitive: deps.perception.isSensitive });
    if (screened.status !== "clear" || !isCurrent()) return;
    const output = await route("screenshot-ambient");
    if (!output.ok || !isCurrent()) return;
    const frame = ScreenshotOutputSchema.parse(output.output);
    const context = createScreenContext({ staleAfterMs: Math.max(0, input.expiresAt - Date.now()) });
    const observedAt = Date.now();
    const execution = { runId: turn.runId, attemptId: turn.attemptId, effects: deps.effects,
      signal: turn.signal, onCommitModelIntent: turn.onCommitModelIntent };
    const describe = deps.describe;
    await observeAmbientFrame({ describe: (image) => describe.describe({ ...image,
      prompt: `${image.prompt ?? ""} Describe the visible video frame only; do not infer the unseen video.` }, execution),
      store: deps.store, context, logger: deps.logger, dropRawAfterDescribe: deps.dropRawAfterDescribe,
    }, frame, { observedAt, isCurrent });
    const observation = context.latest(Date.now());
    if (!observation || !isCurrent()) return;
    const title = scrubPii(probe.title);
    return { title, isCurrent, text: fenceUntrusted({ source: "detected-viewing-evidence",
      content: `Native access to ${media.bvid} P${media.page} was verified. Title: ${title}\nVisible screen: ${observation.description.slice(0, 2800)}` }) };
  };
}

async function capturedCapability(binding: { input: ViewingInvitationPreparation; turn: TurnContext; isCurrent(): boolean }, subjectId: string) {
  const { input, turn, isCurrent } = binding;
  if (!isCurrent()) return;
  const options = { toolCallId: randomUUID(), messages: [], abortSignal: turn.signal, context: undefined };
  const found = ExtensionDiscoverResultSchema.parse(await execute(turn.runContext?.tools?.extension_discover,
    { kind: "capability", ownerHostId: input.source.hostId, query: subjectId }, options));
  const matches = found.entries.filter((entry) => entry.available && entry.callMode === "capability"
    && entry.identity.subjectId === subjectId && entry.identity.ownerHostId === input.source.hostId
    && entry.identity.connectionGeneration === input.source.connectionGeneration
    && entry.identity.catalogGeneration === input.source.catalogGeneration);
  const entry = matches[0];
  if (matches.length !== 1 || !entry || !isCurrent()) return;
  const called = ExtensionCallResultSchema.parse(await execute(turn.runContext?.tools?.extension_call,
    { extensionId: entry.identity.extensionId, input: {} }, { ...options, toolCallId: randomUUID() }));
  if (!called.ok || called.owner.extensionId !== entry.identity.extensionId || !isCurrent()) return;
  const routed = called.output;
  if (typeof routed !== "object" || routed === null || !("ok" in routed) || routed.ok !== true || !("output" in routed)) return;
  return routed.output;
}

function execute(definition: ToolSet[string] | undefined, value: unknown, options: ToolExecutionOptions<unknown>) {
  const call = definition?.execute as ((value: unknown, options: ToolExecutionOptions<unknown>) => unknown) | undefined;
  if (!call) throw new Error("VIEWING_CAPTURE_UNAVAILABLE");
  return call(value, options);
}
