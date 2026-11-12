import { describe, expect, it, vi } from "vitest";
import { SUBAGENT_METHODS, SubagentListResultSchema, SubagentHistoryResultSchema, SubagentControlResultSchema,
  SubagentConversationResultSchema, SubagentActivityReadResultSchema, SubagentConversationBodyResultSchema } from "@taki/shared";
import { subagentFixture } from "../../testing/subagent-fixture.ts";
import { streamingMockModel } from "../../testing/mock-language-model.ts";
import { createConnectionRegistry } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { createSubagentSubscriptions } from "../../harness/subagent-subscriptions.ts";
import { registerSubagentMethods } from "./subagent-methods.ts";

describe("authenticated child conversation protocol", () => {
  it("rejects unauthenticated/copied/retired/node connections and reports exact CAS conflicts", async () => {
    const f = await subagentFixture(streamingMockModel(["retained"]));
    const connections = createConnectionRegistry(); const registry = createMethodRegistry(); const subscriptions = createSubagentSubscriptions(connections);
    registerSubagentMethods(registry, { service: f.service, subscriptions, connections });
    const connection = connections.create(); const notify = vi.fn(); const closes: (() => void)[] = [];
    const ctx: MethodContext = { connection, notify, close() {}, onClose: (callback) => closes.push(callback) };
    const request = { jsonrpc: "2.0" as const, id: 1, method: SUBAGENT_METHODS.list, params: { characterId: "taki" } };
    let resolveTerminal!: () => void;
    const terminal = { promise: new Promise<void>((resolve) => { resolveTerminal = resolve; }), resolve: () => resolveTerminal() };
    const unsubscribe = f.runRepo.onTerminalCommit((fact) => {
      if (fact.run.initiator === "subagent") terminal.resolve();
    });
    try {
      expect(await registry.dispatch(request, ctx)).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
      connections.authenticate(connection, { deviceId: "operator", role: "operator", capabilities: [] });
      expect(await registry.dispatch(request, { ...ctx, connection: { ...connection } })).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
      const node = connections.create(); connections.authenticate(node, { deviceId: "node", role: "node", capabilities: [] });
      expect(await registry.dispatch(request, { ...ctx, connection: node })).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
      const sub = { ...request, method: SUBAGENT_METHODS.subscribe, params: {} };
      await registry.dispatch(sub, ctx); await registry.dispatch(sub, ctx); expect(closes).toHaveLength(1);
      const work = await f.service.delegate({ parentRunId: f.parent.run.runId, parentToolNames: [] }, { characterId: "taki", operationKey: "job", label: "Read",
        initialContext: { kind: "fresh" }, direction: "Do work", materials: [], completionPolicy: "record_only", lifetimeMinutes: 30 });
      await terminal.promise;
      expect(f.executions.list({ subagentId: work.conversation.subagentId })[0]?.result).toBeTruthy();
      const list = await registry.dispatch(request, ctx); expect("result" in list && SubagentListResultSchema.parse(list.result).entries).toHaveLength(1);
      const history = await registry.dispatch({ ...request, method: SUBAGENT_METHODS.history,
        params: { ...request.params, subagentId: work.conversation.subagentId } }, ctx);
      expect("result" in history && SubagentHistoryResultSchema.parse(history.result).results).toHaveLength(1);
      const current = f.service.summary(work.conversation.subagentId);
      const params = { characterId: "taki", subagentId: current.subagentId };
      const page = await registry.dispatch({ ...request, method: SUBAGENT_METHODS.conversation, params }, ctx);
      expect("result" in page).toBe(true);
      const entries = "result" in page ? SubagentConversationResultSchema.parse(page.result).entries : [];
      expect(entries.length).toBeGreaterThan(0);
      const body = await registry.dispatch({ ...request, method: SUBAGENT_METHODS.conversationBody,
        params: { ...params, seq: entries[0]!.seq } }, ctx);
      expect("result" in body && SubagentConversationBodyResultSchema.parse(body.result).complete).toBe(true);
      const activity = await registry.dispatch({ ...request, method: SUBAGENT_METHODS.activityRead, params }, ctx);
      expect("result" in activity && SubagentActivityReadResultSchema.parse(activity.result).subagentId).toBe(current.subagentId);
      expect(await registry.dispatch({ ...request, method: SUBAGENT_METHODS.activityRead,
        params: { ...params, characterId: "wrong" } }, ctx)).toMatchObject({ error: { data: { reason: "SUBAGENT_CHARACTER_MISMATCH" } } });
      await registry.dispatch({ ...request, method: SUBAGENT_METHODS.activitySubscribe, params }, ctx);
      await registry.dispatch({ ...request, method: SUBAGENT_METHODS.activityUnsubscribe, params: {} }, ctx);
      await registry.dispatch({ ...request, method: SUBAGENT_METHODS.activitySubscribe, params }, ctx);
      expect(closes).toHaveLength(2);
      expect(await registry.dispatch({ ...request, method: SUBAGENT_METHODS.inboxResume,
        params: { characterId: "taki", consumerId: "missing", operationKey: "resume" } }, ctx))
        .toMatchObject({ error: { data: { reason: "SUBAGENT_INBOX_RECONCILIATION_REQUIRED" } } });
      const stop = { ...request, method: SUBAGENT_METHODS.stop, params: { characterId: "taki", target: { subagentId: current.subagentId,
        workInputId: work.input!.inputId, expectedRunId: null, expectedControlVersion: current.controlVersion } } };
      const stopped = await registry.dispatch(stop, ctx); expect("result" in stopped && SubagentControlResultSchema.parse(stopped.result).conversation.stopOrigin).toBe("user");
      expect(await registry.dispatch(stop, ctx)).toMatchObject({ error: { code: -32602, data: { reason: "SUBAGENT_CONTROL_CONFLICT" } } });
      subscriptions.publish("taki", current.subagentId); await Promise.resolve(); expect(notify).toHaveBeenCalledOnce();
      connections.remove(connection); subscriptions.publish("taki", current.subagentId); await Promise.resolve(); expect(notify).toHaveBeenCalledOnce();
      expect(await registry.dispatch(request, ctx)).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
    } finally { unsubscribe(); subscriptions.close(); await f.close(); }
  });
});
