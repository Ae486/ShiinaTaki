import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createReadFileTool } from "../workspace/read-file-tool.ts";
import { createWorkspacePaths } from "../workspace/workspace-paths.ts";
import { createLogger } from "../logging/logger.ts";
import { createMaterialSelection } from "./subagent-tool-materials.ts";
import type { MaterialRef } from "@taki/shared";

describe("selected actual tool-acquired material", () => {
  it("recovers from an invalid source reference within the same governed SDK Run and Attempt", async () => {
    let requests = 0;
    let reference: MaterialRef | undefined;
    const model = new MockLanguageModelV4({ doStream: async (options) => {
      requests++;
      if (requests === 1) return scriptedModel([{ kind: "tool", toolCallId: "read-evidence", toolName: "read_file",
        input: { path: "evidence.txt" } }]).doStream(options);
      const execution = f.executions.list({ subagentId: f.children.list({ characterId: "taki" })[0]!.subagentId })[0]!;
      reference = { kind: "tool_result", runId: execution.runId, attemptId: f.runs.status(execution.runId).run.activeAttemptId!,
        stepNumber: 0, toolCallId: "read-evidence", key: "result" };
      const prompt = JSON.stringify(options.prompt);
      expect(prompt).toContain("materialReferences");
      expect(prompt).toContain("read-evidence");
      if (requests === 2) return scriptedModel([{ kind: "tool", toolCallId: "invalid-final", toolName: "complete_subagent",
        input: { text: "Premature result", materials: [{ ...reference, key: "nonexistent-source" }] } }]).doStream(options);
      expect(requests).toBe(3);
      expect(prompt).toContain("SUBAGENT_MATERIAL_NOT_FOUND");
      expect(prompt).toContain("nextAction");
      expect(f.effects.unfinished(execution.runId).filter((effect) => effect.kind !== "model")).toEqual([]);
      expect(execution.proposal).toBeNull();
      return scriptedModel([{ kind: "tool", toolCallId: "corrected-final", toolName: "complete_subagent",
        input: { text: "Report with the actual source", materials: [reference] } }]).doStream(options);
    } });
    const f: Awaited<ReturnType<typeof subagentFixture>> = await subagentFixture(model, { agent: {
      coreTools: () => createReadFileTool({ paths: createWorkspacePaths({ root: f.root }), logger: createLogger("fatal") }),
    } });
    try {
      await writeFile(join(f.root, "evidence.txt"), "Offline reading and existing records are required.", "utf8");
      const work = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["read_file"] }, {
        characterId: "taki", operationKey: "recover-material", label: "Review evidence", initialContext: { kind: "fresh" },
        direction: "Read the evidence and report with its source", materials: [], completionPolicy: "record_only",
      });
      await vi.waitFor(() => expect(f.executions.list({ subagentId: work.conversation.subagentId })[0]?.result).toBeTruthy());
      const executions = f.executions.list({ subagentId: work.conversation.subagentId });
      expect(executions).toHaveLength(1);
      const execution = executions[0]!;
      expect(execution.result).toMatchObject({ outcome: "completed", outputKind: "validated",
        body: "Report with the actual source", sourceContext: { materials: [{ label: "Workspace file", reference: "evidence.txt" }] } });
      expect(execution.workInputId).toBe(work.input!.inputId);
      expect(f.runs.status(execution.runId).attempts).toHaveLength(1);
      expect(execution.result!.attemptId).toBe(reference!.kind === "tool_result" ? reference!.attemptId : undefined);
      expect(requests).toBe(3);
      expect(f.effects.unfinished(execution.runId)).toEqual([]);
      const effects = f.effects.list!(execution.runId).filter((effect) => effect.kind === "tool");
      expect(effects.map((effect) => effect.outcome).sort()).toEqual(["completed", "completed", "failed"]);
      expect(f.service.events.list({ characterId: "taki" }).map((event) => event.kind)).toEqual(["final"]);
      expect(f.service.summary(work.conversation.subagentId).progress?.completedSteps).toBe(3);
      expect(f.conversation.history("taki")).toEqual([]);
      expect(f.errors).toEqual([]);
    } finally { await f.close(); }
  });

  it("runs two governed file reads, retains original results and passes only explicitly selected source to the parent", async () => {
    let count = 0;
    const model = new MockLanguageModelV4({ doStream: async (options) => {
      count++;
      if (count < 3) return scriptedModel([{ kind: "tool", toolCallId: `read-${count}`, toolName: "read_file",
        input: { path: count === 1 ? "one.txt" : "two.txt" } }]).doStream(options);
      const run = f.executions.list({ subagentId: f.children.list({ characterId: "taki" })[0]!.subagentId })[0]!;
      const input = count === 3 ? { text: "Result about the selected first file", materials: [{ kind: "tool_result", runId: run.runId,
        attemptId: f.runs.status(run.runId).run.activeAttemptId, stepNumber: 0, toolCallId: "read-1", key: "result" }] }
        : { eventId: f.service.events.list({ characterId: "taki" })[0]!.eventId, operationKey: "retain-source",
          action: { kind: "retained", note: "Parent synthesis" } };
      return scriptedModel([{ kind: "tool", toolCallId: `result-${count}`, toolName: count === 3 ? "complete_subagent" : "handle_agent_event", input }]).doStream(options);
    } });
    const f: Awaited<ReturnType<typeof subagentFixture>> = await subagentFixture(model, { agent: {
      coreTools: () => createReadFileTool({ paths: createWorkspacePaths({ root: f.root }), logger: createLogger("fatal") }),
    } });
    try {
      await writeFile(join(f.root, "one.txt"), 'External narrator: "I lost my job."', "utf8");
      await writeFile(join(f.root, "two.txt"), "Unrelated source two", "utf8");
      const work = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["read_file"] }, {
        characterId: "taki", operationKey: "read", label: "Read selected files", initialContext: { kind: "fresh" },
        direction: "Read both files and select only the first as supporting material", materials: [], completionPolicy: "request_parent", lifetimeMinutes: 30,
      });
      await vi.waitFor(() => expect(f.service.events.list({ characterId: "taki" })[0]?.state).toBe("handled"));
      const execution = f.executions.list({ subagentId: work.conversation.subagentId })[0]!;
      expect(execution.result?.sourceContext.materials).toEqual([{ label: "Workspace file", reference: "one.txt" }]);
      expect(f.service.events.list({ characterId: "taki" })[0]?.sourceContext.materials).toEqual([{ label: "Workspace file", reference: "one.txt" }]);
      expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("materialReferences");
      expect(JSON.stringify(model.doStreamCalls[3]?.prompt)).toContain("one.txt");
      expect(JSON.stringify(model.doStreamCalls[3]?.prompt)).not.toContain("two.txt");
      const selected = createMaterialSelection({ ...f, characterId: "taki", subagentId: work.conversation.subagentId });
      const materials = selected.select([{ kind: "tool_result", runId: execution.runId, attemptId: execution.result!.attemptId,
        stepNumber: 0, toolCallId: "read-1", key: "result" }]);
      expect(materials[0]?.text).toContain('"truncated":false');
      expect(materials[0]?.text).toContain("I lost my job.");
      expect(f.conversation.history("taki")).toEqual([]);
      expect(f.errors).toEqual([]);
    } finally { await f.close(); }
  });
});
