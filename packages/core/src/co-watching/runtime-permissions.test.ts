import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { APPROVAL_METHODS, CanonicalApprovalRequestSchema, type CanonicalApprovalRequest,
  type CanonicalApprovalRespondParams } from "@taki/shared";
import { createApprovalDecisionService } from "../approval/approval-decision-service.ts";
import { createApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import { createApprovalStateRepo } from "../approval/approval-state-repo.ts";
import { createGovernancePolicyRepo } from "../governance/governance-policy-repo.ts";
import { createGovernancePolicyService } from "../governance/governance-policy-service.ts";
import { createRunSnapshotCapture } from "../harness/run-snapshot-capture.ts";
import { createMcpManager } from "../mcp/mcp-manager.ts";
import type { TurnInteractive } from "../mcp/mcp-turn-tools.ts";
import type { Connection } from "../server/connection-registry.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { coWatchingFixture } from "../testing/co-watching-fixture.ts";
import { InMemoryTransport, memConnect, type CallHandler } from "../testing/mcp-test-transport.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

async function fixture() {
  const f = await coWatchingFixture();
  const requests: CanonicalApprovalRequest[] = [];
  const connection: Connection = { ...f.interactive.connection, notify: (method, params) => {
    if (method === APPROVAL_METHODS.request) requests.push(CanonicalApprovalRequestSchema.parse(params));
  } };
  const governance = createGovernancePolicyService(createGovernancePolicyRepo(f.db));
  const approval = createApprovalInteractionService(
    createApprovalDecisionService(createApprovalStateRepo(f.db)), (event) => f.events.append(event),
  );
  const call = vi.fn<CallHandler>((message) => ({ jsonrpc: "2.0", id: message.id,
    result: { ...f.raw, content: [] } }));
  const definitions = [{ name: "bilinote_read_result", inputSchema: {
    type: "object", properties: { client_request_id: { type: "string" }, job_id: { type: "string" },
      include_complete: { type: "boolean" } }, required: ["client_request_id", "job_id", "include_complete"],
    additionalProperties: false,
  } }];
  const manager = createMcpManager({ logger: createCaptureLogger().logger,
    connect: (entry) => memConnect(new Map([[entry.key, new InMemoryTransport(definitions, call)]]))(entry),
    governance: { service: governance, ownerHostId: f.playback.hostId, approval } });
  cleanups.push(async () => {
    approval.disconnect(connection);
    await f.runtime.close();
    await manager.close();
    await f.cleanup();
  });
  const publish = (configRevision: number) => manager.applyDesired({ serverId: f.analysis.serverId,
    ownerHostId: f.playback.hostId, configRevision, config: { command: "fixture" }, enabled: true,
    selectedTools: ["bilinote_read_result"] });
  await publish(1);

  // Use the production admission capture, manager and approval machinery. Only browser/native/model
  // producers remain synthetic. The alias preserves the existing runtime fixture's result-tool key;
  // the actual MCP subject, revision, policy, prompt and dispatch lease stay owned by the manager.
  const capture = createRunSnapshotCapture({ governance, approval, effects: f.effects,
    provider: "fixture", modelId: "fixture", memory: { captureRun: async () => ({
      snapshot: f.root.snapshot.memory, tools: {},
    }) }, extensions: { runContext: (interactive, runId) => {
      const captured = manager.snapshot(interactive)[0]!;
      return { tools: { native_result: captured.tool }, instructions: "",
        toolDisclosure: { deferredToolNames: [], describedTools: {}, skills: {} }, snapshot: {
          runId: runId!, primaryHostId: f.playback.hostId,
          hosts: [{ hostId: f.playback.hostId, available: true, connectionGeneration: 1,
            catalogGeneration: 1, extensionCount: 1 }],
          entries: [], collisions: [], budget: { maxEntries: 64, maxDescriptionChars: 512,
            maxSearchResults: 16, maxCalls: 8 },
        } };
    } } });
  f.capture.mockImplementation(async (request, runId?: string, options?: { admission?: TurnInteractive }) => {
    const result = await capture.capture(request, runId!, options);
    if (!result.context?.authorityCurrent) throw new Error("Expected captured execution authority");
    return { ...result, context: { ...result.context, authorityCurrent: result.context.authorityCurrent } };
  });

  const start = (requestId = f.input.requestId) => f.runtime.start({ ...f.input, requestId }, { connection });
  const respond = (request: CanonicalApprovalRequest, choice: CanonicalApprovalRespondParams["choice"]) =>
    approval.respond(connection, { approvalId: request.approvalId, choice,
      expectedApprovalGeneration: request.approvalGeneration,
      ...(choice === "allow_always" ? { disclosure: { revision: 1, futureBackgroundUseAccepted: true } } : {}) });
  return { ...f, start, requests, connection, governance, approval, manager, call, respond, publish };
}

async function waitForRequest(f: Awaited<ReturnType<typeof fixture>>, index = 0) {
  await vi.waitFor(() => expect(f.requests.length).toBe(index + 1));
  await flush();
  return f.requests[index]!;
}

describe("accepted Co-Watching through the shared MCP permission pipeline", () => {
  it("keeps native reading and model preparation blocked until the exact request is allowed", async () => {
    const f = await fixture();
    expect(f.start()).toMatchObject({ accepted: true });
    const request = await waitForRequest(f);
    await flush();
    const { ref } = f.manager.snapshot()[0]!;
    expect(request.binding.identity.subject).toEqual({ subjectId: ref.subjectId, revision: ref.subjectRevision });
    expect(f.session().status).toBe("reading");
    expect(f.call).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    const waiting = f.db.prepare("SELECT effect_id,run_id,state FROM run_effects WHERE json_extract(approval_ref_json,'$.approvalId')=$id")
      .get({ id: request.approvalId })!;
    const effectId = waiting.effect_id;
    if (typeof effectId !== "string" || typeof waiting.run_id !== "string") throw new Error("Expected a persisted waiting Effect");
    expect(waiting.state).toBe("waiting");
    expect(f.events.list(waiting.run_id).filter((event) => event.kind === "effect.intent_committed")).toEqual([]);

    expect(f.respond(request, "allow_once")).toMatchObject({ status: "accepted" });
    await vi.waitFor(() => expect(f.session().status).toBe("ready"));
    expect(f.call).toHaveBeenCalledOnce();
    expect(f.call.mock.calls[0]![0].params).toEqual({ name: "bilinote_read_result", arguments: {
      client_request_id: f.analysis.native.requestId, job_id: f.analysis.native.jobId, include_complete: true,
    } });
    expect(f.generate).toHaveBeenCalledOnce();
    expect(f.db.prepare("SELECT state,outcome FROM run_effects WHERE effect_id=$id").get({ id: effectId }))
      .toMatchObject({ state: "terminal", outcome: "completed" });
    expect(f.manager.statuses()[0]?.leaseCount).toBe(0);
  });

  it("settles a denied request without native reading, model preparation or a hidden retry", async () => {
    const f = await fixture(); f.start();
    const request = await waitForRequest(f);
    expect(f.respond(request, "deny")).toMatchObject({ status: "accepted" });
    await vi.waitFor(() => expect(f.session().status).toBe("failed"));
    f.runtime.playbackChanged(); await flush();
    expect(f.requests).toHaveLength(1);
    expect(f.call).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.db.prepare("SELECT outcome,error_code FROM run_effects WHERE json_extract(approval_ref_json,'$.approvalId')=$id")
      .get({ id: request.approvalId })).toMatchObject({ outcome: "failed", error_code: "approval_denied" });
  });

  it("cancels a pending approval on Stop and rejects a late Allow without reviving work", async () => {
    const f = await fixture(); f.start();
    const request = await waitForRequest(f);
    expect(f.runtime.stop("taki", f.session().sessionId)).toMatchObject({ accepted: true });
    expect(f.respond(request, "allow_once")).not.toMatchObject({ status: "accepted" });
    await f.runtime.close();
    expect(f.session().status).toBe("stopped");
    expect(f.call).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.send).not.toHaveBeenCalled();
  });

  it("does not let an operator disconnect turn a pending request into permission", async () => {
    const f = await fixture(); f.start();
    await waitForRequest(f);
    f.approval.disconnect(f.connection);
    await vi.waitFor(() => expect(f.session().status).toBe("failed"));
    expect(f.call).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
  });

  it("rechecks policy after approval instead of dispatching under a newly denied cell", async () => {
    const f = await fixture(); f.start();
    const request = await waitForRequest(f);
    f.respond(request, "allow_once");
    const changed = f.governance.setCell({ key: "mcp-tool-call", level: "standard", posture: "deny",
      expectedPolicyGeneration: request.policyGeneration });
    f.approval.invalidatePolicy(changed.policyGeneration);
    await vi.waitFor(() => expect(f.session().status).toBe("failed"));
    expect(f.call).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
  });

  it("reuses a matching long-term grant but requests permission after an MCP configuration revision changes", async () => {
    const f = await fixture(); f.start();
    const original = await waitForRequest(f);
    expect(f.respond(original, "allow_always")).toMatchObject({ status: "accepted" });
    await vi.waitFor(() => expect(f.session().status).toBe("ready"));
    f.runtime.stop("taki", f.session().sessionId);
    f.start(randomUUID());
    await vi.waitFor(() => expect(f.session().status).toBe("ready"));
    expect(f.requests).toHaveLength(1);
    expect(f.call).toHaveBeenCalledTimes(2);

    f.runtime.stop("taki", f.session().sessionId);
    await f.publish(2);
    f.start(randomUUID());
    const changed = await waitForRequest(f, 1);
    expect(changed.binding.identity.subject?.subjectId).toBe(original.binding.identity.subject?.subjectId);
    expect(changed.binding.identity.subject?.revision).not.toBe(original.binding.identity.subject?.revision);
    expect(f.call).toHaveBeenCalledTimes(2);
    expect(f.generate).toHaveBeenCalledTimes(2);
    f.respond(changed, "deny");
    await vi.waitFor(() => expect(f.session().status).toBe("failed"));
    expect(f.call).toHaveBeenCalledTimes(2);
  });
});
