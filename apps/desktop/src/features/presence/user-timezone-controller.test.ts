import { describe, expect, it, vi } from "vitest";
import type { UserTimezoneState, UserTimezoneReadResult, UserTimezoneMutationResult } from "@taki/shared";
import { createUserTimezoneController } from "./user-timezone-controller.ts";

const DEVICE = "a47b05fd-f704-4d6e-9607-b78697795a17";
const SOURCE = "cc077ad2-e950-4daf-9fe8-69bf9e5e090a";
function state(overrides: Partial<UserTimezoneState> = {}): UserTimezoneState {
  return { timezone: "UTC", mode: "follow-primary-device", authorityDeviceId: DEVICE, revision: 1,
    updatedAt: "2026-09-27T00:00:00Z", confirmedAt: null, source: "bootstrap", sourceDeviceId: null, ...overrides };
}
function fixture() {
  let current = state(); let zone = "Asia/Shanghai";
  const read = vi.fn(async (): Promise<UserTimezoneReadResult> => ({ state: current, reportStatus: "awaiting-report", reportSourceId: SOURCE }));
  const report = vi.fn(async (): Promise<UserTimezoneMutationResult> => {
    current = state({ timezone: zone, revision: current.revision + 1, source: "device", sourceDeviceId: DEVICE, confirmedAt: "2026-09-27T00:00:00Z" });
    return { status: "accepted", state: current };
  });
  const update = vi.fn(async (): Promise<UserTimezoneMutationResult> => ({ status: "accepted", state: current }));
  const controller = createUserTimezoneController({ client: { userTimezoneRead: read, userTimezoneReport: report, userTimezoneUpdate: update },
    deviceId: DEVICE, timezone: () => zone });
  return { controller, read, report, update, zone: (next: string) => { zone = next; }, state: (next: UserTimezoneState) => { current = next; } };
}
describe("Home designated timezone reporter", () => {
  it("claims once, confirms actual zone, and only reports another device-zone change", async () => {
    const f = fixture(); await f.controller.refresh(); await f.controller.refresh();
    expect(f.read.mock.calls).toEqual([[], [{ claimReportSource: true }], []]);
    expect(f.report).toHaveBeenCalledTimes(1);
    expect(f.report).toHaveBeenCalledWith({ expectedRevision: 1, timezone: "Asia/Shanghai", reportSourceId: SOURCE });
    f.zone("Europe/London"); await f.controller.refresh(); expect(f.report).toHaveBeenCalledTimes(2);
    f.controller.dispose();
  });
  it("does not claim fixed/foreign authority or replay a retired source", async () => {
    const f = fixture(); f.state(state({ mode: "fixed", authorityDeviceId: null })); await f.controller.refresh();
    expect(f.read).toHaveBeenCalledTimes(1); expect(f.report).not.toHaveBeenCalled();
    f.state(state()); f.report.mockResolvedValue({ status: "refused", reason: "stale-source", state: state() });
    await f.controller.refresh(); await f.controller.refresh();
    expect(f.report).toHaveBeenCalledTimes(1); f.controller.dispose();
  });
  it("drops a late claim after generation retirement and never submits a report", async () => {
    const f = fixture(); let done!: (value: UserTimezoneReadResult) => void;
    f.read.mockImplementationOnce(() => new Promise((resolve) => { done = resolve; }));
    const pending = f.controller.refresh(); f.controller.dispose(); done({ state: state(), reportStatus: "awaiting-report" });
    await pending; expect(f.report).not.toHaveBeenCalled();
  });
  it("uses a revision-fenced explicit setting without silently retrying a conflict", async () => {
    const f = fixture(); await f.controller.refresh();
    f.update.mockResolvedValue({ status: "refused", reason: "revision-conflict", state: state({ revision: 8 }) });
    await f.controller.save({ mode: "fixed", timezone: "Europe/Paris" });
    expect(f.update).toHaveBeenCalledOnce();
    expect(f.update).toHaveBeenCalledWith({ mode: "fixed", timezone: "Europe/Paris", expectedRevision: 2 });
    expect(f.controller.snapshot().error).toContain("已变化"); f.controller.dispose();
  });
  it("keeps a foreign reporter read-only and preserves unavailable truth after a refusal", async () => {
    const f = fixture(); f.state(state({ authorityDeviceId: "7f88523a-4051-4f5f-b266-7bebf10f44bd" }));
    await f.controller.refresh(); expect(f.read.mock.calls).toEqual([[]]); expect(f.report).not.toHaveBeenCalled();
    f.controller.dispose();
    const next = fixture(); next.report.mockResolvedValue({ status: "refused", reason: "stale-source", state: state() });
    await next.controller.refresh(); expect(next.controller.snapshot().data?.reportStatus).toBe("unavailable");
    next.controller.dispose();
  });
  it("does not replay a lost report acknowledgement, while new device-zone evidence can report", async () => {
    const f = fixture(); f.report.mockRejectedValueOnce(new Error("outcome unknown"));
    await f.controller.refresh(); await f.controller.refresh(); expect(f.report).toHaveBeenCalledOnce();
    f.zone("Europe/Paris"); await f.controller.refresh(); expect(f.report).toHaveBeenCalledTimes(2); f.controller.dispose();
  });
  it("retires an old read before an explicit save and keeps its late result out", async () => {
    const f = fixture(); await f.controller.refresh();
    let finish!: (value: UserTimezoneReadResult) => void;
    f.read.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const oldRead = f.controller.refresh();
    const fixed = state({ mode: "fixed", authorityDeviceId: null, revision: 5, timezone: "Europe/Paris" });
    f.update.mockResolvedValueOnce({ status: "accepted", state: fixed });
    await f.controller.save({ mode: "fixed", timezone: "Europe/Paris" });
    finish({ state: state(), reportStatus: "unavailable" }); await oldRead;
    expect(f.controller.snapshot().data?.state).toEqual(fixed); f.controller.dispose();
  });
});
