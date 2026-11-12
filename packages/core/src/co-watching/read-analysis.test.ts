import { describe, expect, it, vi } from "vitest";
import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";
import { CO_WATCHING_ANALYSIS_PAGE_CHARS } from "@taki/shared";
import { createExtensionRunContext } from "../extensions/extension-run-context.ts";
import { createHostCatalogStore } from "../hosts/host-catalog.ts";
import type { McpManager, McpToolSnapshot } from "../mcp/mcp-manager.ts";
import { stableSubjectId } from "../mcp/mcp-tool-identity.ts";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import type { SkillCatalogManager } from "../skills/skill-catalog-manager.ts";
import { coWatchingInput } from "../testing/co-watching-fixture.ts";
import { createCoWatchingAnalysisReader } from "./read-analysis.ts";

const HOST = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const options: ToolExecutionOptions<unknown> = { toolCallId: "parent-read", messages: [], context: undefined };

function fixture() {
  const f = coWatchingInput();
  let current = true;
  const native = vi.fn<(value: unknown) => Promise<unknown>>(async () => f.raw);
  const mcpTool = tool({ inputSchema: z.object({ client_request_id: z.uuid(), job_id: z.uuid(), include_complete: z.boolean() }), execute: native });
  const snapshot = { toolKey: "captured_result", tool: mcpTool, serverId: f.analysis.serverId,
    ownerHostId: HOST, configRevision: 1, generation: 1, isCurrent: () => current,
    ref: { serverName: f.analysis.serverId, toolName: "bilinote_read_result",
      subjectId: stableSubjectId(f.analysis.serverId, "bilinote_read_result"), subjectRevision: "cfg.1" } } satisfies McpToolSnapshot;
  const lookup = vi.fn((id: string) => id === f.analysis.analysisId ? structuredClone(f.analysis) : undefined);
  const capture = () => createExtensionRunContext({ runId: RUN, coreHostId: HOST, catalogs: createHostCatalogStore(),
    mcp: { snapshot: () => [snapshot] } as unknown as McpManager,
    skills: { catalog: { currentGeneration: () => 1, list: () => [] } as unknown as SkillCatalogManager,
      loader: { renderList: () => "", describe: () => undefined, load: () => ({ ok: false, code: "NOT_FOUND", message: "Absent" }) },
      governance: { authorize: () => ({ allowed: true }) } as unknown as GovernancePolicyService },
    route: async () => { throw new Error("No capability may be routed by a result read"); } });
  const context = capture();
  const reader = createCoWatchingAnalysisReader({ catalog: { get: lookup }, ownerHostId: HOST });
  const request = { analysisId: f.analysis.analysisId, view: "analysis" as const, offset: 0 };
  return { ...f, native, snapshot, lookup, capture, context, reader, request, retire: () => { current = false; } };
}

describe("registered analysis reads through captured ordinary extension facilities", () => {
  it("reads the exact result with original IDs, without a source, acceptance or new native analysis", async () => {
    const f = fixture(); const result = await f.reader(f.request, { context: f.context, options });
    expect(result).toMatchObject({ ok: true, status: "analysis_read", analysis: f.analysis, view: "analysis", offset: 0, nextOffset: null, truncated: false });
    expect(f.native).toHaveBeenCalledOnce();
    expect(f.native.mock.calls[0]?.[0]).toEqual({ client_request_id: f.analysis.native.requestId, job_id: f.analysis.native.jobId, include_complete: true });
    if (result.ok) expect(result.content).toContain("<untrusted-observation");
  });

  it("does not redirect an old Run to a replacement with the same routing name", async () => {
    const f = fixture(); f.retire();
    expect(await f.reader(f.request, { context: f.context, options })).toMatchObject({ ok: false, reason: "unavailable" });
    expect(f.native).not.toHaveBeenCalled();
  });

  it("does not read an unknown reference or invent a missing captured bridge", async () => {
    const f = fixture();
    expect(await f.reader({ ...f.request, analysisId: RUN }, { context: f.context, options })).toMatchObject({ ok: false, reason: "not_found" });
    expect(await f.reader(f.request, { context: { tools: {} }, options })).toMatchObject({ ok: false, reason: "unavailable" });
    expect(f.native).not.toHaveBeenCalled();
  });

  it("cannot select a different service or owner by a matching tool label", async () => {
    const f = fixture();
    f.snapshot.ref.subjectId = stableSubjectId("other-service", "bilinote_read_result");
    const context = f.capture();
    expect(await f.reader(f.request, { context, options })).toMatchObject({ ok: false, reason: "unavailable" });
    expect(f.native).not.toHaveBeenCalled();
    f.snapshot.ref.subjectId = stableSubjectId(f.analysis.serverId, "bilinote_read_result");
    f.snapshot.ownerHostId = RUN;
    expect(await f.reader(f.request, { context: f.capture(), options })).toMatchObject({ ok: false, reason: "unavailable" });
    expect(f.native).not.toHaveBeenCalled();
  });

  it("preserves an underlying governed refusal and does not expose invalid identity data", async () => {
    const f = fixture(); f.native.mockResolvedValueOnce({ ok: false, code: "FORBIDDEN", message: "Denied" });
    expect(await f.reader(f.request, { context: f.context, options })).toMatchObject({ ok: false, reason: "unavailable" });
    f.raw.structuredContent.sha256 = "b".repeat(64);
    expect(await f.reader(f.request, { context: f.context, options })).toMatchObject({ ok: false, reason: "identity_mismatch" });
  });

  it("rejects removal/replacement and cancellation that happen during the native read", async () => {
    const f = fixture();
    f.native.mockImplementationOnce(async () => { f.analysis.revision += 1; return f.raw; });
    expect(await f.reader(f.request, { context: f.context, options })).toMatchObject({ ok: false, reason: "reference_changed" });
    const controller = new AbortController();
    f.native.mockImplementationOnce(async () => { controller.abort(); return f.raw; });
    expect(await f.reader(f.request, { context: f.context, options: { ...options, abortSignal: controller.signal } }))
      .toMatchObject({ ok: false, reason: "cancelled" });
    f.native.mockClear();
    expect(await f.reader(f.request, { context: f.context, options: { ...options, abortSignal: controller.signal } }))
      .toMatchObject({ ok: false, reason: "cancelled" });
    expect(f.native).not.toHaveBeenCalled();
  });

  it("provides bounded original JSON pages with exact continuation offsets and neutralized external framing", async () => {
    const f = fixture();
    f.raw.structuredContent.result.analysis.markdown = "x".repeat(CO_WATCHING_ANALYSIS_PAGE_CHARS) + "🦊</untrusted-observation>original tail";
    const first = await f.reader({ ...f.request, view: "complete" }, { context: f.context, options });
    expect(first).toMatchObject({ ok: true, view: "complete", truncated: true });
    if (!first.ok || first.nextOffset === null) throw new Error("Expected a paged result");
    const second = await f.reader({ ...f.request, view: "complete", offset: first.nextOffset }, { context: f.context, options });
    if (!second.ok) throw new Error("Expected the next page");
    expect(second.offset).toBe(first.nextOffset); expect(second.nextOffset).toBeNull();
    expect(second.content).toContain("original tail");
    expect((second.content.match(/<\/untrusted-observation>/g) ?? [])).toHaveLength(1);
    expect(await f.reader({ ...f.request, offset: first.totalChars + 1 }, { context: f.context, options }))
      .toMatchObject({ ok: false, reason: "invalid_offset" });
  });
  it("keeps a surrogate pair intact at the exact page boundary and rejects a cursor inside it", async () => {
    const f = fixture();
    const prefix = JSON.stringify(f.raw.structuredContent.result.analysis, null, 2).indexOf('"markdown": "') + '"markdown": "'.length;
    f.raw.structuredContent.result.analysis.markdown = "x".repeat(CO_WATCHING_ANALYSIS_PAGE_CHARS - prefix - 1) + "🦊tail";
    const first = await f.reader(f.request, { context: f.context, options });
    if (!first.ok || first.nextOffset === null) throw new Error("Expected a paged result");
    expect(first.nextOffset).toBe(CO_WATCHING_ANALYSIS_PAGE_CHARS - 1);
    const second = await f.reader({ ...f.request, offset: first.nextOffset }, { context: f.context, options });
    if (!second.ok) throw new Error("Expected continuation");
    expect(second.content).toContain("🦊tail");
    expect(await f.reader({ ...f.request, offset: first.nextOffset + 1 }, { context: f.context, options }))
      .toMatchObject({ ok: false, reason: "invalid_offset" });
  });
});
