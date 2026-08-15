/**
 * INPUT:  real Core and taki-node processes joined through the test-only WS relay
 * OUTPUT: process proof that stale or conflicting governance lineage never executes and settles without replay
 * POS:    e2e — Slice-3 Host projection binding rejection and bounded Core settlement coverage
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  canonicalHostGovernanceProjection,
  type HostGovernanceProjection,
} from "@taki/shared";
import { describe, expect, it } from "vitest";
import type { CapabilityRelay, CapabilityRequestMutator } from "./fixture/ws-relay.ts";
import { withStack } from "./fixture/with-stack.ts";

interface CleanupEvidence {
  coreDataDir: string;
  nodeDataDir: string;
  relay: CapabilityRelay;
}

describe("stale governance projection process rejection", () => {
  it("rejects an older policyGeneration without execution or replay", async () => {
    const cleanup = await rejectedRequest((request) => ({
      ...request,
      control: { ...request.control, policyGeneration: request.control.policyGeneration - 1 },
    }));
    assertCleaned(cleanup);
  }, 60_000);

  it("rejects a different valid projection digest at the same generation", async () => {
    const cleanup = await rejectedRequest((request) => {
      const cells = request.control.governanceProjection.cells.map((cell, index) =>
        index === 0 ? { ...cell, posture: cell.posture === "deny" ? "auto" as const : "deny" as const } : cell
      );
      const projection = withDigest({ ...request.control.governanceProjection, cells });
      return { ...request, control: { ...request.control, governanceProjection: projection } };
    });
    assertCleaned(cleanup);
  }, 60_000);
});

async function rejectedRequest(mutator: CapabilityRequestMutator): Promise<CleanupEvidence> {
  let evidence: CleanupEvidence | undefined;
  await withStack({ devTrigger: true, nodeWsRelay: true }, async (stack) => {
    await stack.setPermissionLevel("relaxed");
    await expect(stack.l1("process_list", {})).resolves.toMatchObject({ ok: true });
    const relay = stack.relay();
    if (!relay) throw new Error("node WS relay was not started");
    evidence = { coreDataDir: stack.coreDataDir, nodeDataDir: stack.nodeDataDir, relay };
    const auditBefore = stack.audit().length;
    const requestCountBefore = relay.requestCount();
    relay.mutateNext(mutator);

    const outcome = stack.l1("process_list", {}, 20_000);
    await relay.waitForRequestCount(requestCountBefore + 1);
    await stack.node()?.stderr.waitFor((line) => line.includes("capability request binding rejected"), 10_000);
    await relay.close();

    await expect(outcome).resolves.toMatchObject({ ok: false, code: "NODE_DISCONNECTED" });
    expect(stack.audit()).toHaveLength(auditBefore);
    expect(relay.requestCount()).toBe(requestCountBefore + 1);
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(relay.requestCount()).toBe(requestCountBefore + 1);
    expect(relay.activeConnectionCount()).toBe(0);
  });
  if (!evidence) throw new Error("stack did not expose cleanup evidence");
  return evidence;
}

function withDigest(projection: HostGovernanceProjection): HostGovernanceProjection {
  const payload = {
    registryRevision: projection.registryRevision,
    descriptorRevision: projection.descriptorRevision,
    classifierRevision: projection.classifierRevision,
    cells: projection.cells,
  };
  return {
    ...projection,
    digest: createHash("sha256").update(canonicalHostGovernanceProjection(payload)).digest("hex"),
  };
}

function assertCleaned(evidence: CleanupEvidence): void {
  expect(evidence.relay.isClosed()).toBe(true);
  expect(evidence.relay.activeConnectionCount()).toBe(0);
  expect(existsSync(evidence.coreDataDir)).toBe(false);
  expect(existsSync(evidence.nodeDataDir)).toBe(false);
}
