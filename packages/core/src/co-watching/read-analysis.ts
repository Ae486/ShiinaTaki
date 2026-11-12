/**
 * INPUT: a registered result reference and the ordinary turn's captured extension tools
 * OUTPUT: a verified bounded analysis/original-result page without watching or submitting work
 * POS: core/co-watching — read-only, open-world adapter; reuses native MCP governance and never reconnects
 */
import { randomUUID } from "node:crypto";
import type { ToolExecutionOptions, ToolSet } from "ai";
import {
  CO_WATCHING_ANALYSIS_PAGE_CHARS, CoWatchingAnalysisReadResultSchema,
  ExtensionCallResultSchema, ExtensionDiscoverResultSchema,
  type CoWatchingAnalysisReadParams, type CoWatchingAnalysisReadResult,
} from "@taki/shared";
import type { AgentRunContext } from "../agents/chat-agent.ts";
import { fenceUntrusted } from "../agents/untrusted-fence.ts";
import { stableSubjectId } from "../mcp/mcp-tool-identity.ts";
import type { CoWatchingCatalog } from "./analysis-catalog.ts";
import { verifyCoWatchingNative } from "./native-result.ts";

export type CoWatchingAnalysisReader = (request: CoWatchingAnalysisReadParams, execution: {
  context?: AgentRunContext; options: ToolExecutionOptions<unknown>;
}) => Promise<CoWatchingAnalysisReadResult>;

export function createCoWatchingAnalysisReader(input: {
  catalog: Pick<CoWatchingCatalog, "get">; ownerHostId: string;
}): CoWatchingAnalysisReader {
  return async (request, execution) => {
    const { context, options } = execution;
    try {
      if (options.abortSignal?.aborted) return failure("cancelled");
      const analysis = input.catalog.get(request.analysisId);
      if (!analysis) return failure("not_found");
      const subjectId = stableSubjectId(analysis.serverId, "bilinote_read_result");
      // Search only the already captured directory by canonical identity. Neither labels nor a live
      // manager lookup may select a replacement service behind this turn's admitted MCP binding.
      const discovered = ExtensionDiscoverResultSchema.parse(await execute(context?.tools?.extension_discover,
        { kind: "mcp-tool", query: subjectId, ownerHostId: input.ownerHostId }, options));
      const matches = discovered.entries.filter((entry) => entry.identity.subjectId === subjectId
        && entry.identity.ownerHostId === input.ownerHostId && entry.identity.kind === "mcp-tool"
        && entry.callMode === "mcp-tool" && entry.available);
      const [entry] = matches;
      if (matches.length !== 1 || !entry) return failure("unavailable");
      const extensionId = entry.identity.extensionId;
      const called = ExtensionCallResultSchema.parse(await execute(context?.tools?.extension_call, {
        extensionId, input: { client_request_id: analysis.native.requestId, job_id: analysis.native.jobId, include_complete: true },
      }, { ...options, toolCallId: randomUUID() }));
      if (options.abortSignal?.aborted) return failure("cancelled");
      if (!called.ok || called.owner.extensionId !== extensionId) return failure("unavailable");
      // Removal/replacement during the awaited native read cannot leave a seemingly current result behind.
      if (JSON.stringify(input.catalog.get(request.analysisId)) !== JSON.stringify(analysis)) return failure("reference_changed");
      const verified = verifyCoWatchingNative(called.output, analysis);
      const text = JSON.stringify(request.view === "complete" ? verified.complete : verified.native.analysis, null, 2);
      const page = resultPage(text, request.offset);
      if (!page) return failure("invalid_offset");
      return CoWatchingAnalysisReadResultSchema.parse({ ok: true, status: "analysis_read", analysis,
        view: request.view, ...page });
    } catch (error) {
      if (options.abortSignal?.aborted) return failure("cancelled");
      return failure(error instanceof Error && error.message === "CO_WATCHING_ANALYSIS_MISMATCH" ? "identity_mismatch" : "unavailable");
    }
  };
}

function resultPage(text: string, offset: number) {
  const isLowSurrogate = (index: number) => text.charCodeAt(index) >= 0xdc00 && text.charCodeAt(index) <= 0xdfff;
  if (offset > text.length || isLowSurrogate(offset)) return undefined;
  let end = Math.min(text.length, offset + CO_WATCHING_ANALYSIS_PAGE_CHARS);
  if (isLowSurrogate(end)) end -= 1;
  return { offset, totalChars: text.length, nextOffset: end < text.length ? end : null,
    truncated: offset > 0 || end < text.length,
    content: fenceUntrusted({ source: "registered-video-analysis", content: text.slice(offset, end) }) };
}

function execute(definition: ToolSet[string] | undefined, value: unknown, options: ToolExecutionOptions<unknown>) {
  const call = definition?.execute as ((value: unknown, options: ToolExecutionOptions<unknown>) => unknown) | undefined;
  if (!call) throw new Error("CO_WATCHING_ANALYSIS_UNAVAILABLE");
  return call(value, options);
}

function failure(reason: Exclude<CoWatchingAnalysisReadResult, { ok: true }>["reason"]): CoWatchingAnalysisReadResult {
  const messages = {
    not_found: "This registered analysis no longer exists. List the catalog again; do not submit another analysis.",
    unavailable: "The captured native result reader could not return this analysis. Report the read failure; do not start watching or reanalyze.",
    cancelled: "The read was cancelled; no watching or analysis was started.",
    reference_changed: "The registered result changed during reading. Refresh the catalog before selecting it again.",
    invalid_selection: "Choose an exact listed analysis ID and use read_analysis; leave read-only selection fields null for control actions.",
    invalid_offset: "Use offset 0 or the exact nextOffset from the previous page of this result and view.",
    identity_mismatch: "The native result does not match the registered media, request or hash. Do not use this content or reanalyze automatically.",
  };
  return { ok: false, reason, message: messages[reason] };
}
