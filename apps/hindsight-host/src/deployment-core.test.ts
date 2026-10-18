import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalCapabilityChallenge, canonicalHostOperationControl, type CapabilityRequest, type CapabilityResume,
  type CapabilityAuthorizationLineage, type CapabilityChallenge, type HostGovernanceEvidence, type CanonicalApprovalRequest } from "@taki/shared";
import { HindsightCustodyPrepareSchema, HINDSIGHT_SECRET_REFS } from "@taki/shared/hindsight-custody";
import { DeploymentEffectV1Schema, type InjectionCheckpointV1 } from "@taki/shared/hindsight-deployment";
import { createRunRepo } from "../../../packages/core/src/db/run-repo.ts";
import { createEffectRepo } from "../../../packages/core/src/db/effect-repo.ts";
import { createRunEventRepo } from "../../../packages/core/src/db/run-event-repo.ts";
import { openDatabase } from "../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../packages/core/src/db/migrations/index-list.ts";
import { createRunService } from "../../../packages/core/src/harness/run-service.ts";
import { createEffectLifecycleService } from "../../../packages/core/src/harness/effect-lifecycle-service.ts";
import { createGovernancePolicyRepo } from "../../../packages/core/src/governance/governance-policy-repo.ts";
import { createGovernancePolicyService } from "../../../packages/core/src/governance/governance-policy-service.ts";
import { createApprovalDecisionService } from "../../../packages/core/src/approval/approval-decision-service.ts";
import { createApprovalStateRepo } from "../../../packages/core/src/approval/approval-state-repo.ts";
import { createApprovalInteractionService } from "../../../packages/core/src/approval/approval-interaction-service.ts";
import { approvalDecisionScopeDigest } from "../../../packages/core/src/approval/approval-binding.ts";
import { createSecretCatalogService } from "../../../packages/core/src/secrets/secret-catalog-service.ts";
import { createCapabilityBroker } from "../../../packages/core/src/capabilities/capability-broker.ts";
import { routeCapability, type InteractiveOperator } from "../../../packages/core/src/capabilities/route-capability.ts";
import { createHostCatalogStore } from "../../../packages/core/src/hosts/host-catalog.ts";
import { registryReturning, fakeOperator } from "../../../packages/core/src/testing/capability-tool-harness.ts";
import { createCaptureLogger } from "../../../packages/core/src/testing/capture-logger.ts";
import type { Connection } from "../../../packages/core/src/server/connection-registry.ts";
import { createHindsightCustodyOwner } from "../../../packages/core/src/memory/hindsight/hindsight-custody-owner.ts";
import { HindsightDeploymentOwner } from "../../../packages/core/src/memory/hindsight/hindsight-deployment-owner.ts";
import { deploymentFixture, type DeploymentFixture } from "./deployment-test-fixtures.ts";
import { DeploymentHelperProcess, FakeDeploymentEngine } from "../test-fixtures/deployment-process-fixture.ts";

const roots: string[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const capabilities = {
  "hindsight-custody": { classifierId: "hindsight-fixed-custody", execution: "read" as const, cancellation: "cooperative" as const },
  "hindsight-deployment": { classifierId: "hindsight-deployment-action", execution: "effect" as const, cancellation: "non-cooperative" as const },
  "hindsight-deployment-observe": { classifierId: "hindsight-owned-observation", execution: "read" as const, cancellation: "cooperative" as const },
};
const memoryCapabilities = { providerId: "legacy-markdown", contractVersion: 1 as const, retain: true, recall: true,
  reflect: false, edit: false, invalidate: true, restore: false, conditionalMutation: false, idempotentWrites: false,
  sparseRetrieval: true, vectorRetrieval: "unavailable" as const, derivedMemoryRead: false };

async function harness(existing?: { fixture: DeploymentFixture; engine: FakeDeploymentEngine }) {
  const root = existing?.fixture.root ?? mkdtempSync(join(process.env.TAKI_C2A_TEMP ?? tmpdir(), "taki-c2a-core-"));
  if (!existing) roots.push(root);
  const fixture = existing?.fixture ?? await deploymentFixture(root, process.env.TAKI_C2A_KEY_ADAPTER ?? "G:/Temp/taki-c2a-source-20261014-impl/fake-key-adapter.exe");
  const engine = existing?.engine ?? new FakeDeploymentEngine(fixture);
  if (!existing) closers.push(() => engine.close());
  const db = openDatabase({ path: join(root, "runs.db"), migrations: MIGRATIONS });
  const capture = createCaptureLogger();
  const repo = createRunRepo(db);
  const effects = createEffectLifecycleService(createEffectRepo(db, createRunEventRepo(db)), (runId, attemptId) => repo.guardDispatch(runId, attemptId));
  const policy = createGovernancePolicyService(createGovernancePolicyRepo(db));
  policy.setLevel("relaxed", policy.level().policyGeneration);
  const approval = createApprovalInteractionService(createApprovalDecisionService(createApprovalStateRepo(db)));
  const flags = { snapshotAvailable: true, hostCurrent: true, custodyAvailable: true, captures: 0, approve: true, automatic: true };
  const runs = createRunService<InteractiveOperator>({ repo, provider: "fixture", modelId: "never-called", snapshot: {
    async capture(input, runId, operator) {
      if (operator) operator.runId = runId; // Match the real snapshot capture's enrichment.
      flags.captures++;
      if (!flags.snapshotAvailable) throw new Error("fixture snapshot unavailable");
      return { context: { tools: {} }, snapshot: { schemaVersion: "slice1.v1", characterId: input.characterId, initiator: input.initiator,
        provenance: input.provenance, deliveryClass: input.deliveryClass, contextMode: input.contextMode, modelProvider: "fixture", modelId: "never-called",
        primaryHostId: fixture.plan.coreHostId, hosts: [], extensions: [], extensionSnapshotDigest: "a".repeat(64),
        governance: { policyGeneration: policy.level().policyGeneration, registryRevision: 3, approvalGeneration: approval.approvalGeneration() },
        memory: { providerId: "legacy-markdown", contractVersion: 1, capabilities: memoryCapabilities, capabilityDigest: "b".repeat(64) },
        contextDecision: { sourceCategories: ["character"], tokenAccounting: "unknown" }, replayDecision: { status: "not_captured" },
        budget: {}, implementation: { runtimeVersion: "fixture", schemaVersion: "slice1.v1" }, sourceRefs: [] } };
    },
  } });
  const catalog = await createSecretCatalogService({ filePath: join(root, "catalog", "secret-catalog.bin"), storeId: fixture.plan.coreHostId,
    logger: capture.logger, keySource: { kind: "credentials-directory", canCreate: false, read: () => new Uint8Array(32).fill(0xa5), create: () => { throw new Error("fixture no key creation"); } } });
  const broker = createCapabilityBroker({ logger: capture.logger, approval, effects, timeoutMs: 10_000 });
  const hostId = fixture.plan.executionHostId;
  const provenance = { hostId, connectionGeneration: 1 };
  const host: Connection = { state: { status: "authenticated", deviceId: hostId, role: "node", capabilities: Object.keys(capabilities),
    host: { ...provenance, protocolVersion: 2, catalogSchemaVersion: 2 } }, notify: (method, params) => notify(method, params) };
  const connections = registryReturning(host);
  connections.isCurrentHost = (connection) => flags.hostCurrent && connection === host;
  const catalogs = createHostCatalogStore();
  catalogs.publish({ ...provenance, label: "C2a fixture", protocolVersion: 2, catalogSchemaVersion: 2, catalogGeneration: 1,
    publishedAt: new Date().toISOString(), readiness: "ready", workspaces: [], skills: [], mcpServers: [],
    capabilities: Object.entries(capabilities).map(([capabilityId, descriptor]) => ({ capabilityId, execution: descriptor.execution,
      cancellation: descriptor.cancellation, governance: { descriptorRevision: 1, classifierRevision: 1, classifierId: descriptor.classifierId } })) },
  { ...provenance, protocolVersion: 2, catalogSchemaVersion: 2 });
  const deps = { registry: connections, catalogs, broker, logger: capture.logger, governance: policy, approval, effects };
  const custodyCurrent = { registration: fixture.registration, configurationDigest: fixture.plan.configurationDigest, selection: fixture.selection };
  const custody = createHindsightCustodyOwner({ coreHostId: fixture.plan.coreHostId, catalog,
    current: () => flags.custodyAvailable ? custodyCurrent : null,
    route: (request, interactive) => routeCapability({ ...deps, interactive }, request),
    isCurrent: (control, authorization) => flags.hostCurrent && control.policyGeneration === policy.level().policyGeneration
      && approval.approvalGeneration() === (authorization?.approvalGeneration ?? control.approvalGeneration) });
  const owner = new HindsightDeploymentOwner({ runs, custody, registration: () => ({ registration: fixture.deploymentRegistration,
    sha256: fixture.plan.deploymentRegistrationSha256 }), route: (request, interactive) => routeCapability({ ...deps, interactive }, request) });
  const helper = new DeploymentHelperProcess(fixture, engine);
  const requests: CapabilityRequest[] = [];
  const executions: CapabilityRequest[] = [];
  const approvals: CanonicalApprovalRequest[] = [];
  const checkpoints: InjectionCheckpointV1[] = [];
  const hooks: { beforeRequest?: (request: CapabilityRequest) => void; beforeCheckpoint?: (checkpoint: InjectionCheckpointV1) => void;
    beforeResponse?: (request: CapabilityRequest, output: unknown) => void } = {};
  const operator = fakeOperator((method, params) => {
    if (method !== "approval.request") return;
    const value = params as CanonicalApprovalRequest; approvals.push(value);
    queueMicrotask(() => approval.respond(operator, { approvalId: value.approvalId, choice: flags.approve ? "allow_once" : "deny",
      expectedApprovalGeneration: approval.approvalGeneration() }));
  });
  const interactive = { connection: operator };
  let closed = false;
  async function close() {
    if (closed) return; closed = true; owner.dispose(); custody.dispose();
    broker.cancelGeneration(hostId, 1, "fixture closed"); await helper.stop(); db.close();
  }
  closers.push(close);

  function evidence(request: CapabilityRequest): HostGovernanceEvidence {
    const capability = request.control.capabilityId;
    const cellKey = capability === "hindsight-custody" ? "hindsight-custody:prepare" : capability === "hindsight-deployment-observe"
      ? "hindsight-deployment-observe:read" : `hindsight-deployment:${DeploymentEffectV1Schema.parse(request.input).action}`;
    const posture = request.control.governanceProjection.cells.find((cell) => cell.key === cellKey)!.posture;
    return { descriptorRevision: 1, classifierRevision: 1, cellKey, effectivePosture: posture, constraint: "none" };
  }
  function challenge(request: CapabilityRequest): CapabilityChallenge {
    const governance = evidence(request);
    const scope = approvalDecisionScopeDigest({ bindingRevision: 1, identity: { capabilityId: request.control.capabilityId, ownerHostId: hostId },
      descriptorRevision: 1, classifierId: capabilities[request.control.capabilityId as keyof typeof capabilities].classifierId,
      classifierRevision: 1, cellKey: governance.cellKey });
    const value = { requestId: request.requestId, control: request.control, challengeId: randomUUID(), governance,
      controlDigest: createHash("sha256").update(canonicalHostOperationControl(request.control)).digest("hex"), decisionScopeDigest: scope,
      presentation: { revision: 1 as const, title: "C2a fixture", capabilityLabel: request.control.capabilityId, riskSummary: "Fixed fixture effect",
        sections: [{ title: "Action", fields: [{ label: "Cell", value: governance.cellKey }] }] }, challengeDigest: "0".repeat(64) };
    return { ...value, challengeDigest: createHash("sha256").update(canonicalCapabilityChallenge(value)).digest("hex") };
  }
  function notify(method: string, params: unknown): void {
    if (method === "capability.request") {
      const request = params as CapabilityRequest; requests.push(request); hooks.beforeRequest?.(request);
      if (!flags.automatic) return;
      if (evidence(request).effectivePosture === "deny") {
        broker.resolve({ ...request, state: "failed", governance: evidence(request), error: { code: "DENIED", message: "fixture denied" } }, provenance); return;
      }
      if (request.control.capabilityId === "hindsight-custody" && evidence(request).effectivePosture === "auto") void execute(request);
      else broker.challenge(challenge(request), provenance);
    } else if (method === "capability.execute" || method === "capability.resume") {
      const frame = params as CapabilityResume; const request = requests.find((entry) => entry.requestId === frame.requestId)!;
      const authorization = method === "capability.resume" ? { authorizationId: frame.authorization.authorizationId,
        approvalGeneration: frame.authorization.approvalGeneration, challengeDigest: frame.authorization.challengeDigest } : undefined;
      void execute(request, authorization);
    }
  }
  async function execute(request: CapabilityRequest, authorization?: CapabilityAuthorizationLineage): Promise<void> {
    executions.push(request);
    try {
      let output: unknown;
      if (request.control.capabilityId === "hindsight-custody") {
        const input = HindsightCustodyPrepareSchema.parse(request.input);
        output = { version: 1, state: "prepared", requestId: request.requestId, hostAttemptId: request.control.attemptId, snapshotId: input.snapshotId,
          sealedEnvelopeSha256: input.sealedEnvelopeSha256, installationId: input.installationId, configurationDigest: input.configurationDigest, deploymentReady: false };
      } else {
        output = await helper.invoke({ version: 1, ...request, ...(authorization ? { authorization } : {}), owner: fixture.owner,
          input: request.input as Parameters<typeof helper.invoke>[0]["input"] }, async (checkpoint) => {
          checkpoints.push(checkpoint); hooks.beforeCheckpoint?.(checkpoint);
          return broker.authorizeHindsightInjection(checkpoint, provenance);
        });
      }
      hooks.beforeResponse?.(request, output);
      broker.resolve({ requestId: request.requestId, control: request.control, state: "completed", output, governance: evidence(request),
        ...(authorization ? { authorization } : {}) }, provenance);
    } catch {
      broker.resolve({ requestId: request.requestId, control: request.control, state: "outcome_unknown", ...(authorization ? { authorization } : {}) }, provenance);
    }
  }
  const start = (key = randomUUID(), withOperator = true) => owner.start({ idempotencyKey: key, expectedConfigurationDigest: fixture.plan.configurationDigest }, withOperator ? interactive : undefined);
  return { fixture, engine, helper, db, repo, effects, runs, policy, catalog, custody, custodyCurrent, owner, broker, flags, hooks,
    requests, executions, approvals, checkpoints, interactive, provenance, evidence, challenge, start, close, records: capture.records };
}

describe.skipIf(process.platform !== "win32")("C2a durable Core owner with actual helper/Native processes", () => {
  it("commits real Run/Attempt/Effect admission and independently grants one real child", async () => {
    const h = await harness(); const key = randomUUID();
    const result = await h.start(key); expect(result.state).toBe("running");
    const run = h.runs.findByIdempotency(`hindsight-deployment:start:v1:${key}`)!;
    expect(result.deploymentId).toBe(run.runId); expect(run.runId).not.toBe(key); expect(run.state).toBe("completed");
    const effects = h.effects.list!(run.runId); expect(effects).toHaveLength(3); expect(effects.every((effect) => effect.outcome === "completed")).toBe(true);
    expect(h.checkpoints).toHaveLength(1); expect(h.engine.marker().startupId).toBe(result.startupId);
    const checkpoint = h.checkpoints[0]!;
    expect(checkpoint.control.coreAttemptId).toBe(run.activeAttemptId);
    expect(effects.some((effect) => effect.effectId === checkpoint.control.effectId)).toBe(true);
    expect(h.broker.authorizeHindsightInjection(checkpoint, h.provenance).state).toBe("unavailable");
    expect(await h.start(key)).toEqual(result);
    expect(h.flags.captures).toBe(1); expect(h.engine.counts).toMatchObject({ createVolume: 1, createContainer: 1, startContainer: 1, authorize: 1, submit: 1 });
    expect(JSON.stringify(h.records)).not.toContain("C2A_FAKE_");
  });

  it("recovers the same Run and original process after helper loss plus DB reopen with fresh custody unavailable", async () => {
    const h = await harness(); const key = randomUUID(); h.helper.crashAfter = "submit";
    const lost = await h.start(key); expect(lost.reason).toBe("outcome-unknown");
    const original = h.runs.findByIdempotency(`hindsight-deployment:start:v1:${key}`)!;
    const marker = h.engine.marker(); const counts = { ...h.engine.counts };
    await h.close(); const reopened = await harness({ fixture: h.fixture, engine: h.engine });
    reopened.flags.snapshotAvailable = false; reopened.flags.custodyAvailable = false;
    const observed = await reopened.start(key); expect(observed.state).toBe("running");
    expect(observed.deploymentId).toBe(original.runId); expect(reopened.engine.marker()).toEqual(marker);
    expect(reopened.flags.captures).toBe(0);
    for (const action of ["createVolume", "createContainer", "startContainer", "authorize", "submit"] as const) expect(reopened.engine.counts[action]).toBe(counts[action]);
    expect(await reopened.owner.start({ idempotencyKey: key, expectedConfigurationDigest: "f".repeat(64) })).toMatchObject({ state: "unavailable" });
    expect(reopened.requests.filter((request) => request.control.capabilityId === "hindsight-deployment")).toHaveLength(0);
  });

  it("keeps concurrent identical admissions on one original Run and never repeats effects", async () => {
    const h = await harness(); const key = randomUUID();
    const results = await Promise.all([h.start(key), h.start(key)]);
    expect(results.every((result) => result.deploymentId === results[0]!.deploymentId)).toBe(true);
    expect(h.db.prepare("SELECT count(*) AS n FROM runs").get()?.n).toBe(1);
    expect(h.engine.counts).toMatchObject({ createVolume: 1, createContainer: 1, startContainer: 1, authorize: 1, submit: 1 });
  });

  it("admits a stable startup Run for a genuinely new Native startup on the original resource", async () => {
    const h = await harness(); const first = await h.start();
    expect(first.state).toBe("running");
    await h.engine.restartNative();
    const waiting = await h.owner.observe(first.deploymentId!, h.interactive);
    expect(waiting.state).toBe("waiting"); expect(waiting.startupId).not.toBe(first.startupId);
    const resumed = await h.owner.resumeStartup(first.deploymentId!, h.interactive);
    expect(resumed).toMatchObject({ state: "running", deploymentId: first.deploymentId, containerId: first.containerId, startupId: waiting.startupId });
    const key = `hindsight-deployment:startup:v1:${first.deploymentId}:${waiting.startupId}`;
    const startupRun = h.runs.findByIdempotency(key)!;
    expect(startupRun.runId).not.toBe(first.deploymentId);
    expect(startupRun.provenance.parentRunId).toBe(first.deploymentId);
    expect(startupRun.triggerRequestId).toBe(waiting.startupId);
    expect(h.effects.list!(startupRun.runId)).toHaveLength(1);
    expect(await h.owner.resumeStartup(first.deploymentId!, h.interactive)).toEqual(resumed);
    expect(h.runs.findByIdempotency(key)?.runId).toBe(startupRun.runId);
    expect(h.flags.captures).toBe(2);
    expect(h.engine.counts).toMatchObject({ createVolume: 1, createContainer: 1, startContainer: 1, authorize: 2, submit: 2 });
  });

  it("uses ask/resume once per effect and keeps denied/unattended effects undispatched", async () => {
    const h = await harness(); h.policy.setLevel("standard", h.policy.level().policyGeneration);
    expect((await h.start()).state).toBe("running"); expect(h.approvals).toHaveLength(5);
    expect(h.effects.list!(h.runs.findByIdempotency(h.runs.status(h.requests.find((entry) => entry.control.capabilityId === "hindsight-deployment")!.control.runId).run.idempotencyKey)!.runId)
      .every((effect) => effect.outcome === "completed")).toBe(true);
    const denied = await harness(); denied.policy.setLevel("standard", denied.policy.level().policyGeneration); denied.flags.approve = false;
    expect(await denied.start()).toMatchObject({ state: "unavailable", reason: "denied" }); expect(denied.engine.counts.createVolume).toBe(0);
    const unattended = await harness(); unattended.policy.setLevel("standard", unattended.policy.level().policyGeneration);
    expect(await unattended.start(randomUUID(), false)).toMatchObject({ state: "unavailable", reason: "approval-required" }); expect(unattended.approvals).toHaveLength(0);
    expect(unattended.engine.counts.createVolume).toBe(0);
  });

  it("rejects early success and duplicate auto challenges before any extra dispatch", async () => {
    const h = await harness();
    h.hooks.beforeRequest = (request) => {
      if (request.control.capabilityId !== "hindsight-deployment") return;
      const early = h.broker.resolve({ requestId: request.requestId, control: request.control, state: "completed", governance: h.evidence(request),
        output: { version: 1, state: "unavailable", reason: "denied", deploymentReady: false } }, h.provenance);
      expect(early.accepted).toBe(false);
      expect(h.effects.get(request.control.effectId!)).toBeUndefined();
      const challenge = h.challenge(request); expect(h.broker.challenge(challenge, h.provenance).accepted).toBe(true);
      expect(h.broker.challenge(challenge, h.provenance)).toEqual({ accepted: false, reason: "duplicate" });
    };
    expect((await h.start()).state).toBe("running");
    expect(h.executions.filter((request) => request.control.capabilityId === "hindsight-deployment")).toHaveLength(3);
  });

  it.each(["catalog-aba", "configuration", "host", "policy", "cancel"])("refuses stale %s at the actual pending checkpoint", async (kind) => {
    const h = await harness();
    h.hooks.beforeCheckpoint = (checkpoint) => {
      expect(h.effects.get(checkpoint.control.effectId!)?.state).toBe("intent_committed");
      expect(h.broker.authorizeHindsightInjection(checkpoint, { ...h.provenance, hostId: randomUUID() }).state).toBe("unavailable");
      expect(h.broker.authorizeHindsightInjection({ ...checkpoint, startupId: randomUUID() }, h.provenance).state).toBe("unavailable");
      if (kind === "catalog-aba") {
        const path = join(h.fixture.root, "catalog", "secret-catalog.bin"); const bytes = readFileSync(path);
        h.catalog.set(HINDSIGHT_SECRET_REFS.defaultModelApiKey, `C2A_FAKE_${"f".repeat(64)}`); writeFileSync(path, bytes);
      }
      if (kind === "configuration") h.custodyCurrent.configurationDigest = "f".repeat(64);
      if (kind === "host") h.flags.hostCurrent = false;
      if (kind === "policy") h.policy.setLevel("strict", h.policy.level().policyGeneration);
      if (kind === "cancel") h.runs.requestCancel(checkpoint.control.runId);
    };
    expect((await h.start()).state).not.toBe("running");
    expect(h.engine.counts).toMatchObject({ authorize: 0, submit: 0, submitBytes: 0 });
  });

  it("records dispatched custody drift as unknown before Effect settlement and recovers the real child", async () => {
    const h = await harness(); const key = randomUUID();
    h.hooks.beforeResponse = (request) => {
      if (request.control.capabilityId === "hindsight-deployment" && DeploymentEffectV1Schema.parse(request.input).action === "inject") {
        h.catalog.set(HINDSIGHT_SECRET_REFS.defaultModelApiKey, `C2A_FAKE_${"f".repeat(64)}`);
      }
    };
    const result = await h.start(key); expect(result.reason).toBe("outcome-unknown");
    const run = h.runs.findByIdempotency(`hindsight-deployment:start:v1:${key}`)!;
    expect(run.state).toBe("outcome_unknown");
    expect(h.effects.get(h.checkpoints[0]!.control.effectId!)?.outcome).toBe("outcome_unknown");
    expect((await h.start(key)).state).toBe("running"); expect(h.engine.counts.submit).toBe(1);
  });

  it.each(["cancelled", "another-attempt"])("does not publish stale running when real Run settlement returns %s", async (kind) => {
    const h = await harness(); const realSettle = h.runs.settle.bind(h.runs);
    h.runs.settle = (...args) => {
      const [runId, attemptId, outcome] = args;
      if (outcome === "completed") {
        if (kind === "cancelled") h.runs.requestCancel(runId);
        else h.runs.retry(runId, attemptId, "fixture stale callback");
      }
      return realSettle(...args);
    };
    expect(await h.start()).toMatchObject({ state: "outcome-unknown", reason: "outcome-unknown" });
    expect(h.engine.counts.submit).toBe(1);
  });

  it("keeps post-route custody drift unknown after the Effect was already accepted", async () => {
    const h = await harness(); const key = randomUUID();
    const request = h.broker.request.bind(h.broker);
    h.broker.request = async (target, input, identity) => {
      const result = await request(target, input, identity);
      if (target.descriptor.capabilityId === "hindsight-deployment" && DeploymentEffectV1Schema.parse(input).action === "inject") {
        h.catalog.set(HINDSIGHT_SECRET_REFS.defaultModelApiKey, `C2A_FAKE_${"f".repeat(64)}`);
      }
      return result;
    };
    expect(await h.start(key)).toMatchObject({ state: "outcome-unknown", reason: "outcome-unknown" });
    const run = h.runs.findByIdempotency(`hindsight-deployment:start:v1:${key}`)!;
    expect(run.state).toBe("outcome_unknown");
    expect(h.effects.get(h.checkpoints[0]!.control.effectId!)?.outcome).toBe("completed");
    expect((await h.start(key)).state).toBe("running"); expect(h.engine.counts.submit).toBe(1);
  });
});
