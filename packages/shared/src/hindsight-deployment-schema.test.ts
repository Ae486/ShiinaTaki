import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalDeploymentPlan, C2A_FAKE_VALUE, DeploymentEffectV1Schema, DeploymentStartParamsSchema,
  NativeBootstrapStatusSchema } from "./hindsight-deployment-schema.ts";
import { CANONICAL_GOVERNANCE_REGISTRY, governanceDescriptor } from "./governance-registry.ts";

describe("C2a fixed deployment contracts", () => {
  it("pins canonical plan bytes independently of key insertion order", () => {
    const effect = DeploymentEffectV1Schema.parse(JSON.parse(readFileSync(new URL(
      "../fixtures/protocol/hindsight-deployment-effect.inject.valid.json", import.meta.url), "utf8")));
    expect(createHash("sha256").update(canonicalDeploymentPlan(effect.plan)).digest("hex"))
      .toBe("35764c5d2ba0a365c09588e4f3c5a8e609c360a23229b3a53e8b420384ebe40b");
    const reordered = Object.fromEntries(Object.entries(effect.plan).reverse());
    expect(canonicalDeploymentPlan(DeploymentEffectV1Schema.parse({ ...effect, plan: reordered }).plan))
      .toBe(canonicalDeploymentPlan(effect.plan));
  });

  it("keeps three separate once-only effects and an independently constrained read", () => {
    const effect = governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, "hindsight-deployment")!;
    expect(effect.classifier).toEqual({ authority: "host", classifierId: "hindsight-deployment-action", classifierRevision: 1 });
    expect(effect.cells.map((cell) => cell.key).sort()).toEqual(["hindsight-deployment:create", "hindsight-deployment:inject", "hindsight-deployment:start"]);
    for (const cell of effect.cells) expect(cell).toMatchObject({ approvalMemory: "once-only", levels: { strict: "ask", standard: "ask", relaxed: "auto" } });
    const read = governanceDescriptor(CANONICAL_GOVERNANCE_REGISTRY, "hindsight-deployment-observe")!;
    expect(read.cells).toMatchObject([{ levels: { strict: "auto", standard: "auto", relaxed: "auto" } }]);
  });

  it("requires a bound running Native status and rejects caller authority", () => {
    expect(NativeBootstrapStatusSchema.safeParse({ version: 1, state: "running",
      startupId: "11111111-1111-4111-8111-111111111111", configurationDigest: "a".repeat(64), deploymentReady: false }).success).toBe(false);
    expect(DeploymentStartParamsSchema.safeParse({ idempotencyKey: crypto.randomUUID(), expectedConfigurationDigest: "a".repeat(64),
      deploymentReady: true, command: "unused" }).success).toBe(false);
    for (const value of ["generated-test-value", `C2A_FAKE_${"A".repeat(64)}`, `C2A_FAKE_${"a".repeat(65)}`]) expect(C2A_FAKE_VALUE.test(value)).toBe(false);
    expect(C2A_FAKE_VALUE.test(`C2A_FAKE_${"a".repeat(64)}`)).toBe(true);
  });
});
