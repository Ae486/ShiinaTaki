import { afterEach, describe, expect, it, vi } from "vitest";
import {
  USER_TIMEZONE_METHODS, UserTimezoneReadResultSchema, UserTimezoneMutationResultSchema,
} from "@taki/shared";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createUserTimezoneRepo } from "../../db/user-timezone-repo.ts";
import { createUserTimezoneService } from "../../time/user-timezone-service.ts";
import { createConnectionRegistry } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { registerUserTimezoneMethods } from "./user-timezone-methods.ts";

const operatorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const authorityId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  const service = createUserTimezoneService({ db, repo: createUserTimezoneRepo(db), schedules: { recomputeUserTimezone: vi.fn() },
    isOperatorDevice: (id) => id === operatorId || id === authorityId, logger: { warn: vi.fn() } });
  const connections = createConnectionRegistry();
  const registry = createMethodRegistry();
  registerUserTimezoneMethods(registry, { service, connections });
  const context = (deviceId: string, role?: "operator" | "node") => {
    const connection = connections.create();
    if (role) connections.authenticate(connection, { deviceId, role, capabilities: [] });
    const onClose: Array<() => void> = [];
    return { connection, notify: vi.fn(), onClose: (callback: () => void) => onClose.push(callback), close: () => {
      connections.remove(connection); for (const callback of onClose) callback();
    } } satisfies MethodContext;
  };
  const call = (ctx: MethodContext, method: string, params: unknown) => registry.dispatch({ jsonrpc: "2.0", id: 1, method, params }, ctx);
  const result = async (ctx: MethodContext, method: string, params: unknown) => {
    const response = await call(ctx, method, params);
    if (!("result" in response)) throw new Error(JSON.stringify(response.error));
    return response.result as unknown;
  };
  const read = async (ctx: MethodContext, claimReportSource?: true) => UserTimezoneReadResultSchema.parse(await result(ctx, USER_TIMEZONE_METHODS.read, claimReportSource ? { claimReportSource } : {}));
  const update = async (ctx: MethodContext, params: unknown) => UserTimezoneMutationResultSchema.parse(await result(ctx, USER_TIMEZONE_METHODS.update, params));
  const report = async (ctx: MethodContext, params: unknown) => UserTimezoneMutationResultSchema.parse(await result(ctx, USER_TIMEZONE_METHODS.report, params));
  return { service, connections, context, call, read, update, report };
}

describe("User Timezone operator methods", () => {
  it("requires live authenticated operators and rejects client-supplied identity", async () => {
    const f = fixture();
    expect(await f.call(f.context(operatorId), USER_TIMEZONE_METHODS.read, {})).toMatchObject({ error: { data: { code: "NOT_AUTHENTICATED" } } });
    expect(await f.call(f.context(operatorId, "node"), USER_TIMEZONE_METHODS.read, {})).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
    const operator = f.context(operatorId, "operator");
    expect(await f.call(operator, USER_TIMEZONE_METHODS.report, { deviceId: authorityId, reportSourceId: operatorId, expectedRevision: 1, timezone: "UTC" }))
      .toMatchObject({ error: { code: -32602 } });
    operator.close();
    expect(await f.call(operator, USER_TIMEZONE_METHODS.update, { expectedRevision: 1, mode: "fixed", timezone: "Asia/Tokyo" }))
      .toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
    expect(f.service.read().revision).toBe(1);
  });

  it("uses authenticated identity, explicit source binding and revision CAS for reports", async () => {
    const f = fixture(); const operator = f.context(operatorId, "operator"); const authority = f.context(authorityId, "operator");
    await f.update(operator, { expectedRevision: 1, mode: "follow-primary-device", authorityDeviceId: authorityId });
    expect(await f.read(operator, true)).toMatchObject({ refusal: "foreign-authority", reportStatus: "unavailable" });
    const source = await f.read(authority, true);
    expect(source).toMatchObject({ reportStatus: "awaiting-report", state: { confirmedAt: null } });
    const report = { expectedRevision: 2, timezone: "Asia/Tokyo", reportSourceId: source.reportSourceId };
    expect(await f.report(operator, report)).toMatchObject({ status: "refused", reason: "foreign-authority" });
    expect(await f.report(authority, report)).toMatchObject({ status: "accepted", state: { revision: 3, sourceDeviceId: authorityId } });
    expect(await f.read(authority)).toMatchObject({ reportStatus: "current", state: { timezone: "Asia/Tokyo" } });
    expect(await f.report(authority, report)).toMatchObject({ status: "refused", reason: "revision-conflict" });
  });

  it("keeps other same-device windows valid while fencing replaced and closed report sources", async () => {
    const f = fixture(); const operator = f.context(operatorId, "operator");
    const pet = f.context(authorityId, "operator"); const home = f.context(authorityId, "operator");
    await f.update(operator, { expectedRevision: 1, mode: "follow-primary-device", authorityDeviceId: authorityId });
    const old = await f.read(pet, true);
    await f.read(home); // A second window's ordinary read cannot take the reporting source.
    const firstReport = { expectedRevision: 2, timezone: "Asia/Tokyo", reportSourceId: old.reportSourceId };
    expect(await f.report(home, firstReport)).toMatchObject({ status: "refused", reason: "stale-source" });
    expect(await f.report(pet, firstReport)).toMatchObject({ status: "accepted" });
    const replacement = await f.read(home, true);
    expect(replacement.reportSourceId).not.toBe(old.reportSourceId);
    expect(f.connections.list()).toHaveLength(3);
    expect(await f.report(pet, { ...firstReport, expectedRevision: 3 })).toMatchObject({ status: "refused", reason: "stale-source" });
    expect(await f.read(pet, true)).toMatchObject({ refusal: "stale-source" });
    expect(await f.report(home, { expectedRevision: 3, timezone: "America/New_York", reportSourceId: replacement.reportSourceId })).toMatchObject({ status: "accepted" });
    pet.close();
    expect(await f.read(home)).toMatchObject({ reportStatus: "current" });
    home.close();
    expect(await f.read(operator)).toMatchObject({ reportStatus: "unavailable", state: { timezone: "America/New_York", revision: 4 } });
    const reconnect = f.context(authorityId, "operator");
    const recovered = await f.read(reconnect, true);
    expect(await f.report(reconnect, { expectedRevision: 4, timezone: "Asia/Shanghai", reportSourceId: replacement.reportSourceId })).toMatchObject({ status: "refused", reason: "stale-source" });
    expect(await f.report(reconnect, { expectedRevision: 4, timezone: "Asia/Shanghai", reportSourceId: recovered.reportSourceId })).toMatchObject({ status: "accepted" });
  });

  it("invalidates old tokens on settings changes and permits deliberate fresh claims", async () => {
    const f = fixture(); const authority = f.context(authorityId, "operator");
    await f.update(authority, { expectedRevision: 1, mode: "follow-primary-device", authorityDeviceId: authorityId });
    const old = await f.read(authority, true);
    await f.update(authority, { expectedRevision: 2, mode: "fixed", timezone: "Europe/Paris" });
    expect(await f.report(authority, { expectedRevision: 2, timezone: "Asia/Tokyo", reportSourceId: old.reportSourceId })).toMatchObject({ status: "ignored-fixed" });
    expect(await f.read(authority, true)).toMatchObject({ reportStatus: "fixed" });
    await f.update(authority, { expectedRevision: 3, mode: "follow-primary-device", authorityDeviceId: authorityId });
    const current = await f.read(authority, true);
    expect(current.reportSourceId).not.toBe(old.reportSourceId);
    expect(await f.report(authority, { expectedRevision: 4, timezone: "Asia/Tokyo", reportSourceId: old.reportSourceId })).toMatchObject({ status: "refused", reason: "stale-source" });
    expect(await f.report(authority, { expectedRevision: 4, timezone: "Asia/Tokyo", reportSourceId: current.reportSourceId })).toMatchObject({ status: "accepted" });
  });
});
