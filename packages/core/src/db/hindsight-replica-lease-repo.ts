/**
 * INPUT:  a Core database, Bank identity, and trusted clock
 * OUTPUT: persisted Core-issued run/owner/fence leases, exact-token expiry renewal and synchronous ownership assertions
 * POS:    core/db — B5 per-Bank fencing prerequisite, independent of B2 import runs
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { MemoryReplicaLeaseSchema, type MemoryReplicaLease } from "@taki/shared";
import type { Database } from "./sqlite.ts";

const ClaimSchema = z.strictObject({
  bankId: z.string().min(1).max(256), ownerId: z.string().min(1).max(256),
  durationMs: z.int().min(1).max(3_600_000),
});
export interface HindsightReplicaLeaseRepo {
  acquire(input: z.infer<typeof ClaimSchema>): MemoryReplicaLease;
  renew(input: { lease: MemoryReplicaLease; durationMs: number }): MemoryReplicaLease;
  release(lease: MemoryReplicaLease): void;
  assert(lease: MemoryReplicaLease): void;
}

export function createHindsightReplicaLeaseRepo(db: Database, now: () => string): HindsightReplicaLeaseRepo {
  return {
    acquire: (input) => acquire(db, { ...ClaimSchema.parse(input), now: timestamp(now()) }),
    renew: (input) => renew(db, { lease: MemoryReplicaLeaseSchema.parse(input.lease),
      durationMs: ClaimSchema.shape.durationMs.parse(input.durationMs), now: timestamp(now()) }),
    release: (input) => {
      const lease = MemoryReplicaLeaseSchema.parse(input);
      assertLease(db, lease, timestamp(now()));
      db.prepare(`UPDATE hindsight_replica_sync_leases SET expires_at=:now
        WHERE bank_id=:bank AND run_id=:run AND owner_id=:owner AND fence=:fence`)
        .run({ now: timestamp(now()), bank: lease.bankId, run: lease.runId, owner: lease.ownerId, fence: lease.fence });
    },
    assert: (lease) => assertLease(db, MemoryReplicaLeaseSchema.parse(lease), timestamp(now())),
  };
}

function acquire(db: Database, input: z.infer<typeof ClaimSchema> & { now: string }): MemoryReplicaLease {
  let result: MemoryReplicaLease | undefined;
  db.transaction(() => {
    const row = db.prepare("SELECT fence,expires_at FROM hindsight_replica_sync_leases WHERE bank_id=:bank").get({ bank: input.bankId });
    if (row && Date.parse(String(row.expires_at)) > Date.parse(input.now)) throw new Error("HINDSIGHT_REPLICA_BUSY");
    result = MemoryReplicaLeaseSchema.parse({ bankId: input.bankId, ownerId: input.ownerId, runId: randomUUID(),
      fence: Number(row?.fence ?? 0) + 1, expiresAt: new Date(Date.parse(input.now) + input.durationMs).toISOString() });
    db.prepare(`INSERT INTO hindsight_replica_sync_leases (bank_id,run_id,owner_id,fence,expires_at)
      VALUES (:bank,:run,:owner,:fence,:expires) ON CONFLICT(bank_id) DO UPDATE SET run_id=excluded.run_id,
      owner_id=excluded.owner_id,fence=excluded.fence,expires_at=excluded.expires_at`)
      .run({ bank: result.bankId, run: result.runId, owner: result.ownerId, fence: result.fence, expires: result.expiresAt });
  });
  if (!result) throw new Error("HINDSIGHT_REPLICA_LEASE_LOST");
  return result;
}

function renew(db: Database, input: { lease: MemoryReplicaLease; durationMs: number; now: string }): MemoryReplicaLease {
  const { lease } = input;
  const expiresAt = new Date(Math.max(Date.parse(lease.expiresAt), Date.parse(input.now) + input.durationMs)).toISOString();
  // Renewal is a CAS on the complete old token, not a new claim. Matching the
  // old expiry makes stale owners fail even when the run/fence are unchanged.
  const changed = db.prepare(`UPDATE hindsight_replica_sync_leases SET expires_at=:expires
    WHERE bank_id=:bank AND run_id=:run AND owner_id=:owner AND fence=:fence
      AND expires_at=:previous AND julianday(expires_at)>julianday(:now)`)
    .run({ bank: lease.bankId, run: lease.runId, owner: lease.ownerId, fence: lease.fence,
      previous: lease.expiresAt, expires: expiresAt, now: input.now });
  if (changed.changes !== 1) throw new Error("HINDSIGHT_REPLICA_LEASE_LOST");
  return { ...lease, expiresAt };
}

function assertLease(db: Database, lease: MemoryReplicaLease, now: string): void {
  const row = db.prepare(`SELECT * FROM hindsight_replica_sync_leases
    WHERE bank_id=:bank AND run_id=:run AND owner_id=:owner AND fence=:fence`)
    .get({ bank: lease.bankId, run: lease.runId, owner: lease.ownerId, fence: lease.fence });
  if (!row || row.expires_at !== lease.expiresAt || Date.parse(lease.expiresAt) <= Date.parse(now)) {
    throw new Error("HINDSIGHT_REPLICA_LEASE_LOST");
  }
}

function timestamp(value: string): string { return z.iso.datetime({ offset: true }).parse(value); }
