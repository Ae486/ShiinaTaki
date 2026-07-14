import { describe, expect, it } from "vitest";
import { AVATAR_METHODS } from "@taki/shared";
import { createAvatarSubscriptions } from "../../avatar/avatar-subscriptions.ts";
import type { Connection } from "../connection-registry.ts";
import type { MethodContext } from "../method-registry.ts";
import { avatarSubscribeMethod } from "./avatar-subscribe.ts";

interface FakeCtx extends MethodContext {
  notified: Array<{ method: string; params: unknown }>;
  fireClose(): void;
}
function fakeCtx(): FakeCtx {
  const notified: Array<{ method: string; params: unknown }> = [];
  let onCloseCb: (() => void) | undefined;
  const connection: Connection = {
    state: { status: "authenticated", deviceId: "d1", role: "operator", capabilities: [] },
  };
  return {
    notify: (method, params) => notified.push({ method, params }),
    connection,
    close: () => undefined,
    onClose: (cb) => {
      onCloseCb = cb;
    },
    notified,
    fireClose: () => onCloseCb?.(),
  };
}

describe("avatarSubscribeMethod", () => {
  it("is operator-only and named avatar.subscribe", () => {
    const def = avatarSubscribeMethod(createAvatarSubscriptions());
    expect(def.method).toBe(AVATAR_METHODS.subscribe);
    expect(def.roles).toEqual(["operator"]);
  });

  it("forwards published commands to the socket as avatar.command notifications", () => {
    const subs = createAvatarSubscriptions();
    const ctx = fakeCtx();

    expect(avatarSubscribeMethod(subs).handler({ characterId: "taki" }, ctx)).toEqual({ status: "ok" });
    subs.publish({ characterId: "taki", kind: "expression", name: "smile01" });

    expect(ctx.notified).toEqual([
      { method: AVATAR_METHODS.command, params: { characterId: "taki", kind: "expression", name: "smile01" } },
    ]);
  });

  it("auto-unsubscribes on socket close (ctx.onClose) so later commands are not delivered", () => {
    const subs = createAvatarSubscriptions();
    const ctx = fakeCtx();
    avatarSubscribeMethod(subs).handler({ characterId: "taki" }, ctx);

    ctx.fireClose();
    subs.publish({ characterId: "taki", kind: "expression", name: "smile01" });

    expect(ctx.notified).toHaveLength(0);
    expect(subs.count("taki")).toBe(0);
  });
});
