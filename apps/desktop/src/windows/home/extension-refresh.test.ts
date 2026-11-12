import { describe, expect, it, vi } from "vitest";
import { EXTENSION_METHODS, MCP_METHODS, SKILL_METHODS, type ExtensionChanged, type ExtensionConvergenceResult } from "@taki/shared";
import { createWsClient } from "@/lib/ws-client.js";
import type { WsTransport } from "@/lib/ws-transport.js";
import { createMcpController } from "./pages/mcp/mcp-controller.ts";
import { createSkillsController } from "./pages/skills/skills-controller.ts";
import { createExtensionResource } from "./extension-convergence-resource.ts";

const DATA: ExtensionConvergenceResult = { observedAt: "2026-09-08T00:00:00.000Z", coreHostId: "11111111-1111-4111-8111-111111111111", hosts: [], entries: [], collisions: [] };
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const sent: Array<{ id: number; method: string; params: unknown }> = [];
  const handlers: Array<(frame: string) => void> = [];
  const transport: WsTransport = {
    send: (frame) => { sent.push(JSON.parse(frame)); }, close: () => undefined,
    onMessage: (handler) => { handlers.push(handler); }, onOpen: () => undefined, onClose: () => undefined,
  };
  const deliver = (frame: unknown) => { for (const handler of handlers) handler(JSON.stringify(frame)); };
  return {
    client: createWsClient({ transport }), sent,
    count: (method: string) => sent.filter((frame) => frame.method === method).length,
    result: (method: string, result: unknown) => deliver({ jsonrpc: "2.0", id: sent.findLast((frame) => frame.method === method)?.id, result }),
    change: (event: ExtensionChanged) => deliver({ jsonrpc: "2.0", method: EXTENSION_METHODS.changed, params: event }),
  };
}

describe("shared extension membership and targeted visible projections", () => {
  it("shares one physical subscription, gates baselines and reuses covered hidden snapshots without cross-target reads", async () => {
    const f = fixture();
    const mcpSink = { loading: vi.fn(), loaded: vi.fn(), loadFailed: vi.fn(), mutationStarted: vi.fn(), mutationFailed: vi.fn() };
    const skillsSink = vi.fn();
    const stripSink = vi.fn();
    const mcp = createMcpController(mcpSink);
    const skills = createSkillsController(skillsSink);
    const strip = createExtensionResource(f.client);
    mcp.setVisible(false);
    mcp.replace(f.client);
    skills.bind(f.client);
    const stop = strip.observe(stripSink);
    strip.setVisible(stripSink, true);
    expect(f.count(EXTENSION_METHODS.subscribe)).toBe(1);
    expect(f.sent).toHaveLength(1);
    f.change({ revision: 1, targets: ["mcp", "skills", "extension-status"] });
    f.result(EXTENSION_METHODS.subscribe, { status: "ok" });
    await flush();
    expect(f.count(SKILL_METHODS.list)).toBe(1);
    expect(f.count(EXTENSION_METHODS.status)).toBe(1);
    expect(f.count(MCP_METHODS.list)).toBe(0);
    f.result(SKILL_METHODS.list, { packages: [], catalogGeneration: 1 });
    f.result(EXTENSION_METHODS.status, DATA);
    await flush();

    skills.setVisible(false);
    strip.setVisible(stripSink, false);
    mcp.setVisible(true);
    await flush();
    expect(f.count(MCP_METHODS.list)).toBe(1);
    f.result(MCP_METHODS.list, { servers: [] });
    await flush();
    const hiddenSkills = skillsSink.mock.calls.length;
    const hiddenStrip = stripSink.mock.calls.length;
    f.change({ revision: 2, targets: ["skills"] });
    f.change({ revision: 2, targets: ["skills"] });
    await flush();
    expect(f.count(SKILL_METHODS.list)).toBe(1);
    expect(f.count(EXTENSION_METHODS.status)).toBe(1);
    expect(f.count(MCP_METHODS.list)).toBe(1);
    expect(skillsSink).toHaveBeenCalledTimes(hiddenSkills);
    expect(stripSink).toHaveBeenCalledTimes(hiddenStrip);
    mcp.setVisible(false);
    mcp.setVisible(true);
    strip.setVisible(stripSink, true);
    await strip.invalidateLegacy();
    expect(f.count(MCP_METHODS.list)).toBe(1);
    expect(f.count(EXTENSION_METHODS.status)).toBe(1);
    skills.setVisible(true);
    expect(f.count(SKILL_METHODS.list)).toBe(2);
    f.result(SKILL_METHODS.list, { packages: [], catalogGeneration: 2 });
    await flush();
    expect(f.count(EXTENSION_METHODS.subscribe)).toBe(1);
    stop();
    mcp.dispose();
    skills.bind(null);
    f.client.close();
  });
});
