/**
 * INPUT:  canonical fixture Banks and the existing deterministic application transport
 * OUTPUT: programmable Native-shaped template snapshots, receipts and exact request traces
 * POS:    Core tests only — these synthetic receipts prove Core joins, never Native SQL/authentication/provenance
 */
import { HINDSIGHT_TEMPLATE_BUILD, type HindsightTemplateApplyRequest, type HindsightTemplateReceipt,
  type HindsightTemplateSnapshot, type HindsightTemplateSelectors, type HindsightTemplateTarget } from "@taki/shared";
import { applicationTestCompatibility } from "../../../testing/hindsight-application-runtime-fixtures.ts";
import type { HindsightClient } from "../hindsight-client.ts";
import { withoutApplicationHash } from "../hindsight-application-integrity.ts";
import { HindsightTemplateRefusal } from "../hindsight-template-client.ts";
import { projectTemplateSnapshot, templateProjectionDigest } from "./template-projection.ts";
import { fixtureCommit, signFixtureSnapshot } from "./template-test-fixtures.ts";
import { templateEqual, templateHash } from "./template-integrity.ts";

export interface TemplateFixtureCall {
  method: "compatibility" | "snapshot" | "apply" | "result" | "refresh" | "stats" | "create";
  bankId: string | null;
  request?: HindsightTemplateApplyRequest;
}
export interface TemplateFixtureHooks {
  before?(call: TemplateFixtureCall): Promise<void> | void;
  afterCommit?(receipt: HindsightTemplateReceipt): Promise<void> | void;
  receipt?(value: HindsightTemplateReceipt): HindsightTemplateReceipt;
}

interface TemplateNativeState {
  manifest: ReturnType<typeof applicationTestCompatibility>; calls: TemplateFixtureCall[]; hooks: TemplateFixtureHooks;
  snapshots: Map<string, HindsightTemplateSnapshot>; receipts: Map<string, HindsightTemplateReceipt>;
  occupied: Set<string>; created: Set<string>;
}

export function templateNativeFixture(base: HindsightClient) {
  const manifest = applicationTestCompatibility();
  const versioned = { version: "1.0.0", support: { state: "supported" as const, reason: "all_contracts_available" as const } };
  manifest.source_identity.compatibility_build = HINDSIGHT_TEMPLATE_BUILD;
  manifest.contracts.transitions = versioned;
  manifest.contracts.transition_source_evidence = versioned;
  manifest.contracts.template_lifecycle = versioned;
  const calls: TemplateFixtureCall[] = [];
  const hooks: TemplateFixtureHooks = {};
  const snapshots = new Map<string, HindsightTemplateSnapshot>();
  const receipts = new Map<string, HindsightTemplateReceipt>();
  const occupied = new Set<string>();
  const created = new Set<string>();
  const state: TemplateNativeState = { manifest, calls, hooks, snapshots, receipts, occupied, created };
  return { ...state, client: createFixtureClient(base, state) };
}

function createFixtureClient(base: HindsightClient, state: TemplateNativeState): HindsightClient {
  const { manifest, calls, hooks, snapshots, receipts, occupied, created } = state;
  const trace = async (call: TemplateFixtureCall) => { calls.push(structuredClone(call)); await hooks.before?.(call); };
  return {
    ...base,
    compatibility: async () => { await trace({ method: "compatibility", bankId: null }); return structuredClone(manifest); },
    bankStats: async (bankId) => {
      await trace({ method: "stats", bankId });
      return { bank_id: bankId, total_nodes: occupied.has(bankId) ? 1 : 0, total_documents: 0, total_observations: 0, pending_operations: 0 };
    },
    createOrUpdateBank: async (bankId) => { await trace({ method: "create", bankId }); created.add(bankId); return { bankId, name: null }; },
    templateSnapshot: async ({ request }) => {
      await trace({ method: "snapshot", bankId: request.target.bank_id });
      return selectSnapshot(snapshots.get(request.target.bank_id), request);
    },
    templateResult: async ({ request }) => {
      await trace({ method: "result", bankId: request.target.bank_id });
      const receipt = receipts.get(request.request_id);
      if (!receipt) return { state: "absent" };
      if (receipt.request_hash !== request.request_hash || !templateEqual(receipt.target, request.target)) throw new HindsightTemplateRefusal("request_conflict");
      return { state: "committed", receipt: structuredClone(receipt) };
    },
    templateApply: async ({ request }) => {
      await trace({ method: "apply", bankId: request.target.bank_id, request });
      const previous = receipts.get(request.request_id);
      if (previous) {
        if (previous.request_hash !== request.request_hash) throw new HindsightTemplateRefusal("request_conflict");
        return structuredClone(previous);
      }
      const current = selectSnapshot(snapshots.get(request.target.bank_id), { target: request.target, selectors: request.expected_snapshot.selectors });
      if (current.snapshot_hash !== request.expected_snapshot.snapshot_hash) throw new HindsightTemplateRefusal("snapshot_conflict");
      const committed = commitFixtureRequest(request);
      snapshots.set(request.target.bank_id, committed.snapshot);
      const receipt = hooks.receipt ? hooks.receipt(committed.receipt) : committed.receipt;
      receipts.set(request.request_id, receipt);
      await hooks.afterCommit?.(receipt);
      return structuredClone(receipt);
    },
    templateRefreshResult: async ({ request }) => {
      await trace({ method: "refresh", bankId: request.target.bank_id });
      const child = receipts.get(request.request_id)?.children.find((entry) => entry.child_id === request.child_id);
      if (!child) throw new HindsightTemplateRefusal("child_not_found");
      return { contract_version: "1.0.0", target: request.target, request_id: request.request_id,
        child_id: child.child_id, model_id: child.model_id, definition_hash: child.definition_hash, state: "pending",
        result_revision: null, result_payload_hash: null };
    },
  };
}

function selectSnapshot(previous: HindsightTemplateSnapshot | undefined, input: { target: HindsightTemplateTarget; selectors: HindsightTemplateSelectors }) {
  if (previous && !templateEqual(previous.target, input.target)) throw new HindsightTemplateRefusal("generation_mismatch");
  return signFixtureSnapshot({ contract_version: "1.0.0", target: input.target, selectors: input.selectors,
    config: input.selectors.config_keys.map((key) => previous?.config.find((entry) => entry.key === key)
      ?? { key, stored: { kind: "absent" }, inherited: key === "entity_labels" ? [] : "Native inherited instruction" }),
    models: input.selectors.model_ids.map((id) => previous?.models.find((entry) => entry.id === id) ?? { id, definition: null, proof: null }),
    directives: input.selectors.directives.map(({ id, name }) => previous?.directives.find((entry) => entry.id === id)
      ?? { id, name, definition: null, proof: null, name_matches: previous?.directives.filter((entry) => entry.definition?.name === name).map((entry) => entry.id) ?? [] }),
    snapshot_hash: "0".repeat(64) });
}

function commitFixtureRequest(request: HindsightTemplateApplyRequest) {
  const projection = projectTemplateSnapshot(request.expected_snapshot);
  for (const change of request.changes.config) {
    const entry = projection.config.find((item) => item.key === change.key);
    if (!entry) throw new Error("fixture config selector missing");
    entry.stored = change.stored;
  }
  for (const change of request.changes.models) {
    const entry = projection.models.find((item) => item.id === (change.kind === "delete" ? change.id : change.definition.id));
    if (!entry) throw new Error("fixture model selector missing");
    entry.definition = change.kind === "delete" ? null : change.definition;
  }
  for (const change of request.changes.directives) {
    const entry = projection.directives.find((item) => item.id === (change.kind === "delete" ? change.id : change.definition.id));
    if (!entry) throw new Error("fixture directive selector missing");
    entry.definition = change.kind === "delete" ? null : change.definition;
    entry.name_matches = entry.definition ? [entry.id] : [];
  }
  const committed = fixtureCommit({ request, projection, effectiveDefinitionHash: templateProjectionDigest(projection),
    templateRevision: "fixture", userRevision: 0, enrollmentRevision: 1, consequences: { deletions: [], providerWork: request.refresh } });
  if (request.initialization) {
    const receipt = { ...committed.receipt, initialization_proof_hash: templateHash("definition", { fixture_initialization: request.request_id }) };
    committed.receipt = { ...receipt, receipt_hash: templateHash("receipt", withoutApplicationHash(receipt, "receipt_hash")) };
  }
  return committed;
}
