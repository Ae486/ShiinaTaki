/**
 * INPUT:  admitted snapshot client, current verified page cache, and a bounded run context
 * OUTPUT: complete verified logical snapshot assembled from unchanged evidence and divergent record transfers
 * POS:    core/memory/hindsight — B5 selective transfer; no invented object-manifest endpoint or authority mutation
 */
import {
  HindsightLogicalSnapshotMetadataSchema, HindsightLogicalSnapshotPageSchema,
  type HindsightLogicalSnapshotMetadata, type HindsightLogicalSnapshotPage,
} from "@taki/shared";
import type { HindsightReplicaSyncRepo } from "../../db/hindsight-replica-sync-repo.ts";
import type { HindsightCallContext, HindsightClient } from "./hindsight-client.ts";
import { canonicalJson } from "../legacy-migration/legacy-identities.ts";
import { snapshotManifestHash, verifyLogicalSnapshot, type VerifiedSnapshot } from "./hindsight-snapshot-validator.ts";

interface SnapshotLoadInput {
  client: HindsightClient; repo: HindsightReplicaSyncRepo; bankId: string; providerLineageId: string;
  context: () => HindsightCallContext; now: () => string;
}

export async function loadHindsightReplicaSnapshot(input: SnapshotLoadInput): Promise<VerifiedSnapshot> {
  const { createLogicalSnapshot, logicalSnapshot, logicalSnapshotPage } = input.client;
  if (!createLogicalSnapshot || !logicalSnapshot || !logicalSnapshotPage) throw new Error("HINDSIGHT_SNAPSHOT_CLIENT_UNAVAILABLE");
  // Provider logical_snapshot.py hashes the record list independently of page position. page_size=1 is supported.
  // A cold cache must download every record once; normalized JS numbers cannot reconstruct Python's original bytes.
  const metadata = HindsightLogicalSnapshotMetadataSchema.parse(await createLogicalSnapshot({ bankId: input.bankId,
    pageSize: 1, ttlSeconds: 3_600, context: input.context() }));
  assertManifest(input, metadata);
  const reread = await logicalSnapshot(input.bankId, metadata.snapshotId, input.context());
  if (canonicalJson(metadata) !== canonicalJson(reread)) throw new Error("HINDSIGHT_SNAPSHOT_MANIFEST_CHANGED");
  const pages: HindsightLogicalSnapshotPage[] = [];
  for (const [pageNumber, pageHash] of metadata.manifest.pageHashes.entries()) {
    const context = input.context();
    const cached = input.repo.cachedSnapshotRecord({ bankId: input.bankId, providerLineageId: input.providerLineageId,
      bankGeneration: metadata.manifest.bankGeneration, pageHash });
    pages.push(HindsightLogicalSnapshotPageSchema.parse(cached ? { snapshotId: metadata.snapshotId, pageNumber,
      totalPages: metadata.manifest.totalPages, recordCount: 1, contentHash: pageHash, records: [cached] }
      : await logicalSnapshotPage({ bankId: input.bankId, snapshotId: metadata.snapshotId, pageNumber, context })));
  }
  const final = await logicalSnapshot(input.bankId, metadata.snapshotId, input.context());
  if (canonicalJson(metadata) !== canonicalJson(final)) throw new Error("HINDSIGHT_SNAPSHOT_MANIFEST_CHANGED");
  input.context();
  return verifyLogicalSnapshot({ metadata, pages, expectedBankId: input.bankId,
    expectedProviderLineage: input.providerLineageId, now: input.now() });
}

function assertManifest(input: SnapshotLoadInput, metadata: HindsightLogicalSnapshotMetadata): void {
  const manifest = metadata.manifest;
  if (manifest.bankId !== input.bankId) throw new Error("HINDSIGHT_SNAPSHOT_BANK_MISMATCH");
  if (manifest.providerLineage !== input.providerLineageId) throw new Error("HINDSIGHT_SNAPSHOT_LINEAGE_MISMATCH");
  if (manifest.pageSize !== 1 || manifest.totalPages !== manifest.totalRecords
    || new Set(manifest.pageHashes).size !== manifest.totalPages) throw new Error("HINDSIGHT_SNAPSHOT_INTEGRITY");
  if (snapshotManifestHash(metadata) !== manifest.manifestDigest) throw new Error("HINDSIGHT_SNAPSHOT_MANIFEST_HASH_MISMATCH");
  if (Date.parse(metadata.expiresAt) <= Date.parse(input.now())) throw new Error("HINDSIGHT_SNAPSHOT_EXPIRED");
}
