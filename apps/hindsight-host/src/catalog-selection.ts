/**
 * INPUT:  admitted C1 selection, verified installation and a code-owned private callback
 * OUTPUT: transient selected values with current opened-byte checks; no public value-returning method
 * POS:    hindsight-host — shared read-only Catalog crossing for C1 preparation and C2 private delivery
 */
import { join } from "node:path";
import { openCatalog, sodiumReady } from "@taki/secret-catalog-codec";
import { HINDSIGHT_CUSTODY_LIMITS, HINDSIGHT_SECRET_REFS,
  type HindsightCustodyPrepare, type HindsightCredentialSlot } from "@taki/shared/hindsight-custody";
import { readCatalogKey } from "./credential-source.ts";
import { fileIdentity, readInstalledFile, requireProtectedPath, sha256 } from "./installed-files.ts";
import type { VerifiedInstallation } from "./installation.ts";
import { CustodyError } from "./custody-error.ts";

export interface SelectedCatalogValue { slot: HindsightCredentialSlot; value: string }
export async function withSelectedCatalog<T>(input: {
  selection: HindsightCustodyPrepare; installation: VerifiedInstallation; signal: AbortSignal; requireCurrent(): void;
}, consume: (values: SelectedCatalogValue[], requireCurrent: () => void) => Promise<T> | T): Promise<T> {
  let key: Uint8Array | undefined;
  try {
    input.requireCurrent();
    const registration = input.installation.registration;
    const selection = input.selection;
    if (selection.coreHostId !== registration.coreHostId || selection.installationId !== registration.installationId
      || selection.catalogStoreId !== registration.catalogStoreId || selection.catalogKeyVersion !== registration.catalogKeyVersion) {
      throw new CustodyError("snapshot-stale");
    }
    const path = join(registration.coreDataDirectory, "secret-catalog.bin");
    if (input.installation.owner.kind === "unix-user") requireProtectedPath(path, input.installation.owner.uid, true);
    const envelope = readInstalledFile(path, HINDSIGHT_CUSTODY_LIMITS.envelopeBytes);
    if (sha256(envelope.bytes) !== selection.sealedEnvelopeSha256) throw new CustodyError("snapshot-stale");
    const validate = () => {
      input.requireCurrent();
      if (input.signal.aborted || fileIdentity(path) !== envelope.identity
        || sha256(readInstalledFile(path, HINDSIGHT_CUSTODY_LIMITS.envelopeBytes).bytes) !== selection.sealedEnvelopeSha256) {
        throw new CustodyError("snapshot-stale");
      }
    };
    key = await readCatalogKey(input.installation, input.signal);
    await sodiumReady;
    validate();
    const catalog = openCatalog(envelope.bytes, key, selection.catalogStoreId);
    if (catalog.keyVersion !== selection.catalogKeyVersion) throw new CustodyError("snapshot-stale");
    const values = selection.selection.flatMap((entry): SelectedCatalogValue[] => {
      if (entry.source !== "catalog") return [];
      const value = catalog.entries[HINDSIGHT_SECRET_REFS[entry.slot]];
      if (!value) throw new CustodyError("custody-locked");
      if (value.updatedAt !== entry.updatedAt) throw new CustodyError("snapshot-stale");
      if (value.value.length > HINDSIGHT_CUSTODY_LIMITS.valueCodeUnits) throw new CustodyError("input-oversize");
      return [{ slot: entry.slot, value: value.value }];
    });
    validate();
    return await consume(values, validate);
  } finally {
    key?.fill(0); // JavaScript strings are transient but cannot be securely erased.
  }
}
