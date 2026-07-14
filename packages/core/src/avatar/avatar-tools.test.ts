import { describe, expect, it } from "vitest";
import type { AvatarCommand } from "@taki/shared";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import type { AvatarSubscriptions } from "./avatar-subscriptions.ts";
import { createAvatarTools } from "./avatar-tools.ts";

const EXEC_OPTS = { toolCallId: "c1", messages: [] } as never;

function capturing(): { subscriptions: AvatarSubscriptions; published: AvatarCommand[] } {
  const published: AvatarCommand[] = [];
  const subscriptions: AvatarSubscriptions = {
    subscribe: () => undefined,
    unsubscribe: () => undefined,
    publish: (command) => published.push(command),
    count: () => 0,
  };
  return { subscriptions, published };
}

function toolsFor(characterId: string): { tools: ReturnType<typeof createAvatarTools>; published: AvatarCommand[] } {
  const { logger } = createCaptureLogger();
  const { subscriptions, published } = capturing();
  return { tools: createAvatarTools({ subscriptions, characterId, logger }), published };
}

describe("createAvatarTools", () => {
  it("exposes both avatar tools under provider-safe (underscore) names", () => {
    const { tools } = toolsFor("taki");
    expect(Object.keys(tools).sort()).toEqual(["avatar_play_motion", "avatar_set_expression"]);
  });

  it("avatar_set_expression publishes an expression command bound to the turn's characterId and acks { ok:true }", async () => {
    const { tools, published } = toolsFor("taki");
    expect(await tools.avatar_set_expression?.execute?.({ name: "shame01" }, EXEC_OPTS)).toEqual({ ok: true });
    expect(published).toEqual([{ characterId: "taki", kind: "expression", name: "shame01" }]);
  });

  it("avatar_play_motion publishes a motion command, passing priority + loop through", async () => {
    const { tools, published } = toolsFor("taki");
    expect(
      await tools.avatar_play_motion?.execute?.({ name: "angry01", priority: "force", loop: true }, EXEC_OPTS),
    ).toEqual({ ok: true });
    expect(published).toEqual([{ characterId: "taki", kind: "motion", name: "angry01", priority: "force", loop: true }]);
  });

  it("avatar_play_motion works without the optional knobs (a plain one-shot motion)", async () => {
    const { tools, published } = toolsFor("taki");
    await tools.avatar_play_motion?.execute?.({ name: "thinking01" }, EXEC_OPTS);
    expect(published).toEqual([{ characterId: "taki", kind: "motion", name: "thinking01" }]);
  });

  it("binds the publish to the characterId given at construction (invariant 7)", async () => {
    const { tools, published } = toolsFor("other");
    await tools.avatar_set_expression?.execute?.({ name: "default" }, EXEC_OPTS);
    expect(published[0]?.characterId).toBe("other");
  });
});
