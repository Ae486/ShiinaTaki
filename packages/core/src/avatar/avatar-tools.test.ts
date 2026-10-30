import { describe, expect, it } from "vitest";
import type { AvatarCommand } from "@taki/shared";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { createAvatarOutcomes } from "./avatar-outcomes.ts";
import type { AvatarSubscriptions } from "./avatar-subscriptions.ts";
import { createAvatarTools } from "./avatar-tools.ts";

const CONN = { id: "pet" };

interface Harness {
  tools: ReturnType<typeof createAvatarTools>;
  published: AvatarCommand[];
  outcomes: ReturnType<typeof createAvatarOutcomes>;
  fire(): void;
}

function harness(characterId: string, subscribers: number, publishThrows = false): Harness {
  const { logger } = createCaptureLogger();
  const published: AvatarCommand[] = [];
  const timers: Array<() => void> = [];
  const subscriptions: AvatarSubscriptions = {
    generation: () => 1,
    subscribe: () => undefined,
    unsubscribe: () => undefined,
    publish: (command) => {
      if (publishThrows) throw new Error("publish failed");
      published.push(command);
    },
    count: () => subscribers,
    isSubscribed: () => subscribers > 0,
  };
  const outcomes = createAvatarOutcomes({
    deadlineMs: () => 1000,
    setTimer: (fn) => { timers.push(fn); return { clear: () => undefined }; },
  });
  return {
    tools: createAvatarTools({ subscriptions, outcomes, characterId, logger }),
    published,
    outcomes,
    fire: () => { for (const fn of timers.splice(0)) fn(); },
  };
}

const opts = (signal?: AbortSignal) => ({ toolCallId: "c1", messages: [], abortSignal: signal }) as never;

describe("createAvatarTools", () => {
  it("exposes both avatar tools under provider-safe (underscore) names", () => {
    expect(Object.keys(harness("taki", 0).tools).sort()).toEqual(["avatar_play_motion", "avatar_set_expression"]);
  });

  it("returns not_rendered instantly when no Pet UI is subscribed, still publishing with a commandId", async () => {
    const h = harness("taki", 0);
    const result = await h.tools.avatar_set_expression?.execute?.({ name: "shame01" }, opts());
    expect(result).toEqual({ ok: true, outcome: "not_rendered" });
    expect(h.published).toHaveLength(1);
    expect(h.published[0]).toMatchObject({ characterId: "taki", kind: "expression", name: "shame01" });
    expect(h.published[0]?.commandId).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.outcomes.size()).toBe(0);
  });

  it("avatar_play_motion passes priority + loop through and awaits an applied report", async () => {
    const h = harness("taki", 1);
    const pending = h.tools.avatar_play_motion?.execute?.({ name: "angry01", priority: "force", loop: true }, opts());
    const command = h.published[0];
    expect(command).toMatchObject({ characterId: "taki", kind: "motion", name: "angry01", priority: "force", loop: true });
    h.outcomes.report(command!.commandId, { connection: CONN, outcome: "applied" });
    expect(await pending).toEqual({ ok: true, outcome: "applied" });
  });

  it("maps a rejection to AVATAR_REJECTED with its reason", async () => {
    const h = harness("taki", 1);
    const pending = h.tools.avatar_play_motion?.execute?.({ name: "thinking01" }, opts());
    expect(h.published[0]).toMatchObject({ kind: "motion", name: "thinking01" });
    h.outcomes.report(h.published[0]!.commandId, { connection: CONN, outcome: "rejected", reason: "motion_busy" });
    expect(await pending).toEqual({ ok: false, outcome: "rejected", code: "AVATAR_REJECTED", reason: "motion_busy" });
  });

  it("maps superseded to a cancelled result and the deadline to outcome_unknown", async () => {
    const h = harness("taki", 1);
    const superseded = h.tools.avatar_set_expression?.execute?.({ name: "a" }, opts());
    h.outcomes.report(h.published[0]!.commandId, { connection: CONN, outcome: "superseded" });
    expect(await superseded).toEqual({ ok: false, outcome: "superseded", code: "CANCELLED", state: "cancelled" });

    const silent = h.tools.avatar_set_expression?.execute?.({ name: "b" }, opts());
    h.fire();
    expect(await silent).toEqual({ ok: false, outcome: "unknown", code: "OUTCOME_UNKNOWN", state: "outcome_unknown" });
  });

  it("resolves unknown immediately when the turn aborts", async () => {
    const h = harness("taki", 1);
    const controller = new AbortController();
    const pending = h.tools.avatar_set_expression?.execute?.({ name: "a" }, opts(controller.signal));
    controller.abort("turn cancelled by operator");
    expect(await pending).toMatchObject({ ok: false, outcome: "unknown" });
  });

  it("degrades a publish failure to INTERNAL_ERROR without throwing", async () => {
    const h = harness("taki", 1, true);
    expect(await h.tools.avatar_set_expression?.execute?.({ name: "a" }, opts())).toEqual({
      ok: false, code: "INTERNAL_ERROR", message: "publish failed",
    });
  });

  it("binds the publish to the characterId given at construction (invariant 7)", async () => {
    const h = harness("other", 0);
    await h.tools.avatar_set_expression?.execute?.({ name: "default" }, opts());
    expect(h.published[0]?.characterId).toBe("other");
  });

  it("describes the outcomes so a busy rejection is neither retried nor apologized for", () => {
    const h = harness("taki", 0);
    for (const name of ["avatar_set_expression", "avatar_play_motion"] as const) {
      const description = h.tools[name]?.description ?? "";
      expect(description).toMatch(/do NOT retry/);
      expect(description).toMatch(/not_rendered/);
      expect(description).not.toMatch(/no result to read/);
    }
  });
});
