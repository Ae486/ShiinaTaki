import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { JsonRpcSuccessResponseSchema, RunStatusResultSchema } from "@taki/shared";
import { DeploymentStatusV1Schema, HINDSIGHT_DEPLOYMENT_METHODS } from "@taki/shared/hindsight-deployment";
import { installedDeploymentFixture } from "../test-fixtures/deployment-installed-fixture.ts";
import { fileDigest, sha256 } from "./installed-files.ts";

describe.skipIf(process.platform !== "win32" || process.env.TAKI_C2A_INSTALLED_FIXTURE !== "1")("C2a actual installed Shell entry", () => {
  it("admits a real operator Run through Rust Gate and the copied fixed adapter to one Native child", async () => {
    const h = await installedDeploymentFixture();
    let proof: Record<string, unknown> | undefined;
    try {
      const input = { idempotencyKey: randomUUID(), expectedConfigurationDigest: h.fixture.plan.configurationDigest };
      const frame = await h.operator.request(HINDSIGHT_DEPLOYMENT_METHODS.start, input, 90_000);
      const result = DeploymentStatusV1Schema.parse(JsonRpcSuccessResponseSchema.parse(frame).result);
      expect(result).toMatchObject({ state: "running", deploymentReady: false, containerId: h.docker.engine.containerId });
      const run = RunStatusResultSchema.parse(JsonRpcSuccessResponseSchema.parse(await h.operator.request("run.status", { runId: result.operationId })).result);
      expect(run).toMatchObject({ run: { runId: result.operationId, outcome: "completed" } });
      const second = DeploymentStatusV1Schema.parse(JsonRpcSuccessResponseSchema.parse(await h.operator.request(HINDSIGHT_DEPLOYMENT_METHODS.start, input)).result);
      expect(second).toEqual(result);
      expect(h.docker.engine.marker().startupId).toBe(result.startupId);
      expect(h.docker.engine.counts).toMatchObject({ createVolume: 1, createContainer: 1, startContainer: 1, authorize: 1, submit: 1 });
      const registry = JSON.parse(readFileSync(join(h.fixture.root, "state", "deployment.json"), "utf8"));
      expect(registry.attempts.map((entry: { action: string }) => entry.action)).toEqual(["create", "start", "inject"]);
      expect(registry.attempts.every((entry: { control: { effectId?: string; coreAttemptId?: string } }) => entry.control.effectId && entry.control.coreAttemptId)).toBe(true);
      const manifest = JSON.parse(readFileSync(join(h.payload, "manifest.json"), "utf8"));
      for (const path of ["app/deployment-owner.js", "app/deployment-host.js", "app/docker-adapter.js"]) expect(manifest.files).toContainEqual(expect.objectContaining({ path }));
      const audit = readFileSync(join(h.nodeData, "audit.jsonl"), "utf8");
      expect(audit).toContain("hindsight-deployment");
      const publicData = JSON.stringify({ result, registry, argv: h.docker.argv, audit,
        logs: [...h.core.stdout.lines(), ...h.core.stderr.lines(), ...h.node.stdout.lines(), ...h.node.stderr.lines(), ...h.docker.engine.logs()] });
      for (const secret of Object.values(h.fixture.values)) expect(publicData).not.toContain(secret);
      expect(h.docker.argv.some((args) => args[0] === "exec" && args.includes("-i") && !args.includes("-t"))).toBe(true);
      expect(h.docker.argv.flat().some((arg) => arg.includes("C2A_FAKE_"))).toBe(false);
      proof = { engine: "substituted-private-pipe", result, run, registry, argv: h.docker.argv,
        counts: { ...h.docker.engine.counts }, pids: h.docker.engine.pids.slice(),
        manifestSha256: fileDigest(join(h.payload, "manifest.json")), runtimeSha256: h.fixture.registration.runtime.sha256,
        nodeSha256: sha256(readFileSync(h.node.child.spawnfile)),
        fakeDockerSha256: h.fixture.deploymentRegistration.docker.sha256 };
    } finally {
      const pids = h.docker.engine.pids.slice();
      await h.close();
      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
      if (proof) writeFileSync(h.evidencePath, JSON.stringify({ ...proof, ownedCleanup: true }, null, 2));
    }
  }, 120_000);
});
