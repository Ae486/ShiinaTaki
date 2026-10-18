import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createConfigSource } from "../../config/config-source.ts";
import { createConfigRepo } from "../../db/config-repo.ts";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { createHealthyTransitionHarness } from "../../testing/memory-transition-healthy-fixtures.ts";
import { W3_AT } from "../../testing/memory-transition-candidate-fixtures.ts";
import { configurationObservationFixture } from "../../testing/hindsight-configuration-fixture.ts";
import { createSecretCatalogService } from "../../secrets/secret-catalog-service.ts";
import { createHindsightConnectionSecret, HINDSIGHT_SECRET_REFS } from "./hindsight-secret-refs.ts";
import { projectHindsightCompatibilityManifest } from "./hindsight-compatibility-service.ts";
import { readHindsightConfigurationContext } from "./hindsight-configuration-context.ts";
import { createHindsightConfigurationService } from "./hindsight-configuration-service.ts";

afterEach(() => vi.useRealTimers());

it.each(["replace", "restore"])("rejects a real same-millisecond catalog %s while a response is in flight", async (mode) => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(W3_AT);
  const h = await createHealthyTransitionHarness();
  const f = configurationObservationFixture(); f.service.dispose();
  let service: ReturnType<typeof createHindsightConfigurationService> | undefined;
  try {
    h.db.prepare("UPDATE hindsight_connection_state SET compatibility_json=:compatibility WHERE singleton=1")
      .run({ compatibility: JSON.stringify(projectHindsightCompatibilityManifest(h.remote.manifest)) });
    const catalog = await createSecretCatalogService({ filePath: join(h.dataDir, "observation-test-catalog.bin"),
      storeId: "11111111-1111-4111-8111-111111111111", logger: createCaptureLogger().logger,
      keySource: { kind: "credentials-directory", canCreate: false, read: () => new Uint8Array(32).fill(7), create: () => { throw new Error("not used"); } } });
    catalog.set(HINDSIGHT_SECRET_REFS.connectionApiKey, "owned-key-a");
    const original = catalog.backup();
    const secret = createHindsightConnectionSecret(catalog);
    const config = createConfigSource({ repo: createConfigRepo(h.db), env: {
      TAKI_HINDSIGHT_ENABLED: "true", TAKI_HINDSIGHT_ENDPOINT: "http://127.0.0.1:18481" } });
    const context = { db: h.db, config, secret, configurationRevision: () => 0, secretRevision: () => catalog.revision() };
    const scope = { kind: "global" as const };
    const before = readHindsightConfigurationContext(context, scope)!;
    Object.assign(f.current, before); f.manifest.provider.lineage = before.providerLineage;
    const entered = deferred(); const released = deferred();
    f.state.reply = async (value) => { entered.resolve(); await released.promise; return { status: 200, body: JSON.stringify(value) }; };
    service = createHindsightConfigurationService({ ...f.deps, read: (target) => readHindsightConfigurationContext(context, target) });
    const old = service.observe({ scope }); await entered.promise;
    catalog.set(HINDSIGHT_SECRET_REFS.connectionApiKey, "owned-key-b");
    if (mode === "restore") catalog.restore(original.envelope);
    const after = readHindsightConfigurationContext(context, scope)!;
    // The original persisted fingerprint intentionally stays unchanged here:
    // only the private observation generation fixes timestamp/restore ABA.
    expect(after.connectionFingerprint).toBe(before.connectionFingerprint);
    released.resolve();
    expect(await old).toMatchObject({ status: "stale", reason: "context_changed", observation: null });
    expect(after.contextIdentity).not.toBe(before.contextIdentity);
    expect(service.status({ scope }).observation).toBeNull();
  } finally { service?.dispose(); await h.close(); }
}, 30_000);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}
