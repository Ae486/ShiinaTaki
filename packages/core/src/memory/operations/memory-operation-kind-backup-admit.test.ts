import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryOperation, MemoryOperationRequest } from "@taki/shared";
import {
  configureHindsight, createHindsightActivationJourney, onboardLocal, type HindsightActivationJourney, type JourneySession,
} from "../hindsight-activation/hindsight-activation-journey-fixture.ts";
import { operatorZip, putInbox, withoutTaki } from "../hindsight-backup/hindsight-backup-harness.ts";
import type { NativeBackupRouteDouble } from "../hindsight-backup/hindsight-backup-route-fixtures.ts";
import { createHindsightBackupStore } from "../hindsight-backup/hindsight-backup-store.ts";
import { activatedHindsight, mirroringRoute, openBackupRow, refusalOf } from "./memory-operation-backup-fixtures.ts";

const ZIP = "hindsight-backup.zip";
const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

const journeys: HindsightActivationJourney[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const journey of journeys.splice(0)) await journey.close(); });

async function activated() {
  const route = mirroringRoute(() => j);
  const j = createHindsightActivationJourney({ backupRoute: route }); journeys.push(j);
  return { j, route, root: createHindsightBackupStore(j.dataDir).root, ...await activatedHindsight(j) };
}

const admit = (expectedEpochId: string, backupId: string): MemoryOperationRequest => ({ kind: "backup.admit", expectedEpochId, backupId, fileName: ZIP });
const verify = (backupId: string): MemoryOperationRequest => ({ kind: "backup.verify", backupId });

/** A route-b capture through the owner: the staged backup id the operator reads from the settled row. */
async function stagedCapture(session: JourneySession, epochId: string): Promise<string> {
  const settled = await session.settled({ kind: "backup.capture", expectedEpochId: epochId, route: "operator-artifact" });
  expect(settled).toMatchObject({ state: "completed", result: { kind: "backup", verifiedAt: null, mismatch: null } });
  return (settled.producer as { backupId: string }).backupId;
}

async function dropZip(input: { root: string; route: NativeBackupRouteDouble; backupId: string }): Promise<void> {
  putInbox(input.root, { name: ZIP, bytes: await operatorZip(input) });
}

describe("backup.admit / backup.verify — admission", () => {
  it("refuses both under the Local marker and admit on a stale epoch, leaving no row", async () => {
    const j = createHindsightActivationJourney({}); journeys.push(j);
    const session = j.session;
    const localEpochId = await onboardLocal(session);
    expect(refusalOf(session, admit(localEpochId, UNKNOWN_ID))).toMatchObject({ reason: "MEMORY_OPERATION_UNSUPPORTED" });
    expect(refusalOf(session, verify(UNKNOWN_ID))).toMatchObject({ reason: "MEMORY_OPERATION_UNSUPPORTED" });
    await configureHindsight(session);
    await session.settled({ kind: "hindsight.activate", source: { mode: "new", setupRevision: session.setup.status().revision, expectedEpochId: localEpochId } });
    expect(refusalOf(session, admit(localEpochId, UNKNOWN_ID))).toMatchObject({ reason: "MEMORY_OPERATION_UNSUPPORTED" });
    const kinds = session.operations.list({ includeTerminal: true, limit: 50 }).map((operation) => operation.kind);
    expect(kinds.filter((kind) => kind.startsWith("backup."))).toEqual([]);
  });

  it("shares the exclusive hindsight-backup family in both directions", async () => {
    const { session, epochId } = await activated();
    const open = openBackupRow(session, { family: "hindsight-backup",
      operation: { kind: "backup.admit", request: admit(epochId, UNKNOWN_ID), producer: { kind: "backup", backupId: UNKNOWN_ID, phase: "verifying" } } });
    const blocked: MemoryOperationRequest[] = [{ kind: "backup.capture", expectedEpochId: epochId }, verify(UNKNOWN_ID),
      admit(epochId, UNKNOWN_ID), { kind: "connection.revalidate", expectedEpochId: epochId }];
    for (const request of blocked) expect(refusalOf(session, request)).toEqual({ reason: "MEMORY_OPERATION_BUSY", activeOperationId: open });
    session.db.prepare("DELETE FROM memory_operations WHERE operation_id=:id").run({ id: open });
    const revalidate = await session.settled({ kind: "connection.revalidate", expectedEpochId: epochId });
    const lifecycle = openBackupRow(session, { family: "hindsight-lifecycle", operation: revalidate as Pick<MemoryOperation, "kind" | "request" | "producer"> });
    for (const request of [admit(epochId, UNKNOWN_ID), verify(UNKNOWN_ID)]) {
      expect(refusalOf(session, request)).toEqual({ reason: "MEMORY_OPERATION_BUSY", activeOperationId: lifecycle });
    }
  });
});

describe("route b through the operation owner", () => {
  it("stages a capture, admits the operator ZIP verified, re-verifies it and reports it in status", async () => {
    const { j, session, epochId, route, root } = await activated();
    const backupId = await stagedCapture(session, epochId);
    expect(route.requests).toEqual([]);
    expect(session.authorityStatus().hindsight?.backup).toMatchObject({ lastVerified: null, latest: null, staged: [{ backupId }] });
    await dropZip({ root, route, backupId });
    const admitted = await session.settled(admit(epochId, backupId));
    expect(admitted).toMatchObject({ state: "completed", errorCode: null, producer: { kind: "backup", backupId, phase: "completed" },
      result: { kind: "backup", backupId, verifiedAt: expect.any(String), mismatch: null } });
    expect((await createHindsightBackupStore(j.dataDir).list())[0]).toMatchObject({ backupId, route: "operator-artifact" });
    const verified = await session.settled(verify(backupId));
    expect(verified).toMatchObject({ state: "completed", result: { kind: "backup", backupId, mismatch: null } });
    const backup = session.authorityStatus().hindsight?.backup;
    expect(backup).toMatchObject({ lastVerified: { backupId }, latest: { backupId }, staged: [], ageSeconds: expect.any(Number) });
    expect(backup!.missingInterval.length).toBeGreaterThan(0);
  });

  it("fails an admit whose ZIP lacks the proof and hands the ZIP back", async () => {
    const { session, epochId, route, root } = await activated();
    const backupId = await stagedCapture(session, epochId);
    putInbox(root, { name: ZIP, bytes: await operatorZip({ root, route, backupId }, { manifest: withoutTaki }) });
    expect(await session.settled(admit(epochId, backupId))).toMatchObject({ state: "failed", reason: "producer_failed",
      errorCode: "HINDSIGHT_BACKUP_PROOF_MISSING", result: null });
    expect(existsSync(join(root, "inbox", ZIP))).toBe(true);
  });
});

describe("backup.admit — boot observation", () => {
  it("returns a ZIP claimed before a restart to the inbox as outcome_unknown", async () => {
    const { j, session, epochId, route, root } = await activated();
    const backupId = await stagedCapture(session, epochId);
    await dropZip({ root, route, backupId });
    renameSync(join(root, "inbox", ZIP), join(root, `${backupId}.staged`, "native.zip"));
    const open = openBackupRow(session, { family: "hindsight-backup",
      operation: { kind: "backup.admit", request: admit(epochId, backupId), producer: { kind: "backup", backupId, phase: "verifying" } } });
    const next = await j.restart("boot-b");
    expect(next.operations.status(open)).toMatchObject({ state: "outcome_unknown", reason: "producer_incomplete" });
    expect(existsSync(join(root, "inbox", ZIP))).toBe(true);
    expect(await next.settled(admit(epochId, backupId))).toMatchObject({ state: "completed" });
  });

  it("settles an admit whose pair was sealed before the restart as completed", async () => {
    const { j, session, epochId, route, root } = await activated();
    const backupId = await stagedCapture(session, epochId);
    await dropZip({ root, route, backupId });
    await session.settled(admit(epochId, backupId));
    const open = openBackupRow(session, { family: "hindsight-backup",
      operation: { kind: "backup.admit", request: admit(epochId, backupId), producer: { kind: "backup", backupId, phase: "sealing" } } });
    const next = await j.restart("boot-b");
    expect(next.operations.status(open)).toMatchObject({ state: "completed", producer: { phase: "completed" },
      result: { kind: "backup", backupId, verifiedAt: expect.any(String), mismatch: null } });
  });
});
