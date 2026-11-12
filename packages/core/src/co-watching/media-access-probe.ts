/**
 * INPUT: an explicit URL, selected Core-owned service and existing Run's captured extension bridge
 * OUTPUT: exact native media identity and bounded video-byte access evidence
 * POS: core/co-watching — shared access probe; creates neither an MCP connection nor an analysis job
 */
import { randomUUID } from "node:crypto";
import type { ToolExecutionOptions, ToolSet } from "ai";
import { ExtensionCallResultSchema, ExtensionDiscoverResultSchema, MediaAccessProbeResultSchema,
  type MediaAccessProbeResult } from "@taki/shared";
import type { AgentRunContext } from "../agents/chat-agent.ts";
import { stableSubjectId } from "../mcp/mcp-tool-identity.ts";
import { unwrapNativeAnalysisResult } from "./native-analysis-progress.ts";

export async function probeMediaAccess(input: {
  context: AgentRunContext; ownerHostId: string; serverId: string; videoUrl: string;
  signal?: AbortSignal; isCurrent?: () => boolean;
}): Promise<MediaAccessProbeResult> {
  const current = () => !input.signal?.aborted && (input.isCurrent === undefined || input.isCurrent() === true);
  if (!current()) throw new Error("MEDIA_ACCESS_UNAVAILABLE");
  const subjectId = stableSubjectId(input.serverId, "bilinote_probe_media");
  const options: ToolExecutionOptions<unknown> = { toolCallId: randomUUID(), messages: [], abortSignal: input.signal, context: undefined };
  const discovered = ExtensionDiscoverResultSchema.parse(await execute(input.context.tools?.extension_discover,
    { kind: "mcp-tool", query: subjectId, ownerHostId: input.ownerHostId }, options));
  const matches = discovered.entries.filter((entry) => entry.identity.kind === "mcp-tool"
    && entry.identity.subjectId === subjectId && entry.identity.ownerHostId === input.ownerHostId
    && entry.callMode === "mcp-tool" && entry.available);
  const [entry] = matches;
  if (matches.length !== 1 || !entry || !current()) throw new Error("MEDIA_ACCESS_UNAVAILABLE");
  const extensionId = entry.identity.extensionId;
  const called = ExtensionCallResultSchema.parse(await execute(input.context.tools?.extension_call,
    { extensionId, input: { video_url: input.videoUrl } }, { ...options, toolCallId: randomUUID() }));
  if (!current() || !called.ok || called.owner.extensionId !== extensionId) throw new Error("MEDIA_ACCESS_UNAVAILABLE");
  const result = MediaAccessProbeResultSchema.parse(unwrapNativeAnalysisResult(called.output));
  const requested = new URL(input.videoUrl);
  const match = /^\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/.exec(requested.pathname);
  if (match && (result.source.bvid !== match[1] || result.source.page !== Number(requested.searchParams.get("p") ?? "1"))) {
    throw new Error("MEDIA_ACCESS_MISMATCH");
  }
  return result;
}

function execute(definition: ToolSet[string] | undefined, value: unknown, options: ToolExecutionOptions<unknown>) {
  const call = definition?.execute as ((value: unknown, options: ToolExecutionOptions<unknown>) => unknown) | undefined;
  if (!call) throw new Error("MEDIA_ACCESS_UNAVAILABLE");
  return call(value, options);
}
