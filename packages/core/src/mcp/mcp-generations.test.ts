/**
 * INPUT:  the runtime generation machine (createMcpManager) over in-memory transports (closedCount pattern)
 * OUTPUT: process proofs for the frozen candidate/lease/drain/close/crash contracts: candidate publishes under
 *         lock, failed candidate keeps last-good, in-flight calls hold leases on their captured generation,
 *         future turns see the replacement, draining gets no new leases, drain budget force-closes, disable/
 *         remove/secret-clear block leases and close exactly once, test never publishes, boot reconcile rebuilds
 *         from desired state ONLY (never persisted runtime truth), local pagination counts pages
 * POS:    core/mcp — the Secure MCP Lifecycle runtime contract suite (unit; real-process proofs live in e2e/)
 */
import { afterEach, describe, expect, it } from "vitest";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { AsyncCallTransport, InMemoryTransport, PagedToolsTransport, memConnect, type CallHandler } from "../testing/mcp-test-transport.ts";
import type { McpServerConfig } from "@taki/shared";
import { createMcpManager, type McpDesiredRuntime, type McpManager } from "./mcp-manager.ts";
import type { McpConnect } from "./mcp-connect.ts";

const ECHO_TOOL = {
  name: "echo",
  description: "Echoes text",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};
const SEARCH_TOOL = { name: "search", description: "Searches", inputSchema: { type: "object" } };

const echoOk: CallHandler = (msg) => ({
  jsonrpc: "2.0",
  id: msg.id,
  result: { content: [{ type: "text", text: `echo: ${String(msg.params.arguments?.text)}` }] },
});

/** A controllable gate: the transport's tools/call settles only when the test resolves it. */
function deferredGate(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

const managers: McpManager[] = [];
afterEach(async () => {
  await Promise.allSettled(managers.splice(0).map((manager) => manager.close()));
});

function desiredOf(serverId: string, config: McpServerConfig, selectedTools: string[] = []): McpDesiredRuntime {
  return { serverId, config, selectedTools, enabled: true };
}

function makeManager(transports: Map<string, InMemoryTransport>, deps: { resolveSecret?: (ref: string) => string | null; connect?: McpConnect } = {}): McpManager {
  const { logger, records } = createCaptureLogger();
  const manager = createMcpManager({
    logger,
    connect: deps.connect ?? memConnect(transports),
    resolveSecret: deps.resolveSecret,
    drainBudgetMs: 60,
    shutdownBudgetMs: 60,
    candidateDeadlineMs: 500,
  });
  managers.push(manager);
  return Object.assign(manager, { records });
}

const call = async (manager: McpManager, key: string, text: string) =>
  (await manager.tools()[key]?.execute?.({ text }, { toolCallId: `c-${text}`, messages: [] } as never)) as {
    ok?: boolean;
    code?: number | string;
    content?: Array<{ text: string }>;
  };

describe("candidate publication and last-good retention", () => {
  it("publishes a new generation atomically: the next tools() read sees it, the generation number advances", async () => {
    const first = new InMemoryTransport([ECHO_TOOL], echoOk);
    const transports = new Map<string, InMemoryTransport>([["srv", first]]);
    const manager = makeManager(transports);
    await manager.applyDesired(desiredOf("srv", { command: "one" }));
    expect(Object.keys(manager.tools())).toEqual(["srv_echo"]);
    const before = manager.statuses().find((status) => status.serverId === "srv")?.runtimeGeneration;

    // Swap the transport the connect seam resolves, then re-apply desired state: an atomic generation swap.
    transports.set("srv", new InMemoryTransport([ECHO_TOOL, SEARCH_TOOL], echoOk));
    const outcome = await manager.applyDesired(desiredOf("srv", { command: "two" }));
    expect(outcome).toMatchObject({ status: "published", toolNames: ["echo", "search"], pages: 1 });
    expect(Object.keys(manager.tools()).sort()).toEqual(["srv_echo", "srv_search"]);
    expect(manager.statuses().find((status) => status.serverId === "srv")?.runtimeGeneration).toBeGreaterThan(before ?? 0);
    expect(first.closedCount).toBe(1); // the replaced generation closed (no leases were held)
  });

  it("a failing edit candidate keeps the last-good generation serving and records a sanitized failure", async () => {
    const good = new InMemoryTransport([ECHO_TOOL], echoOk);
    const transports = new Map<string, InMemoryTransport>([["srv", good]]);
    const manager = makeManager(transports, {
      connect: (entry) => {
        if ((entry.config as { command: string }).command === "bad-config") return Promise.reject(new Error("spawn ENOENT"));
        return memConnect(transports)(entry);
      },
    });
    await manager.applyDesired(desiredOf("srv", { command: "good" }));
    const failedEdit = await manager.applyDesired(desiredOf("srv", { command: "bad-config" }));
    expect(failedEdit).toMatchObject({ status: "failed", reason: "connect-failed" });
    expect(Object.keys(manager.tools())).toEqual(["srv_echo"]); // last-good keeps serving
    expect(await call(manager, "srv_echo", "retained")).toMatchObject({ content: [{ text: "echo: retained" }] });
    expect(manager.statuses()).toMatchObject([
      { serverId: "srv", phase: "connected", lastOutcome: { status: "failed", reason: "connect-failed" } },
    ]);
  });

  it("paginates tools/list locally under one deadline and reports the page count", async () => {
    const paged = new PagedToolsTransport([ECHO_TOOL, SEARCH_TOOL, { name: "third", inputSchema: { type: "object" } }], 1, echoOk);
    const manager = makeManager(new Map([["paged", paged]]));
    const outcome = await manager.applyDesired(desiredOf("paged", { command: "x" }));
    expect(outcome).toMatchObject({ status: "published", pages: 3, toolNames: ["echo", "search", "third"] });
  });

  it("applies the selected-tools filter at candidate preparation", async () => {
    const transport = new InMemoryTransport([ECHO_TOOL, SEARCH_TOOL], echoOk);
    const manager = makeManager(new Map([["srv", transport]]));
    const outcome = await manager.applyDesired(desiredOf("srv", { command: "x" }, ["search"]));
    expect(outcome).toMatchObject({ status: "published", toolNames: ["search"] });
    expect(Object.keys(manager.tools())).toEqual(["srv_search"]);
  });
});

describe("leases, draining, and exactly-once close", () => {
  it("an in-flight call stays on its captured generation while the next turn sees the replacement", async () => {
    const gate = deferredGate();
    const oldTransport = new AsyncCallTransport([ECHO_TOOL], async (msg) => {
      await gate.promise;
      return echoOk(msg);
    });
    const newTransport = new InMemoryTransport([ECHO_TOOL], echoOk);
    const transports = new Map<string, InMemoryTransport>([["srv", oldTransport]]);
    const manager = makeManager(transports);
    await manager.applyDesired(desiredOf("srv", { command: "old" }));

    const inFlight = call(manager, "srv_echo", "in-flight");
    await new Promise((resolve) => setImmediate(resolve));
    expect(manager.statuses().find((status) => status.serverId === "srv")).toMatchObject({ leaseCount: 1 });

    // Publish the replacement while the call is mid-flight.
    transports.set("srv", newTransport);
    const outcome = await manager.applyDesired(desiredOf("srv", { command: "new" }));
    expect(outcome).toMatchObject({ status: "published" });

    // The next turn sees the replacement's transport; the captured turn's closure still holds the OLD client.
    expect(await call(manager, "srv_echo", "new-generation")).toMatchObject({ content: [{ text: "echo: new-generation" }] });
    expect(oldTransport.closedCount).toBe(0); // lease held: draining generation stays open

    gate.release();
    expect(await inFlight).toMatchObject({ content: [{ text: "echo: in-flight" }] }); // settled on ITS generation
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(oldTransport.closedCount).toBe(1); // closed exactly once after the lease drained
    expect(newTransport.closedCount).toBe(0);
  });

  it("a retired generation refuses new leases fail-closed (never redirects to the replacement)", async () => {
    const oldTransport = new AsyncCallTransport([ECHO_TOOL], async (msg) => {
      await new Promise<void>(() => undefined); // never settles
      return echoOk(msg);
    });
    const newTransport = new InMemoryTransport([ECHO_TOOL], echoOk);
    const transports = new Map<string, InMemoryTransport>([["srv", oldTransport]]);
    const manager = makeManager(transports);
    await manager.applyDesired(desiredOf("srv", { command: "old" }));
    const capturedTurn = manager.tools();
    const hanging = call(manager, "srv_echo", "hangs").catch(() => undefined); // holds the lease forever (unit-only)

    transports.set("srv", newTransport);
    await manager.applyDesired(desiredOf("srv", { command: "new" }));

    // The captured turn's SAME key now fails closed on lease acquisition — it is not redirected.
    const stale = await capturedTurn.srv_echo?.execute?.({ text: "stale" }, { toolCallId: "c-stale", messages: [] } as never);
    expect(stale).toMatchObject({ ok: false, code: "MCP_STALE_GENERATION" });
    // The drain budget force-closed the stuck old generation exactly once.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(oldTransport.closedCount).toBe(1);
    void hanging;
  });

  it("disable blocks new leases immediately and closes the client exactly once after the drain", async () => {
    const gate = deferredGate();
    const transport = new AsyncCallTransport([ECHO_TOOL], async (msg) => {
      await gate.promise;
      return echoOk(msg);
    });
    const manager = makeManager(new Map([["srv", transport]]));
    await manager.applyDesired(desiredOf("srv", { command: "x" }));
    const inFlight = call(manager, "srv_echo", "during-disable");
    await new Promise((resolve) => setImmediate(resolve));

    manager.disableServer("srv");
    expect(Object.keys(manager.tools())).toEqual([]); // new leases blocked; the key is gone from new turns
    expect(manager.statuses().find((status) => status.serverId === "srv")).toMatchObject({ phase: "disabled" });

    gate.release();
    expect(await inFlight).toMatchObject({ content: [{ text: "echo: during-disable" }] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(transport.closedCount).toBe(1);
  });

  it("secretCleared retires exactly the servers referencing the cleared ref", async () => {
    const referenced = new InMemoryTransport([ECHO_TOOL], echoOk);
    const unrelated = new InMemoryTransport([ECHO_TOOL], echoOk);
    const manager = makeManager(new Map([["a", referenced], ["b", unrelated]]));
    await manager.applyDesired(desiredOf("a", { command: "x", env: { TOKEN: "secret-ref:mcp.a.env.TOKEN" } }));
    await manager.applyDesired(desiredOf("b", { command: "y" }));

    manager.secretCleared("mcp.a.env.TOKEN");
    expect(Object.keys(manager.tools())).toEqual(["b_echo"]); // only the referencing server retired
    expect(referenced.closedCount).toBe(1);
    expect(unrelated.closedCount).toBe(0);
    expect(manager.statuses()).toMatchObject([
      { serverId: "a", phase: "failed", lastOutcome: { status: "failed", reason: "secret-unresolvable" } },
      { serverId: "b", phase: "connected" },
    ]);
  });

  it("test is an ephemeral candidate: diagnostics only, never publishes, always closes", async () => {
    const live = new InMemoryTransport([ECHO_TOOL], echoOk);
    const probe = new InMemoryTransport([ECHO_TOOL, SEARCH_TOOL], echoOk);
    const transports = new Map<string, InMemoryTransport>([["srv", live], ["probe", probe]]);
    const manager = makeManager(transports);
    await manager.applyDesired(desiredOf("srv", { command: "live" }));

    const result = await manager.test({ serverId: "probe", config: { command: "probe" }, selectedTools: [] });
    expect(result).toMatchObject({ status: "ok", toolNames: ["echo", "search"], pages: 1 });
    expect(probe.closedCount).toBe(1); // the ephemeral candidate was closed, guaranteed
    expect(live.closedCount).toBe(0); // the live generation is untouched
    expect(Object.keys(manager.tools())).toEqual(["srv_echo"]); // a test NEVER publishes tools
    expect(manager.statuses().find((status) => status.serverId === "srv")?.runtimeGeneration).toBe(1);

    const failed = await manager.test({ serverId: "missing", config: { command: "missing" }, selectedTools: [] });
    expect(failed).toMatchObject({ status: "failed", reason: "connect-failed" });
    expect(Object.keys(manager.tools())).toEqual(["srv_echo"]); // still no publish from a failing test
  });

  it("shutdown: close drains under budget, force-closes the rest, and is idempotent", async () => {
    const gate = deferredGate();
    const held = new AsyncCallTransport([ECHO_TOOL], async (msg) => {
      await gate.promise;
      return echoOk(msg);
    });
    const idle = new InMemoryTransport([ECHO_TOOL], echoOk);
    const manager = makeManager(new Map([["held", held], ["idle", idle]]));
    await manager.reconcile([desiredOf("held", { command: "x" }), desiredOf("idle", { command: "y" })]);
    const inFlight = call(manager, "held_echo", "during-shutdown");
    await new Promise((resolve) => setImmediate(resolve));

    gate.release();
    await manager.close();
    await manager.close(); // idempotent
    expect(held.closedCount).toBe(1);
    expect(idle.closedCount).toBe(1);
    expect(await inFlight).toMatchObject({ content: [{ text: "echo: during-shutdown" }] });
    expect(manager.tools()).toEqual({}); // publication stopped
  });
});

describe("crash/restart reconcile (desired state only)", () => {
  it("a fresh manager rebuilds from desired state and never restores runtime generations as truth", async () => {
    const desiredServers = [desiredOf("srv", { command: "x" })];
    const firstTransport = new InMemoryTransport([ECHO_TOOL], echoOk);
    const first = makeManager(new Map([["srv", firstTransport]]));
    await first.reconcile(desiredServers);
    const firstGeneration = first.statuses().find((status) => status.serverId === "srv")?.runtimeGeneration;
    expect(firstGeneration).toBe(1);
    await first.close();

    // "Restart": a brand-new manager over the SAME desired state. Generation counters are process-local and
    // restart at 1 — nothing about the previous runtime (generations, outcomes, leases) was persisted or restored.
    const secondTransport = new InMemoryTransport([ECHO_TOOL], echoOk);
    const second = makeManager(new Map([["srv", secondTransport]]));
    await second.reconcile(desiredServers);
    const secondStatus = second.statuses().find((status) => status.serverId === "srv");
    expect(secondStatus).toMatchObject({ phase: "connected", lastOutcome: { status: "published" } });
    expect(secondStatus?.runtimeGeneration).toBe(1); // a fresh lineage, not restored truth
    expect(secondStatus?.leaseCount).toBe(0); // no lease survived the "crash"
  });

  it("a server withdrawn from desired state is drained at reconcile (crash-style desired-only rebuild)", async () => {
    const keep = new InMemoryTransport([ECHO_TOOL], echoOk);
    const drop = new InMemoryTransport([ECHO_TOOL], echoOk);
    const transports = new Map<string, InMemoryTransport>([["keep", keep], ["drop", drop]]);
    const manager = makeManager(transports);
    await manager.reconcile([desiredOf("keep", { command: "x" }), desiredOf("drop", { command: "y" })]);
    expect(Object.keys(manager.tools()).sort()).toEqual(["drop_echo", "keep_echo"]);

    // The second reconcile re-runs candidates for every enabled server (desired -> candidates -> publish), so
    // `keep` gets a fresh transport for its replacement generation; `drop` is withdrawn and drained.
    const keepReplacement = new InMemoryTransport([ECHO_TOOL], echoOk);
    transports.set("keep", keepReplacement);
    await manager.reconcile([desiredOf("keep", { command: "x" })]);
    expect(Object.keys(manager.tools())).toEqual(["keep_echo"]);
    expect(drop.closedCount).toBe(1); // withdrawn from desired: closed exactly once
    expect(keep.closedCount).toBe(1); // replaced by its own fresh candidate generation
    expect(keepReplacement.closedCount).toBe(0); // the live replacement stays open
  });
});
