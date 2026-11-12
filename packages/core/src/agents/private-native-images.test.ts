import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import type { SubagentControlResult } from "@taki/shared";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";
import { createAttachmentStore } from "../media/attachment-store.ts";
import { createScreenshotStore } from "../capabilities/screenshot-store.ts";
import { nativeScreenshotResult, projectAmbientScreenshotRoute } from "../capabilities/native-screenshot-result.ts";
import { nativeToolImages } from "./native-tool-images.ts";

const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
afterEach(async () => { for (const fixture of fixtures.splice(0)) await fixture.close(); });
const IMAGE = { mediaType: "image/png" as const, dataBase64: Buffer.from("private-native-capture").toString("base64"), width: 32, height: 16 };
const final = (id: string) => ({ kind: "tool" as const, toolCallId: id, toolName: "complete_subagent", input: { text: "Retained answer", materials: [] } });

async function finished(fixture: Awaited<ReturnType<typeof subagentFixture>>, accepted: SubagentControlResult, count = 1) {
  await vi.waitFor(() => {
    const executions = fixture.executions.list({ subagentId: accepted.conversation.subagentId });
    expect(executions).toHaveLength(count);
    expect(executions.every((execution) => execution.result?.outcome === "completed")).toBe(true);
  });
}

function followUp(fixture: Awaited<ReturnType<typeof subagentFixture>>, accepted: SubagentControlResult, operationKey: string) {
  const current = fixture.service.summary(accepted.conversation.subagentId);
  return fixture.service.send({ characterId: "taki", operationKey, direction: "Use the same captured evidence", materials: [],
    target: { subagentId: current.subagentId, workInputId: accepted.input!.workInputId,
      expectedControlVersion: current.controlVersion, expectedRunId: current.activeRunId } }, { kind: "user" });
}

function imageParts(prompt: { role: string; content: unknown }[]) {
  return prompt.flatMap((message) => Array.isArray(message.content)
    ? message.content.filter((part: { type: string }) => part.type === "file") : []);
}

describe("private native screenshot replay through SDK and SQLite", () => {
  it("uses retained pixels on the next step and later Runs, then reports removal without recapture", async () => {
    const model = scriptedModel([{ kind: "tool", toolCallId: "capture", toolName: "screenshot", input: {} }, final("first"), final("second"), final("third")]);
    const capture = vi.fn(() => nativeScreenshotResult({ attachments, store }, IMAGE));
    const fixture = await subagentFixture(model, {
      tools: { screenshot: tool({ inputSchema: z.object({}), execute: capture }) },
      agent: { attachments: { save: (data, mediaType) => attachments.save(data, mediaType), read: (ref) => attachments.read(ref) } },
    });
    fixtures.push(fixture);
    const attachments = createAttachmentStore({ attachmentsDir: join(fixture.root, "attachments") });
    const store = createScreenshotStore({ screenshotsDir: join(fixture.root, "screenshots") });
    const accepted = await fixture.service.delegate({ parentRunId: fixture.parent.run.runId, parentToolNames: ["screenshot"] }, {
      characterId: "taki", operationKey: "capture-work", label: "Capture", direction: "Inspect one screenshot",
      initialContext: { kind: "fresh" }, materials: [], completionPolicy: "record_only",
    });
    await finished(fixture, accepted);
    expect(imageParts(model.doStreamCalls[1]!.prompt)).toHaveLength(1);
    const rows = fixture.messages.history({ subagentId: accepted.conversation.subagentId });
    expect(rows.flatMap((row) => row.parts ?? []).filter((part) => part.type === "tool-result" && part.imageRefs?.length)).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(IMAGE.dataBase64);
    expect(fixture.conversation.history("taki")).toEqual([]);
    followUp(fixture, accepted, "follow-up"); await finished(fixture, accepted, 2);
    expect(imageParts(model.doStreamCalls[2]!.prompt)).toHaveLength(1);
    attachments.clear();
    followUp(fixture, accepted, "after-removal"); await finished(fixture, accepted, 3);
    expect(imageParts(model.doStreamCalls[3]!.prompt)).toEqual([]);
    expect(JSON.stringify(model.doStreamCalls[3]!.prompt)).toContain("NOT_FOUND");
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("carries a temporary screenshot through private reconstruction and releases it before a later Run", async () => {
    const model = scriptedModel([{ kind: "tool", toolCallId: "ambient", toolName: "capture_screen", input: {} }, final("first"), final("follow-up")]);
    let output: unknown;
    const capture = vi.fn(() => { output = projectAmbientScreenshotRoute({ ok: true, output: IMAGE }); return output; });
    const fixture = await subagentFixture(model, { tools: { capture_screen: tool({ inputSchema: z.object({}), execute: capture }) } });
    fixtures.push(fixture);
    const accepted = await fixture.service.delegate({ parentRunId: fixture.parent.run.runId, parentToolNames: ["capture_screen"] }, {
      characterId: "taki", operationKey: "ambient-work", label: "Ambient", direction: "Inspect the temporary frame",
      initialContext: { kind: "fresh" }, materials: [], completionPolicy: "record_only",
    });
    await finished(fixture, accepted);
    expect(imageParts(model.doStreamCalls[1]!.prompt)).toHaveLength(1);
    const rows = fixture.messages.history({ subagentId: accepted.conversation.subagentId });
    expect(JSON.stringify(rows)).not.toContain(IMAGE.dataBase64);
    expect(rows.flatMap((row) => row.parts ?? []).some((part) => part.type === "tool-result" && part.imageRefs?.length)).toBe(false);
    expect(nativeToolImages(output)?.images).toEqual([]);
    followUp(fixture, accepted, "temporary-follow-up"); await finished(fixture, accepted, 2);
    expect(imageParts(model.doStreamCalls[2]!.prompt)).toEqual([]);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("removes a private temporary frame invalidated after preparation at the actual model dispatch", async () => {
    let current = true; let output: unknown;
    const model = scriptedModel([{ kind: "tool", toolCallId: "ambient", toolName: "capture_screen", input: {} }, final("final")]);
    const capture = vi.fn(() => { output = projectAmbientScreenshotRoute({ ok: true, output: IMAGE }, () => current); return output; });
    const fixture = await subagentFixture(model, { tools: { capture_screen: tool({ inputSchema: z.object({}), execute: capture }) } });
    fixtures.push(fixture);
    const prepareEffect = fixture.effects.prepare;
    let modelCalls = 0;
    vi.spyOn(fixture.effects, "prepare").mockImplementation((request) => {
      const effect = prepareEffect(request);
      if (request.kind === "model" && ++modelCalls === 2) current = false;
      return effect;
    });
    const accepted = await fixture.service.delegate({ parentRunId: fixture.parent.run.runId, parentToolNames: ["capture_screen"] }, {
      characterId: "taki", operationKey: "retired-frame", label: "Ambient", direction: "Use permitted evidence",
      initialContext: { kind: "fresh" }, materials: [], completionPolicy: "record_only",
    });
    await finished(fixture, accepted);
    expect(imageParts(model.doStreamCalls[1]!.prompt)).toEqual([]);
    expect(JSON.stringify(model.doStreamCalls[1]!.prompt)).toContain("OBSERVATION_RETIRED");
    expect(nativeToolImages(output)?.images).toEqual([]);
    expect(capture).toHaveBeenCalledOnce();
  });
});
