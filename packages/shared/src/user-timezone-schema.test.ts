import { describe, expect, it } from "vitest";
import {
  UserTimezoneNameSchema, UserTimezoneStateSchema, UserTimezoneReadParamsSchema, UserTimezoneReadResultSchema,
  UserTimezoneReportParamsSchema, UserTimezoneUpdateParamsSchema, UserTimezoneMutationResultSchema,
} from "./user-timezone-schema.ts";

const deviceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const state = { timezone: "UTC", mode: "fixed", authorityDeviceId: null, revision: 1,
  updatedAt: "1970-01-01T00:00:00.000Z", confirmedAt: null, source: "bootstrap", sourceDeviceId: null };

describe("User Timezone protocol", () => {
  it("accepts real IANA names and refuses invalid zones, offsets and oversized input", () => {
    for (const zone of ["UTC", "Asia/Shanghai", "America/New_York", "Etc/GMT+12"]) expect(UserTimezoneNameSchema.safeParse(zone).success).toBe(true);
    for (const zone of ["Moon/Base", "", "+08:00", "UTC ", "x".repeat(101)]) expect(UserTimezoneNameSchema.safeParse(zone).success).toBe(false);
  });
  it("keeps bootstrap honestly unconfirmed and requires coherent authority/source metadata", () => {
    expect(UserTimezoneStateSchema.parse(state)).toEqual(state);
    expect(UserTimezoneStateSchema.safeParse({ ...state, confirmedAt: state.updatedAt }).success).toBe(false);
    expect(UserTimezoneStateSchema.safeParse({ ...state, mode: "follow-primary-device" }).success).toBe(false);
    expect(UserTimezoneStateSchema.safeParse({ ...state, source: "operator" }).success).toBe(false);
    expect(UserTimezoneStateSchema.safeParse({ ...state, authorityDeviceId: deviceId }).success).toBe(false);
  });
  it("binds settings to positive safe revisions and forbids identity/source injection", () => {
    expect(UserTimezoneUpdateParamsSchema.parse({ expectedRevision: 1, mode: "fixed", timezone: "Asia/Tokyo" })).toBeDefined();
    expect(UserTimezoneUpdateParamsSchema.parse({ expectedRevision: 1, mode: "follow-primary-device", authorityDeviceId: deviceId })).toBeDefined();
    for (const expectedRevision of [0, 1.2, Number.MAX_SAFE_INTEGER + 1]) {
      expect(UserTimezoneUpdateParamsSchema.safeParse({ expectedRevision, mode: "fixed", timezone: "UTC" }).success).toBe(false);
    }
    const report = { expectedRevision: 2, timezone: "Asia/Tokyo", reportSourceId: deviceId };
    expect(UserTimezoneReportParamsSchema.parse(report)).toEqual(report);
    expect(UserTimezoneReportParamsSchema.safeParse({ ...report, deviceId }).success).toBe(false);
    expect(UserTimezoneReportParamsSchema.safeParse({ ...report, confirmedAt: state.updatedAt }).success).toBe(false);
    expect(UserTimezoneUpdateParamsSchema.safeParse({ expectedRevision: 1, mode: "follow-primary-device", authorityDeviceId: deviceId, timezone: "UTC" }).success).toBe(false);
  });
  it("round-trips bounded reads and explicit refusals without accepting extra state", () => {
    expect(UserTimezoneReadParamsSchema.parse({ claimReportSource: true })).toEqual({ claimReportSource: true });
    expect(UserTimezoneReadParamsSchema.safeParse({ deviceId }).success).toBe(false);
    const read = { state, reportStatus: "fixed" };
    expect(UserTimezoneReadResultSchema.parse(JSON.parse(JSON.stringify(read)))).toEqual(read);
    const refusal = { status: "refused", reason: "revision-conflict", state };
    expect(UserTimezoneMutationResultSchema.parse(refusal)).toEqual(refusal);
    expect(UserTimezoneMutationResultSchema.safeParse({ ...refusal, reason: "arbitrary" }).success).toBe(false);
  });
});
