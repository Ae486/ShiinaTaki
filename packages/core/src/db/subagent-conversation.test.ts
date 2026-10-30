import { afterEach, describe, expect, it, vi } from "vitest";
import { tool } from "ai";
import { z } from "zod";
import { SubagentConversationResultSchema, SubagentConversationBodyResultSchema } from "@taki/shared";
import { subagentFixture } from "../testing/subagent-fixture.ts";
import { scriptedModel } from "../testing/mock-language-model.ts";

const fixtures: Awaited<ReturnType<typeof subagentFixture>>[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); });

describe("continuous private conversation projection", () => {
  it("does not advertise live-batch coverage before real stream presentation references are durable", async () => {
    const f = await subagentFixture(scriptedModel([
      { kind: "tool", toolCallId: "probe", toolName: "probe", input: {} },
      { kind: "tool", toolCallId: "report", toolName: "complete_subagent", input: { text: "Result", materials: [] } },
    ]), { tools: { probe: tool({ inputSchema: z.object({}), execute: () => ({ ok: true }) }) } });
    fixtures.push(f); f.queue.tryAcquireBackground("taki");
    const early: ReturnType<typeof f.service.conversation>["entries"] = [];
    let sawCanonicalBeforePresentation = false;
    let sawMappedInvalidation = false;
    f.service.state.deps.changed = (_characterId, subagentId) => {
      const unmapped = f.db.prepare(`SELECT 1 FROM run_messages m JOIN subagent_executions e ON e.run_id=m.run_id
        JOIN runs r ON r.run_id=m.run_id WHERE e.subagent_id=:child AND r.state='running' AND m.entry_kind='output'
        AND NOT EXISTS(SELECT 1 FROM subagent_message_presentation p WHERE p.message_seq=m.seq) LIMIT 1`).get({ child: subagentId });
      if (!unmapped) {
        const current = f.service.summary(subagentId);
        if (current.activeRunId) sawMappedInvalidation ||= f.service.conversation({ characterId: "taki", subagentId,
          direction: "newest", limit: 100 }).entries.some((entry) => entry.kind === "message" && Boolean(entry.presentation?.references.length));
        return;
      }
      sawCanonicalBeforePresentation = true;
      early.push(...f.service.conversation({ characterId: "taki", subagentId, direction: "newest", limit: 100 }).entries
        .filter((entry) => entry.kind === "message"));
    };
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["probe"] }, {
      characterId: "taki", operationKey: "timing", label: "Timing", initialContext: { kind: "fresh" },
      direction: "Work", materials: [], completionPolicy: "request_parent" });
    await vi.waitFor(() => expect(f.service.activityRead({ characterId: "taki", subagentId: accepted.conversation.subagentId }).activity.status).toBe("terminal"));
    expect(sawCanonicalBeforePresentation).toBe(true); expect(sawMappedInvalidation).toBe(true);
    expect(early.every((entry) => !entry.batch || entry.presentation?.references.length)).toBe(true);
  });

  it("pages complete native tool batches, retains real item identities and refuses cross-child cursors", async () => {
    const f = await subagentFixture(scriptedModel([
      { kind: "tool", toolCallId: "probe", toolName: "probe", input: {} },
      { kind: "tool", toolCallId: "report", toolName: "complete_subagent", input: { text: "A report", materials: [] } },
    ]), { tools: { probe: tool({ inputSchema: z.object({}), execute: () => ({ value: "A native result" }) }) } });
    fixtures.push(f); f.queue.tryAcquireBackground("taki");
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: ["probe"] }, {
      characterId: "taki", operationKey: "job", label: "Worker", initialContext: { kind: "fresh" },
      direction: "Investigate", materials: [], completionPolicy: "request_parent" });
    const subagentId = accepted.conversation.subagentId;
    await vi.waitFor(() => expect(f.service.activityRead({ characterId: "taki", subagentId }).activity.status).toBe("terminal"));
    const newest = SubagentConversationResultSchema.parse(f.service.conversation({ characterId: "taki", subagentId, direction: "newest", limit: 1 }));
    expect(newest.entries[0]?.kind).toBe("event");
    const entries = [...newest.entries]; let cursor = newest.nextCursor;
    while (cursor) {
      const page = f.service.conversation({ characterId: "taki", subagentId, direction: "older", cursor, limit: 1 });
      entries.unshift(...page.entries); cursor = page.nextCursor;
    }
    expect(new Set(entries.map((entry) => entry.seq)).size).toBe(entries.length);
    expect(entries.map((entry) => entry.kind)).toEqual(["input", "message", "message", "event"]);
    const messages = entries.filter((entry) => entry.kind === "message");
    expect(messages[0]?.batch?.entrySeqs).toEqual(messages.map((entry) => entry.seq));
    expect(messages[1]?.batch).toEqual(messages[0]?.batch);
    const callId = messages[0]?.presentation?.references[0]?.itemId;
    expect(callId).toBeTruthy(); expect(messages[1]?.presentation?.references[0]?.itemId).toBe(callId);
    const snapshot = f.service.activityRead({ characterId: "taki", subagentId });
    expect(snapshot.itemSteps.find((item) => item.itemId === callId)?.stepNumber).toBe(0);
    expect(entries.at(-1)?.presentation?.references[0]?.itemId).toBeTruthy();
    const other = f.children.create({ characterId: "taki", createdByRunId: f.parent.run.runId, label: "Other", initialContext: { kind: "fresh" } });
    expect(() => f.service.conversation({ characterId: "taki", subagentId: other.subagentId,
      direction: "older", cursor: { subagentId, seq: newest.entries[0]!.seq }, limit: 1 })).toThrow("CURSOR_MISMATCH");
    const newer = f.service.conversation({ characterId: "taki", subagentId, direction: "newer",
      cursor: { subagentId, seq: entries[0]!.seq }, limit: 100 });
    expect(newer.entries).toEqual(entries.slice(1));
  });

  it("returns explicit previews and complete digest-fenced body pages without crossing child scope", async () => {
    const original = "Large unicode 正文 🐈 ".repeat(3000);
    const f = await subagentFixture(scriptedModel([{ kind: "tool", toolCallId: "report", toolName: "complete_subagent",
      input: { text: original, materials: [] } }])); fixtures.push(f); f.queue.tryAcquireBackground("taki");
    const accepted = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, {
      characterId: "taki", operationKey: "long", label: "Long", initialContext: { kind: "fresh" },
      direction: "Work", materials: [], completionPolicy: "request_parent" });
    const subagentId = accepted.conversation.subagentId;
    await vi.waitFor(() => expect(f.service.activityRead({ characterId: "taki", subagentId }).activity.status).toBe("terminal"));
    const preview = f.service.conversation({ characterId: "taki", subagentId, direction: "newest", limit: 1 }).entries[0]!;
    expect(preview.body?.nextOffset).toBe(0); expect(JSON.stringify(preview).length).toBeLessThan(5000);
    let offset: number | null = 0; let serialized = "";
    while (offset !== null) {
      const page = SubagentConversationBodyResultSchema.parse(f.service.conversationBody({ characterId: "taki", subagentId,
        seq: preview.seq, offset, limit: 1777, digest: preview.body!.digest }));
      serialized += page.body; offset = page.nextOffset;
    }
    expect(JSON.parse(serialized).event.body).toBe(original);
    expect(() => f.service.conversationBody({ characterId: "taki", subagentId, seq: preview.seq,
      offset: 0, limit: 100, digest: "0".repeat(64) })).toThrow("BODY_CHANGED");
  });
});
