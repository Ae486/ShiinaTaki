/**
 * INPUT:  actual final native proof identity, authenticated clients and an owner request guard
 * OUTPUT: every retained native/application/maintenance/auxiliary page and its validated immutable body closure
 * POS:    core/memory/transitions — W3 read adapter; never acquires fences, runs models or selects authority
 */
import type { HindsightTransitionStatus } from "@taki/shared";
import type { HindsightClient, HindsightCallContext } from "../hindsight/hindsight-client.ts";
import type { HindsightTransitionClient } from "../hindsight/hindsight-transition-client.ts";
import type { HindsightApplicationClient } from "../hindsight/hindsight-application-client.ts";
import type { HindsightCurrentStateClient } from "../hindsight/hindsight-current-client.ts";
import { loadBodies } from "../hindsight/hindsight-application-bundle-loader.ts";
import { validateHindsightTransitionStatus } from "../hindsight/hindsight-transition-proof.ts";
import { sealTransitionNativeEvidence } from "./transition-native-evidence.ts";

export type TransitionEvidenceClient = HindsightTransitionClient & HindsightApplicationClient
  & Pick<HindsightCurrentStateClient, "currentSnapshotPage"> & Pick<HindsightClient, "createLogicalSnapshot">;
export async function loadTransitionNativeEvidence(input: { status: HindsightTransitionStatus;
  client: TransitionEvidenceClient; request(): HindsightCallContext }) {
  const { status, client } = input; const proof = status.proof;
  validateHindsightTransitionStatus(status, { bankId: status.bank_id, transitionId: status.request.transition_id });
  if (!proof) throw new Error("MEMORY_TRANSITION_PROOF_INVALID");
  const read = { bankId: status.bank_id, transitionId: status.request.transition_id, proofHash: proof.proof_hash };
  const nativePages = [];
  for (let pageNumber = 0; pageNumber < proof.native_snapshot.manifest.total_pages; pageNumber++) {
    nativePages.push(await client.currentSnapshotPage({ bankId: status.bank_id, snapshotId: proof.native_snapshot.snapshot_id,
      pageNumber, context: input.request() }));
  }
  const applicationPages = [];
  for (let pageNumber = 0; pageNumber < proof.application_snapshot.total_pages; pageNumber++) {
    applicationPages.push(await client.applicationSnapshotPage({ bankId: status.bank_id, namespace: proof.application_snapshot.namespace,
      snapshotId: proof.application_snapshot.snapshot_id, pageNumber, context: input.request() }));
  }
  const bodies = await loadBodies({ bankId: status.bank_id, namespace: proof.application_snapshot.namespace,
    client, request: input.request, context: input.request() }, applicationPages);
  const maintenancePages = [];
  for (let pageNumber = 0; pageNumber < proof.evidence.total_pages; pageNumber++) {
    maintenancePages.push(await client.transitionEvidence({ ...read, pageNumber, context: input.request() }));
  }
  const auxiliaryPages = [];
  for (let pageNumber = 0; pageNumber < proof.auxiliary_page_hashes.length; pageNumber++) {
    auxiliaryPages.push(await client.transitionAuxiliary({ ...read, pageNumber, context: input.request() }));
  }
  input.request();
  return sealTransitionNativeEvidence({ version: 1, transitionId: status.request.transition_id, status, nativePages, applicationPages,
    bodies: [...bodies.values()].map(({ ref, bytes }) => ({ ref, base64: Buffer.from(bytes).toString("base64") })),
    maintenancePages, auxiliaryPages });
}
