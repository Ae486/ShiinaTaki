import { randomUUID } from "node:crypto";
import { createPatternFixture } from "./c3-pattern-native-server.mjs";
import { CHILD_A, CHILD_B, WORK_A, history, work } from "./s7-subagent-data.ts";
import { SubagentHistoryResultSchema, SubagentControlResultSchema, SubagentConversationResultSchema,
  CO_WATCHING_METHODS, CO_WATCHING_INVITATION_METHODS } from "../../../packages/shared/src/index.ts";

export async function createSubagentFixture(path) {
  const fixture = await createPatternFixture(path);
  const original = fixture.response.bind(fixture);
  const receive = fixture.receive.bind(fixture);
  fixture.children = [history(CHILD_A), history(CHILD_B)];
  fixture.controlCalls = [];
  fixture.holdHistory = false;
  fixture.heldHistory = [];
  fixture.failHistory = false;
  fixture.dropSend = false;
  fixture.empty = false;
  fixture.change = () => fixture.notify("subagent.changed", { characterId: "taki", subagentId: CHILD_A, revision: ++fixture.revision });
  fixture.revision = 0;
  fixture.receive = (connection, request) => {
    if (fixture.holdHistory && ["subagent.history", "subagent.conversation"].includes(request.method)) fixture.heldHistory.push(() => receive(connection, request));
    else receive(connection, request);
  };
  fixture.releaseHistory = () => { fixture.holdHistory = false; fixture.heldHistory.splice(0).forEach((release) => release()); };
  fixture.response = (connection, request) => {
    const { method, params } = request;
    if (method === CO_WATCHING_METHODS.subscribe) return { ok: true };
    if (method === CO_WATCHING_INVITATION_METHODS.read) return { characterId: "taki", invitation: null };
    if (method === CO_WATCHING_METHODS.read) return { characterId: "taki", enabled: true, sources: [], analyses: [],
      session: fixture.children[0].conversation.stopOrigin === "user" ? { sessionId: "00000000-0000-4000-8000-000000000051", sourceRef: "00000000-0000-4000-8000-000000000052",
        analysisId: "00000000-0000-4000-8000-000000000053", title: "城市记忆", status: "paused_child", reason: null, subagentId: CHILD_A, workInputId: WORK_A,
        expiresAt: "2026-10-24T12:00:00.000Z", preparedCount: null, sentCount: 0, pendingRevision: false } : null };
    if (!method.startsWith("subagent.")) return original(connection, request);
    if (method === "subagent.subscribe") return { status: "ok" };
    if (["subagent.attention", "subagent.inbox.recovery"].includes(method)) return { entries: [], nextCursor: null };
    if (["subagent.activity.subscribe", "subagent.activity.unsubscribe"].includes(method)) return { status: "ok" };
    if (method === "subagent.activity.read") return { subagentId: params.subagentId, workInputId: WORK_A,
      activity: { status: "idle" }, coveredThroughStep: -1, itemSteps: [] };
    if (method === "subagent.list") return { entries: fixture.empty ? [] : fixture.children.map((row) => row.conversation), nextCursor: null };
    if (["subagent.history", "subagent.conversation"].includes(method)) {
      if (fixture.failHistory) { fixture.failHistory = false; throw new Error("Isolated read failure"); }
      const child = fixture.children.find((row) => row.conversation.subagentId === params.subagentId);
      if (method === "subagent.history") return SubagentHistoryResultSchema.parse(child);
      const entries = [...child.inputs.map((input, index) => ({ kind: "input", input, createdAt: input.createdAt,
        historicalOrder: false, subagentId: params.subagentId, workInputId: input.workInputId, seq: index + 1 })),
      ...child.messages.map((message, index) => ({ kind: "message", message, createdAt: message.createdAt,
        historicalOrder: false, subagentId: params.subagentId, workInputId: WORK_A, seq: child.inputs.length + index + 1 }))];
      if (child.conversation.stopOrigin) entries.push({ kind: "control", seq: entries.length + 1,
        subagentId: params.subagentId, workInputId: WORK_A, createdAt: child.conversation.createdAt, historicalOrder: false,
        control: { origin: child.conversation.stopOrigin, action: "stop", controlVersion: child.conversation.controlVersion } });
      return SubagentConversationResultSchema.parse({ conversation: child.conversation, entries, nextCursor: null, hasMore: false });
    }
    const child = fixture.children.find((row) => row.conversation.subagentId === params.target.subagentId);
    if (!child) throw new Error("Unknown isolated child");
    fixture.controlCalls.push({ method, params });
    let input = null;
    let cancellationRequested = false;
    if (method === "subagent.stop") {
      cancellationRequested = !!child.conversation.activeRunId;
      child.conversation = { ...child.conversation, activeRunId: null, activeWorkInputId: null, stopOrigin: "user",
        state: "blocked_user", controlVersion: child.conversation.controlVersion + 1 };
      child.executions.forEach((run) => { run.state = "cancelled"; });
      fixture.notify(CO_WATCHING_METHODS.changed, { characterId: "taki", revision: ++fixture.revision });
    } else {
      input = work({ inputId: randomUUID(), subagentId: params.target.subagentId, workInputId: params.target.workInputId,
        inputSeq: child.inputs.length + 1, workSeq: child.inputs.length + 1, operationKey: params.operationKey,
        kind: method === "subagent.continue" ? "continue" : "message", direction: params.direction, sender: { kind: "user" }, consumed: null });
      child.inputs.push(input);
      if (method === "subagent.continue") child.conversation = { ...child.conversation, stopOrigin: null, state: "queued", controlVersion: child.conversation.controlVersion + 1 };
    }
    if (method === "subagent.send" && fixture.dropSend) { fixture.dropSend = false; connection.socket.close(); }
    fixture.change();
    return SubagentControlResultSchema.parse({ conversation: child.conversation, input, cancellationRequested });
  };
  return fixture;
}
