/**
 * INPUT:  one admission-bound coordinator, Global/Character routes, and the current foreground query
 * OUTPUT: cancellable, deduplicated, fenced memory text under a shared result/token budget and optional deadline
 * POS:    core/memory — ephemeral request projection only; never writes Timeline, summaries, or memory sources
 */
import { HindsightMemoryRecallEnvelopeV1Schema, RecallEnvelopeSchema, type MemoryErrorCode, type MemoryResult, type RecallResult, type RunMemoryReference } from "@taki/shared";
import type { MemoryCoordinator } from "./memory-coordinator.ts";
import type { MemoryToolBankRouter } from "./canonical-tools/canonical-memory-tools.ts";
import { fenceUntrusted } from "../agents/untrusted-fence.ts";
import { estimateTokens } from "./token-estimator.ts";
import { sameStableMemoryCapabilities } from "./memory-capability-snapshot.ts";
import { recallMatchesNamespace, selectMemoryRecall, type MemoryRecallCandidate } from "./memory-recall-selection.ts";

export interface AutomaticMemoryRecallConfig { maxTokens: number; limit: number; timeoutMs?: number }
// ADR 0009 fixes the initial shared 1024-token cap; eight results remain the default.
// Provider completion or cancellation ends the default wait. A finite business deadline is caller opt-in.
export const DEFAULT_AUTOMATIC_MEMORY_RECALL: Readonly<AutomaticMemoryRecallConfig> = Object.freeze({ maxTokens: 1024, limit: 8 });
export interface AutomaticMemoryRecallInput { query: string; visibleContext: string; now: number; signal?: AbortSignal }
export type AutomaticMemoryRecall = (input: AutomaticMemoryRecallInput) => Promise<string>;
type Scope = "global" | "character";
interface Branch { scope: Scope; bankId: string; data?: RecallResult; outcome: "completed" | "failed" | "timed_out" | "cancelled"; code?: MemoryErrorCode }
export interface AutomaticMemoryRecallDiagnostic {
  returned: number;
  tokens: number;
  branches: ReadonlyArray<{ scope: Scope; outcome: Branch["outcome"]; code?: MemoryErrorCode }>;
}
interface RecallDeps {
  coordinator: Pick<MemoryCoordinator, "recall">;
  router: MemoryToolBankRouter;
  snapshot: RunMemoryReference;
  config?: Partial<AutomaticMemoryRecallConfig>;
  onDiagnostic?: (diagnostic: AutomaticMemoryRecallDiagnostic) => void;
}
interface BoundRecall extends Omit<RecallDeps, "config" | "router"> {
  config: Readonly<AutomaticMemoryRecallConfig>;
  routes: ReadonlyArray<{ scope: Scope; bankId: string }>;
}

export function createAutomaticMemoryRecall(input: RecallDeps): AutomaticMemoryRecall {
  const config = Object.freeze({ ...DEFAULT_AUTOMATIC_MEMORY_RECALL, ...input.config });
  validateConfig(config);
  const routes = Object.freeze([{ scope: "global" as const, bankId: input.router.globalBankId() },
    { scope: "character" as const, bankId: input.router.characterBankId() }].map((route) => Object.freeze(route)));
  const deps = Object.freeze({ ...input, config, routes });
  return (request) => recallForeground(deps, request);
}

async function recallForeground(deps: BoundRecall, input: AutomaticMemoryRecallInput): Promise<string> {
  if (input.signal?.aborted || input.query.trim().length === 0 || !Number.isFinite(input.now)) return "";
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort();
  input.signal?.addEventListener("abort", cancel, { once: true });
  const timer = deps.config.timeoutMs === undefined ? undefined
    : setTimeout(() => { timedOut = true; controller.abort(); }, deps.config.timeoutMs);
  timer?.unref?.();
  try {
    const branches = await Promise.all(deps.routes.map((route) => readBank({ deps, input, route, signal: controller.signal,
      abortedOutcome: () => timedOut ? "timed_out" : "cancelled" })));
    if (input.signal?.aborted) return "";
    const projection = projectRecall({ branches, input, config: deps.config });
    report(deps, { returned: projection.returned, tokens: estimateTokens(projection.text),
      branches: branches.map(({ scope, outcome, code }) => ({ scope, outcome, ...(code ? { code } : {}) })) });
    return projection.text;
  } catch {
    // Optional retrieval cannot convert a valid foreground response into a failed chat turn.
    report(deps, { returned: 0, tokens: 0, branches: deps.routes.map(({ scope }) => ({ scope, outcome: "failed", code: "MEMORY_INTERNAL_ERROR" })) });
    return "";
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener("abort", cancel);
  }
}

async function readBank(args: { deps: BoundRecall; input: AutomaticMemoryRecallInput; route: BoundRecall["routes"][number];
  signal: AbortSignal; abortedOutcome: () => "timed_out" | "cancelled" }): Promise<Branch> {
  const { deps, input, route, signal } = args;
  // Each bank supplies at most one final-budget-sized candidate set. Only the deterministic merged projection
  // spends the shared budget, allowing a healthy bank to use capacity left by a failed or duplicate-only bank.
  const operation = Promise.resolve().then(() => deps.coordinator.recall({ bankId: route.bankId,
    query: boundedQuery(input.query), queryTimestamp: new Date(input.now).toISOString(), budget: "low",
    limit: deps.config.limit, maxTokens: deps.config.maxTokens, factTypes: ["world", "experience", "observation"],
    layerIds: [], includeInvalidated: false }, { signal, expectedAuthorityEpochId: deps.snapshot.authorityEpochId,
    expectedProviderId: deps.snapshot.providerId, expectedProviderLineageId: deps.snapshot.providerLineageId,
    expectedCapabilityDigest: deps.snapshot.capabilityDigest }));
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: Branch) => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", onAbort); resolve(value);
    };
    const onAbort = () => finish({ ...route, outcome: args.abortedOutcome(), code: "MEMORY_OPERATION_CANCELLED" });
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
    // Keep the result handler after timeout or cancellation to contain an abort-ignoring provider's late rejection.
    void operation.then((result) => { if (!settled) finish(parseBranch({ deps, route, result })); })
      .catch(() => finish({ ...route, outcome: "failed", code: "MEMORY_INTERNAL_ERROR" }));
  });
}

function parseBranch(input: { deps: BoundRecall; route: BoundRecall["routes"][number]; result: MemoryResult<RecallResult> }): Branch {
  const schema = input.deps.snapshot.providerId === "hindsight" ? HindsightMemoryRecallEnvelopeV1Schema : RecallEnvelopeSchema;
  const parsed = schema.safeParse(input.result);
  if (!parsed.success) return { ...input.route, outcome: "failed", code: "MEMORY_INTERNAL_ERROR" };
  const result = parsed.data;
  if (!result.ok) return { ...input.route, outcome: "failed", code: result.error.code };
  if (result.providerId !== input.deps.snapshot.providerId || result.authorityEpochId !== input.deps.snapshot.authorityEpochId
    || !sameStableMemoryCapabilities(result.capabilities, input.deps.snapshot.capabilities)
    || result.capabilities.vectorRetrieval !== result.data.vectorState
    || !recallMatchesNamespace(result.data, { bankId: input.route.bankId, authorityEpochId: result.authorityEpochId })) {
    return { ...input.route, outcome: "failed", code: "MEMORY_AUTHORITY_MISMATCH" };
  }
  return { ...input.route, data: result.data, outcome: "completed" };
}

function projectRecall(args: { branches: Branch[]; input: AutomaticMemoryRecallInput; config: AutomaticMemoryRecallConfig }) {
  const selected = selectMemoryRecall({ ...args.input, ...args.config,
    branches: args.branches.flatMap((branch) => branch.data ? [{ ...branch, data: branch.data }] : []),
    tokens: (candidates) => estimateTokens(render(candidates.map(renderCandidate))) });
  return { text: render(selected.candidates.map(renderCandidate)), returned: selected.candidates.length };
}

function renderCandidate(candidate: MemoryRecallCandidate): string {
  if (candidate.kind === "hit") {
    const { hit, scope } = candidate; const unit = hit.record.unit;
    return `- [${scope}; ${hit.confirmed ? "confirmed" : "unconfirmed Pending Memory"}; memory=${unit.memoryId}; revision=${unit.revision}] ${unit.text}`;
  }
  const { entry, scope } = candidate; const { operation } = entry;
  const status = `${scope}; unconfirmed Pending Memory; intent=${entry.operationId}; phase=${entry.phase}; original-at=${entry.originalAt}`;
  if (operation.kind === "retain") {
    const source = operation.request.documentId === null ? "" : `; source=${operation.request.documentId}`;
    const context = operation.request.context === null ? "" : `\nSource context: ${operation.request.context}`;
    return `- [${status}; source intent${source}] ${operation.request.content}${context}`;
  }
  const request = operation.request;
  const change = request.kind === "edit" ? `patch=${JSON.stringify(request.patch)}`
    : request.kind === "invalidate" ? `reason=${JSON.stringify(request.reason)}` : "restoration requested";
  return `- [${status}; mutation=${request.kind}; memory=${request.memoryId}; expectedRevision=${request.expectedRevision}] ${change}\nConfirmed target: ${entry.targetRecord?.unit.text ?? ""}`;
}

function render(lines: string[]): string {
  if (lines.length === 0) return "";
  // Escape all payload tags before the shared fence: a remembered </turn-context> cannot close the outer tail.
  const content = lines.join("\n").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return fenceUntrusted({ source: "automatic-memory-recall", content });
}

function boundedQuery(query: string): string {
  // RecallRequest's Shared maximum is UTF-16 length, so do not split a surrogate at that exact boundary.
  return query.slice(0, 16_384).replace(/[\uD800-\uDBFF]$/u, "");
}

function validateConfig(config: AutomaticMemoryRecallConfig): void {
  const limits = { maxTokens: 32_000, limit: 100, timeoutMs: 2_147_483_647 };
  for (const key of ["maxTokens", "limit", "timeoutMs"] as const) {
    const value = config[key];
    if (key === "timeoutMs" && value === undefined) continue;
    if (value === undefined || !Number.isSafeInteger(value) || value < 1 || value > limits[key]) throw new Error(`invalid automatic memory recall ${key}`);
  }
}

function report(deps: BoundRecall, diagnostic: AutomaticMemoryRecallDiagnostic): void {
  try { deps.onDiagnostic?.(diagnostic); }
  catch { return; } // Optional diagnostics cannot change retrieval or foreground success.
}
