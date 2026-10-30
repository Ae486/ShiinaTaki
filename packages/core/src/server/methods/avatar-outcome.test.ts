import { describe, expect, it } from "vitest";
import { JSONRPCErrorException } from "json-rpc-2.0";
import { AVATAR_METHODS, JSON_RPC_APP_ERROR } from "@taki/shared";
import { createAvatarOutcomes } from "../../avatar/avatar-outcomes.ts";
import { createAvatarSubscriptions } from "../../avatar/avatar-subscriptions.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import type { Connection } from "../connection-registry.ts";
import type { MethodContext } from "../method-registry.ts";
import { avatarOutcomeMethod } from "./avatar-outcome.ts";

function ctx(): MethodContext {
  const connection: Connection = {
    state: { status: "authenticated", deviceId: "d1", role: "operator", capabilities: [] },
  };
  return { notify: () => undefined, connection, close: () => undefined, onClose: () => undefined };
}

function fixture() {
  const subscriptions = createAvatarSubscriptions();
  const outcomes = createAvatarOutcomes({ deadlineMs: () => 1000, setTimer: () => ({ clear: () => undefined }) });
  const capture = createCaptureLogger();
  return { subscriptions, outcomes, capture, def: avatarOutcomeMethod({ subscriptions, outcomes, logger: capture.logger }) };
}

describe("avatarOutcomeMethod", () => {
  it("is operator-only and named avatar.outcome", () => {
    const { def } = fixture();
    expect(def.method).toBe(AVATAR_METHODS.outcome);
    expect(def.roles).toEqual(["operator"]);
  });

  it("refuses with a FORBIDDEN app error when the connection is not subscribed to the character", () => {
    const { def } = fixture();
    let thrown: unknown = null;
    try {
      def.handler({ characterId: "taki", commandId: "c1", outcome: "applied" }, ctx());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(JSONRPCErrorException);
    expect((thrown as JSONRPCErrorException).code).toBe(JSON_RPC_APP_ERROR);
    expect(((thrown as JSONRPCErrorException).data as { code: string }).code).toBe("FORBIDDEN");
  });

  it("settles the pending wait from a subscribed connection with the reported outcome + reason", async () => {
    const { def, subscriptions, outcomes } = fixture();
    const context = ctx();
    subscriptions.subscribe("taki", context.connection, () => undefined);
    const wait = outcomes.open({ commandId: "c1", subscribers: 1 });

    expect(def.handler({ characterId: "taki", commandId: "c1", outcome: "rejected", reason: "motion_busy" }, context)).toEqual({ status: "ok" });
    await expect(wait).resolves.toEqual({ outcome: "rejected", reason: "motion_busy" });
  });

  it("returns ok for a late or unknown command and only logs at debug", async () => {
    const { def, subscriptions, outcomes, capture } = fixture();
    const context = ctx();
    subscriptions.subscribe("taki", context.connection, () => undefined);
    const wait = outcomes.open({ commandId: "c1", subscribers: 1 });
    def.handler({ characterId: "taki", commandId: "c1", outcome: "applied" }, context);
    await wait;

    expect(def.handler({ characterId: "taki", commandId: "c1", outcome: "superseded" }, context)).toEqual({ status: "ok" });
    expect(def.handler({ characterId: "taki", commandId: "ghost", outcome: "applied" }, context)).toEqual({ status: "ok" });
    expect(capture.records.map((record) => [record.level, (record.obj as { status: string }).status])).toEqual([
      ["debug", "late"],
      ["debug", "unknown_command"],
    ]);
  });
});
