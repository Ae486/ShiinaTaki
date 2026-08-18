/**
 * INPUT:  one real Core, two isolated debug taki-node processes, and the dev-only Run snapshot tool drive
 * OUTPUT: process proof for ambiguous direct routing, sealed Host ownership, reconnect generation, and isolation
 * POS:    e2e — Slice 8 simultaneous two-Node Extension discovery and call evidence; no LLM or authority bypass
 */
import { describe, expect, it } from "vitest";
import {
  ExtensionCallResultSchema,
  ExtensionDiscoverResultSchema,
  type ExtensionDescriptor,
} from "@taki/shared";
import {
  NODE_DEVICE_NAME,
  SECOND_NODE_DEVICE_NAME,
  withStack,
  type Stack,
} from "./fixture/with-stack.ts";

const processAuditCount = (records: ReturnType<Stack["audit"]>): number =>
  records.filter((entry) => entry.capability === "process-list").length;
const REPLACEMENT_CAPABILITIES = ["process-list", "exec"] as const;
const LONG_EFFECT_COMMAND = "ping -n 40 127.0.0.1";

const isPairingFor = (deviceName: string) => (entry: Record<string, unknown>): boolean =>
  entry.msg === "pairing code issued" && entry.deviceName === deviceName;

describe("two-Node Extension discovery and routing", () => {
  it("proves replacement, stale-response rejection, isolation, and interruption settlement", async () => {
    await withStack({ devTrigger: true, secondNode: true, nodeWsRelay: true }, async (stack) => {
      const relay = stack.relay();
      if (!relay) throw new Error("primary Node relay was not started");
      expect(stack.node()?.child.exitCode ?? null).toBeNull();
      expect(stack.secondNode()?.child.exitCode ?? null).toBeNull();
      expect(stack.countCoreLog(isPairingFor(NODE_DEVICE_NAME))).toBe(1);
      expect(stack.countCoreLog(isPairingFor(SECOND_NODE_DEVICE_NAME))).toBe(1);
      await stack.setPermissionLevel("relaxed");

      const initial = await waitForProcessExtensions(stack, 2);
      const [first, second] = initial;
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      expect(first!.identity.ownerHostId).not.toBe(second!.identity.ownerHostId);

      await expect(stack.l1("process_list", {})).resolves.toMatchObject({
        ok: false,
        code: "TARGET_HOST_REQUIRED",
      });
      expect([processAuditCount(stack.audit()), processAuditCount(stack.secondAudit())]).toEqual([0, 0]);

      await expect(callExtension(stack, first!)).resolves.toMatchObject({
        ok: true,
        owner: first!.identity,
      });
      const firstPhysicalCounts = [processAuditCount(stack.audit()), processAuditCount(stack.secondAudit())];
      expect([...firstPhysicalCounts].sort()).toEqual([0, 1]);
      const firstIsHostA = firstPhysicalCounts[0] === 1;
      const hostA = firstIsHostA ? first! : second!;
      const hostB = firstIsHostA ? second! : first!;

      await expect(callExtension(stack, second!)).resolves.toMatchObject({
        ok: true,
        owner: second!.identity,
      });
      expect([processAuditCount(stack.audit()), processAuditCount(stack.secondAudit())]).toEqual([1, 1]);

      await stack.killNode();
      const whileHostADown = await waitForProcessExtensions(stack, 1);
      expect(whileHostADown[0]?.identity.ownerHostId).toBe(hostB.identity.ownerHostId);
      await expect(callExtension(stack, hostB)).resolves.toMatchObject({
        ok: true,
        owner: hostB.identity,
      });
      expect([processAuditCount(stack.audit()), processAuditCount(stack.secondAudit())]).toEqual([1, 2]);

      await stack.startNode(false, REPLACEMENT_CAPABILITIES);
      const reconnected = await waitForProcessExtensions(stack, 2);
      const reconnectedA = ownedBy(reconnected, hostA.identity.ownerHostId);
      const currentB = ownedBy(reconnected, hostB.identity.ownerHostId);
      expect(reconnectedA.identity.extensionId).toBe(hostA.identity.extensionId);
      expect(reconnectedA.identity.connectionGeneration).toBeGreaterThan(hostA.identity.connectionGeneration);
      expect(currentB.identity.connectionGeneration).toBe(hostB.identity.connectionGeneration);
      expect(stack.countCoreLog(isPairingFor(NODE_DEVICE_NAME))).toBe(1);

      const clipboardAfterReplacement = await waitForCapabilityExtensions(stack, "clipboard-read", 1);
      expect(clipboardAfterReplacement[0]?.identity.ownerHostId).toBe(hostB.identity.ownerHostId);
      await expect(callExtension(stack, currentB)).resolves.toMatchObject({
        ok: true,
        owner: currentB.identity,
      });

      const staleRequestBaseline = relay.requestCount();
      const staleResponseBaseline = relay.responseCount();
      relay.mutateNextResponse((response) => ({
        ...response,
        control: {
          ...response.control,
          connectionGeneration: hostA.identity.connectionGeneration,
        },
      }));
      const interruptedRead = callExtension(stack, reconnectedA);
      await relay.waitForResponseCount(staleResponseBaseline + 1);
      expect(relay.requestCount()).toBe(staleRequestBaseline + 1);
      await stack.killNode();
      await expect(interruptedRead).resolves.toMatchObject({
        ok: false,
        owner: reconnectedA.identity,
        state: "cancelled",
      });
      expect(relay.requestCount()).toBe(staleRequestBaseline + 1);

      const isolatedB = ownedBy(await waitForProcessExtensions(stack, 1), hostB.identity.ownerHostId);
      await expect(callExtension(stack, isolatedB)).resolves.toMatchObject({
        ok: true,
        owner: isolatedB.identity,
      });

      await stack.startNode(false, REPLACEMENT_CAPABILITIES);
      const effectGeneration = ownedBy(
        await waitForProcessExtensions(stack, 2),
        hostA.identity.ownerHostId,
      );
      expect(effectGeneration.identity.connectionGeneration)
        .toBeGreaterThan(reconnectedA.identity.connectionGeneration);
      const primaryExec = ownedBy(
        await waitForCapabilityExtensions(stack, "exec", 2),
        hostA.identity.ownerHostId,
      );
      const effectRequestBaseline = relay.requestCount();
      const effectAuditBaseline = stack.audit().filter((entry) => entry.capability === "exec").length;
      const interruptedEffect = callExtension(stack, primaryExec, { command: LONG_EFFECT_COMMAND });
      await relay.waitForRequestCount(effectRequestBaseline + 1);
      await waitForAuditCount(stack, "exec", effectAuditBaseline + 1);
      await stack.killNode();
      await expect(interruptedEffect).resolves.toMatchObject({
        ok: false,
        owner: primaryExec.identity,
        state: "outcome_unknown",
      });
      expect(relay.requestCount()).toBe(effectRequestBaseline + 1);

      await stack.startNode(false, REPLACEMENT_CAPABILITIES);
      const finalExtensions = await waitForProcessExtensions(stack, 2);
      expect(ownedBy(finalExtensions, hostA.identity.ownerHostId).identity.connectionGeneration)
        .toBeGreaterThan(effectGeneration.identity.connectionGeneration);
      expect(relay.requestCount()).toBe(effectRequestBaseline + 1);
      const finalB = ownedBy(finalExtensions, hostB.identity.ownerHostId);
      await expect(callExtension(stack, finalB)).resolves.toMatchObject({ ok: true, owner: finalB.identity });
      expect(relay.requestCount()).toBe(effectRequestBaseline + 1);
    });
  }, 180_000);
});

async function waitForProcessExtensions(stack: Stack, count: number): Promise<ExtensionDescriptor[]> {
  return waitForCapabilityExtensions(stack, "process-list", count);
}

async function waitForCapabilityExtensions(
  stack: Stack,
  capability: string,
  count: number,
): Promise<ExtensionDescriptor[]> {
  let observed: ExtensionDescriptor[] = [];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = ExtensionDiscoverResultSchema.parse(await stack.l1("extension_discover", {
      query: capability,
      kind: "capability",
      limit: 8,
    }));
    observed = result.entries;
    if (observed.length === count) return observed;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`expected ${count} ${capability} extensions, observed ${observed.length}`);
}

async function callExtension(stack: Stack, extension: ExtensionDescriptor, input: unknown = {}) {
  return ExtensionCallResultSchema.parse(await stack.l1("extension_call", {
    extensionId: extension.identity.extensionId,
    input,
  }, 60_000));
}

async function waitForAuditCount(stack: Stack, capability: string, count: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (stack.audit().filter((entry) => entry.capability === capability).length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`expected ${count} ${capability} audit records`);
}

function ownedBy(entries: ExtensionDescriptor[], ownerHostId: string): ExtensionDescriptor {
  const entry = entries.find((candidate) => candidate.identity.ownerHostId === ownerHostId);
  if (!entry) throw new Error(`missing process-list extension for Host ${ownerHostId}`);
  return entry;
}
