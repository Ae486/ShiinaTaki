/**
 * INPUT: trusted primary source, finite proposed window and canonical admission/link callbacks
 * OUTPUT: source-bound one-shot plans, due facts and exact currentness through held delivery
 * POS: core/initiative/intentions — domain owner over Core SQLite; execution remains Run-owned
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { InitiativeIntentionSchema, InitiativeIntentionPlanSchema, type InitiativeIntention,
  type InitiativeIntentionPlan, type InitiativeIntentionPlanResult, type InitiativeDueIntention } from "@taki/shared";
import type { Database } from "../../db/sqlite.ts";
import { registerPatternPrimarySource, type InteractionPatternPrimarySource } from "../patterns/pattern-source.ts";
import { captureIntentionSource, intentionSourceCurrent, intentionSourceKey, intentionSourceWitness,
  reportedTimeIsQuoted, type IntentionActor, type IntentionSourceWitness } from "./intention-source.ts";
import { readIntention, readSourceIntention, readOpenIntentions, insertIntention, closeIntention, claimIntention,
  attachIntentionRun, linkedRun, releaseIntentionClaim, type IntentionScope, type IntentionClaim } from "./intention-repository.ts";
import { reconcileIntention } from "./intention-lifecycle.ts";

export const DEFAULT_INTENTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const Scope = z.strictObject({ characterId: z.string().min(1).max(200), intentionId: z.string().min(1).max(200) });
const Claim = Scope.extend({ canonicalRunKey: z.string().min(1).max(256) });
const Plan = z.strictObject({ characterId: z.string().min(1).max(200), plan: InitiativeIntentionPlanSchema });
export interface IntentionServiceOptions {
  db: Database; now?: () => number; maximumWindowMs?: () => number;
  onChanged?: (change: { characterId: string }) => void;
  sourceState?: (source: IntentionSourceWitness) => "current" | "unavailable" | "withdrawn";
}
export interface IntentionService {
  registerPrimarySource(source: InteractionPatternPrimarySource): boolean;
  plan(input: { characterId: string; plan: InitiativeIntentionPlan }, actor: IntentionActor): InitiativeIntentionPlanResult;
  get(scope: IntentionScope): InitiativeIntention | null;
  listDue(characterId: string): InitiativeDueIntention[];
  nextWakeAt(characterId: string): number | undefined;
  claim(input: IntentionClaim): boolean;
  link(input: IntentionClaim & { runId: string }): boolean;
  isCurrent(input: IntentionClaim): boolean;
  releaseUnadmitted(input: IntentionClaim): boolean;
  settleLinked(input: IntentionScope): void;
  reconcile(): void;
  notificationFailures(): number;
}
interface Context {
  options: IntentionServiceOptions; db: Database; now(): number;
  write<T>(operation: (changed: Set<string>) => T): T;
  failures(): number;
}

export function createIntentionService(options: IntentionServiceOptions): IntentionService {
  const ctx = createContext(options);
  const current = (input: IntentionScope) => ctx.write((changed) => currentIntention(ctx,
    Scope.parse({ characterId: input.characterId, intentionId: input.intentionId }), changed));
  return {
    registerPrimarySource: (source) => registerPatternPrimarySource(ctx.db, source),
    plan: (input, actor) => ctx.write((changed) => planIntention(ctx, { input, actor }, changed)),
    get: current,
    listDue: (characterId) => listDue(ctx, characterId),
    nextWakeAt: (characterId) => nextWakeAt(ctx, characterId),
    claim: (raw) => ctx.write((changed) => {
      const input = Claim.parse(raw); const value = currentIntention(ctx, input, changed);
      if (!value || value.state !== "active" || Date.parse(value.notBefore) > ctx.now() || sourceState(ctx, value.source) !== "current") return false;
      return claimIntention(ctx.db, input);
    }),
    link: (raw) => ctx.write((changed) => {
      const input = Claim.extend({ runId: z.string().min(1).max(200) }).parse(raw);
      const value = currentIntention(ctx, input, changed);
      if (!value || value.state !== "claimed" || value.canonicalRunKey !== input.canonicalRunKey) return false;
      return linkedRun(ctx.db, input)?.run_id === input.runId && attachIntentionRun(ctx.db, input);
    }),
    isCurrent: (raw) => {
      const input = Claim.parse(raw); const value = current({ intentionId: input.intentionId, characterId: input.characterId });
      return value !== null && value.state !== "terminal" && Date.parse(value.notBefore) <= ctx.now()
        && sourceState(ctx, value.source) === "current"
        && (value.state === "active" || value.canonicalRunKey === input.canonicalRunKey);
    },
    releaseUnadmitted: (raw) => ctx.write((changed) => {
      const input = Claim.parse(raw); const value = currentIntention(ctx, input, changed);
      return value?.state === "claimed" && value.canonicalRunKey === input.canonicalRunKey && releaseIntentionClaim(ctx.db, input);
    }),
    settleLinked: (input) => ctx.write((changed) => settleOne(ctx, Scope.parse(input), changed)),
    reconcile: () => reconcileAll(ctx),
    notificationFailures: ctx.failures,
  };
}

function createContext(options: IntentionServiceOptions): Context {
  let failures = 0;
  return { options, db: options.db, now: options.now ?? Date.now, failures: () => failures,
    write<T>(operation: (changed: Set<string>) => T): T {
      let result: T | undefined; const changed = new Set<string>();
      options.db.transaction(() => { result = operation(changed); });
      for (const characterId of changed) {
        try { options.onChanged?.({ characterId }); }
        catch { failures = Math.min(Number.MAX_SAFE_INTEGER, failures + 1); }
      }
      return result as T;
    } };
}

function planIntention(ctx: Context, request: {
  input: { characterId: string; plan: InitiativeIntentionPlan }; actor: IntentionActor;
}, changed: Set<string>): InitiativeIntentionPlanResult {
  const parsed = Plan.safeParse(request.input);
  if (!parsed.success) return { status: "refused", reason: "invalid_request" };
  const { characterId, plan } = parsed.data;
  const captured = captureIntentionSource(ctx.db, { characterId, actor: request.actor });
  if ("reason" in captured) return { status: "refused", reason: captured.reason };
  const source = sourceState(ctx, captured.source);
  if (source !== "current") return { status: "refused", reason: source === "withdrawn" ? "source_stale" : "source_unavailable" };
  const sourceKey = intentionSourceKey(captured.source);
  const previous = readSourceIntention(ctx.db, sourceKey);
  if (previous) return { status: "duplicate", intention: currentIntention(ctx, previous, changed) ?? previous };
  const duration = Date.parse(plan.expiresAt) - Date.parse(plan.notBefore);
  const maximum = ctx.options.maximumWindowMs?.() ?? DEFAULT_INTENTION_WINDOW_MS;
  if (!Number.isSafeInteger(maximum) || maximum <= 0 || duration > maximum) return { status: "refused", reason: "window_too_long" };
  if (Date.parse(plan.expiresAt) <= ctx.now()) return { status: "refused", reason: "expired" };
  if (!reportedTimeIsQuoted(ctx.db, captured.source, plan.reportedEventTime)) return { status: "refused", reason: "invalid_request" };
  const count = ctx.db.prepare("SELECT count(*) AS n FROM initiative_intentions WHERE character_id=:characterId").get({ characterId });
  if (Number(count?.n) >= 10000) return { status: "refused", reason: "capacity" };
  const intention = InitiativeIntentionSchema.parse({ intentionId: randomUUID(), characterId, sourceKey, source: captured.source,
    ...plan, notBefore: new Date(plan.notBefore).toISOString(), expiresAt: new Date(plan.expiresAt).toISOString(), state: "active",
    canonicalRunKey: null, runId: null, disposition: null, createdAt: new Date(ctx.now()).toISOString(), terminalAt: null });
  insertIntention(ctx.db, intention); changed.add(characterId);
  return { status: "created", intention };
}

function currentIntention(ctx: Context, scope: IntentionScope, changed: Set<string>): InitiativeIntention | null {
  const identity = { characterId: scope.characterId, intentionId: scope.intentionId };
  let value = readIntention(ctx.db, identity);
  if (!value || value.state === "terminal") return value;
  if (value.state === "claimed" && value.runId === null && value.canonicalRunKey !== null) {
    const claim = { ...identity, canonicalRunKey: value.canonicalRunKey };
    const run = linkedRun(ctx.db, claim);
    if (run) { attachIntentionRun(ctx.db, { ...claim, runId: String(run.run_id) }); value = readIntention(ctx.db, identity) ?? value; }
  }
  const disposition = Date.parse(value.expiresAt) <= ctx.now() ? "expired"
    : (!intentionSourceCurrent(ctx.db, value.source)
      || sourceState(ctx, value.source) === "withdrawn") ? "source_invalidated" : null;
  if (disposition) {
    closeIntention(ctx.db, { scope, disposition, at: new Date(ctx.now()).toISOString() }); changed.add(value.characterId);
    return readIntention(ctx.db, identity);
  }
  return value;
}

function listDue(ctx: Context, characterId: string): InitiativeDueIntention[] {
  z.string().min(1).max(200).parse(characterId);
  const due: InitiativeDueIntention[] = [];
  eachOpen(ctx, characterId, (value, changed) => {
    const current = currentIntention(ctx, value, changed);
    if (current?.state !== "active" || current.purpose === null || Date.parse(current.notBefore) > ctx.now() || sourceState(ctx, current.source) !== "current") return;
    due.push({ intentionId: current.intentionId, characterId, sourceKey: current.sourceKey,
      sourceRevision: current.source.digest, purpose: current.purpose,
      notBefore: Date.parse(current.notBefore), expiresAt: Date.parse(current.expiresAt) });
  });
  return due.sort((a, b) => a.notBefore - b.notBefore || a.intentionId.localeCompare(b.intentionId)).slice(0, 100);
}

function nextWakeAt(ctx: Context, characterId: string): number | undefined {
  z.string().min(1).max(200).parse(characterId);
  const now = ctx.now(); let after = ""; let earliest: number | undefined;
  // Scheduling reads never acquire a source, sweep state or mint an opportunity. Formation's
  // per-Character capacity bounds this paged scan, including temporarily unavailable witnesses.
  for (;;) {
    const batch = readOpenIntentions(ctx.db, { characterId, after });
    if (batch.length === 0) return earliest;
    for (const value of batch) {
      if (value.state !== "active" || Date.parse(value.expiresAt) <= now
        || !intentionSourceCurrent(ctx.db, value.source) || sourceState(ctx, value.source) === "withdrawn") continue;
      const wakeAt = Math.max(now, Date.parse(value.notBefore));
      earliest = Math.min(earliest ?? wakeAt, wakeAt);
    }
    after = batch.at(-1)?.intentionId ?? after;
  }
}

function settleOne(ctx: Context, scope: IntentionScope, changed: Set<string>): void {
  const value = currentIntention(ctx, scope, changed);
  if (value && reconcileIntention(ctx.db, { intention: value, at: new Date(ctx.now()).toISOString(), restart: false })) changed.add(value.characterId);
}

function reconcileAll(ctx: Context): void {
  eachOpen(ctx, undefined, (value, changed) => {
    const current = currentIntention(ctx, value, changed);
    if (current && reconcileIntention(ctx.db, { intention: current, at: new Date(ctx.now()).toISOString(), restart: true })) changed.add(current.characterId);
  });
}

function eachOpen(ctx: Context, characterId: string | undefined, visit: (value: InitiativeIntention, changed: Set<string>) => void): void {
  let after = "";
  for (;;) {
    const batch = readOpenIntentions(ctx.db, { characterId, after });
    if (batch.length === 0) return;
    for (const value of batch) ctx.write((changed) => visit(value, changed));
    after = batch.at(-1)?.intentionId ?? after;
  }
}

function sourceState(ctx: Context, source: InitiativeIntention["source"]): "current" | "unavailable" | "withdrawn" {
  return ctx.options.sourceState?.(intentionSourceWitness(source)) ?? "current";
}
