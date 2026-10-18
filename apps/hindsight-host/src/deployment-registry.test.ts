import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DeploymentEffectV1Schema, canonicalDeploymentPlan } from "@taki/shared/hindsight-deployment";
import { DeploymentRegistry, type OwnedDeploymentRecord } from "./deployment-registry.ts";
import { sha256 } from "./installed-files.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(process.env.TAKI_C2A_TEMP ?? tmpdir(), "taki-c2a-registry-")); roots.push(root);
  const path = join(root, "deployment.json");
  writeFileSync(path, JSON.stringify({ version: 1, revision: 0, state: "vacant" }));
  const { plan } = DeploymentEffectV1Schema.parse(JSON.parse(readFileSync(new URL(
    "../../../packages/shared/fixtures/protocol/hindsight-deployment-effect.create.valid.json", import.meta.url), "utf8")));
  const record: OwnedDeploymentRecord = { version: 1, state: "owned", revision: 1, plan,
    planDigest: sha256(canonicalDeploymentPlan(plan)), steps: {}, attempts: [] };
  return { root, path, record, registry: new DeploymentRegistry(root) };
}
describe("C2 durable deployment registry", () => {
  it("reopens original flushed facts and refuses a stale publisher after atomic replacement", () => {
    const h = fixture(); const stale = new DeploymentRegistry(h.root);
    h.registry.publish(h.record);
    expect(new DeploymentRegistry(h.root).snapshot()).toEqual(h.record);
    expect(() => stale.publish({ ...h.record, plan: { ...h.record.plan, deploymentId: randomUUID() } })).toThrow();
    expect(readdirSync(h.root)).toEqual(["deployment.json"]);
    expect(new DeploymentRegistry(h.root).snapshot()).toEqual(h.record);
  });
  it("refuses external file replacement or corrupt ownership instead of recreating vacant state", () => {
    const h = fixture(); h.registry.publish(h.record);
    writeFileSync(h.path, "generated corrupt registry");
    expect(() => h.registry.snapshot()).toThrow();
    expect(() => h.registry.publish({ ...h.record, revision: 2 })).toThrow();
    expect(() => new DeploymentRegistry(h.root)).toThrow();
    expect(readFileSync(h.path, "utf8")).toBe("generated corrupt registry");
  });
  it("retains the original publication on invalid revision or changed plan digest", () => {
    const h = fixture(); h.registry.publish(h.record);
    expect(() => h.registry.publish(h.record)).toThrow();
    expect(() => h.registry.publish({ ...h.record, revision: 2, planDigest: "0".repeat(64) })).toThrow();
    expect(new DeploymentRegistry(h.root).snapshot()).toEqual(h.record);
    expect(readdirSync(h.root)).toEqual(["deployment.json"]);
  });
});
