import { afterEach, describe, expect, it } from "vitest";
import { MemoryHindsightStatusSectionSchema, type HindsightBankSetupProjection } from "@taki/shared";
import { APPLICATION_TEST_AT } from "../../testing/hindsight-application-fixtures.ts";
import { hindsightRuntimeFixture } from "../../testing/hindsight-runtime-composition-fixtures.ts";
import { hindsightBankBindings } from "../hindsight/hindsight-bank-identity.ts";
import { readHindsightLiveConnection } from "../hindsight/hindsight-runtime-connection.ts";
import { readHindsightLifecycleStatus, type HindsightLifecycleStatusInput } from "./memory-hindsight-lifecycle-status.ts";
import { setupSnapshot } from "./memory-operation-fixtures.ts";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

function fixture() {
  const f = hindsightRuntimeFixture(); cleanup.push(f.close);
  const row = (characterId: string, patch: Partial<HindsightBankSetupProjection>) => f.setup.upsert({ scope: "character",
    canonicalIdentity: `character:${characterId}`, externalBankId: `bank-${characterId}`, templateRevision: "taki-bank-v1",
    templateDigest: "b".repeat(64), status: "verified", operationIds: [], lastVerifiedAt: APPLICATION_TEST_AT, lastError: null, ...patch });
  row("rana", { status: "failed", lastVerifiedAt: null, lastError: { code: "HINDSIGHT_TEMPLATE_INVALID", retryable: false, nextAction: "Fix the template." } });
  row("sayo", { status: "pending", lastVerifiedAt: null });
  row("yuki", {});
  for (const characterId of ["taki", "mika", "x".repeat(200)]) f.timeline.append({ characterId, role: "user", content: "hello" });
  const live = readHindsightLiveConnection({ config: f.source, secrets: f.secrets.catalog });
  if (live.state !== "ready") throw new Error("fixture connection must be ready");
  const input = (patch: Partial<HindsightLifecycleStatusInput> = {}): HindsightLifecycleStatusInput => ({ db: f.db, epochId: "epoch", live,
    runtimeDrift: "none", setup: setupSnapshot({ banks: f.setup.list(), configFingerprint: live.fingerprint }), provisioning: ["sayo"],
    busy: false, unavailableReason: null, revalidateBlocked: false, ...patch });
  return { f, live, input };
}

describe("Hindsight lifecycle status section", () => {
  it("projects all five readiness states from B3 rows, replica binding, open operations and the Timeline", () => {
    const { input } = fixture();
    const section = readHindsightLifecycleStatus(input());
    expect(MemoryHindsightStatusSectionSchema.parse(section)).toEqual(section);
    const readiness = Object.fromEntries(section.banks.map((bank) => [bank.characterId ?? "global", [bank.readiness, bank.errorCode]]));
    expect(readiness).toEqual({ global: ["ready", null], taki: ["ready", null], rana: ["failed", "HINDSIGHT_TEMPLATE_INVALID"],
      sayo: ["provisioning", null], yuki: ["syncing", null], mika: ["not_provisioned", null], ["x".repeat(200)]: ["not_provisioned", null] });
    expect(section.banks.find((bank) => bank.characterId === "mika")?.nativeBankId).toBe(hindsightBankBindings("mika")[1].externalBankId);
    expect(section.banks.find((bank) => bank.characterId === "x".repeat(200))?.nativeBankId).toBeNull();
    expect(section.banks.filter((bank) => bank.characterId === "taki")).toHaveLength(1);
    expect(section.actions).toEqual({ revalidate: false, provision: ["rana", "mika"] });
    // Without an open operation a pending row is not provisioning; a replica bound under another epoch is not ready.
    const idle = readHindsightLifecycleStatus(input({ provisioning: [], epochId: "other-epoch" }));
    expect(idle.banks.find((bank) => bank.characterId === "sayo")?.readiness).toBe("not_provisioned");
    expect(idle.banks.find((bank) => bank.characterId === "taki")?.readiness).toBe("syncing");
  });

  it("separates runtime drift, an unreviewed boot config and a disabled connection without probing the network", () => {
    const { f, live, input } = fixture(); const other = "c".repeat(64);
    const drift = (patch: Partial<HindsightLifecycleStatusInput>) => readHindsightLifecycleStatus(input(patch)).connection;
    expect(drift({})).toEqual({ config: "ready", drift: "none", admittedAt: null });
    expect(drift({ runtimeDrift: "config_changed" }).drift).toBe("config_changed");
    const reviewed = (fingerprint: string) => setupSnapshot({ banks: f.setup.list(), configFingerprint: fingerprint });
    expect(drift({ setup: reviewed(other) }).drift).toBe("unreviewed");
    expect(drift({ setup: reviewed(other), runtimeDrift: null }).drift).toBe("config_changed");
    expect(drift({ setup: reviewed(live.fingerprint), runtimeDrift: null }).drift).toBe("none");
    expect(drift({ live: { state: "disabled", fingerprint: null }, runtimeDrift: "connection_disabled" }))
      .toEqual({ config: "disabled", drift: "none", admittedAt: null });
    expect(f.remote.calls).toEqual([]);
  });

  it("derives actions from drift, runtime availability and an open exclusive family only", () => {
    const { f, input } = fixture();
    const actions = (patch: Partial<HindsightLifecycleStatusInput>) => readHindsightLifecycleStatus(input(patch)).actions;
    expect(actions({ runtimeDrift: "config_changed", unavailableReason: "config_changed" })).toEqual({ revalidate: true, provision: [] });
    expect(actions({ runtimeDrift: null, unavailableReason: "not_installed" })).toEqual({ revalidate: true, provision: [] });
    expect(actions({ setup: setupSnapshot({ banks: f.setup.list(), configFingerprint: "c".repeat(64) }) }).revalidate).toBe(true);
    for (const reason of ["stopped", "authority_mismatch"] as const) expect(actions({ runtimeDrift: null, unavailableReason: reason }).revalidate).toBe(false);
    expect(actions({ live: { state: "disabled", fingerprint: null }, runtimeDrift: "connection_disabled", unavailableReason: "connection_disabled" }))
      .toEqual({ revalidate: false, provision: [] });
    expect(actions({ busy: true, runtimeDrift: "config_changed", unavailableReason: "config_changed" })).toEqual({ revalidate: false, provision: [] });
    expect(actions({ busy: true })).toEqual({ revalidate: false, provision: [] });
    // A Stage 5 change keeps its drift visible but is never offered as a revalidation.
    expect(readHindsightLifecycleStatus(input({ runtimeDrift: "config_changed", unavailableReason: "config_changed", revalidateBlocked: true })))
      .toMatchObject({ connection: { drift: "config_changed" }, actions: { revalidate: false } });
  });

  it("reports the stored admission evidence time for the current epoch and fingerprint only", async () => {
    const { f, input } = fixture();
    await f.compose().captureRun("taki");
    const admittedAt = readHindsightLifecycleStatus(input()).connection.admittedAt;
    expect(admittedAt).not.toBeNull();
    expect(readHindsightLifecycleStatus(input({ epochId: "other-epoch" })).connection.admittedAt).toBeNull();
  });
});
