import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { ModelMessage } from "ai";
import { SubagentInputSchema, type RunMessage, type SubagentContextSummary } from "@taki/shared";
import { createCompanionFixture } from "../testing/companion-fixture.ts";
import { createRunMessageRepo } from "../db/run-message-repo.ts";
import { createSubagentInputRepo } from "../db/subagent-input-repo.ts";
import { createSubagentExecutionRepo } from "../db/subagent-execution-repo.ts";
import { createSubagentContextSummaryRepo } from "../db/subagent-context-summary-repo.ts";
import { estimateMessagesTokens, IMAGE_TOKENS } from "../memory/token-estimator.ts";
import { toModelMessage } from "./turn-mapping.ts";
import { validateSummary } from "./summary-quality.ts";
import { renderSubagentInput } from "./run-message-store.ts";
import type { PrivateTaskSummarizer } from "./private-task-summarizer.ts";
import { preparePrivateTaskContext, type PrivateTaskContextInput } from "./private-task-context.ts";

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

// Repository boundaries are stubbed here to isolate projection selection. The ChatAgent worker
// context/retention suites separately exercise actual SDK recording, summary CAS and input receipts.
function fixture(options: { rows: RunMessage[]; budget: number; summaryText?: string; replacement?: string }) {
  const base = createCompanionFixture(); cleanups.push(() => base.cleanup());
  const subagentId = randomUUID(); const workInputId = randomUUID();
  let summary: SubagentContextSummary | null = options.summaryText ? {
    subagentId, workInputId, revision: 1, throughSeq: 1, sourceFromSeq: 1, sourceDigest: "a".repeat(64),
    text: options.summaryText, runId: "run", attemptId: "attempt", createdAt: "2026-10-30T00:00:00Z",
  } : null;
  const summaries = { ...createSubagentContextSummaryRepo(base.db), latest: () => summary,
    capture: vi.fn(({ throughSeq }: { throughSeq: number }) => ({ kind: "advance" as const, subagentId, workInputId, throughSeq,
      expectedRevision: summary?.revision ?? 0, sourceFromSeq: (summary?.throughSeq ?? 0) + 1, sourceDigest: "b".repeat(64) })),
    captureRewrite: vi.fn(() => {
      if (!summary) throw new Error("SUBAGENT_SUMMARY_REWRITE_UNAVAILABLE");
      return { kind: "rewrite" as const, subagentId, workInputId, throughSeq: summary.throughSeq,
        expectedRevision: summary.revision, sourceFromSeq: summary.throughSeq + 1, sourceDigest: "c".repeat(64),
        previous: { revision: summary.revision, throughSeq: summary.throughSeq, sourceDigest: summary.sourceDigest, text: summary.text } };
    }),
    failed: vi.fn(() => false), recordFailure: vi.fn(),
    commit: vi.fn((value: Parameters<ReturnType<typeof createSubagentContextSummaryRepo>["commit"]>[0]) => {
      value.validateCurrent();
      summary = { ...value.range, text: value.text, runId: value.runId, attemptId: value.attemptId,
        revision: value.range.expectedRevision + 1, createdAt: "2026-10-30T00:00:01Z" };
      return summary;
    }),
  };
  const summarize = vi.fn<PrivateTaskSummarizer>(async () => ({ text: options.replacement ?? "Task unfinished; preserve source attribution and negation. Continue remaining audit.", finishReason: "stop" }));
  const input: PrivateTaskContextInput = {
    runId: "run", subagentId, workInputId, initial: [], historyBudget: () => options.budget,
    messages: { ...createRunMessageRepo(base.db), history: ({ afterSeq = 0 }) => options.rows.filter((row) => row.seq > afterSeq) },
    inputs: { ...createSubagentInputRepo(base.db), latestWorkSeq: () => 1, pending: () => [] },
    executions: createSubagentExecutionRepo(base.db), summaries, summarize,
    token: () => ({ subagentId, workInputId, throughWorkSeq: 1, controlVersion: 0 }),
    renderInput: (record) => ({ role: "user", content: record.direction }), assertCurrent: vi.fn(),
  };
  return { input, summaries, summarize, prepare: () => preparePrivateTaskContext(input, { attemptId: "attempt", stepNumber: 4, messages: [] }) };
}

function round(seq: number, content: string): RunMessage {
  return { seq, runId: "run", attemptId: "attempt", stepNumber: seq, messageIndex: 0, entryKind: "output",
    role: "assistant", content, inputId: null, modelEffectId: null, modelInputDigest: null, createdAt: "2026-10-30T00:00:00Z" };
}

describe("private task projected tail selection", () => {
  it("projects historical explicit SDK image content natively while keeping byte-free complete private tool feedback", async () => {
    const output = { type: "content" as const, value: [
      { type: "text", text: "Historical capture metadata" },
      { type: "file", mediaType: "image/png", data: { type: "data", data: "HISTORICAL_PIXEL_BYTES" } },
    ] };
    const rows: RunMessage[] = [
      { ...round(1, "capture"), parts: [{ type: "tool-call", toolCallId: "old-capture", toolName: "mcp_capture" }] },
      { ...round(2, "captured"), stepNumber: 1, role: "tool", parts: [{ type: "tool-result", toolCallId: "old-capture", toolName: "mcp_capture", output }] },
    ];
    const f = fixture({ rows, budget: 3000 });
    const prepared = await f.prepare();
    expect(estimateMessagesTokens(prepared.messages)).toBeGreaterThan(IMAGE_TOKENS);
    const feedback = prepared.messages.find((message) => message.role === "tool");
    expect(JSON.stringify(feedback)).toContain("Historical capture metadata");
    expect(JSON.stringify(feedback)).not.toContain("HISTORICAL_PIXEL_BYTES");
    const native = prepared.messages.filter((message) => message.role === "user" && Array.isArray(message.content));
    expect(JSON.stringify(native)).toContain("HISTORICAL_PIXEL_BYTES");
    expect(native).toHaveLength(1);
    expect(rows[1]!.parts?.[0]).toMatchObject({ output });
  });

  it("prices retained images before accepting a protected private round", async () => {
    const ref = `attachments/${"a".repeat(64)}.png`;
    const rows: RunMessage[] = [
      { ...round(1, "capture"), parts: [{ type: "tool-call", toolCallId: "capture", toolName: "screenshot" }] },
      { ...round(2, "captured"), stepNumber: 1, role: "tool", parts: [{ type: "tool-result", toolCallId: "capture", toolName: "screenshot",
        output: { type: "json", value: { ok: true } }, imageRefs: [{ mediaType: "image/png", ref }] }] },
    ];
    const reader = { read: vi.fn(() => ({ ok: true as const, mediaType: "image/png" as const, dataBase64: "AAAA" })) };
    const fitting = fixture({ rows, budget: 3000 }); fitting.input.attachments = reader;
    const prepared = await fitting.prepare();
    expect(estimateMessagesTokens(prepared.messages)).toBeGreaterThan(IMAGE_TOKENS);
    expect(reader.read).toHaveBeenCalledTimes(1);
    const unfit = fixture({ rows, budget: 1500 }); unfit.input.attachments = reader;
    await expect(unfit.prepare()).rejects.toThrow("SUBAGENT_CONTEXT_ROUND_UNFIT");
    expect(unfit.summarize).not.toHaveBeenCalled();
  });

  it("summarizes older image evidence without sending image bytes to the text-summary producer", async () => {
    const ref = `attachments/${"b".repeat(64)}.png`;
    const rows: RunMessage[] = [
      { ...round(1, "capture"), parts: [{ type: "tool-call", toolCallId: "capture", toolName: "screenshot" }] },
      { ...round(2, "captured"), stepNumber: 1, role: "tool", parts: [{ type: "tool-result", toolCallId: "capture", toolName: "screenshot",
        output: { type: "json", value: { ok: true, capturedAt: "2026-11-02T00:00:00Z" } }, imageRefs: [{ mediaType: "image/png", ref }] }] },
      round(3, "Newer relevant evidence. ".repeat(150)),
    ];
    const f = fixture({ rows, budget: 2500 });
    f.input.attachments = { read: () => ({ ok: true, mediaType: "image/png", dataBase64: "PRIVATE_PIXEL_BYTES" }) };
    const prepared = await f.prepare();
    expect(f.summarize).toHaveBeenCalledOnce();
    expect(f.summarize.mock.calls[0]?.[0].transcript).not.toContain("PRIVATE_PIXEL_BYTES");
    expect(JSON.stringify(prepared.messages)).not.toContain("PRIVATE_PIXEL_BYTES");
    expect(estimateMessagesTokens(prepared.messages)).toBeLessThan(2500);
  });

  it.each([false, true])("preserves unchanged small outputs beside a token-heavy exact page (large peer=%s)", async (largePeer) => {
    const history = { type: "tool-result" as const, toolCallId: "page", toolName: "read_self_history",
      output: { type: "json" as const, value: { records: [{ body: "中".repeat(3000), offset: 0, complete: false }],
        nextCursor: "exact-page-cursor", hasMore: true } } };
    const small = { type: "tool-result" as const, toolCallId: "small", toolName: "read_file",
      output: { type: "text" as const, value: "ok" } };
    const failed = { type: "tool-result" as const, toolCallId: "failed", toolName: "read_file",
      output: { type: "error-text" as const, value: "File not found" } };
    const big = { type: "tool-result" as const, toolCallId: "big", toolName: "read_file",
      output: { type: "json" as const, value: { content: "Large exact source. ".repeat(1500) } } };
    const parts = [history, small, ...(largePeer ? [big] : []), failed];
    const rows: RunMessage[] = [
      { ...round(1, ""), parts: parts.map((part) => ({ type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName })) },
      { ...round(2, ""), stepNumber: 1, role: "tool", parts },
    ];
    const f = fixture({ rows, budget: 6000 });
    const prepared = await f.prepare();
    const output = prepared.messages.find((message) => message.role === "tool")!;
    if (output.role !== "tool") throw new Error("Expected complete mixed results");
    expect(output.content.find((part) => part.type === "tool-result" && part.toolCallId === "page")).toEqual(history);
    expect(output.content.find((part) => part.type === "tool-result" && part.toolCallId === "small")).toEqual(small);
    expect(output.content.find((part) => part.type === "tool-result" && part.toolCallId === "failed")).toEqual(failed);
    if (largePeer) expect(output.content.find((part) => part.type === "tool-result" && part.toolCallId === "big"))
      .toMatchObject({ output: { type: "text", value: expect.stringContaining("exact retained row is pageable") } });
  });

  it("does not claim omission when a small JSON peer changes only representation", async () => {
    const value = { ok: true, note: "The full small result" };
    const results = [
      { type: "tool-result" as const, toolCallId: "big", toolName: "read_file", output: { type: "json" as const,
        value: { content: "Large exact source. ".repeat(1500) } } },
      { type: "tool-result" as const, toolCallId: "small-json", toolName: "read_file", output: { type: "json" as const, value } },
      { type: "tool-result" as const, toolCallId: "page", toolName: "read_self_history", output: { type: "json" as const,
        value: { records: [{ body: "exact page", offset: 0, complete: false }], nextCursor: "cursor", hasMore: true } } },
    ];
    const f = fixture({ budget: 6000, rows: [
      { ...round(1, ""), parts: results.map((part) => ({ type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName })) },
      { ...round(2, ""), stepNumber: 1, role: "tool", parts: results },
    ] });
    const prepared = await f.prepare();
    const output = prepared.messages.find((message) => message.role === "tool")!;
    if (output.role !== "tool") throw new Error("Expected complete mixed results");
    const small = output.content.find((part) => part.type === "tool-result" && part.toolCallId === "small-json")!;
    if (small.type !== "tool-result" || small.output.type !== "text") throw new Error("Expected the reducer's JSON representation");
    expect(JSON.parse(small.output.value.split("\nCore projection:")[0]!)).toEqual(value);
    expect(small.output.value).toContain("exact retained row is pageable");
    expect(small.output.value).not.toContain("omitted");
  });

  it("targets the replacement envelope including snapshot, pending input and reduced peers, excluding old summary text", async () => {
    const replacement = "Keep the original constraints and continue the remaining work.";
    const file = { type: "tool-result" as const, toolCallId: "file", toolName: "read_file",
      output: { type: "json" as const, value: { ok: true, content: "Full peer evidence. ".repeat(1500) } } };
    const rows: RunMessage[] = [round(2, "old evidence ".repeat(1500)),
      { ...round(3, ""), parts: [{ type: "tool-call", toolCallId: "file", toolName: "read_file" }] },
      { ...round(4, ""), stepNumber: 3, role: "tool", parts: [file] }];
    const f = fixture({ rows, budget: 6000, summaryText: "previous facts ".repeat(800), replacement });
    f.input.summaries!.latest(f.input.workInputId)!.revision = 9;
    f.input.initial = [{ role: "user", content: "Snapshot facts. ".repeat(70) }];
    const pending = SubagentInputSchema.parse({
      inputId: randomUUID(), subagentId: f.input.subagentId, workInputId: f.input.workInputId,
      inputSeq: 2, workSeq: 2, operationKey: "pending", requestDigest: "c".repeat(64), kind: "message",
      sender: { kind: "user" }, direction: "New guidance. ".repeat(80), materials: [], toolSelection: null,
      createdAt: "2026-10-30T00:00:00Z", completionPolicy: "record_only", workExpiresAt: null,
      workValidity: { kind: "until_cancelled" }, replyToEventId: null, consumed: null, replyAcceptance: null,
    });
    f.input.inputs = { ...f.input.inputs, latestWorkSeq: () => 2, pending: () => [pending], get: () => pending };
    f.input.renderInput = renderSubagentInput;
    const prepared = await f.prepare();
    expect(f.summarize).toHaveBeenCalledOnce();
    expect(prepared.summary).toMatchObject({ revision: 10, throughSeq: 2 });
    const withoutSummary = prepared.messages.map((message) => message.role === "user" && typeof message.content === "string"
      && message.content.startsWith("Core private task summary")
      ? { ...message, content: message.content.slice(0, -replacement.length) } : message);
    const nonSummaryCost = estimateMessagesTokens(withoutSummary);
    expect(f.summarize.mock.calls[0]![0].targetSummaryTokens).toBe(Math.floor(6000 * 0.8 - nonSummaryCost));
    expect(withoutSummary[0]).toEqual(f.input.initial[0]);
    expect(withoutSummary.at(-1)).toEqual(renderSubagentInput(pending));
    expect(withoutSummary.find((message) => message.role === "tool")).toMatchObject({ content: [
      { output: { type: "text", value: expect.stringContaining("exact retained row is pageable") } },
    ] });
    expect(prepared.inputIds).toEqual([pending.inputId]);
  });

  it("uses the remaining fit budget when the fixed replacement envelope exceeds the pressure target", async () => {
    const replacement = "Continue safely.";
    const rows = [round(1, "old ".repeat(4000)), round(2, "recent ".repeat(1400))];
    const f = fixture({ rows, budget: 3000, replacement });
    const prepared = await f.prepare();
    const withoutSummary = prepared.messages.map((message) => message.role === "user" && typeof message.content === "string"
      && message.content.startsWith("Core private task summary")
      ? { ...message, content: message.content.slice(0, -replacement.length) } : message);
    const nonSummaryCost = estimateMessagesTokens(withoutSummary);
    expect(nonSummaryCost).toBeGreaterThan(3000 * 0.8);
    expect(f.summarize.mock.calls[0]![0].targetSummaryTokens).toBe(Math.floor(3000 - nonSummaryCost));
    expect(estimateMessagesTokens(prepared.messages)).toBeLessThan(3000);
  });

  it.each([false, true])("reduces ordinary siblings without changing an exact history page (history first=%s)", async (historyFirst) => {
    const page = { status: "available", subagentId: "child", category: "messages", hasMore: true,
      records: [{ id: "original", body: "Exact page contents. ".repeat(150).slice(0, 3000), offset: 3000, complete: false }],
      nextCursor: '{"child":"child","category":"messages","after":0,"through":9,"offset":6000,"recordId":"original"}',
      message: "Exact retained content continues at nextCursor." };
    const history = { type: "tool-result" as const, toolCallId: "page", toolName: "read_self_history",
      output: { type: "json" as const, value: page } };
    const file = { type: "tool-result" as const, toolCallId: "file", toolName: "read_file",
      output: { type: "json" as const, value: { ok: true, path: "source.json", content: "Original source evidence. ".repeat(600) } } };
    const results = historyFirst ? [history, file] : [file, history];
    const assistant: RunMessage = { ...round(2, ""), stepNumber: 1,
      parts: results.map((part) => ({ type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName })) };
    const output: RunMessage = { ...round(3, ""), stepNumber: 1, role: "tool", parts: results };
    const rows = [assistant, output];
    const raw = structuredClone(rows);
    const f = fixture({ rows, budget: 9246, summaryText: "summary ".repeat(2950) });
    const prepared = await f.prepare();
    const projected = prepared.messages.find((message) => message.role === "tool")!;
    expect(projected.role).toBe("tool");
    if (projected.role !== "tool") throw new Error("Expected the complete tool round");
    expect(projected.content.map((part) => "toolCallId" in part ? part.toolCallId : null)).toEqual(results.map((part) => part.toolCallId));
    expect(projected.content.find((part) => part.type === "tool-result" && part.toolCallId === "page")).toEqual(history);
    expect(projected.content.find((part) => part.type === "tool-result" && part.toolCallId === "file"))
      .toMatchObject({ output: { type: "text", value: expect.stringContaining("exact retained row is pageable") } });
    const unbounded = prepared.messages.map((message) => message.role === "tool" ? toModelMessage(output)! : message);
    expect(estimateMessagesTokens(unbounded)).toBeGreaterThan(9246);
    expect(estimateMessagesTokens(prepared.messages)).toBeLessThan(9246);
    expect(f.summaries.capture).not.toHaveBeenCalled();
    expect(rows).toEqual(raw);
  });

  it("retires an optional older round when summary plus both rounds is unfit but the newest fits", async () => {
    const rows = [round(2, "older evidence ".repeat(750)), round(3, "newest evidence ".repeat(900))];
    const raw = structuredClone(rows);
    const f = fixture({ rows, budget: 9271, summaryText: "previous facts ".repeat(880) });
    const prepared = await f.prepare();
    expect(f.summaries.capture).toHaveBeenCalledWith(expect.objectContaining({ throughSeq: 2 }));
    expect(f.summaries.commit).toHaveBeenCalledOnce();
    expect(prepared.summary?.throughSeq).toBe(2);
    expect(estimateMessagesTokens(prepared.messages)).toBeLessThan(9271);
    expect(JSON.stringify(prepared.messages)).toContain(rows[1]!.content);
    expect(f.summarize.mock.calls[0]).toBeDefined();
    expect(rows).toEqual(raw);
  });

  it("treats the retention target as soft when an optional older complete round would overflow", async () => {
    const rows = [round(1, "large older evidence ".repeat(1400)), round(2, "newest evidence ".repeat(20))];
    const f = fixture({ rows, budget: 4000 });
    const prepared = await f.prepare();
    expect(f.summaries.capture).toHaveBeenCalledWith(expect.objectContaining({ throughSeq: 1 }));
    expect(JSON.stringify(prepared.messages)).toContain(rows[1]!.content);
    expect(estimateMessagesTokens(prepared.messages)).toBeLessThan(4000);
  });

  it("remeasures a replacement summary and retires more eligible history if needed", async () => {
    const rows = [round(1, "old ".repeat(5500)), round(2, "middle ".repeat(250)), round(3, "latest ".repeat(170))];
    const f = fixture({ rows, budget: 2000, replacement: "summary ".repeat(670) });
    const prepared = await f.prepare();
    expect(f.summaries.capture.mock.calls.map(([range]) => range.throughSeq)).toEqual([1, 2]);
    expect(f.summaries.commit).toHaveBeenCalledTimes(2);
    expect(f.summaries.recordFailure).not.toHaveBeenCalled();
    expect(estimateMessagesTokens(prepared.messages)).toBeLessThan(2000);
    expect(JSON.stringify(prepared.messages)).toContain(rows[2]!.content);
  });

  it("corrects a shrinking but capacity-unfit candidate before committing any revision", async () => {
    const f = fixture({ rows: [round(1, "old ".repeat(5500)), round(2, "latest ".repeat(350))], budget: 2000 });
    const oversized = "summary ".repeat(850);
    const fitting = "Keep distinct sources and pending work.";
    f.summarize.mockResolvedValueOnce({ text: oversized, finishReason: "stop" })
      .mockResolvedValueOnce({ text: fitting, finishReason: "stop" });
    const prepared = await f.prepare();
    expect(f.summarize).toHaveBeenCalledTimes(2);
    expect(f.summaries.commit).toHaveBeenCalledOnce();
    expect(f.summaries.commit.mock.calls[0]![0].text).toBe(fitting);
    expect(f.summarize.mock.calls[1]![0]).toMatchObject({ previous: f.summarize.mock.calls[0]![0].previous,
      transcript: f.summarize.mock.calls[0]![0].transcript, sizeFeedback: { kind: "capacity", maxInputTokens: 2000 } });
    expect(estimateMessagesTokens(prepared.messages)).toBeLessThan(2000);
  });

  it("bounds capacity correction to two calls and suppresses the failed original source identity", async () => {
    const f = fixture({ rows: [round(2, "old ".repeat(5500)), round(3, "latest ".repeat(350))],
      budget: 2000, summaryText: "Previous trusted task record.", replacement: "summary ".repeat(850) });
    const previous = f.summaries.latest();
    f.summaries.failed.mockImplementation(() => f.summaries.recordFailure.mock.calls.length > 0);
    await expect(f.prepare()).rejects.toThrow("SUBAGENT_CONTEXT_SUMMARY_UNAVAILABLE");
    expect(f.summarize).toHaveBeenCalledTimes(2);
    expect(f.summaries.commit).not.toHaveBeenCalled();
    expect(f.summaries.latest()).toEqual(previous);
    expect(f.summaries.recordFailure).toHaveBeenCalledOnce();
    expect(f.summaries.recordFailure).toHaveBeenCalledWith(f.summaries.capture.mock.results[0]!.value,
      "SUBAGENT_SUMMARY_CAPACITY_UNFIT");
    await expect(f.prepare()).rejects.toThrow("SUBAGENT_CONTEXT_SUMMARY_UNAVAILABLE");
    expect(f.summarize).toHaveBeenCalledTimes(2);
  });

  it.each([
    { text: "   ", finishReason: "stop", code: "SUBAGENT_SUMMARY_QUALITY_BLANK" },
    { text: "Unfinished record ".repeat(4000), finishReason: "length", code: "SUBAGENT_SUMMARY_QUALITY_TRUNCATED" },
    { text: "authorization: retained-sensitive-marker " + "oversized ".repeat(4000), finishReason: "stop", code: "SUBAGENT_SUMMARY_QUALITY_FORBIDDEN_CONTENT" },
  ])("records $code without retrying or retaining rejected text", async ({ text, finishReason, code }) => {
    const f = fixture({ rows: [round(2, "old ".repeat(5500)), round(3, "latest ".repeat(350))],
      budget: 2000, summaryText: "Previous trusted task record." });
    const previous = f.summaries.latest();
    f.summarize.mockResolvedValue({ text, finishReason });
    f.summaries.failed.mockImplementation(() => f.summaries.recordFailure.mock.calls.length > 0);
    await expect(f.prepare()).rejects.toThrow("SUBAGENT_CONTEXT_SUMMARY_UNAVAILABLE");
    expect(f.summaries.recordFailure).toHaveBeenCalledExactlyOnceWith(f.summaries.capture.mock.results[0]!.value, code);
    expect(f.summaries.commit).not.toHaveBeenCalled();
    expect(f.summaries.latest()).toEqual(previous);
    await expect(f.prepare()).rejects.toThrow("SUBAGENT_CONTEXT_SUMMARY_UNAVAILABLE");
    expect(f.summarize).toHaveBeenCalledOnce();
  });

  it("distinguishes actual retired-projection non-shrink from source-text non-shrink", async () => {
    const rows = [round(1, "source ".repeat(350)), round(2, "latest evidence")];
    const replacement = "x".repeat(estimateMessagesTokens([toModelMessage(rows[0]!)!]) * 4);
    const f = fixture({ rows, budget: 600, replacement });
    f.summaries.failed.mockImplementation(() => f.summaries.recordFailure.mock.calls.length > 0);
    await expect(f.prepare()).rejects.toThrow("SUBAGENT_CONTEXT_SUMMARY_UNAVAILABLE");
    expect(validateSummary({ text: replacement, sourceText: f.summarize.mock.calls[0]![0].transcript }).accepted).toBe(true);
    expect(f.summaries.recordFailure).toHaveBeenCalledExactlyOnceWith(f.summaries.capture.mock.results[0]!.value,
      "SUBAGENT_SUMMARY_NON_SHRINKING");
    expect(f.summarize).toHaveBeenCalledTimes(2);
    expect(f.summaries.commit).not.toHaveBeenCalled();
    await expect(f.prepare()).rejects.toThrow("SUBAGENT_CONTEXT_SUMMARY_UNAVAILABLE");
    expect(f.summarize).toHaveBeenCalledTimes(2);
  });

  it.each(["source", "retired_projection"])("corrects %s non-shrink from identical sources without accepting the first candidate", async (kind) => {
    const rows = [round(1, "source ".repeat(350)), round(2, "latest evidence")];
    const retiredTokens = estimateMessagesTokens([toModelMessage(rows[0]!)!]);
    const oversized = kind === "source" ? "oversized ".repeat(4000) : "x".repeat(retiredTokens * 4);
    const fitting = "Keep the source distinction and continue the unfinished work.";
    const f = fixture({ rows, budget: 600 });
    f.summarize.mockResolvedValueOnce({ text: oversized, finishReason: "stop" })
      .mockResolvedValueOnce({ text: fitting, finishReason: "stop" });
    const prepared = await f.prepare();
    const firstRequest = f.summarize.mock.calls[0]![0];
    const quality = validateSummary({ text: oversized, sourceText: firstRequest.transcript });
    expect(quality.accepted).toBe(kind === "retired_projection");
    expect(f.summarize).toHaveBeenCalledTimes(2);
    expect(f.summarize.mock.calls[1]![0]).toEqual({ ...firstRequest, sizeFeedback: { kind: "non_shrinking",
      candidateTokens: quality.summaryTokens, maxSummaryTokens: Math.min(quality.sourceTokens, retiredTokens) } });
    expect(f.summaries.commit).toHaveBeenCalledOnce();
    expect(f.summaries.commit.mock.calls[0]![0].text).toBe(fitting);
    expect(f.summaries.recordFailure).not.toHaveBeenCalled();
    expect(estimateMessagesTokens(prepared.messages)).toBeLessThan(600);
  });

  it.each([
    { first: "non_shrinking", second: "non_shrinking", code: "SUBAGENT_SUMMARY_QUALITY_NON_SHRINKING" },
    { first: "non_shrinking", second: "capacity", code: "SUBAGENT_SUMMARY_CAPACITY_UNFIT" },
    { first: "capacity", second: "non_shrinking", code: "SUBAGENT_SUMMARY_QUALITY_NON_SHRINKING" },
    { first: "non_shrinking", second: "blank", code: "SUBAGENT_SUMMARY_QUALITY_BLANK" },
    { first: "non_shrinking", second: "truncated", code: "SUBAGENT_SUMMARY_QUALITY_TRUNCATED" },
    { first: "non_shrinking", second: "provider", code: "SUBAGENT_SUMMARY_REPLACEMENT_FAILED" },
  ])("stops after $first then $second and records the final $code", async ({ first, second, code }) => {
    const candidate = (kind: string) => ({ text: kind === "blank" ? "" : kind === "capacity" ? "summary ".repeat(850)
      : "oversized ".repeat(4000), finishReason: kind === "truncated" ? "length" : "stop" });
    const f = fixture({ rows: [round(2, "old ".repeat(5500)), round(3, "latest ".repeat(350))],
      budget: 2000, summaryText: "Previous trusted task record." });
    const previous = f.summaries.latest();
    f.summarize.mockResolvedValueOnce(candidate(first));
    if (second === "provider") f.summarize.mockRejectedValueOnce(new Error("Private provider details"));
    else f.summarize.mockResolvedValueOnce(candidate(second));
    f.summaries.failed.mockImplementation(() => f.summaries.recordFailure.mock.calls.length > 0);
    await expect(f.prepare()).rejects.toThrow("SUBAGENT_CONTEXT_SUMMARY_UNAVAILABLE");
    expect(f.summaries.recordFailure).toHaveBeenCalledExactlyOnceWith(f.summaries.capture.mock.results[0]!.value, code);
    expect(f.summaries.latest()).toEqual(previous);
    expect(f.summaries.commit).not.toHaveBeenCalled();
    expect(f.summarize).toHaveBeenCalledTimes(2);
    await expect(f.prepare()).rejects.toThrow("SUBAGENT_CONTEXT_SUMMARY_UNAVAILABLE");
    expect(f.summarize).toHaveBeenCalledTimes(2);
  });

  it.each(["stop", "stale_owner"])("refuses a corrective generation after %s", async (kind) => {
    const f = fixture({ rows: [round(1, "source ".repeat(350)), round(2, "latest evidence")], budget: 600 });
    const controller = new AbortController();
    let current = true;
    f.input.assertCurrent = () => { if (!current) throw new Error("Current owner unavailable"); };
    f.summarize.mockImplementationOnce(async () => {
      if (kind === "stop") controller.abort();
      else current = false;
      return { text: "oversized ".repeat(4000), finishReason: "stop" };
    });
    await expect(preparePrivateTaskContext(f.input, { attemptId: "attempt", stepNumber: 4, messages: [],
      envelope: { maxInputTokens: 600, instructions: "", toolSchemaTokens: 0, signal: controller.signal } }))
      .rejects.toThrow("SUBAGENT_CONTEXT_SUMMARY_UNAVAILABLE");
    expect(f.summarize).toHaveBeenCalledOnce();
    expect(f.summaries.commit).not.toHaveBeenCalled();
  });

  it("records an unavailable summarizer without committing a candidate", async () => {
    const f = fixture({ rows: [round(1, "old ".repeat(5500)), round(2, "latest ".repeat(350))], budget: 2000 });
    f.summarize.mockResolvedValue(undefined);
    await expect(f.prepare()).rejects.toThrow("SUBAGENT_CONTEXT_SUMMARY_UNAVAILABLE");
    expect(f.summaries.recordFailure).toHaveBeenCalledExactlyOnceWith(f.summaries.capture.mock.results[0]!.value,
      "SUBAGENT_SUMMARY_UNAVAILABLE");
    expect(f.summarize).toHaveBeenCalledOnce();
    expect(f.summaries.commit).not.toHaveBeenCalled();
  });

  it.each([
    { phase: "replacement", message: "provider failure with private text", code: "SUBAGENT_SUMMARY_REPLACEMENT_FAILED" },
    { phase: "replacement", message: "SUBAGENT_SUMMARY_CONFLICT", code: "SUBAGENT_SUMMARY_REPLACEMENT_FAILED" },
    { phase: "commit", message: "SUBAGENT_SUMMARY_CONFLICT", code: "SUBAGENT_SUMMARY_CONFLICT" },
    { phase: "commit", message: "SUBAGENT_SUMMARY_SOURCE_STALE", code: "SUBAGENT_SUMMARY_SOURCE_STALE" },
    { phase: "commit", message: "SUBAGENT_SUMMARY_OWNER_STALE", code: "SUBAGENT_SUMMARY_OWNER_STALE" },
    { phase: "commit", message: "SUBAGENT_SUMMARY_INCOMPLETE_RANGE", code: "SUBAGENT_SUMMARY_INCOMPLETE_RANGE" },
    { phase: "commit", message: "SQL failure with private text", code: "SUBAGENT_SUMMARY_COMMIT_FAILED" },
  ])("records only $code for a $phase exception", async ({ phase, message, code }) => {
    const f = fixture({ rows: [round(2, "old ".repeat(5500)), round(3, "latest ".repeat(350))],
      budget: 2000, summaryText: "Previous trusted task record." });
    const previous = f.summaries.latest();
    if (phase === "replacement") f.summarize.mockRejectedValue(new Error(message));
    else f.summaries.commit.mockImplementation(() => { throw new Error(message); });
    await expect(f.prepare()).rejects.toThrow("SUBAGENT_CONTEXT_SUMMARY_UNAVAILABLE");
    expect(f.summaries.recordFailure).toHaveBeenCalledExactlyOnceWith(f.summaries.capture.mock.results[0]!.value, code);
    expect(f.summaries.latest()).toEqual(previous);
    expect(f.summarize).toHaveBeenCalledOnce();
  });

  it.each([false, true])("rewrites an oversized persisted summary with both exact newest history pages intact (budget shrank=%s)", async (shrunk) => {
    const results = [0, 1].map((page) => ({ type: "tool-result" as const, toolCallId: `page-${page}`, toolName: "read_self_history",
      output: { type: "json" as const, value: { status: "available", records: [{ body: `Exact page ${page}. `.repeat(220), offset: page * 3000, complete: false }],
        hasMore: true, nextCursor: `exact-next-page-${page}` } } }));
    const rows = [{ ...round(2, ""), stepNumber: 2, parts: results.map((part) => ({ type: "tool-call" as const, toolCallId: part.toolCallId, toolName: part.toolName })) },
      { ...round(3, ""), stepNumber: 2, role: "tool" as const, parts: results }];
    const raw = structuredClone(rows);
    const f = fixture({ rows, budget: 4000, summaryText: "summary ".repeat(1500) });
    const previous = f.summaries.latest();
    if (shrunk) {
      f.input.historyBudget = () => 10_000;
      expect((await f.prepare()).summary?.revision).toBe(1);
      expect(f.summarize).not.toHaveBeenCalled();
      f.input.historyBudget = () => 4000;
    }
    const prepared = await f.prepare();
    expect(f.summaries.capture).not.toHaveBeenCalled();
    expect(f.summaries.captureRewrite).toHaveBeenCalledOnce();
    expect(f.summarize.mock.calls[0]![0]).toMatchObject({ previous: previous!.text, transcript: "" });
    expect(prepared.summary).toMatchObject({ revision: 2, throughSeq: 1 });
    expect(prepared.inputIds).toEqual([]);
    const output = prepared.messages.find((message) => message.role === "tool");
    expect(output).toMatchObject({ content: results });
    expect(estimateMessagesTokens(prepared.messages)).toBeLessThan(4000);
    expect(rows).toEqual(raw);
  });

  it("keeps a live partial protected and refuses an actually unfit newest round", async () => {
    const partial = { ...round(1, "unfinished observation ".repeat(900)), entryKind: "partial" as const };
    const protectedRound = round(2, "newest evidence ".repeat(1200));
    const f = fixture({ rows: [partial, protectedRound], budget: 4000 });
    await expect(f.prepare()).rejects.toThrow("SUBAGENT_CONTEXT_ROUND_UNFIT");
    expect(f.summaries.capture).not.toHaveBeenCalled();
    expect(f.summarize).not.toHaveBeenCalled();
  });

  it("prices the initial snapshot with the same summary and tail projection", async () => {
    const rows = [round(2, "older ".repeat(1500)), round(3, "newest ".repeat(900))];
    const f = fixture({ rows, budget: 6000, summaryText: "summary ".repeat(900) });
    const initial: ModelMessage = { role: "user", content: "captured snapshot ".repeat(350) };
    f.input.initial = [initial];
    const prepared = await f.prepare();
    expect(prepared.messages[0]).toEqual(initial);
    expect(f.summaries.capture).toHaveBeenCalledWith(expect.objectContaining({ throughSeq: 2 }));
    expect(estimateMessagesTokens(prepared.messages)).toBeLessThan(6000);
  });
});
