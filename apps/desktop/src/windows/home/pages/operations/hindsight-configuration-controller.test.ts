import { afterEach, describe, expect, it, vi } from "vitest";
import type { HindsightConfigurationParams, HindsightConfigurationStatus } from "@taki/shared";
import { configurationObservationFixture } from "../../../../../../../packages/core/src/testing/hindsight-configuration-fixture.ts";
import { createConfigurationController, INITIAL_CONFIGURATION, type ConfigurationViewState } from "./hindsight-configuration-controller.ts";
import { configurationRows } from "./hindsight-configuration-state.ts";

const params = { scope: { kind: "global" as const } };
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
const disposals: Array<() => void> = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => { for (const dispose of disposals.splice(0)) dispose(); vi.useRealTimers(); });
function fixture() {
  const native = configurationObservationFixture();
  disposals.push(() => native.service.dispose());
  const client = {
    hindsightConfigurationStatus: vi.fn(async (input: HindsightConfigurationParams) => native.service.status(input)),
    hindsightConfigurationObserve: vi.fn((input: HindsightConfigurationParams) => native.service.observe(input)),
  };
  let state = INITIAL_CONFIGURATION;
  const history: ConfigurationViewState[] = [];
  const controller = createConfigurationController((value) => { state = value; history.push(value); });
  disposals.push(() => controller.dispose());
  return { native, client, controller, history, state: () => state };
}

describe("configuration observation Home controller with the actual Core service/client", () => {
  it("reads Core on mount, observes explicitly, displays genuine comparisons and never calls model health", async () => {
    const f = fixture(); f.controller.replace(f.client, params.scope); await flush();
    expect(f.state()).toMatchObject({ kind: "ready", data: { status: "not_observed" } });
    expect(f.native.state.calls).toEqual([]);
    await f.controller.observe();
    const state = f.state(); if (state.kind !== "ready") throw new Error("expected Core result");
    expect(configurationRows(state.data)).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "defaultModel", actual: "model", comparison: "match" }),
      expect.objectContaining({ field: "reflectModel", actual: "mock · model", comparison: "mismatch" }),
      expect.objectContaining({ field: "embeddingProvider", comparison: "unknown" }),
    ]));
    expect(f.native.state.calls).toEqual(["/ext/taki-memory/version", "/ext/taki-memory/banks/bank/configuration-observation"]);
  });

  it.each(["deny", "fail"])("clears old model evidence immediately and after a %s refresh", async (mode) => {
    const f = fixture(); f.controller.replace(f.client, params.scope); await flush(); await f.controller.observe();
    f.native.state.mode = mode;
    const next = f.controller.observe(); expect(f.state()).toEqual({ kind: "observing", data: null }); await next;
    expect(f.state()).toMatchObject({ kind: "ready", data: { status: mode === "deny" ? "not_authorized" : "unavailable", observation: null } });
    expect(JSON.stringify(f.state())).not.toContain("private-fixture-error");
  });

  it("uses Core truth across two observers and remount/reconnect without observation replay", async () => {
    const f = fixture(); let second: ConfigurationViewState = INITIAL_CONFIGURATION;
    const other = createConfigurationController((value) => { second = value; }); disposals.push(() => other.dispose());
    f.controller.replace(f.client, params.scope); await flush(); await f.controller.observe();
    other.replace(f.client, params.scope); await flush(); expect(second).toEqual(f.state());
    other.dispose(); other.replace(f.client, params.scope); await flush();
    f.controller.replace(null, params.scope); expect(f.state().data).toBeNull();
    f.controller.replace({ ...f.client }, params.scope); await flush(); expect(second).toEqual(f.state());
    expect(f.client.hindsightConfigurationObserve).toHaveBeenCalledTimes(1);
  });

  it("ignores a retired connection response and a late response for the previous scope", async () => {
    const f = fixture(); const delayed = deferred<HindsightConfigurationStatus>();
    f.client.hindsightConfigurationStatus.mockReturnValueOnce(delayed.promise);
    f.controller.replace(f.client, params.scope);
    f.controller.replace({ ...f.client }, { kind: "character", characterId: "taki" }); await flush();
    delayed.resolve(f.native.service.status(params)); await flush();
    expect(f.state()).toMatchObject({ data: { scope: { kind: "character", characterId: "taki" }, bankId: "bank-taki" } });
  });

  it("rejects a response with the wrong scope and never displays raw transport/validation errors", async () => {
    const f = fixture(); f.client.hindsightConfigurationStatus.mockResolvedValueOnce(f.native.service.status(params));
    f.controller.replace(f.client, { kind: "character", characterId: "taki" }); await flush();
    expect(f.state()).toEqual({ kind: "failed", data: null });
    f.client.hindsightConfigurationStatus.mockRejectedValueOnce(new Error("SECRET_ENDPOINT_SENTINEL"));
    await f.controller.refresh(); expect(f.state()).toEqual({ kind: "failed", data: null });
    expect(JSON.stringify(f.history)).not.toContain("SECRET_ENDPOINT_SENTINEL");
  });

  it("expires once, reads Core once, and never turns expiry into periodic observation", async () => {
    vi.useFakeTimers(); const f = fixture(); f.controller.replace(f.client, params.scope); await flush(); await f.controller.observe();
    f.native.state.time = 60_000;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.state()).toMatchObject({ kind: "ready", data: { status: "stale", reason: "expired", observation: null } });
    expect(f.client.hindsightConfigurationStatus).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(f.client.hindsightConfigurationStatus).toHaveBeenCalledTimes(2);
    expect(f.client.hindsightConfigurationObserve).toHaveBeenCalledTimes(1);
  });

  it("does not rearm the same expired evidence if a delayed status still claims validity", async () => {
    vi.useFakeTimers(); const f = fixture(); f.controller.replace(f.client, params.scope); await flush(); await f.controller.observe();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.state()).toEqual({ kind: "expired", data: null });
    await vi.advanceTimersByTimeAsync(180_000); expect(f.client.hindsightConfigurationStatus).toHaveBeenCalledTimes(2);
    await f.controller.observe(); expect(f.state()).toMatchObject({ kind: "ready", data: { status: "observed" } });
  });

  it("subtracts response transit time and rejects evidence already expired on arrival", async () => {
    vi.useFakeTimers(); const f = fixture(); await f.native.service.observe(params); f.native.state.time = 59_500;
    const late = f.native.service.status(params); const pending = deferred<HindsightConfigurationStatus>();
    f.client.hindsightConfigurationStatus.mockReturnValueOnce(pending.promise); f.controller.replace(f.client, params.scope);
    await vi.advanceTimersByTimeAsync(501); pending.resolve(late); await flush();
    expect(f.state()).toEqual({ kind: "expired", data: null }); expect(vi.getTimerCount()).toBe(0);
  });

  it("disposal cancels expiry work and duplicate refreshes do not stack", async () => {
    vi.useFakeTimers(); const f = fixture(); const pending = deferred<HindsightConfigurationStatus>();
    f.client.hindsightConfigurationStatus.mockReturnValueOnce(pending.promise); f.controller.replace(f.client, params.scope);
    await f.controller.refresh(); await f.controller.observe(); expect(f.client.hindsightConfigurationStatus).toHaveBeenCalledTimes(1);
    expect(f.client.hindsightConfigurationObserve).not.toHaveBeenCalled();
    pending.resolve(f.native.service.status(params)); await flush(); await f.controller.observe(); f.controller.dispose();
    await vi.advanceTimersByTimeAsync(120_000); expect(f.client.hindsightConfigurationStatus).toHaveBeenCalledTimes(1);
  });
});
