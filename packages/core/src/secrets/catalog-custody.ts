/**
 * INPUT:  the Catalog owner's successful publication state and its one registered sealed file
 * OUTPUT: opaque capture/validate snapshots binding this boot, private revision, bytes and fixed selection
 * POS:    core/secrets — internal read-only admission seam; external replacement never reloads cached values
 */
import { createHash, randomUUID } from "node:crypto";
import { closeSync, fstatSync, openSync, readSync, lstatSync } from "node:fs";
import {
  HINDSIGHT_CUSTODY_LIMITS, HINDSIGHT_SECRET_REFS, HindsightFixedSelectionSchema,
  type HindsightCustodyPrepare, type HindsightCustodyRefusal, type HindsightFixedSelection,
} from "@taki/shared/hindsight-custody";
import type { SecretCatalogPlain } from "@taki/secret-catalog-codec";

export type CatalogCustodySnapshot = Readonly<Pick<HindsightCustodyPrepare,
  "snapshotId" | "coreBootId" | "catalogStoreId" | "catalogKeyVersion" | "sealedEnvelopeSha256" | "selection">>;
export interface CatalogCustodyPublication {
  data: SecretCatalogPlain | null;
  revision: number;
  sealedDigest: string | null;
  fileIdentity: string | null;
}
export class CatalogCustodyError extends Error {
  readonly reason: HindsightCustodyRefusal;
  constructor(reason: HindsightCustodyRefusal) {
    super("catalog custody unavailable");
    this.name = "CatalogCustodyError";
    this.reason = reason;
  }
}

export function sealedCatalogDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function catalogFileIdentity(path: string): string | null {
  try {
    const stat = lstatSync(path, { bigint: true });
    return stat.isFile() && stat.nlink === 1n ? `${stat.dev}:${stat.ino}:${stat.ctimeNs}:${stat.size}` : null;
  } catch {
    return null; // A published but no longer observable file cannot establish custody.
  }
}

export function createCatalogCustody(filePath: string, publication: () => CatalogCustodyPublication, bootId: string = randomUUID()) {
  const snapshots = new WeakMap<CatalogCustodySnapshot, number>();
  return {
    capture(selection: HindsightFixedSelection): CatalogCustodySnapshot {
      const current = publication();
      requireCurrent(filePath, current);
      const data = current.data;
      if (!data || !current.sealedDigest) throw new CatalogCustodyError("custody-locked");
      const selected = HindsightFixedSelectionSchema.parse(selection).map((entry) => {
        if (entry.source !== "catalog") return Object.freeze(entry);
        const value = data.entries[HINDSIGHT_SECRET_REFS[entry.slot]];
        if (!value) throw new CatalogCustodyError("custody-locked");
        if (value.value.length > HINDSIGHT_CUSTODY_LIMITS.valueCodeUnits) throw new CatalogCustodyError("input-oversize");
        return Object.freeze({ ...entry, updatedAt: value.updatedAt });
      });
      Object.freeze(selected);
      const snapshot = Object.freeze({
        snapshotId: randomUUID(), coreBootId: bootId, catalogStoreId: data.storeId,
        catalogKeyVersion: data.keyVersion, sealedEnvelopeSha256: current.sealedDigest, selection: selected,
      });
      snapshots.set(snapshot, current.revision);
      return snapshot;
    },
    validate(snapshot: CatalogCustodySnapshot): boolean {
      const current = publication();
      if (snapshots.get(snapshot) !== current.revision || snapshot.coreBootId !== bootId
        || snapshot.sealedEnvelopeSha256 !== current.sealedDigest
        || snapshot.catalogStoreId !== current.data?.storeId
        || snapshot.catalogKeyVersion !== current.data.keyVersion) return false;
      try {
        requireCurrent(filePath, current);
        return true;
      } catch {
        return false; // The caller publishes one bounded stale result, never a raw filesystem error.
      }
    },
  };
}

function requireCurrent(path: string, current: CatalogCustodyPublication): void {
  if (!current.data || !current.sealedDigest || !current.fileIdentity) throw new CatalogCustodyError("custody-locked");
  try {
    const bytes = readCurrentEnvelope(path, current.fileIdentity);
    if (sealedCatalogDigest(bytes) !== current.sealedDigest) throw new CatalogCustodyError("snapshot-stale");
  } catch (error) {
    if (error instanceof CatalogCustodyError) throw error;
    throw new CatalogCustodyError("snapshot-stale");
  }
}

function readCurrentEnvelope(path: string, identity: string): Uint8Array {
  const fd = openSync(path, "r");
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile()) throw new CatalogCustodyError("snapshot-stale");
    if (before.size > BigInt(HINDSIGHT_CUSTODY_LIMITS.envelopeBytes)) throw new CatalogCustodyError("input-oversize");
    if (`${before.dev}:${before.ino}:${before.ctimeNs}:${before.size}` !== identity) throw new CatalogCustodyError("snapshot-stale");
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let total = 0;
    while (total < bytes.length) {
      const read = readSync(fd, bytes, total, bytes.length - total, null);
      if (read === 0) break;
      total += read;
    }
    const after = fstatSync(fd, { bigint: true });
    if (total !== Number(before.size) || before.ctimeNs !== after.ctimeNs
      || catalogFileIdentity(path) !== identity) throw new CatalogCustodyError("snapshot-stale");
    return bytes.subarray(0, total);
  } finally {
    closeSync(fd); // No no-delete lock: legitimate Core rename publication must remain possible.
  }
}
