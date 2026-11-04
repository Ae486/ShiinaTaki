/**
 * INPUT: an admitted viewing opportunity, its captured tools and the existing privacy owners
 * OUTPUT: bounded screened evidence only after exact native media access and a real Host capture
 * POS: core/co-watching — source adapter over governed MCP, ambient capture and the same Run Effects
 */
import { randomUUID } from "node:crypto";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { ExtensionCallResultSchema, ExtensionDiscoverResultSchema, ScreenshotOutputSchema } from "@taki/shared";
import type { TurnContext } from "../agents/chat-agent.ts";
import type { NativeImageContext } from "../agents/native-image-context.ts";
import { nativeToolImages, type NativeToolImages } from "../agents/native-tool-images.ts";
import { fenceUntrusted } from "../agents/untrusted-fence.ts";
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
  store: AmbientShotStore;
  dropRawAfterConsumption: boolean;
}

export function createViewingInvitationEvidence(deps: Dependencies) {
  return async (input: ViewingInvitationPreparation, turn: TurnContext): Promise<ViewingInvitationEvidence | undefined> => {
    const target = deps.nativeTarget();
    if (!target || !turn.runContext || !turn.runId || !turn.attemptId || !deps.enabled()) return;
    const epoch = deps.perception.evidence.generation();
    const isCurrent = () => deps.enabled() && !turn.signal?.aborted && input.isCurrent() && target.isCurrent()
      && !deps.perception.pause.isPaused() && deps.perception.evidence.isCurrent(epoch) && Date.now() < input.expiresAt;
    if (!isCurrent()) return;
    const media = input.source.source.media;
    const probe = await probeMediaAccess({ context: turn.runContext, ownerHostId: deps.ownerHostId, serverId: target.serverId,
      videoUrl: `https://www.bilibili.com/video/${media.bvid}?p=${media.page}`, signal: turn.signal, isCurrent });
    if (!isCurrent() || probe.source.bvid !== media.bvid || probe.source.cid !== media.cid || probe.source.page !== media.page) return;
    const route = async (capability: string) => {
      const captured = await capturedCapability({ input, turn, isCurrent }, capability);
      return captured === undefined ? { ok: false as const, code: "DENIED" as const, message: "Viewing evidence unavailable" }
        : { ok: true as const, ...captured };
    };
    const screened = await screenForegroundNow({ route, isSensitive: deps.perception.isSensitive });
    if (screened.status !== "clear" || !isCurrent()) return;
    const output = await route("screenshot-ambient");
    if (!output.ok) return;
    const nativeImageContext = await acquireViewingFrame(deps, output,
      { expiresAt: input.expiresAt, sourceRef: input.source.sourceRef, isCurrent });
    if (!nativeImageContext) return;
    const title = scrubPii(probe.title);
    return { title, isCurrent, nativeImageContext, text: fenceUntrusted({ source: "detected-viewing-evidence",
      content: `Native access to ${media.bvid} P${media.page} was verified. Title: ${title}. `
        + "The attached image is a screened current video frame, not a detailed analysis of the unseen video." }) };
  };
}

interface CapturedEvidence { output: unknown; nativeImages?: NativeToolImages }

async function acquireViewingFrame(deps: Dependencies, captured: CapturedEvidence,
  observation: { expiresAt: number; sourceRef: string; isCurrent(): boolean }): Promise<NativeImageContext | undefined> {
  const native = captured.nativeImages;
  const isCurrent = () => observation.isCurrent() && (native?.isCurrent?.() ?? true);
  const context = createScreenContext({ staleAfterMs: Math.max(0, observation.expiresAt - Date.now()) });
  let transferred = false;
  try {
    if (!isCurrent()) return;
    if (native && native.images.length !== 1) return;
    const image = native?.images[0];
    const frame = ScreenshotOutputSchema.parse(image && typeof captured.output === "object" && captured.output !== null
      ? { ...captured.output, ...image } : captured.output);
    const observedAt = Date.now();
    transferred = true;
    await observeAmbientFrame({ store: deps.store, context, dropRawAfterConsumption: deps.dropRawAfterConsumption },
      frame, { observedAt, isCurrent, release: () => native?.release?.(),
        sourceContext: { materials: [{ label: "Detected viewing screen capture", reference: observation.sourceRef,
          time: new Date(observedAt).toISOString() }] } });
    const input = context.acquire();
    if (!input || !isCurrent()) { context.clear(); return; }
    return input;
  } finally { if (!transferred) native?.release?.(); }
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
  const raw = await execute(turn.runContext?.tools?.extension_call,
    { extensionId: entry.identity.extensionId, input: {} }, { ...options, toolCallId: randomUUID() });
  const nativeImages = nativeToolImages(raw);
  let handedOff = false;
  try {
    const called = ExtensionCallResultSchema.parse(raw);
    if (!called.ok || called.owner.extensionId !== entry.identity.extensionId || !isCurrent()) return;
    const routed = called.output;
    if (typeof routed !== "object" || routed === null || !("ok" in routed) || routed.ok !== true || !("output" in routed)) return;
    handedOff = true;
    return { output: routed.output, nativeImages };
  } finally { if (!handedOff) nativeImages?.release?.(); }
}

function execute(definition: ToolSet[string] | undefined, value: unknown, options: ToolExecutionOptions<unknown>) {
  const call = definition?.execute as ((value: unknown, options: ToolExecutionOptions<unknown>) => unknown) | undefined;
  if (!call) throw new Error("VIEWING_CAPTURE_UNAVAILABLE");
  return call(value, options);
}
