import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  JsonRpcErrorResponseSchema,
  JsonRpcSuccessResponseSchema,
  PerceptionCardSchema,
  PerceptionChangedSchema,
  PerceptionPauseStateSchema,
  PerceptionSubscribeResultSchema,
} from "@taki/shared";
import { expect, it } from "vitest";
import { pairOperator } from "./fixture/operator-drivers.ts";
import { openRpcSocket, type RpcSocket } from "./fixture/rpc-socket.ts";
import { withStack, type Stack } from "./fixture/with-stack.ts";

async function pairedObserver(stack: Stack, deviceName: string): Promise<RpcSocket> {
  const socket = await openRpcSocket(stack.wsUrl);
  try {
    await pairOperator(socket, {
      deviceId: randomUUID(), deviceName,
      getCode: async () => String((await stack.waitForCoreLog(
        (entry) => entry.msg === "pairing code issued" && entry.deviceName === deviceName,
      )).code),
    });
    return socket;
  } catch (error) {
    socket.close();
    throw error;
  }
}

function changes(socket: RpcSocket) {
  return socket.notifications().filter((note) => note.method === "perception.changed")
    .map((note) => PerceptionChangedSchema.parse(note.params));
}

async function subscribe(socket: RpcSocket): Promise<void> {
  const frame = await socket.request("perception.subscribe", {});
  expect(PerceptionSubscribeResultSchema.parse(JsonRpcSuccessResponseSchema.parse(frame).result)).toEqual({ status: "ok" });
}

async function card(socket: RpcSocket) {
  return PerceptionCardSchema.parse(JsonRpcSuccessResponseSchema.parse(await socket.request("perception.card", {})).result);
}

it("delivers real pause and absolute-expiry invalidations to subscribed operators without sensing or content frames", async () => {
  let dataDirectory = "";
  await withStack({ provider: "dummy", startNode: false, secretMasterKey: true }, async (stack) => {
    dataDirectory = stack.coreDataDir;
    expect(dirname(resolve(dataDirectory))).toBe(resolve(tmpdir()));
    expect(stack.node()).toBeNull();
    const actor = await stack.operator();
    const observer = await pairedObserver(stack, "refresh-perception-observer");
    const uninvolved = await pairedObserver(stack, "refresh-perception-unsubscribed");
    const anonymous = await openRpcSocket(stack.wsUrl);
    try {
      const refused = JsonRpcErrorResponseSchema.parse(await anonymous.request("perception.subscribe", {}));
      expect(refused.error.data).toMatchObject({ code: "NOT_AUTHENTICATED" });
      await subscribe(actor);
      await subscribe(observer);
      await subscribe(observer); // A lost acknowledgement retry must leave one server-side sink.
      expect((await card(observer)).pauseState).toEqual({ paused: false, until: null });

      const pause = PerceptionPauseStateSchema.parse(JsonRpcSuccessResponseSchema.parse(
        await actor.request("perception.pauseSet", { paused: true }),
      ).result);
      expect(pause).toEqual({ paused: true, until: null });
      await observer.waitForNotification((note) => note.method === "perception.changed");
      expect(changes(observer)).toHaveLength(1);
      expect(changes(actor)).toHaveLength(1);
      const firstChange = PerceptionChangedSchema.parse(changes(observer)[0]);
      expect(Object.keys(firstChange)).toEqual(["revision"]);
      expect((await card(observer)).pauseState).toEqual(pause);
      expect(changes(uninvolved)).toEqual([]);

      // Repeating a durable pause and ordinary card reads do not invent new projection facts.
      await actor.request("perception.pauseSet", { paused: true });
      await card(observer);
      expect(changes(observer)).toHaveLength(1);

      const until = Date.now() + 1_000;
      await actor.request("perception.pauseSet", { paused: true, until });
      const replacement = await observer.waitForNotification((note) => note.method === "perception.changed"
        && PerceptionChangedSchema.parse(note.params).revision > firstChange.revision);
      const beforeExpiry = PerceptionChangedSchema.parse(replacement.params).revision;
      expect((await card(observer)).pauseState).toEqual({ paused: true, until });
      const expiry = await observer.waitForNotification((note) => note.method === "perception.changed"
        && PerceptionChangedSchema.parse(note.params).revision > beforeExpiry, 5_000);
      expect(PerceptionChangedSchema.parse(expiry.params).revision).toBeGreaterThan(beforeExpiry);
      const settled = await card(observer);
      expect(settled.pauseState).toEqual({ paused: false, until: null });
      expect(settled.current).toBeNull();
      expect(settled.recent).toEqual([]);
      expect(changes(observer)).toHaveLength(3);
      expect(changes(uninvolved)).toEqual([]);

      // No capture Host is running and no chat/model request was made. The deadline notification must come from
      // the existing Core projection, not a UI query loop or a newly enabled sampling path.
      const count = changes(observer).length;
      await card(actor);
      await card(observer);
      expect(changes(observer)).toHaveLength(count);
      for (const changed of changes(observer)) expect(Object.keys(changed)).toEqual(["revision"]);
    } finally {
      anonymous.close();
      observer.close();
      uninvolved.close();
    }
  });
  expect(existsSync(dataDirectory)).toBe(false);
});
