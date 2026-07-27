import { describe, expect, it } from "vitest";
import { PERCEPTION_METHODS, PerceptionCardSchema, type PerceptionCard } from "@taki/shared";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { perceptionCardMethod } from "./perception-card.ts";

const CARD: PerceptionCard = {
  current: {
    processName: "Code.exe",
    windowTitle: "main.ts",
    startedAt: 1_700_000_000_000,
    durationMs: 60_000,
    samples: 3,
    idle: false,
  },
  recent: [],
  samplingStatus: { foreground: true, ambientScreen: false },
  pauseState: { paused: false, until: null },
};

function ctx(role: "operator" | "node" = "operator"): MethodContext {
  const connection: Connection = { state: { status: "authenticated", deviceId: "d1", role, capabilities: [] } };
  return { notify: () => undefined, connection, close: () => undefined, onClose: () => undefined };
}

describe("perceptionCardMethod (T3b)", () => {
  it("is operator-only and named perception.card", () => {
    const def = perceptionCardMethod(() => CARD);
    expect(def.method).toBe(PERCEPTION_METHODS.card);
    expect(def.roles).toEqual(["operator"]);
  });

  it("serves a schema-valid snapshot read at call time", () => {
    const seen: number[] = [];
    const result = perceptionCardMethod((now) => {
      seen.push(now);
      return CARD;
    }).handler({}, ctx());
    expect(result).toEqual(CARD);
    expect(PerceptionCardSchema.safeParse(result).success).toBe(true);
    expect(seen).toHaveLength(1); // the clock is read per request, never cached at registration
  });

  it("REFUSES a node-role caller: the activity card is the human's surface", async () => {
    const registry = createMethodRegistry();
    registry.register(perceptionCardMethod(() => CARD));
    const response = await registry.dispatch(
      { jsonrpc: "2.0", id: 1, method: PERCEPTION_METHODS.card, params: {} },
      ctx("node"),
    );
    expect(response).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
  });
});
