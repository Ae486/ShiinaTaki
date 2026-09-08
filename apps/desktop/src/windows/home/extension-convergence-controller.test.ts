import { describe, expect, it, vi } from "vitest";
import type { ExtensionConvergenceResult } from "@taki/shared";
import { createExtensionConvergenceController, type ExtensionConvergenceState } from "./extension-convergence-controller.ts";

const HOST = "11111111-1111-4111-8111-111111111111";
const observation = () => ({ subscribeExtensions: async () => "supported" as const, onExtensionChanged: () => () => undefined });
function result(generation: number): ExtensionConvergenceResult {
  return {
    observedAt: "2026-08-18T00:00:00.000Z",
    coreHostId: HOST,
    hosts: [{ hostId: HOST, available: true, connectionGeneration: 1, catalogGeneration: generation, extensionCount: 0 }],
    entries: [],
    collisions: [],
  };
}

describe("extension convergence controller", () => {
  it("suppresses a retired client's late read and refreshes the replacement", async () => {
    let resolveOld!: (value: ExtensionConvergenceResult) => void;
    const oldRead = new Promise<ExtensionConvergenceResult>((resolve) => { resolveOld = resolve; });
    const states: ExtensionConvergenceState[] = [];
    const controller = createExtensionConvergenceController((state) => states.push(state));
    controller.replace({ ...observation(), extensionStatus: () => oldRead });
    await new Promise((accept) => setImmediate(accept));
    const fresh = { ...observation(), extensionStatus: vi.fn(async () => result(2)) };
    controller.replace(fresh);
    resolveOld(result(1));
    await controller.refresh();

    expect(fresh.extensionStatus).toHaveBeenCalled();
    expect(states.at(-1)).toEqual({ kind: "ready", data: result(2), observation: "live" });
    expect(states).not.toContainEqual({ kind: "ready", data: result(1), observation: "live" });
  });
});
