import { describe, expect, it, vi } from "vitest";
import type { HindsightBackupNativeRequest, HindsightConnectionProjection } from "@taki/shared";
import { createCaptureLogger } from "../../testing/capture-logger.ts";
import { createHindsightClient, type HindsightTransport, type HindsightTransportResponse } from "../hindsight/hindsight-client.ts";
import { HindsightError } from "../hindsight/hindsight-errors.ts";
import type { HindsightLiveProjection } from "../hindsight/hindsight-runtime-connection.ts";
import { HindsightBackupFailure } from "./hindsight-backup-failure.ts";
import { AT, BACKUP_ID, LINEAGE, nativeProof, TERMINAL_IDS } from "./hindsight-backup-fixtures.ts";
import { createHindsightNativeBackupRoute } from "./hindsight-backup-native-route.ts";

const ENDPOINT = "http://127.0.0.1:18888";
const FILE = `taki-backup-${BACKUP_ID}.zip`;
const SHA = "a".repeat(64);
const request: HindsightBackupNativeRequest = {
  version: 1, backupId: BACKUP_ID, createdAt: AT, providerLineageId: LINEAGE, nativeBankIds: ["taki-hs-g"], operationIds: TERMINAL_IDS,
};
const proofBody: Record<string, unknown> = { ...nativeProof(["taki-hs-g"]) };
delete proofBody.zipSha256; delete proofBody.zipBytes;
const reply = (status: number, body: unknown): HindsightTransportResponse => ({ status, body: JSON.stringify(body) });
const created = (patch: Record<string, unknown> = {}) => reply(200, { version: 1, backupId: BACKUP_ID, schema: "public", proof: proofBody,
  artifact: { location: "native-host", fileName: FILE, sha256: SHA, bytes: 8192 }, ...patch });

function route(answer: HindsightTransportResponse, live: HindsightLiveProjection["state"] = "ready") {
  const transport = vi.fn<HindsightTransport>(async () => answer);
  const { logger, records } = createCaptureLogger();
  const connection = (): HindsightLiveProjection => live === "ready"
    ? { state: "ready", fingerprint: "f".repeat(64), projection: { endpoint: ENDPOINT } as HindsightConnectionProjection }
    : { state: live, fingerprint: null, projection: null };
  const value = createHindsightNativeBackupRoute({ connection, logger,
    client: (projection) => createHindsightClient({ endpoint: projection.endpoint, resolveApiKey: () => "fixture-key", transport }) });
  return { route: value, transport, records };
}
const snapshot = (value: ReturnType<typeof route>) => value.route.snapshot({ ...request, signal: new AbortController().signal });
const readBack = (value: ReturnType<typeof route>, file = FILE) => value.route.readBack({ file, signal: new AbortController().signal });
const failure = (code: string) => expect.objectContaining({ name: "HindsightBackupFailure", code });

describe("production native backup route", () => {
  it("is available exactly with a ready connection, without any network call", () => {
    const ready = route(created());
    expect(ready.route.available()).toBe(true);
    expect(route(created(), "disabled").route.available()).toBe(false);
    expect(ready.transport).not.toHaveBeenCalled();
  });

  it("sends the Shared request and composes the proof from the native body and the native-host ZIP digest", async () => {
    const r = route(created());
    expect(await snapshot(r)).toEqual({ proof: nativeProof(["taki-hs-g"], { zipSha256: SHA, zipBytes: 8192 }),
      artifact: { location: "native-host", file: FILE }, schema: "public" });
    const [url, init] = r.transport.mock.calls[0]!;
    expect(String(url)).toBe(`${ENDPOINT}/ext/taki-memory/admin/backups`);
    expect(init).toMatchObject({ method: "POST", headers: { authorization: "Bearer fixture-key" } });
    expect(JSON.parse(String(init!.body))).toEqual(request);
  });

  it("maps a disabled (absent) endpoint and a disabled connection to ROUTE_UNAVAILABLE", async () => {
    await expect(snapshot(route(reply(404, { detail: "Not Found" })))).rejects.toEqual(failure("HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE"));
    const off = route(created(), "disabled");
    await expect(snapshot(off)).rejects.toEqual(failure("HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE"));
    expect(off.transport).not.toHaveBeenCalled();
  });

  it.each(["backup_in_progress", "backup_exists"])("maps the single-flight refusal %s to NATIVE_FAILED with a logged reason", async (reason) => {
    const r = route(reply(409, { error: "taki_backup_refused", reason }));
    await expect(snapshot(r)).rejects.toEqual(failure("HINDSIGHT_BACKUP_NATIVE_FAILED"));
    expect(r.records.map((record) => record.obj)).toContainEqual(expect.objectContaining({ code: "HINDSIGHT_BACKUP_NATIVE_FAILED", reason }));
  });

  it.each([
    ["another backup id", created({ backupId: "99999999-9999-4999-8999-999999999999" })],
    ["an invalid proof body", created({ proof: { ...proofBody, banks: "none" } })],
  ])("refuses %s during client response validation", async (_name, answer) => {
    // The client validates identity and shape before route proof composition;
    // capture maps the escaping HindsightError to NATIVE_FAILED at its own step.
    await expect(snapshot(route(answer))).rejects.toEqual(expect.objectContaining({
      name: "HindsightError", code: "HINDSIGHT_RESPONSE_INVALID",
    }));
  });

  it.each([
    ["an authentication failure", reply(401, { error: "taki_memory_authentication_failed" }), "HINDSIGHT_AUTHENTICATION_FAILED"],
    ["an unsupported native build", reply(503, { error: "taki_memory_capability_unsupported" }), "HINDSIGHT_UNREACHABLE"],
    ["a malformed success body", created({ artifact: { location: "native-host", fileName: "../x.zip", sha256: SHA, bytes: 1 } }), "HINDSIGHT_RESPONSE_INVALID"],
  ])("leaves %s to the capture's NATIVE_FAILED mapping, logging only its sanitized code", async (_name, answer, cause) => {
    const r = route(answer);
    const error = await snapshot(r).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HindsightError);
    expect(error).not.toBeInstanceOf(HindsightBackupFailure);
    expect(r.records.map((record) => record.obj)).toContainEqual({ code: "HINDSIGHT_BACKUP_NATIVE_FAILED", cause });
  });

  it("reads back a native-host ZIP digest, null once the file is gone, ROUTE_UNAVAILABLE when the endpoint is off", async () => {
    const found = route(reply(200, { fileName: FILE, sha256: SHA, bytes: 8192 }));
    expect(await readBack(found)).toEqual({ sha256: SHA, bytes: 8192 });
    expect(String(found.transport.mock.calls[0]![0])).toBe(`${ENDPOINT}/ext/taki-memory/admin/backups/${FILE}`);
    expect(await readBack(route(reply(404, { error: "taki_backup_refused", reason: "artifact_not_found" })))).toBeNull();
    await expect(readBack(route(reply(404, { detail: "Not Found" })))).rejects.toEqual(failure("HINDSIGHT_BACKUP_ROUTE_UNAVAILABLE"));
  });

  it("refuses a read-back for another file or a non-artifact name without trusting it", async () => {
    await expect(readBack(route(reply(200, { fileName: `taki-backup-${LINEAGE}.zip`, sha256: SHA, bytes: 1 }))))
      .rejects.toBeInstanceOf(HindsightError);
    const r = route(reply(200, {}));
    await expect(readBack(r, "/var/lib/hindsight/backups/b.zip")).rejects.toBeInstanceOf(HindsightError);
    expect(r.transport).not.toHaveBeenCalled();
  });
});
