import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HINDSIGHT_SECRET_REFS } from "@taki/shared/hindsight-custody";
import type { InjectionCheckpointV1, InjectionCheckpointResult } from "@taki/shared/hindsight-deployment";
import { deploymentFixture, deploymentInvocation, type DeploymentFixture } from "./deployment-test-fixtures.ts";
import { FakeDeploymentEngine, DeploymentHelperProcess, type EngineBoundary } from "../test-fixtures/deployment-process-fixture.ts";

const owned: { fixture: DeploymentFixture; engine: FakeDeploymentEngine; helpers: DeploymentHelperProcess[] }[] = [];
afterEach(async () => {
  for (const entry of owned.splice(0)) {
    for (const helper of entry.helpers) await helper.stop();
    await entry.engine.close();
    if (dirname(resolve(entry.fixture.root)) !== resolve(process.env.TAKI_C2A_TEMP ?? tmpdir())
      || !basename(entry.fixture.root).startsWith("taki-c2a-host-")) throw new Error("unsafe Host deployment fixture cleanup");
    rmSync(entry.fixture.root, { recursive: true, force: true });
  }
});
async function harness(options: Parameters<typeof deploymentFixture>[2] = {}) {
  const root = mkdtempSync(join(process.env.TAKI_C2A_TEMP ?? tmpdir(), "taki-c2a-host-"));
  const fixture = await deploymentFixture(root, process.env.TAKI_C2A_KEY_ADAPTER, options);
  const engine = new FakeDeploymentEngine(fixture);
  const entry = { fixture, engine, helpers: [] as DeploymentHelperProcess[] }; owned.push(entry);
  const helper = () => { const child = new DeploymentHelperProcess(fixture, engine); entry.helpers.push(child); return child; };
  let checkpoints = 0;
  const checkpoint = async (value: InjectionCheckpointV1): Promise<InjectionCheckpointResult> => {
    checkpoints++;
    return { state: "granted", permit: { version: 1, checkpointId: value.checkpointId, binding: {
      startupId: value.startupId, configurationDigest: value.configurationDigest, operationId: value.deploymentId,
      attemptId: value.control.attemptId, authorizationId: randomUUID(), deadlineAt: fixture.custody.deadlineAt,
    }, selection: fixture.selection } };
  };
  const invoke = (child: DeploymentHelperProcess, action: Parameters<typeof deploymentInvocation>[1], resource = {}) => child.invoke(deploymentInvocation(fixture, action, resource), checkpoint);
  return { ...entry, helper, invoke, checkpoint, checkpoints: () => checkpoints };
}

describe.skipIf(process.platform !== "win32")("C2a actual helper/Native processes with a substituted engine", () => {
  it("runs a real fixed child, reopens the registry in another helper and never reinjects", async () => {
    const h = await harness({ inherited: true }); const first = h.helper();
    expect((await h.invoke(first, "create")).state).toBe("stopped");
    const started = await h.invoke(first, "start", { containerId: h.engine.containerId });
    expect(started.state).toBe("waiting");
    const running = await h.invoke(first, "inject", { containerId: h.engine.containerId, startupId: started.startupId });
    expect(running.state).toBe("running"); const marker = h.engine.marker();
    await first.stop();
    const second = h.helper();
    expect(await h.invoke(second, "observe")).toEqual(running);
    expect(h.engine.marker()).toEqual(marker);
    expect((await h.invoke(second, "inject", { containerId: h.engine.containerId, startupId: started.startupId })).state).toBe("running");
    expect(h.engine.counts).toMatchObject({ createVolume: 1, createContainer: 1, startContainer: 1, authorize: 1, submit: 1 });
    expect(h.checkpoints()).toBe(1);
    const publicFiles = ["installation.json", "deployment-registration.json", "state/deployment.json", "native/c2a-child.json"];
    const publicData = JSON.stringify({ running, logs: [...first.logs, ...second.logs, ...h.engine.logs()] })
      + publicFiles.map((file) => readFileSync(join(h.fixture.root, file), "utf8")).join("");
    for (const value of Object.values(h.fixture.values)) expect(publicData).not.toContain(value);
    expect(readdirSync(join(h.fixture.root, "state"))).toEqual(expect.arrayContaining(["deployment.json", "deployment.lock", "docker-config"]));
    expect(publicData).not.toContain("must_not_load");
  });

  it.each<EngineBoundary>(["createVolume", "createContainer", "startContainer", "authorize", "submit"])(
    "recovers original facts after a real helper crash following %s", async (boundary) => {
      const h = await harness(); const first = h.helper(); let startupId: string | undefined;
      if (!["createVolume", "createContainer"].includes(boundary)) await h.invoke(first, "create");
      if (["authorize", "submit"].includes(boundary)) startupId = (await h.invoke(first, "start", { containerId: h.engine.containerId })).startupId;
      first.crashAfter = boundary;
      const action = ["createVolume", "createContainer"].includes(boundary) ? "create" : boundary === "startContainer" ? "start" : "inject";
      await expect(h.invoke(first, action, action === "create" ? {} : { containerId: h.engine.containerId, ...(startupId ? { startupId } : {}) })).rejects.toThrow();
      await first.exited;
      const counts = { ...h.engine.counts }; const second = h.helper();
      const status = await h.invoke(second, "observe");
      expect(status.deploymentId).toBe(h.fixture.plan.deploymentId);
      expect(status.state).toBe(boundary === "createVolume" ? "outcome-unknown" : boundary === "createContainer" ? "stopped" : boundary === "submit" ? "running" : "waiting");
      if (boundary === "submit") expect(h.engine.marker().startupId).toBe(status.startupId);
      await h.invoke(second, "create");
      for (const key of ["createVolume", "createContainer", "startContainer", "authorize", "submit"] as const) expect(h.engine.counts[key]).toBe(counts[key]);
    });

  it("keeps a post-submit Catalog change unknown and observes the original child without replay", async () => {
    const h = await harness(); const child = h.helper();
    await h.invoke(child, "create");
    const started = await h.invoke(child, "start", { containerId: h.engine.containerId });
    const handle = h.engine.handle.bind(h.engine);
    h.engine.handle = async (method, args) => {
      const result = await handle(method, args);
      if (method === "submit") writeFileSync(join(h.fixture.root, "catalog", "secret-catalog.bin"), "generated rotation");
      return result;
    };
    expect(await h.invoke(child, "inject", { containerId: h.engine.containerId, startupId: started.startupId }))
      .toMatchObject({ state: "outcome-unknown", reason: "outcome-unknown", deploymentId: h.fixture.plan.deploymentId });
    const marker = h.engine.marker();
    await child.stop();
    expect(await h.invoke(h.helper(), "observe")).toMatchObject({ state: "running", startupId: marker.startupId });
    expect(h.engine.marker()).toEqual(marker);
    expect(h.engine.counts).toMatchObject({ createVolume: 1, createContainer: 1, startContainer: 1, authorize: 1, submit: 1 });
  });

  it.each(Object.keys(HINDSIGHT_SECRET_REFS) as (keyof typeof HINDSIGHT_SECRET_REFS)[])(
    "refuses non-fake %s before checkpoint, grant, frame or child", async (invalid) => {
      const h = await harness({ invalid, inherited: invalid === "defaultModelApiKey" }); const child = h.helper();
      await h.invoke(child, "create"); const started = await h.invoke(child, "start", { containerId: h.engine.containerId });
      expect(await h.invoke(child, "inject", { containerId: h.engine.containerId, startupId: started.startupId })).toMatchObject({ state: "unavailable", reason: "denied" });
      expect(h.checkpoints()).toBe(0);
      expect(h.engine.counts).toMatchObject({ authorize: 0, submit: 0, submitBytes: 0 });
      expect(existsSync(join(h.fixture.root, "native", "c2a-child.json"))).toBe(false);
      expect(readFileSync(join(h.fixture.root, "state", "deployment.json"), "utf8")).not.toContain(h.fixture.values[invalid]);
    });

  it.each(["missing", "corrupt"])("refuses %s ownership without initializing or dispatching", async (condition) => {
    const h = await harness(); const path = join(h.fixture.root, "state", "deployment.json");
    if (condition === "missing") unlinkSync(path); else writeFileSync(path, "corrupt generated test data");
    const child = h.helper();
    await expect(h.invoke(child, "create")).rejects.toThrow("fixture pipe closed");
    await child.exited;
    expect(child.child.exitCode).toBe(1);
    expect(h.engine.counts).toMatchObject({ createVolume: 0, createContainer: 0, startContainer: 0, authorize: 0, submit: 0 });
    expect(existsSync(path)).toBe(condition === "corrupt");
  });

  it("requires a fresh permit for a genuinely new startup on the same container and volume", async () => {
    const h = await harness(); const child = h.helper();
    await h.invoke(child, "create"); const first = await h.invoke(child, "start", { containerId: h.engine.containerId });
    await h.invoke(child, "inject", { containerId: h.engine.containerId, startupId: first.startupId });
    await h.engine.restartNative(); const next = await h.invoke(child, "observe");
    expect(next).toMatchObject({ state: "waiting", containerId: h.engine.containerId }); expect(next.startupId).not.toBe(first.startupId);
    expect(next.attemptId).toBeUndefined();
    const renewed = await h.invoke(child, "inject", { containerId: h.engine.containerId, startupId: next.startupId });
    expect(renewed.state).toBe("running"); expect(renewed.attemptId).not.toBe(first.attemptId);
    expect(h.engine.counts).toMatchObject({ createVolume: 1, createContainer: 1, startContainer: 1, authorize: 2, submit: 2 });
  });
});
