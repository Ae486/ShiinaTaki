import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { SubagentSelfHistoryResultSchema } from "@taki/shared";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createSubagentToolResultRepo } from "../db/subagent-tool-result-repo.ts";
import { readSubagentSelfHistory } from "./subagent-self-history-tool.ts";

type Fixture = Awaited<ReturnType<typeof subagentFixture>>;
const fixtures: Fixture[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });

function unwrapped(value: unknown): unknown {
  return value && typeof value === "object" && ("materialReferences" in value || "sourceContext" in value) && "result" in value
    ? unwrapped(value.result) : value;
}

describe("actual SDK mixed private-history projection", () => {
  it("preserves a paged history result while reducing its large file peer and retaining the original file", async () => {
    const originalFile = { ok: true, path: "peer.json", content: "Full original peer evidence. ".repeat(6000), truncated: false };
    const read = vi.fn(async ({ path }: { path: string }) => path === "peer.json" ? originalFile
      : { ok: true, path, content: "Seed evidence for paged retrieval. ".repeat(200), truncated: false });
    const model = scriptedModel([
      { kind: "tool", toolCallId: "seed-read", toolName: "read_file", input: { path: "seed.json" } },
      { kind: "tools", calls: [
        { toolCallId: "history-page", toolName: "read_self_history", input: { category: "materials", cursor: null, limit: 1 } },
        { toolCallId: "peer-read", toolName: "read_file", input: { path: "peer.json" } },
      ] },
      { kind: "tool", toolCallId: "finish", toolName: "complete_subagent", input: { text: "Both retained sources were inspected.", materials: [] } },
    ]);
    const f = await subagentFixture(model, { historyBudget: () => 9246,
      agent: { contextWindowTokens: () => 48000, requestEnvelopeReserve: () => 38754 },
      tools: { read_file: tool({ inputSchema: z.strictObject({ path: z.string() }), execute: read }) } });
    fixtures.push(f);
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["read_file"] }, {
      characterId: "taki", operationKey: "mixed-history", label: "Read private history and source",
      initialContext: { kind: "fresh" }, direction: "Inspect the retained source and one additional source.",
      materials: [], completionPolicy: "record_only",
    });
    const subagentId = accepted.conversation.subagentId;
    await vi.waitFor(() => expect(f.executions.list({ subagentId })[0]?.result).toBeTruthy(), { timeout: 5000 });
    const executions = f.executions.list({ subagentId });
    expect(executions).toHaveLength(1);
    const execution = executions[0]!;
    expect(execution.result).toMatchObject({ outcome: "completed", outputKind: "validated" });
    expect(model.doStreamCalls).toHaveLength(3);
    expect(read.mock.calls.map(([input]) => input.path)).toEqual(["seed.json", "peer.json"]);
    expect(f.db.prepare("SELECT attempt_id FROM run_attempts WHERE run_id=:run").all({ run: execution.runId })).toHaveLength(1);
    const stored = createSubagentToolResultRepo(f.db);
    const identity = { runId: execution.runId, attemptId: execution.result!.attemptId, stepNumber: 1 };
    const originalPage = SubagentSelfHistoryResultSchema.parse(JSON.parse(stored.read({ ...identity, toolCallId: "history-page" })!.text));
    expect(originalPage.hasMore).toBe(true);
    expect(originalPage.nextCursor).toEqual(expect.any(String));
    expect(originalPage.records[0]).toMatchObject({ offset: 0, complete: false });
    const parts = model.doStreamCalls[2]!.prompt.flatMap((message) => message.role === "tool" ? message.content : []);
    const page = parts.find((part) => part.type === "tool-result" && part.toolCallId === "history-page")!;
    if (page.type !== "tool-result" || page.output.type !== "json") throw new Error("Expected the exact paged result");
    expect(JSON.stringify(unwrapped(page.output.value))).toBe(JSON.stringify(originalPage));
    const peer = parts.find((part) => part.type === "tool-result" && part.toolCallId === "peer-read")!;
    expect(peer).toMatchObject({ toolName: "read_file", output: { type: "text", value: expect.stringContaining("exact retained row is pageable") } });
    expect(JSON.stringify(peer).length).toBeLessThan(5000);
    expect(JSON.parse(stored.read({ ...identity, toolCallId: "peer-read" })!.text)).toEqual(originalFile);
    const reconstructed = new Map<string, string>();
    let cursor: string | null = null;
    do {
      const page = readSubagentSelfHistory({ ...f, characterId: "taki", subagentId, toolResults: stored }, { category: "materials", cursor, limit: 1 });
      expect(page.status).toBe("available");
      for (const record of page.records) reconstructed.set(record.id, (reconstructed.get(record.id) ?? "") + record.body);
      cursor = page.nextCursor;
    } while (cursor);
    const source = [...reconstructed.values()].map((text) => JSON.parse(text) as { toolCallId: string; text: string })
      .find((record) => record.toolCallId === "peer-read")!;
    expect(JSON.parse(source.text)).toEqual(originalFile);
    expect(f.errors).toEqual([]);
  });
});
