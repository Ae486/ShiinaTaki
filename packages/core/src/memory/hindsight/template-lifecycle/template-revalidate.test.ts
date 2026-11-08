import { afterEach, describe, expect, it } from "vitest";
import { createHindsightBankSetupRepo } from "../../../db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../../../db/hindsight-connection-repo.ts";
import { createHindsightLifecycleService } from "../../hindsight-lifecycle/hindsight-lifecycle-service.ts";
import { createMemoryOperationService } from "../../operations/memory-operation-service.ts";
import { fakeSetup } from "../../operations/memory-operation-fixtures.ts";
import { templateLifecycleFixture, type TemplateLifecycleFixture } from "./template-lifecycle-fixtures.ts";
import { signFixtureSnapshot } from "./template-test-fixtures.ts";
import { TAKI_MANAGED_TEMPLATE_REVISION } from "./template-catalog.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

function connectionOwner(f: TemplateLifecycleFixture) {
  const lifecycle = createHindsightLifecycleService({ ...f.deps, templates: f.service, runtime: () => f.live,
    binding: () => ({ selection: "hindsight", selectedEpochId: "epoch", binding: { kind: "published", epochId: "epoch" },
      lifetime: "running", flush: "available" }), replaceBinding: f.deps.runtime.replaceBinding, logger: f.base.logger, wait: async () => undefined });
  const owner = createMemoryOperationService({ ...f.deps, live: () => f.live, templates: f.service, lifecycle,
    setup: fakeSetup(), logger: f.base.logger, onChanged: () => undefined });
  cleanup.push(async () => { await lifecycle.stop(); await owner.stop(); });
  return owner;
}

async function fixture(revision = TAKI_MANAGED_TEMPLATE_REVISION) {
  const f = templateLifecycleFixture(); cleanup.push(f.close);
  const params = f.params();
  if (params.target.kind !== "defaults") throw new Error("expected defaults");
  params.target.globalTemplateRevision = revision; params.target.characterTemplateRevision = revision;
  const applied = f.owner.submit(await f.request(params)); await f.owner.stop();
  expect(f.owner.status(applied.operationId).state).toBe("completed");
  let exports = 0;
  f.native.client.exportTemplate = async () => { exports++; throw new Error("managed revalidation must not fall through to legacy export"); };
  return { f, owner: connectionOwner(f), exports: () => exports };
}

describe("connection revalidation of independently managed selections", () => {
  it.each([TAKI_MANAGED_TEMPLATE_REVISION, "taki-bank-v2", "none"])("verifies %s using its exact receipt/current snapshot without new Native writes", async (revision) => {
    const { f, owner, exports } = await fixture(revision);
    const setup = createHindsightBankSetupRepo(f.db).list();
    const selections = f.db.prepare("SELECT * FROM hindsight_template_selections").all();
    const receipts = structuredClone([...f.native.receipts]);
    const priorCalls = f.native.calls.length;
    const operation = owner.submit({ kind: "connection.revalidate", expectedEpochId: "epoch" }); await owner.stop();
    expect(owner.status(operation.operationId)).toMatchObject({ state: "completed", result: { outcome: "unchanged" } });
    expect(createHindsightBankSetupRepo(f.db).list()).toEqual(setup);
    expect(f.db.prepare("SELECT * FROM hindsight_template_selections").all()).toEqual(selections);
    expect([...f.native.receipts]).toEqual(receipts);
    expect(f.native.calls.slice(priorCalls).map((call) => call.method)).toEqual(["compatibility", "snapshot", "snapshot"]);
    expect(exports()).toBe(0);
  });

  it("refuses an external managed definition edit before publishing a new reviewed connection", async () => {
    const { f, owner, exports } = await fixture();
    const banks = createHindsightBankSetupRepo(f.db).list();
    const connection = createHindsightConnectionRepo(f.db).read(banks);
    const snapshot = f.native.client.templateSnapshot!;
    f.native.client.templateSnapshot = async (input) => {
      const value = await snapshot(input);
      return signFixtureSnapshot({ ...value, config: value.config.map((entry) => entry.key === "retain_mission"
        ? { ...entry, stored: { kind: "value", value: "External unreviewed instruction" } } : entry) });
    };
    const nativeWrites = f.native.calls.filter((call) => call.method === "apply").length;
    const operation = owner.submit({ kind: "connection.revalidate", expectedEpochId: "epoch" }); await owner.stop();
    expect(owner.status(operation.operationId).state).toBe("failed");
    expect(createHindsightConnectionRepo(f.db).read(banks)).toEqual(connection);
    expect(createHindsightBankSetupRepo(f.db).list()).toEqual(banks);
    expect(f.native.calls.filter((call) => call.method === "apply")).toHaveLength(nativeWrites);
    expect(exports()).toBe(0);
  });
});
