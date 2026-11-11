import { afterEach, expect, it, vi } from "vitest";
import { curatorTestFixture } from "../memory/hindsight/hindsight-policy-curator-fixtures.ts";
import type { HindsightApplicationReplicaReader } from "./hindsight-application-replica-contract.ts";
import * as checkpoints from "./hindsight-application-replica-checkpoint.ts";
import * as integrity from "../memory/hindsight/hindsight-application-integrity.ts";
import { readHindsightApplicationNative } from "../memory/hindsight/hindsight-application-projection.ts";
import { createApplicationEvidenceAccess } from "./hindsight-application-replica-evidence.ts";

afterEach(() => vi.restoreAllMocks());

// Failure modes: retained readers authorize later work, a Promise outlives its
// transaction, or scoped reuse hides changed/corrupt consumed evidence.
it("closes an escaped reader immediately and admits fresh checkpoint/body evidence next time", async () => {
  const f = curatorTestFixture(); const scope = f.banks[0]!.scope;
  let escaped!: HindsightApplicationReplicaReader;
  try {
    expect(f.replica.readSnapshot((reader) => {
      escaped = reader;
      return reader.record({ ...scope, memoryId: "memory-a" })?.unit.memoryId;
    })).toBe("memory-a");
    expect(() => escaped.record({ ...scope, memoryId: "memory-a" })).toThrow("HINDSIGHT_APPLICATION_READ_SCOPE_CLOSED");
    expect(() => f.replica.readSnapshot(() => Promise.resolve())).toThrow("HINDSIGHT_APPLICATION_READ_SCOPE_ASYNC");
    f.db.exec("UPDATE hindsight_application_replica_bodies SET body_bytes=zeroblob(total_bytes) WHERE body_schema='application-memory.v1'");
    expect(() => f.replica.readSnapshot((reader) => reader.record({ ...scope, memoryId: "memory-a" })))
      .toThrow("HINDSIGHT_APPLICATION_BODY_INTEGRITY_ERROR");
  } finally { await f.close(); }
});

it("refuses a changed namespace or unpaired checkpoint on the next synchronous admission", async () => {
  const f = curatorTestFixture(); const scope = f.banks[0]!.scope;
  try {
    f.replica.readSnapshot((reader) => {
      expect(reader.bankBinding(scope.bankId)?.bank).toBeDefined();
      expect(() => reader.body({ ...scope, namespace: { ...scope.namespace, bank_generation: "foreign" }, bodyId: "unused" }))
        .toThrow("HINDSIGHT_APPLICATION_NAMESPACE_MISMATCH");
    });
    f.db.exec("UPDATE hindsight_replica_sync_checkpoints SET end_cursor=end_cursor+1");
    expect(() => f.replica.readSnapshot((reader) => reader.bankBinding(scope.bankId)))
      .toThrow("HINDSIGHT_APPLICATION_CHECKPOINT_UNPAIRED");
  } finally { await f.close(); }
});

// Repeating the same exact evidence in one admission must not multiply SQL
// checkpoint/body decoding; independent admissions must verify again.
it("bounds checkpoint reads and body decoding by admissions and distinct evidence", async () => {
  const f = curatorTestFixture(); const scope = f.banks[0]!.scope;
  const checkpoint = vi.spyOn(checkpoints, "readApplicationCheckpoint");
  const decode = vi.spyOn(integrity, "decodeHindsightApplicationBody");
  const body = f.banks[0]!.artifacts[1]!.body;
  try {
    for (const count of [1, 16]) {
      checkpoint.mockClear(); decode.mockClear();
      f.replica.readSnapshot((reader) => {
        for (let index = 0; index < count; index++) {
          expect(reader.body({ ...scope, bodyId: body.ref.body_id })?.content).toEqual(body.content);
        }
      });
      expect(checkpoint).toHaveBeenCalledTimes(1);
      expect(decode).toHaveBeenCalledTimes(1);
      checkpoint.mockClear(); decode.mockClear();
      f.replica.readSnapshot((reader) => {
        for (let index = 0; index < count; index++) expect(reader.record({ ...scope, memoryId: "memory-a" })).toBeDefined();
      });
      expect(checkpoint).toHaveBeenCalledTimes(1);
      // Bank + Memory each have one native body and one policy body.
      expect(decode).toHaveBeenCalledTimes(4);
    }
  } finally { await f.close(); }
});

it("keeps independent native-byte verification when no decoded reader owner is supplied", async () => {
  const f = curatorTestFixture(); const bank = f.banks[0]!; const native = bank.native[1]!;
  try {
    const damaged = { ...native.body, bytes: new Uint8Array(native.body.bytes.length) };
    expect(() => readHindsightApplicationNative({ ...bank.scope, head: native.head,
      evidence: { body: () => damaged, artifact: () => bank.artifacts[1]!.artifact } }))
      .toThrow("HINDSIGHT_APPLICATION_BODY_INTEGRITY_ERROR");
    const evidence = createApplicationEvidenceAccess(f.db, bank.scope);
    expect(readHindsightApplicationNative({ ...bank.scope, head: native.head, evidence })).toEqual(native.body.content.value);
    expect(() => readHindsightApplicationNative({ ...bank.scope,
      namespace: { ...bank.scope.namespace, bank_generation: "foreign" }, head: native.head, evidence }))
      .toThrow("HINDSIGHT_APPLICATION_NAMESPACE_MISMATCH");
  } finally { await f.close(); }
});
