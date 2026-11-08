import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HINDSIGHT_TRANSITION_BUILD } from "@taki/shared";
import { configurationObservationFixture } from "../../testing/hindsight-configuration-fixture.ts";
import { createHindsightConfigurationService } from "./hindsight-configuration-service.ts";
import type { HindsightTransportResponse } from "./hindsight-client.ts";

const params = { scope: { kind: "global" as const } };
const owned: ReturnType<typeof configurationObservationFixture>[] = [];
function fixture() { const value = configurationObservationFixture(); owned.push(value); return value; }
afterEach(() => { for (const value of owned.splice(0)) value.service.dispose(); });
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe("API-runtime configuration observations", () => {
  it("uses actual bounded transport, compares only covered requested fields and performs no health/write", async () => {
    const f = fixture();
    const value = await f.service.observe(params);
    expect(value).toMatchObject({ status: "observed", identity: "pinned", validForMs: 60_000,
      comparison: { defaultModel: "match", defaultProvider: "match", retainModel: "not_requested", reflectModel: "mismatch", embeddingProvider: "unknown" } });
    expect(f.service.status(params)).toEqual(value);
    expect(f.state.calls).toEqual(["/ext/taki-memory/version", "/ext/taki-memory/banks/bank/configuration-observation"]);
    expect(JSON.stringify(value)).not.toMatch(/fixture-secret|private-fixture-error/);
  });

  it.each(["deny", "fail"])("a newer %s discards the previous green match and model strings", async (mode) => {
    const f = fixture(); await f.service.observe(params); f.state.mode = mode;
    expect(await f.service.observe(params)).toMatchObject({ status: mode === "deny" ? "not_authorized" : "unavailable", observation: null });
    expect(f.service.status(params).comparison.defaultModel).toBe("unknown");
  });

  it("expires against Core monotonic time, invalidates on changed context and restarts empty", async () => {
    const f = fixture(); await f.service.observe(params); f.state.time = 59_999;
    expect(f.service.status(params).validForMs).toBe(1);
    f.state.time = 60_000;
    expect(f.service.status(params)).toMatchObject({ status: "stale", reason: "expired", observation: null });
    await f.service.observe(params); f.current.contextIdentity = "changed";
    expect(f.service.status(params)).toMatchObject({ status: "stale", reason: "context_changed", observation: null });
    const restarted = createHindsightConfigurationService(f.deps);
    try { expect(restarted.status(params).status).toBe("not_observed"); } finally { restarted.dispose(); }
  });

  it("uses a status capture with the same observation state while network observation keeps independent reads", async () => {
    const f = fixture(); const observed = await f.service.observe(params);
    const read = vi.spyOn(f.deps, "read");
    try {
      expect(f.service.status(params, structuredClone(f.current))).toEqual(observed);
      expect(read).not.toHaveBeenCalled();
      f.state.time = 60_000;
      expect(f.service.status(params, f.current)).toMatchObject({ status: "stale", reason: "expired", observation: null });
      expect(await f.service.observe(params)).toMatchObject({ status: "observed" });
      expect(read.mock.calls.length).toBeGreaterThan(1);
      expect(f.service.status(params, { ...f.current, contextIdentity: "changed-selection" }))
        .toMatchObject({ status: "stale", reason: "context_changed", observation: null });
      expect(f.service.status(params, null)).toMatchObject({ status: "unavailable", observation: null });
      f.service.dispose();
      expect(f.service.status(params, f.current)).toMatchObject({ status: "unavailable", observation: null });
    } finally { read.mockRestore(); }
  });

  it("coalesces concurrent observers and rejects a changed-context response without overwriting a newer request", async () => {
    const f = fixture();
    const delayed = deferred<HindsightTransportResponse>();
    const entered = deferred<void>();
    f.state.reply = async (value) => { entered.resolve(); await delayed.promise; return { status: 200, body: JSON.stringify(value) }; };
    const first = f.service.observe(params); const second = f.service.observe(params);
    expect(first).toBe(second); await entered.promise;
    expect(f.state.calls.length).toBe(2);
    f.current.contextIdentity = "secret-or-epoch-change";
    f.state.reply = null;
    const fresh = await f.service.observe(params);
    delayed.resolve({ status: 200, body: "ignored" });
    await first;
    expect(f.service.status(params)).toEqual(fresh);
  });

  it.each(["nonce", "build", "lineage", "generation", "bank"])("refuses wrong %s identity", async (kind) => {
    const f = fixture();
    f.state.rewrite = (value) => {
      if (kind === "nonce") value.nonce = randomUUID();
      if (kind === "build") value.source.compatibilityBuild = "unsupported-build";
      if (kind === "lineage") value.target.providerLineage = randomUUID();
      if (kind === "generation") value.target.bankGeneration = randomUUID();
      if (kind === "bank") value.target.bankId = "other";
      return value;
    };
    expect(await f.service.observe(params)).toMatchObject({ status: "identity_mismatch", observation: null });
  });

  it.each(["extra", "unsafe", "oversized"])("rejects %s payload without a raw error", async (kind) => {
    const f = fixture();
    f.state.rewrite = (value) => kind === "extra" ? { ...value, secret: "private-fixture-error" }
      : { ...value, profiles: { ...value.profiles, default: { kind: "single", provider: "mock", configuredModel: kind === "unsafe" ? "https://private/secret" : "x".repeat(16_385) } } };
    expect(await f.service.observe(params)).toMatchObject({ status: "unavailable", reason: "invalid_response", observation: null });
  });

  it("keeps the old build optional and labels first setup observation unpinned", async () => {
    const f = fixture(); f.manifest.source_identity.compatibility_build = HINDSIGHT_TRANSITION_BUILD;
    delete f.manifest.contracts.configuration_observation;
    expect(await f.service.observe(params)).toMatchObject({ status: "unsupported", reason: "capability_missing" });
    expect(f.state.calls).toHaveLength(1);
    const fresh = fixture(); fresh.current.providerLineage = null; fresh.current.bankGeneration = null;
    expect(await fresh.service.observe(params)).toMatchObject({ status: "observed", identity: "unpinned" });
  });

  it("withdraws other-Bank observations after API process replacement", async () => {
    const f = fixture(); await f.service.observe(params);
    f.state.session = randomUUID();
    await f.service.observe({ scope: { kind: "character", characterId: "taki" } });
    expect(f.service.status(params)).toMatchObject({ status: "stale", reason: "runtime_changed", observation: null });
  });

  it("rejects an older in-flight response from the replaced process across Banks", async () => {
    const f = fixture();
    const delayed = deferred<void>(); const entered = deferred<void>();
    f.state.reply = async (value) => { entered.resolve(); await delayed.promise; return { status: 200, body: JSON.stringify(value) }; };
    const old = f.service.observe(params); await entered.promise;
    f.state.reply = null; f.state.session = randomUUID();
    const newest = await f.service.observe({ scope: { kind: "character", characterId: "taki" } });
    delayed.resolve();
    expect(await old).toMatchObject({ status: "stale", reason: "runtime_changed", observation: null });
    expect(newest.status).toBe("observed");
  });
});
