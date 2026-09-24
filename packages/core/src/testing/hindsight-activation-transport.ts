/**
 * INPUT:  the exact D78 requests the activation chain sends (Bank template setup, snapshots, current-state transfers, cutover verifications)
 * OUTPUT: createHindsightActivationTransport() — an in-memory HindsightTransport whose bodies are computed from the POSTed request
 *         with the D78 fixture builders (a changed verification request under a used id is refused, as native does), with
 *         per-route call counts and one-shot or persistent fault injection
 * POS:    core/testing — deterministic native substitute for activation tests; never contacts a real Hindsight or PostgreSQL
 */
import { HindsightCurrentTransferRequestSchema, HindsightCutoverVerificationRequestSchema, type HindsightCutoverVerificationStatus,
  type HindsightSnapshotMetadataWire, type HindsightSnapshotPageWire, type HindsightSnapshotRecordWire } from "@taki/shared";
import { currentImportFixture, currentMaintenanceFixture, currentSnapshotFixture } from "../db/hindsight-current-fixtures.ts";
import { createHindsightClient, type HindsightClient, type HindsightTransport, type HindsightTransportResponse } from "../memory/hindsight/hindsight-client.ts";
import { hindsightFixtureCommonRoute } from "./hindsight-fixture-routes.ts";

export type ActivationRoute = "common" | "bank-put" | "template-import" | "template-export" | "operation-status" | "snapshot-create"
  | "snapshot-page" | "transfer-post" | "transfer-result" | "transfer-page" | "verification-post" | "verification-verify"
  | "verification-get" | "verification-page";
/** A fault answers the next matching call; `afterEffect` keeps the route's state change (a lost acknowledgement). */
export interface ActivationFault { response: HindsightTransportResponse | Error; persistent?: boolean; afterEffect?: boolean }
export interface HindsightActivationTransport {
  transport: HindsightTransport;
  client: HindsightClient;
  calls(route: ActivationRoute): number;
  fail(route: ActivationRoute, fault: ActivationFault): void;
  /** Runs before a route is answered (after counting); tests inject Local writes, lease theft or chat commits mid-chain. */
  before(hook: ((call: { route: ActivationRoute; bankId: string }) => void | Promise<void>) | null): void;
  /** Replaces the next verify answer with a non-complete candidate so the operator sees HINDSIGHT_CURRENT_VERIFICATION_INCOMPLETE. */
  incompleteVerification(): void;
}
export interface HindsightActivationTransportInput {
  /** Native baseline records per Bank id (Bank row plus template models/directives); unknown Banks answer bank_not_found. */
  banks: Record<string, HindsightSnapshotRecordWire[]>;
  apiKey?: string;
  endpoint?: string;
}

interface Transfer { native: ReturnType<typeof currentImportFixture> }
interface Verification { request: string; proof: ReturnType<typeof currentMaintenanceFixture>; status: HindsightCutoverVerificationStatus }
interface State {
  banks: Record<string, HindsightSnapshotRecordWire[]>; templates: Map<string, unknown>;
  snapshots: Map<string, { metadata: HindsightSnapshotMetadataWire; pages: HindsightSnapshotPageWire[] }>;
  transfers: Map<string, Transfer>; verifications: Map<string, Verification>; incomplete: boolean;
}
interface Call { route: ActivationRoute; bankId: string; rest: string[]; method: string; body: unknown; query: URLSearchParams }

const BASELINE_CURSOR = 10;

export function createHindsightActivationTransport(input: HindsightActivationTransportInput): HindsightActivationTransport {
  const state: State = { banks: input.banks, templates: new Map(), snapshots: new Map(), transfers: new Map(), verifications: new Map(), incomplete: false };
  const counts = new Map<ActivationRoute, number>(); const faults = new Map<ActivationRoute, ActivationFault>();
  let before: ((call: { route: ActivationRoute; bankId: string }) => void | Promise<void>) | null = null;
  const apiKey = input.apiKey ?? "fixture-key";
  const transport: HindsightTransport = async (url, init) => {
    const target = new URL(String(url)); const path = target.pathname;
    if (new Headers(init?.headers).get("authorization") !== `Bearer ${apiKey}`) return { status: 401, body: JSON.stringify({ detail: "unauthorized" }) };
    const common = hindsightFixtureCommonRoute(path);
    const call = common ? { route: "common" as const, bankId: "", rest: [], method: "GET", body: undefined, query: target.searchParams }
      : parseCall(path, init, target.searchParams);
    counts.set(call.route, (counts.get(call.route) ?? 0) + 1);
    await before?.({ route: call.route, bankId: call.bankId });
    const fault = faults.get(call.route);
    if (fault && !fault.persistent) faults.delete(call.route);
    if (fault && !fault.afterEffect) return raise(fault.response);
    const response = common ?? answer(state, call);
    return fault ? raise(fault.response) : response;
  };
  return {
    transport, client: createHindsightClient({ endpoint: input.endpoint ?? "http://127.0.0.1:18481", resolveApiKey: () => apiKey, transport }),
    calls: (route) => counts.get(route) ?? 0,
    fail: (route, fault) => { faults.set(route, fault); },
    before: (hook) => { before = hook; },
    incompleteVerification: () => { state.incomplete = true; },
  };
}

function raise(response: HindsightTransportResponse | Error): HindsightTransportResponse {
  if (response instanceof Error) throw response;
  return response;
}

function parseCall(path: string, init: RequestInit | undefined, query: URLSearchParams): Call {
  const method = init?.method ?? "GET"; const body = typeof init?.body === "string" ? JSON.parse(init.body) as unknown : undefined;
  const setup = /^\/v1\/default\/banks\/([^/]+)(?:\/(.*))?$/.exec(path); const native = /^\/ext\/taki-memory\/banks\/([^/]+)\/(.*)$/.exec(path);
  const match = setup ?? native; if (!match) throw new Error(`unsupported activation fixture route: ${path}`);
  const bankId = decodeURIComponent(match[1]!); const rest = (match[2] ?? "").split("/").filter(Boolean).map(decodeURIComponent);
  const route = setup ? setupRoute(rest, method) : nativeRoute(rest, method);
  if (!route) throw new Error(`unsupported activation fixture route: ${method} ${path}`);
  return { route, bankId, rest, method, body, query };
}

function setupRoute(rest: string[], method: string): ActivationRoute | undefined {
  if (rest.length === 0 && method === "PUT") return "bank-put";
  if (rest[0] === "import" && method === "POST") return "template-import";
  if (rest[0] === "export") return "template-export";
  if (rest[0] === "operations" && rest.length === 2) return "operation-status";
  return undefined;
}

function nativeRoute(rest: string[], method: string): ActivationRoute | undefined {
  if (rest[0] === "snapshots") return rest.length === 1 && method === "POST" ? "snapshot-create" : "snapshot-page";
  if (rest[0] === "current-state-transfers") {
    return rest.length === 1 && method === "POST" ? "transfer-post" : rest[2] === "mappings" ? "transfer-page" : "transfer-result";
  }
  if (rest[0] === "cutover-verifications") {
    if (rest.length === 1 && method === "POST") return "verification-post";
    if (rest[2] === "verify" && method === "POST") return "verification-verify";
    return rest[2] === "certificates" ? "verification-page" : "verification-get";
  }
  return undefined;
}

function answer(state: State, call: Call): HindsightTransportResponse {
  const baseline = state.banks[call.bankId];
  if (!baseline) return refusal(404, "current_state_transfer_refused", "bank_not_found");
  switch (call.route) {
    case "bank-put": return ok({ bank_id: call.bankId, name: null });
    case "template-import": {
      const dryRun = call.query.get("dry_run") === "true"; if (!dryRun) state.templates.set(call.bankId, call.body);
      return ok({ bank_id: call.bankId, config_applied: true, dry_run: dryRun, operation_ids: dryRun ? [] : [`op-${call.bankId}`] });
    }
    case "template-export": return state.templates.has(call.bankId) ? ok(state.templates.get(call.bankId)) : { status: 404, body: JSON.stringify({ detail: "no template" }) };
    case "operation-status": return ok({ operation_id: call.rest[1], status: "completed" });
    case "snapshot-create": return ok(snapshotOf(state, call.bankId, baseline).metadata);
    case "snapshot-page": return page(state.snapshots.get(call.rest[1] ?? "")?.pages, Number(call.rest[3]));
    case "transfer-post": return ok(transfer(state, call, baseline).native.result);
    case "transfer-result": return state.transfers.has(call.rest[1] ?? "") ? ok(state.transfers.get(call.rest[1]!)!.native.result)
      : refusal(404, "current_state_transfer_refused", "result_not_found");
    case "transfer-page": return page(state.transfers.get(call.rest[1] ?? "")?.native.pages, Number(call.rest[3]));
    case "verification-post": return verification(state, call);
    case "verification-verify": return ok(advance(state, call));
    case "verification-get": return state.verifications.has(call.rest[1] ?? "") ? ok(state.verifications.get(call.rest[1]!)!.status)
      : refusal(404, "cutover_verification_refused", "operation_refused");
    case "verification-page": return page(state.verifications.get(call.rest[1] ?? "")?.proof.pages, Number(call.rest[5]));
    default: throw new Error(`unsupported activation fixture route: ${call.route}`);
  }
}

/** Before an import the Bank exposes its template baseline; afterwards the exact imported records at the transfer's cursor. */
function snapshotOf(state: State, bankId: string, baseline: HindsightSnapshotRecordWire[]) {
  const imported = [...state.transfers.values()].reverse().find((entry) => entry.native.result.bank_id === bankId);
  const snapshot = imported ? imported.native.snapshot : currentSnapshotFixture(baseline, bankId, BASELINE_CURSOR);
  state.snapshots.set(snapshot.metadata.snapshot_id, snapshot);
  return snapshot;
}

function transfer(state: State, call: Call, baseline: HindsightSnapshotRecordWire[]): Transfer {
  const request = HindsightCurrentTransferRequestSchema.parse(call.body);
  const existing = state.transfers.get(request.operation_id); if (existing) return existing;
  const native = currentImportFixture({ request, bankId: call.bankId, sourceBankId: request.source_bank.source_id }, baseline);
  const entry = { native }; state.transfers.set(request.operation_id, entry);
  state.snapshots.set(native.snapshot.metadata.snapshot_id, native.snapshot);
  return entry;
}

/** Like native, a replayed request answers its stored run and a different request under a used id is a request_conflict. */
function verification(state: State, call: Call): HindsightTransportResponse {
  const request = HindsightCutoverVerificationRequestSchema.parse(call.body); const body = JSON.stringify(request);
  const existing = state.verifications.get(request.verification_id);
  if (existing) return existing.request === body ? ok(existing.status) : refusal(409, "cutover_verification_refused", "request_conflict");
  const imported = state.transfers.get(request.transfer_operation_id); if (!imported) throw new Error("activation fixture: verification before transfer");
  const proof = currentMaintenanceFixture({ result: imported.native.result }, imported.native, request.verification_id);
  const entry = { request: body, proof, status: proof.candidate }; state.verifications.set(request.verification_id, entry);
  return ok(entry.status);
}

function advance(state: State, call: Call): HindsightCutoverVerificationStatus {
  const entry = state.verifications.get(call.rest[1] ?? ""); if (!entry) throw new Error("activation fixture: verify before prepare");
  const expected = (call.body as { expected_revision?: number } | undefined)?.expected_revision;
  if (expected !== entry.status.revision) throw new Error("activation fixture: stale verify revision");
  const revision = entry.status.revision + 1;
  if (state.incomplete) {
    state.incomplete = false;
    entry.status = { ...entry.proof.candidate, state: "incomplete", revision, reasons: ["accepted_work_unresolved"] };
    return entry.status;
  }
  entry.status = { ...entry.proof.status, revision }; return entry.status;
}

function page(pages: unknown[] | undefined, pageNumber: number): HindsightTransportResponse {
  const value = pages?.[pageNumber];
  return value === undefined ? refusal(404, "current_state_transfer_refused", "page_not_found") : ok(value);
}
function ok(body: unknown): HindsightTransportResponse { return { status: 200, body: JSON.stringify(body) }; }
function refusal(status: number, error: string, reason: string): HindsightTransportResponse { return { status, body: JSON.stringify({ error, reason }) }; }
