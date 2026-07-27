import { describe, expect, it } from "vitest";
import { PERCEPTION_METHODS, PerceptionPauseStateSchema } from "@taki/shared";
import { createPrivacyPause } from "../../perception/privacy-pause.ts";
import type { Connection } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { perceptionPauseGetMethod } from "./perception-pause-get.ts";
import { perceptionPauseSetMethod } from "./perception-pause-set.ts";

function ctx(role: "operator" | "node" = "operator"): MethodContext {
  const connection: Connection = { state: { status: "authenticated", deviceId: "d1", role, capabilities: [] } };
  return { notify: () => undefined, connection, close: () => undefined, onClose: () => undefined };
}

describe("perception pause methods (T3b)", () => {
  it("are operator-only and named perception.pauseGet / perception.pauseSet", () => {
    const pause = createPrivacyPause();
    expect(perceptionPauseGetMethod(pause).method).toBe(PERCEPTION_METHODS.pauseGet);
    expect(perceptionPauseGetMethod(pause).roles).toEqual(["operator"]);
    expect(perceptionPauseSetMethod(pause).method).toBe(PERCEPTION_METHODS.pauseSet);
    expect(perceptionPauseSetMethod(pause).roles).toEqual(["operator"]);
  });

  it("pauses until resumed, pauses until a deadline, and resumes — echoing a schema-valid snapshot each time", () => {
    let clock = 1_000;
    const pause = createPrivacyPause({ now: () => clock });
    const set = perceptionPauseSetMethod(pause);
    const get = perceptionPauseGetMethod(pause);

    expect(set.handler({ paused: true }, ctx())).toEqual({ paused: true, until: null });
    expect(pause.isPaused()).toBe(true);
    expect(get.handler({}, ctx())).toEqual({ paused: true, until: null });

    expect(set.handler({ paused: true, until: 5_000 }, ctx())).toEqual({ paused: true, until: 5_000 });
    // Last call wins: switching shapes replaces the pause instead of stacking two of them.
    expect(set.handler({ paused: false }, ctx())).toEqual({ paused: false, until: null });
    expect(pause.isPaused()).toBe(false);

    set.handler({ paused: true, until: 2_000 }, ctx());
    clock = 2_000; // the deadline lapses: the read self-resumes rather than needing a timer
    const snapshot = get.handler({}, ctx());
    expect(snapshot).toEqual({ paused: false, until: null });
    expect(PerceptionPauseStateSchema.safeParse(snapshot).success).toBe(true);
  });

  it("treats an explicit null deadline as pause-until-resumed", () => {
    const pause = createPrivacyPause();
    expect(perceptionPauseSetMethod(pause).handler({ paused: true, until: null }, ctx())).toEqual({
      paused: true,
      until: null,
    });
  });

  it("REFUSES a node-role caller: nothing but the operator may change what the core observes", async () => {
    const pause = createPrivacyPause();
    const registry = createMethodRegistry();
    registry.register(perceptionPauseSetMethod(pause));
    pause.pauseUntilResumed();

    const response = await registry.dispatch(
      { jsonrpc: "2.0", id: 1, method: PERCEPTION_METHODS.pauseSet, params: { paused: false } },
      ctx("node"),
    );
    expect(response).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
    expect(pause.isPaused()).toBe(true); // the refused call changed nothing
  });

  it("rejects a malformed set before the handler can touch the pause", async () => {
    const pause = createPrivacyPause();
    const registry = createMethodRegistry();
    registry.register(perceptionPauseSetMethod(pause));

    for (const params of [{ paused: false, until: 42 }, { paused: true, until: -1 }, { until: 42 }]) {
      const response = await registry.dispatch(
        { jsonrpc: "2.0", id: 1, method: PERCEPTION_METHODS.pauseSet, params },
        ctx(),
      );
      expect("error" in response).toBe(true);
    }
    expect(pause.isPaused()).toBe(false);
  });
});
