import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  ExtensionChangedSchema,
  ExtensionConvergenceResultSchema,
  ExtensionSubscribeResultSchema,
  JsonRpcSuccessResponseSchema,
  McpListResultSchema,
  McpMutationResultSchema,
  SkillInspectResultSchema,
  SkillListResultSchema,
  SkillMutationResultSchema,
  type SkillImportSource,
} from "@taki/shared";
import { expect, it } from "vitest";
import { pairOperator } from "./fixture/operator-drivers.ts";
import { CORE_DIR } from "./fixture/paths.ts";
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

async function result(socket: RpcSocket, method: string, params: unknown = {}) {
  return JsonRpcSuccessResponseSchema.parse(await socket.request(method, params)).result;
}

function changes(socket: RpcSocket) {
  return socket.notifications().filter((note) => note.method === "extension.changed")
    .map((note) => ExtensionChangedSchema.parse(note.params));
}

function directorySource(valid: boolean): SkillImportSource {
  const text = valid
    ? "---\nname: refresh-check\ndescription: Synthetic refresh observer proof\n---\nA private fixture body that never belongs in a notification."
    : "Rejected synthetic document without a Skill manifest.";
  return { kind: "directory", files: [{
    path: valid ? "refresh-check/SKILL.md" : "rejected/README.md",
    contentBase64: Buffer.from(text).toString("base64"),
  }] };
}

it("refreshes a second operator from actual MCP and Skill commits while keeping hints targeted and opt-in", async () => {
  let dataDirectory = "";
  await withStack({ provider: "dummy", startNode: false, secretMasterKey: true }, async (stack) => {
    dataDirectory = stack.coreDataDir;
    expect(dirname(resolve(dataDirectory))).toBe(resolve(tmpdir()));
    const actor = await stack.operator();
    const observer = await pairedObserver(stack, "refresh-extension-observer");
    const uninvolved = await pairedObserver(stack, "refresh-extension-unsubscribed");
    try {
      for (const socket of [actor, observer, observer]) {
        expect(ExtensionSubscribeResultSchema.parse(await result(socket, "extension.subscribe"))).toEqual({ status: "ok" });
      }
      const initial = SkillListResultSchema.parse(await result(observer, "skill.list"));
      expect(McpListResultSchema.parse(await result(observer, "mcp.list")).servers).toEqual([]);
      const initialConvergence = ExtensionConvergenceResultSchema.parse(await result(observer, "extension.status"));

      const serverId = "refresh-private-server";
      const added = McpMutationResultSchema.parse(await result(actor, "mcp.add", {
        serverId, enabled: false,
        config: { command: process.execPath, args: [join(CORE_DIR, "src/testing/mcp-fixture.mjs")] },
      }));
      // Disabled desired adds have no manager generation yet; the existing untracked runtime projection is
      // disconnected. The enabled flag, no generation and no tools prove that this did not connect/probe.
      expect(added.server.enabled).toBe(false);
      expect(added.server.status).toMatchObject({ phase: "disconnected", runtimeGeneration: null, toolCount: 0 });
      await observer.waitForNotification((note) => note.method === "extension.changed");
      expect(changes(observer)).toHaveLength(1);
      expect(changes(observer)[0]?.targets).toEqual(["mcp"]);
      expect(McpListResultSchema.parse(await result(observer, "mcp.list")).servers).toHaveLength(1);
      const disabledConvergence = ExtensionConvergenceResultSchema.parse(await result(observer, "extension.status"));
      expect(disabledConvergence.entries).toEqual(initialConvergence.entries);

      // A rejected import is durable operator list state even though the runtime catalog did not advance.
      let previousRevision = changes(observer).at(-1)!.revision;
      const rejected = SkillMutationResultSchema.parse(await result(actor, "skill.import", { source: directorySource(false) }));
      expect(rejected.package.lifecycleState).toBe("rejected");
      const rejectionNotice = await observer.waitForNotification((note) => note.method === "extension.changed"
        && ExtensionChangedSchema.parse(note.params).revision > previousRevision);
      expect(ExtensionChangedSchema.parse(rejectionNotice.params).targets).toEqual(["skills"]);
      const rejectedList = SkillListResultSchema.parse(await result(observer, "skill.list"));
      expect(rejectedList.catalogGeneration).toBe(initial.catalogGeneration);
      expect(rejectedList.packages).toHaveLength(1);

      previousRevision = changes(observer).at(-1)!.revision;
      const imported = SkillMutationResultSchema.parse(await result(actor, "skill.import", { source: directorySource(true) }));
      expect(imported.package.runtimeState).toBe("available");
      await observer.waitForNotification((note) => note.method === "extension.changed"
        && ExtensionChangedSchema.parse(note.params).revision > previousRevision
        && ExtensionChangedSchema.parse(note.params).targets.includes("extension-status"));
      const publishedChanges = changes(observer).filter((change) => change.revision > previousRevision);
      expect(new Set(publishedChanges.flatMap((change) => change.targets))).toEqual(new Set(["skills", "extension-status"]));
      const list = SkillListResultSchema.parse(await result(observer, "skill.list"));
      expect(list.packages.find((row) => row.packageId === imported.package.packageId)?.runtimeState).toBe("available");

      // Real stdio SDK setup runs only because the actor explicitly enabled this synthetic server. Its candidate
      // and publication hooks must both reach the observer; no provider account or operating-system tool runs.
      previousRevision = changes(observer).at(-1)!.revision;
      const enabled = McpMutationResultSchema.parse(await result(actor, "mcp.enable", {
        serverId, expectedConfigRevision: added.server.configRevision,
      }));
      expect(enabled.server.status.phase).toBe("connected");
      await observer.waitForNotification((note) => note.method === "extension.changed"
        && ExtensionChangedSchema.parse(note.params).revision > previousRevision
        && ExtensionChangedSchema.parse(note.params).targets.includes("extension-status"));
      const refreshed = McpListResultSchema.parse(await result(observer, "mcp.list"));
      expect(refreshed.servers[0]?.status.toolCount).toBe(1);

      const count = changes(observer).length;
      const inspected = SkillInspectResultSchema.parse(await result(observer, "skill.inspect", { packageId: imported.package.packageId }));
      expect(inspected.files).toEqual(["SKILL.md"]);
      await result(observer, "mcp.list");
      await result(observer, "extension.status");
      expect(changes(observer)).toHaveLength(count);
      expect(changes(uninvolved)).toEqual([]);
      const events = changes(observer);
      expect(new Set(events.map((event) => event.revision)).size).toBe(events.length);
      expect(events.map((event) => event.revision)).toEqual(events.map((event) => event.revision).toSorted((a, b) => a - b));
      for (const event of events) expect(Object.keys(event).toSorted()).toEqual(["revision", "targets"]);
      const serialized = JSON.stringify(events);
      expect(serialized).not.toContain(serverId);
      expect(serialized).not.toContain(imported.package.packageId);
      expect(serialized).not.toContain("private fixture body");
    } finally {
      observer.close();
      uninvolved.close();
    }
  });
  expect(existsSync(dataDirectory)).toBe(false);
});
