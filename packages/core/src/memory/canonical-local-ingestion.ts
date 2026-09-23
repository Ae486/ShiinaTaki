/**
 * INPUT:  exact primary commits, Local authority/provider, durable journal, and one Utility Slot
 * OUTPUT: serialized automatic ingestion plus a real pre-retirement flush port sharing the same receipts
 * POS:    core/memory — canonical Local background ingestion; never blocks the foreground or calls native services
 */
import { CanonicalMemorySourceSchema } from "@taki/shared";
import type { MemoryConfig } from "../config/memory-config.ts";
import type { CanonicalIngestionRepo } from "../db/canonical-ingestion-repo.ts";
import type { CanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import type { CanonicalMemoryMaintenanceRepo } from "../db/canonical-memory-maintenance-contract.ts";
import type { MemoryAutoRepo } from "../db/memory-auto-repo.ts";
import type { MemoryEventsRepo } from "../db/memory-events-repo.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import { createCanonicalIngestionModel, type CanonicalIngestionModel } from "./canonical-ingestion-model.ts";
import { sanitizeCommittedPrimarySpan, retainedIngestionSource, type PrimaryConversationCommit,
  type SanitizedCommittedSpan } from "./canonical-ingestion-source.ts";
import type { CanonicalIngestionState, PreparedLocalIngestion } from "./canonical-ingestion-plan.ts";
import type { LocalMemoryProvider } from "./local-memory-provider.ts";
import { canonicalLocalMemoryFlushPort, type MemoryFlushPort } from "./memory-flush-port.ts";
import type { UtilitySlot } from "./utility-slot.ts";
import { EPISODIC_EVERY_N } from "./auto-memory.ts";
import type { ProvenPrimaryEntry } from "./canonical-ingestion-source.ts";

export interface CanonicalIngestionRunResult {
  throughSeq: number; eligibilityStartSeq: number; hasApplicableSource: boolean;
  writes: number; reinforced: number; sources: number; skippedSpans: number;
}
export interface CanonicalLocalIngestion {
  /** Call before this Character's first primary append; persisted once, never a synthetic completion watermark. */
  initializeBaseline(characterId: string): void;
  recordPrimaryCommitted(input: PrimaryConversationCommit): void;
  run(input: { characterId: string; throughSeq?: number }): Promise<CanonicalIngestionRunResult>;
  maybeRun(input: { characterId: string }): Promise<CanonicalIngestionRunResult | null>;
  /** Resolves once every queued per-Character chain has settled; the activation drain waits here before capture. */
  settle(): Promise<void>;
  readonly flushPort: MemoryFlushPort;
}
export interface CanonicalLocalIngestionDeps {
  provider: LocalMemoryProvider; authority: CanonicalMemoryAuthorityRepo; maintenance: CanonicalMemoryMaintenanceRepo;
  journal: CanonicalIngestionRepo; timeline: TimelineRepo; autoState: MemoryAutoRepo; slot: UtilitySlot;
  events?: MemoryEventsRepo; config?: MemoryConfig; now?: () => string;
}
interface IngestionContext extends CanonicalLocalIngestionDeps { epochId: string; model: CanonicalIngestionModel }

export function createCanonicalLocalIngestion(deps: CanonicalLocalIngestionDeps): CanonicalLocalIngestion {
  const ctx: IngestionContext = { ...deps, epochId: deps.authority.activeEpoch().epochId,
    model: createCanonicalIngestionModel(deps.slot) };
  const chains = new Map<string, Promise<unknown>>();
  const enqueue = <T>(characterId: string, operation: () => Promise<T>): Promise<T> => {
    const prior = chains.get(characterId) ?? Promise.resolve();
    const next = prior.catch(() => undefined).then(operation);
    chains.set(characterId, next);
    const release = () => { if (chains.get(characterId) === next) chains.delete(characterId); };
    void next.then(release, release);
    return next;
  };
  const run: CanonicalLocalIngestion["run"] = (input) => enqueue(input.characterId, () => runRange(ctx, input));
  return { run, flushPort: canonicalLocalMemoryFlushPort({ run }),
    settle: async () => { while (chains.size) await Promise.allSettled([...chains.values()]); },
    maybeRun: (input) => enqueue(input.characterId, async () => {
      const scope = { epochId: ctx.epochId, characterId: input.characterId };
      return deps.journal.pending(scope) || deps.journal.unprocessedCount(scope) >= EPISODIC_EVERY_N
        ? runRange(ctx, input) : null;
    }),
    initializeBaseline: (characterId) => {
      deps.journal.initializeBaseline({ epochId: ctx.epochId, characterId,
        throughSeq: deps.timeline.latestSeq(characterId), now: now(ctx) });
    },
    recordPrimaryCommitted: (input) => {
      deps.authority.activeEpoch(ctx.epochId);
      deps.journal.recordPrimaryCommitted({ ...input, epochId: ctx.epochId });
    } };
}

async function runRange(ctx: IngestionContext, input: { characterId: string; throughSeq?: number }): Promise<CanonicalIngestionRunResult> {
  try {
    ctx.authority.activeEpoch(ctx.epochId);
    const scope = { epochId: ctx.epochId, characterId: input.characterId };
    const eligibilityStartSeq = ctx.journal.eligibilityStartSeq(scope);
    if (eligibilityStartSeq === undefined) throw new Error("MEMORY_INGESTION_BASELINE_MISSING");
    const throughSeq = ctx.journal.cursor(scope);
    const requested = input.throughSeq ?? Math.max(throughSeq, ctx.journal.latestPrimarySeq(input.characterId));
    if (!Number.isSafeInteger(requested) || requested < 0) throw new Error("MEMORY_INVALID_REQUEST");
    const target = Math.min(requested, ctx.timeline.latestSeq(input.characterId));
    const totals = await drainSources(ctx, { characterId: input.characterId, target, forcePending: input.throughSeq === undefined });
    return { ...totals, eligibilityStartSeq, hasApplicableSource: ctx.journal.hasApplicableSource({ ...scope, throughSeq: target }),
      throughSeq: ctx.journal.advanceCoverage({ ...scope, throughSeq: target, now: now(ctx) }) };
  } catch (error) {
    // Provider/schema causes can include the private transcript; only the closed
    // code may cross this detached maintenance/flush boundary.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(ingestionFailureCode(error));
  }
}

async function drainSources(ctx: IngestionContext, input: { characterId: string; target: number; forcePending: boolean }) {
  const scope = { epochId: ctx.epochId, characterId: input.characterId };
  const totals = { writes: 0, reinforced: 0, sources: 0, skippedSpans: 0 };
  while (true) {
    const pending = ctx.journal.pending(scope);
    const entries = ctx.journal.pendingEntries({ ...scope, throughSeq: input.target });
    if (!entries.length && (!pending || !input.forcePending && !pending.source.proofs.some((ref) => ref.seq <= input.target))) break;
    const state = pending ?? ctx.journal.start({ ...scope, source: captureSpan({ characterId: input.characterId, entries }), now: now(ctx) });
    const complete = await ingestSpan(ctx, state);
    for (const receipt of complete.bankReceipts) {
      totals.writes += receipt.result.memories.length + receipt.result.reinforced.length;
      totals.reinforced += receipt.result.reinforced.length;
      totals.sources += 1;
    }
    if (complete.gate?.decision === "skip") totals.skippedSpans += 1;
  }
  return totals;
}

function captureSpan(input: { characterId: string; entries: ProvenPrimaryEntry[] }): SanitizedCommittedSpan {
  // Shared canonical metadata permits at most 256 array entries. A source wider
  // than that is processed in consecutive durable spans instead of truncating it.
  const bounded = input.entries.slice(0, 256);
  const fromSeq = bounded[0]!.entry.seq - 1;
  while (true) {
    const span = sanitizeCommittedPrimarySpan({ characterId: input.characterId, fromSeq,
      throughSeq: bounded.at(-1)!.entry.seq, entries: bounded });
    if (CanonicalMemorySourceSchema.shape.retainedText.safeParse(retainedIngestionSource(span.messages).text).success) return span;
    bounded.pop();
    if (bounded.length === 0) throw new Error("MEMORY_INGESTION_SOURCE_TOO_LARGE");
  }
}

async function ingestSpan(ctx: IngestionContext, initial: CanonicalIngestionState): Promise<CanonicalIngestionState> {
  let state = initial;
  if (state.gate === null) state = ctx.journal.saveGate({ state, gate: await ctx.model.gate(state.source), now: now(ctx) });
  if (state.gate?.decision === "keep") {
    if (state.extraction === null) {
      const facts = await ctx.model.extract({ source: state.source, gate: state.gate });
      state = ctx.journal.saveExtraction({ state, extraction: { facts, batches: [] }, now: now(ctx) });
    }
    for (const bankId of selectedBanks(ctx, state)) state = await ingestBank(ctx, { state, bankId });
  }
  return ctx.maintenance.transaction(() => {
    const complete = ctx.journal.complete({ state, now: now(ctx) });
    const writes = complete.bankReceipts.flatMap((receipt) => [...receipt.result.memories, ...receipt.result.reinforced]);
    if (writes.length === 0) ctx.events?.record({ kind: "skip", characterId: complete.characterId, turnSeq: complete.source.throughSeq });
    for (const receipt of complete.bankReceipts) for (const record of receipt.result.reinforced) {
      ctx.events?.record({ kind: "reinforce", characterId: complete.characterId,
        turnSeq: complete.source.throughSeq, entryId: record.memoryId });
    }
    return complete;
  });
}

function selectedBanks(ctx: IngestionContext, state: CanonicalIngestionState): string[] {
  const gate = state.gate;
  if (gate?.decision !== "keep") return [];
  const banks = ctx.authority.listBanks(state.epochId).filter((bank) =>
    (bank.scope.kind === "global" || bank.scope.characterId === state.characterId)
    && (gate.route === "both" || bank.scope.kind === gate.route));
  const count = gate.route === "both" ? 2 : 1;
  if (banks.length !== count || new Set(banks.map((bank) => bank.scope.kind)).size !== count) {
    throw new Error("MEMORY_AUTHORITY_MISMATCH");
  }
  return banks.sort((left, right) => left.scope.kind === right.scope.kind ? 0 : left.scope.kind === "global" ? -1 : 1)
    .map((bank) => bank.bankId);
}

async function ingestBank(ctx: IngestionContext, input: { state: CanonicalIngestionState; bankId: string }): Promise<CanonicalIngestionState> {
  let state = input.state;
  let batch = state.extraction?.batches.find((item) => item.bankId === input.bankId);
  if (!batch) {
    batch = prepareBatch(ctx, { state, bankId: input.bankId });
    state = saveBatch(ctx, { state, batch });
  }
  if (!ctx.provider.ingestionReceipt(batch)) {
    let result = await ctx.provider.ingest({ authorityEpochId: state.epochId, requestId: batch.requestId, actor: "background-policy" }, batch);
    // A Local CAS refusal made no write. Re-prepare only this Bank from its
    // already durable facts; never rerun the model or refresh a successful Bank.
    if (!result.ok && result.error.code === "MEMORY_REVISION_MISMATCH" && !ctx.provider.ingestionReceipt(batch)) {
      batch = prepareBatch(ctx, { state, bankId: input.bankId });
      state = saveBatch(ctx, { state, batch });
      result = await ctx.provider.ingest({ authorityEpochId: state.epochId, requestId: batch.requestId, actor: "background-policy" }, batch);
    }
    if (!result.ok) throw new Error(result.error.code);
  }
  return ctx.journal.acknowledgeBank({ state, bankId: input.bankId, now: now(ctx) });
}

function prepareBatch(ctx: IngestionContext, input: { state: CanonicalIngestionState; bankId: string }): PreparedLocalIngestion {
  const { state, bankId } = input;
  if (state.gate?.decision !== "keep" || state.extraction === null) throw new Error("MEMORY_INGESTION_INCOMPLETE");
  return ctx.provider.prepareIngestion({ epochId: state.epochId, characterId: state.characterId,
    spanId: state.spanId, bankId, source: state.source, gate: state.gate, facts: state.extraction.facts });
}

function saveBatch(ctx: IngestionContext, input: { state: CanonicalIngestionState; batch: PreparedLocalIngestion }): CanonicalIngestionState {
  const extraction = input.state.extraction;
  if (extraction === null) throw new Error("MEMORY_INGESTION_INCOMPLETE");
  return ctx.journal.saveExtraction({ state: input.state,
    extraction: { facts: extraction.facts, batches: [...extraction.batches.filter((batch) => batch.bankId !== input.batch.bankId), input.batch] },
    now: now(ctx) });
}

function ingestionFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  return message.match(/^MEMORY_[A-Z_]+(?=:|$)/)?.[0] ?? "MEMORY_INGESTION_FAILED";
}
function now(ctx: CanonicalLocalIngestionDeps): string { return ctx.now?.() ?? new Date().toISOString(); }
