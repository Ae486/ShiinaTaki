import { describe, expect, it } from "vitest";
import { EXTENSION_DISCOVERY_BUDGET } from "@taki/shared";
import { extensionStatusMethod } from "./extension-status.ts";

const HOST = "11111111-1111-4111-8111-111111111111";

describe("extension.status", () => {
  it("projects only bounded convergence facts for operators", async () => {
    const method = extensionStatusMethod({
      coreHostId: HOST,
      now: () => "2026-08-18T00:00:00.000Z",
      snapshot: () => ({
        runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        primaryHostId: HOST,
        hosts: [{ hostId: HOST, available: true, connectionGeneration: 1, catalogGeneration: 2, extensionCount: 0 }],
        entries: [],
        collisions: [],
        budget: EXTENSION_DISCOVERY_BUDGET,
      }),
    });

    expect(method.roles).toEqual(["operator"]);
    expect(await method.handler({}, {} as never)).toEqual({
      observedAt: "2026-08-18T00:00:00.000Z",
      coreHostId: HOST,
      hosts: [{ hostId: HOST, available: true, connectionGeneration: 1, catalogGeneration: 2, extensionCount: 0 }],
      entries: [],
      collisions: [],
    });
  });
});
