import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonRpcSuccessResponseSchema, MEMORY_TEMPLATE_METHODS, MemoryTemplateStatusSchema } from "@taki/shared";
import { composeHindsightTemplates } from "../../../boot/hindsight-template-boot.ts";
import { createConfigRepo } from "../../../db/config-repo.ts";
import { openDatabase, type Database } from "../../../db/sqlite.ts";
import { createMethodRegistry, type MethodContext } from "../../../server/method-registry.ts";
import * as authority from "../../legacy-migration/legacy-activation-repo.ts";
import { templateLifecycleFixture, type TemplateLifecycleFixture } from "./template-lifecycle-fixtures.ts";

const fixtures: TemplateLifecycleFixture[] = [];
const services: ReturnType<typeof composeHindsightTemplates>[] = [];
const readers: Database[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const service of services.splice(0)) service.stop();
  for (const reader of readers.splice(0)) reader.close();
  for (const fixture of fixtures.splice(0)) await fixture.close();
});

async function published(bound = true) {
  const f = templateLifecycleFixture({ globalOnly: true }); fixtures.push(f);
  f.state.failBinding = !bound;
  const operation = f.owner.submit(await f.request()); await f.owner.stop();
  expect(f.owner.status(operation.operationId).state).toBe(bound ? "completed" : "failed");
  return { f, operation, plan: f.plan(operation) };
}

function facade(f: TemplateLifecycleFixture, statusObservation: NonNullable<Parameters<typeof composeHindsightTemplates>[0]["statusObservation"]>) {
  const registry = createMethodRegistry();
  const service = composeHindsightTemplates({ db: f.db, config: f.deps.config, secrets: f.deps.secrets,
    bootId: f.state.bootId, runtime: f.deps.runtime, registry, statusObservation });
  services.push(service);
  const context: MethodContext = { connection: { state: { status: "authenticated", deviceId: "template-status", role: "operator", capabilities: [] } },
    notify: () => undefined, close: () => undefined, onClose: () => undefined };
  const dispatch = () => registry.dispatch({ jsonrpc: "2.0", id: randomUUID(), method: MEMORY_TEMPLATE_METHODS.status, params: {} }, context);
  return { service, dispatch, read: async () => MemoryTemplateStatusSchema.parse(JsonRpcSuccessResponseSchema.parse(await dispatch()).result) };
}

describe("boot-composed template status observation", () => {
  it("uses one observed selection and binding for RPC status while original service reads and recovery stay independent", async () => {
    const { f, operation, plan } = await published();
    const expected = f.service.status();
    expect(expected.catalogs).toEqual([
      { revision: "taki-bank-v3", scope: "global" }, { revision: "taki-bank-v3", scope: "character" },
      { revision: "taki-bank-v2", scope: "global" }, { revision: "taki-bank-v2", scope: "character" },
    ]);
    const observe = vi.fn(() => ({ selection: authority.readMemoryAuthoritySelection(f.db), boundSelectionIdentity: f.state.bound }));
    const rpc = facade(f, observe);
    const selected = vi.spyOn(authority, "readMemoryAuthoritySelection");
    const current = vi.spyOn(authority, "readCurrentMemoryAuthorityIdentity");
    const bound = vi.spyOn(f.deps.runtime, "boundSelectionIdentity");
    const calls = structuredClone(f.native.calls);
    const changes = f.db.prepare("SELECT total_changes() AS count").get();

    expect(await rpc.read()).toEqual(expected);
    expect(observe).toHaveBeenCalledTimes(1); expect(selected).toHaveBeenCalledTimes(1); expect(bound).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    for (const read of [() => rpc.service.status(), () => rpc.service.observe(operation), () => rpc.service.observe(operation, true)]) {
      selected.mockClear(); current.mockClear(); bound.mockClear(); read();
      expect(current).toHaveBeenCalledTimes(1); expect(selected).not.toHaveBeenCalled();
      expect(bound).toHaveBeenCalled(); expect(observe).toHaveBeenCalledTimes(1);
    }
    selected.mockClear();
    expect(() => rpc.service.admit({ kind: "template.recover", requestId: randomUUID(), planId: plan.planId }))
      .toThrow("MEMORY_TEMPLATE_ALREADY_BOUND");
    expect(selected).toHaveBeenCalled(); expect(observe).toHaveBeenCalledTimes(1);

    observe.mockImplementationOnce(() => { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); });
    expect(await rpc.dispatch()).toHaveProperty("error");
    expect(rpc.service.status()).toEqual(expected);
    expect(f.native.calls).toEqual(calls); expect(f.db.prepare("SELECT total_changes() AS count").get()).toEqual(changes);
  });

  it("keeps recovery guards on the observed SQLite snapshot and rejects configuration ABA on the next read and actual admission", async () => {
    const { f, plan } = await published(false);
    const other = openDatabase({ path: join(f.base.dataDir, "memory.sqlite"), migrations: [] }); readers.push(other);
    let changed = false;
    const rpc = facade(f, () => {
      const selection = authority.readMemoryAuthoritySelection(f.db);
      // A second writer commits after the observation. The remaining pure status read must keep its first snapshot.
      if (!changed) {
        changed = true;
        const config = createConfigRepo(other);
        config.upsert("TAKI_HINDSIGHT_ENABLED", false); config.upsert("TAKI_HINDSIGHT_ENABLED", true);
      }
      return { selection, boundSelectionIdentity: f.state.bound };
    });
    const selected = vi.spyOn(authority, "readMemoryAuthoritySelection");
    const bound = vi.spyOn(f.deps.runtime, "boundSelectionIdentity");
    const calls = structuredClone(f.native.calls);
    expect(await rpc.read()).toMatchObject({ recoverPlanId: plan.planId, recoverUnavailableReason: null });
    expect(changed).toBe(true); expect(selected).toHaveBeenCalledTimes(1); expect(bound).not.toHaveBeenCalled();

    selected.mockClear();
    expect(await rpc.read()).toMatchObject({ recoverPlanId: null, recoverUnavailableReason: "stale" });
    expect(selected).toHaveBeenCalledTimes(1); expect(bound).not.toHaveBeenCalled();
    expect(rpc.service.status()).toMatchObject({ recoverPlanId: null, recoverUnavailableReason: "stale" });
    expect(() => rpc.service.admit({ kind: "template.recover", requestId: randomUUID(), planId: plan.planId }))
      .toThrow("MEMORY_TEMPLATE_IDENTITY_CHANGED");
    expect(f.native.calls).toEqual(calls);
  });
});
