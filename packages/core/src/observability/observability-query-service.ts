/**
 * INPUT:  Core SQLite Run/Attempt/Receipt rows and immutable Run Events
 * OUTPUT: bounded, deterministic, Chinese semantic monitor projections for authorized operators
 * POS:    core/observability — read-only projection above the existing Run/Event authority
 */
import {
  RunMonitorListParamsSchema, RunMonitorListResultSchema, RunMonitorSummarySchema,
  TrajectoryInspectorSchema, TrajectoryParamsSchema, TrajectoryResultSchema, TrajectoryRowSchema,
  observabilityLabel, observabilityLabels,
  type MonitorMode, type RunEvent, type RunMonitorListParams, type RunMonitorListResult,
  type RunMonitorSummary, type TrajectoryInspector, type TrajectoryParams, type TrajectoryResult, type TrajectoryRow,
} from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import { payloadDigest, type RunEventRepo } from "../db/run-event-repo.ts";
import { readRunById } from "../db/run-readers.ts";

export interface ObservabilityQueryService {
  list(input: RunMonitorListParams): RunMonitorListResult;
  trajectory(input: TrajectoryParams): TrajectoryResult;
  inspect(input: { characterId: string; runKey: string; rowKey: string }): TrajectoryInspector;
  project(event: RunEvent): TrajectoryRow;
  mode(): MonitorMode;
}

export function createObservabilityQueryService(input: { db: Database; events: RunEventRepo; mode?: () => MonitorMode; scanLimit?: number }): ObservabilityQueryService {
  const mode = input.mode ?? (() => "DISABLED" as const);
  const scanLimit = Math.max(500, input.scanLimit ?? 50_000);
  const authorize = (characterId: string, runKey: string) => {
    const run = readRunById(input.db, runKey);
    if (run.characterId !== characterId) throw new Error("OBSERVABILITY_FORBIDDEN");
    return run;
  };
  const summary = (runKey: string, characterId: string): RunMonitorSummary =>
    buildSummary(input.db, input.events, authorize(characterId, runKey));
  return {
    mode,
    project: projectEvent,
    list: (candidate) => listRuns({ input, mode, scanLimit, summary, candidate }),
    trajectory(candidate) {
      if (mode() === "DISABLED") throw new Error("OBSERVABILITY_DISABLED");
      const params = TrajectoryParamsSchema.parse(candidate); const run = summary(params.runKey, params.characterId);
      if (params.afterSeq > input.events.tail(params.runKey).seq) throw new Error("OBSERVABILITY_CURSOR_STALE");
      const events = input.events.list(params.runKey, params.afterSeq); const rows = events.slice(0, params.limit).map(projectEvent);
      return TrajectoryResultSchema.parse({ run, rows, cursor: { runKey: params.runKey, seq: rows.at(-1)?.seq ?? params.afterSeq }, hasMore: events.length > rows.length });
    },
    inspect({ characterId, runKey, rowKey }) {
      if (mode() === "DISABLED") throw new Error("OBSERVABILITY_DISABLED");
      authorize(characterId, runKey); const runEvent = input.events.list(runKey).find((candidate) => candidate.eventId === rowKey);
      if (!runEvent) throw new Error("OBSERVABILITY_EVENT_NOT_FOUND");
      return inspectEvent(runEvent, mode());
    },
  };
}

function listRuns(args: {
  input: { db: Database; events: RunEventRepo };
  mode: () => MonitorMode;
  scanLimit: number;
  summary(runKey: string, characterId: string): RunMonitorSummary;
  candidate: RunMonitorListParams;
}): RunMonitorListResult {
  const params = RunMonitorListParamsSchema.parse(args.candidate);
  if (args.mode() === "DISABLED") return RunMonitorListResultSchema.parse({ runs: [] });
  validateListCursor(args.input.db, params);
  const matches: Array<{ raw: Record<string, unknown>; run: RunMonitorSummary; events: RunEvent[] }> = [];
  let cursor = params.cursor; let scanned = 0; let exhausted = false;
  while (matches.length < params.limit + 1 && scanned < args.scanLimit) {
    const rows = args.input.db.prepare(`SELECT run_id,queued_at,task_id,parent_run_id FROM runs
      WHERE character_id=:characterId ${cursor ? "AND (queued_at < :queuedAt OR (queued_at = :queuedAt AND run_id < :cursorKey))" : ""}
      ORDER BY queued_at DESC,run_id DESC LIMIT 500`).all({
      characterId: params.characterId,
      ...(cursor ? { queuedAt: cursor.queuedAt, cursorKey: cursor.key } : {}),
    }) as Array<Record<string, unknown>>;
    if (rows.length === 0) { exhausted = true; break; }
    scanned += rows.length;
    for (const raw of rows) {
      const runId = String(raw.run_id);
      const item = { raw, run: args.summary(runId, params.characterId), events: args.input.events.list(runId) };
      if (matchesFilters(item, params)) matches.push(item);
    }
    const last = rows.at(-1)!;
    cursor = { queuedAt: String(last.queued_at), key: String(last.run_id) };
    if (rows.length < 500) { exhausted = true; break; }
  }
  const page = matches.slice(0, params.limit); const last = page.at(-1);
  const nextCursor = matches.length > page.length && last
    ? { queuedAt: last.run.queuedAt, key: last.run.key }
    : !exhausted && cursor ? cursor : undefined;
  return RunMonitorListResultSchema.parse({ runs: page.map((item) => item.run), ...(nextCursor ? { nextCursor } : {}) });
}

function validateListCursor(db: Database, params: RunMonitorListParams): void {
  if (!params.cursor) return;
  const row = db.prepare("SELECT queued_at FROM runs WHERE run_id=:runId AND character_id=:characterId")
    .get({ runId: params.cursor.key, characterId: params.characterId }) as { queued_at?: unknown } | undefined;
  if (!row || String(row.queued_at) !== params.cursor.queuedAt) throw new Error("OBSERVABILITY_CURSOR_STALE");
}

function buildSummary(db: Database, eventsRepo: RunEventRepo, run: ReturnType<typeof readRunById>): RunMonitorSummary {
  const attempts = db.prepare("SELECT count(*) AS count,min(provider) AS provider,min(model_id) AS model_id FROM run_attempts WHERE run_id=:id").get({ id: run.runId });
  const receipt = db.prepare("SELECT summary,reason FROM run_receipts WHERE run_id=:id").get({ id: run.runId });
  const events = eventsRepo.list(run.runId); const usage = aggregateUsage(events);
  const durationMs = run.startedAt && run.terminalAt ? Math.max(0, Date.parse(run.terminalAt) - Date.parse(run.startedAt)) : undefined;
  const effectIds = events.flatMap((item) => isEffectPayload(item.payload) ? [item.payload.effectId] : []);
  const toolResults = events.filter((item) => item.payload.kind === "tool.result.settled");
  const toolSuccessCount = toolResults.filter((item) => item.payload.kind === "tool.result.settled" && item.payload.outcome === "completed").length;
  const toolFailureCount = toolResults.length - toolSuccessCount;
  const modelFailures = events.filter((item) => item.payload.kind === "model.response.settled" && item.payload.outcome !== "completed").length;
  const title = `${observabilityLabel(run.initiator)} · ${observabilityLabel(run.state)}`;
  return RunMonitorSummarySchema.parse({
    key: run.runId, characterId: run.characterId, title, initiator: run.initiator,
    initiatorLabel: observabilityLabel(run.initiator), triggerLabel: observabilityLabel(run.provenance.provider),
    deliveryClass: run.deliveryClass, deliveryLabel: observabilityLabel(run.deliveryClass), state: run.state,
    ...(run.outcome ? { outcome: run.outcome } : {}), queuedAt: run.queuedAt,
    ...(run.startedAt ? { startedAt: run.startedAt } : {}), ...(run.terminalAt ? { terminalAt: run.terminalAt } : {}),
    ...(durationMs === undefined ? {} : { durationMs }), attemptCount: Number(attempts?.count ?? 0),
    effectCount: new Set(effectIds).size,
    modelRequestCount: events.filter((item) => item.kind === "model.request.started").length,
    toolCallCount: events.filter((item) => item.kind === "tool.call.started").length,
    toolResultCount: toolResults.length, toolSuccessCount, toolFailureCount,
    failureCount: modelFailures + toolFailureCount,
    retryCount: events.filter((item) => item.kind === "run.retry").length, usage,
    ...(attempts?.provider ? { provider: String(attempts.provider) } : {}),
    ...(attempts?.model_id ? { modelId: String(attempts.model_id) } : {}),
    ...(run.parentRunId ? { lineageLabel: "子运行" } : run.taskId ? { lineageLabel: "定时任务" } : {}),
    ...(receipt?.summary ? { summary: String(receipt.summary) } : receipt?.reason ? { summary: String(receipt.reason) } : {}),
  });
}

function aggregateUsage(events: RunEvent[]): RunMonitorSummary["usage"] {
  const usage = events.flatMap((item) => item.payload.kind === "usage.settled" ? [item.payload] : []);
  if (usage.length === 0) return {};
  const inputDetails = compact({
    noCacheTokens: sumComplete(usage.map((item) => item.inputTokenDetails?.noCacheTokens)),
    cacheReadTokens: sumComplete(usage.map((item) => item.inputTokenDetails?.cacheReadTokens)),
    cacheWriteTokens: sumComplete(usage.map((item) => item.inputTokenDetails?.cacheWriteTokens)),
  });
  const outputDetails = compact({
    textTokens: sumComplete(usage.map((item) => item.outputTokenDetails?.textTokens)),
    reasoningTokens: sumComplete(usage.map((item) => item.outputTokenDetails?.reasoningTokens)),
  });
  return {
    inputTokens: sumComplete(usage.map((item) => item.inputTokens)), ...(inputDetails ? { inputTokenDetails: inputDetails } : {}),
    outputTokens: sumComplete(usage.map((item) => item.outputTokens)), ...(outputDetails ? { outputTokenDetails: outputDetails } : {}),
    totalTokens: sumComplete(usage.map((item) => item.totalTokens)), quality: aggregateQuality(usage.map((item) => item.quality)),
  };
}

function projectEvent(runEvent: RunEvent): TrajectoryRow {
  const payload = runEvent.payload; const surface = surfaceOf(runEvent);
  const base = {
    rowKey: runEvent.eventId, seq: runEvent.seq, ...(runEvent.attemptId ? { groupKey: runEvent.attemptId } : {}),
    label: observabilityLabel(runEvent.kind), ...(isEffectPayload(payload) ? { contextLabel: effectContext(payload.sourceRef) } : {}),
    phase: phaseOf(runEvent), category: runEvent.category, categoryLabel: observabilityLabel(runEvent.category),
    status: "state" in payload ? observabilityLabel(payload.state) : observabilityLabel(runEvent.kind),
    ...( "outcome" in payload && payload.outcome ? { outcome: observabilityLabel(payload.outcome) } : {}),
    occurredAt: runEvent.occurredAt, ...( "durationMs" in payload && payload.durationMs !== undefined ? { durationMs: payload.durationMs } : {}),
    surface, surfaceLabel: observabilityLabel(surface),
    ...( "summary" in payload && payload.summary ? { summary: payload.summary } : {}),
    ...( "reason" in payload && payload.reason ? { errorReason: payload.reason } : {}),
  };
  if (payload.kind === "usage.settled") return TrajectoryRowSchema.parse({ ...base, kind: "usage", inputTokens: payload.inputTokens, inputTokenDetails: payload.inputTokenDetails, outputTokens: payload.outputTokens, outputTokenDetails: payload.outputTokenDetails, totalTokens: payload.totalTokens, quality: observabilityLabel(payload.quality) });
  if (payload.kind.startsWith("model.")) return TrajectoryRowSchema.parse({ ...base, kind: "model", ...(payload.kind === "model.request.started" || payload.kind === "model.response.settled" ? { provider: payload.provider, modelId: payload.modelId } : {}), ...(payload.kind === "model.response.settled" && payload.finishReason ? { finishReason: observabilityLabel(payload.finishReason) } : {}), ...(payload.kind === "model.response.settled" && payload.timeToFirstOutputMs !== undefined ? { timeToFirstOutputMs: payload.timeToFirstOutputMs } : {}) });
  if (payload.kind === "tool.call.started" || payload.kind === "tool.result.settled") return TrajectoryRowSchema.parse({ ...base, kind: "tool", toolName: payload.toolName, ...(payload.kind === "tool.result.settled" && payload.errorClass ? { errorClass: observabilityLabel(payload.errorClass) } : {}) });
  if (payload.kind === "context.snapshot") return TrajectoryRowSchema.parse({ ...base, kind: "context", sourceCategories: observabilityLabels(payload.sourceCategories), accountingQuality: observabilityLabel(payload.accountingQuality) });
  if (payload.kind === "governance.evaluated") return TrajectoryRowSchema.parse({ ...base, kind: "governance", decision: observabilityLabel(payload.decision) });
  if (payload.kind === "approval.requested" || payload.kind === "approval.decided") return TrajectoryRowSchema.parse({ ...base, kind: "governance", approvalState: observabilityLabel(payload.state) });
  if (payload.kind === "run.retry") return TrajectoryRowSchema.parse({ ...base, kind: "recovery", classification: observabilityLabel("retrying") });
  if (isEffectPayload(payload)) return TrajectoryRowSchema.parse({ ...base, kind: "effect", effectKind: payload.effectKind });
  if (payload.kind === "recovery.classified") return TrajectoryRowSchema.parse({ ...base, kind: "recovery", classification: observabilityLabel(payload.classification) });
  if (runEvent.attemptId) return TrajectoryRowSchema.parse({ ...base, kind: "attempt", attemptOrdinal: "attemptOrdinal" in payload ? payload.attemptOrdinal : 1 });
  return TrajectoryRowSchema.parse({ ...base, kind: "lifecycle" });
}

function inspectEvent(runEvent: RunEvent, mode: MonitorMode): TrajectoryInspector {
  const detail = semanticDetails(runEvent); const technical = mode === "FULL_LOCAL" ? technicalDetails(runEvent) : [];
  return TrajectoryInspectorSchema.parse({
    mode, title: observabilityLabel(runEvent.kind), detail, technical, technicalCollapsed: true,
    redactionNotice: "原始提示词、凭据、授权材料、工具或 Host/MCP 载荷以及传感器媒体不会在监视器中显示。",
  });
}

function semanticDetails(runEvent: RunEvent): Array<{ label: string; value: string }> {
  const payload = runEvent.payload; const fields = [{ label: "状态", value: "state" in payload ? observabilityLabel(payload.state) : observabilityLabel(runEvent.kind) }];
  if ("outcome" in payload && payload.outcome) fields.push({ label: "结果", value: observabilityLabel(payload.outcome) });
  if ("summary" in payload && payload.summary) fields.push({ label: "摘要", value: payload.summary });
  if ("errorCode" in payload && payload.errorCode) fields.push({ label: "错误分类", value: payload.errorCode });
  if (payload.kind === "model.request.started" || payload.kind === "model.response.settled") fields.push({ label: "提供方", value: observabilityLabel(payload.provider) }, { label: "模型", value: payload.modelId });
  if (payload.kind === "model.response.settled") {
    if (payload.finishReason) fields.push({ label: "结束原因", value: observabilityLabel(payload.finishReason) });
    if (payload.durationMs !== undefined) fields.push({ label: "响应耗时", value: `${payload.durationMs} ms` });
    if (payload.timeToFirstOutputMs !== undefined) fields.push({ label: "首次输出耗时", value: `${payload.timeToFirstOutputMs} ms` });
  }
  if (payload.kind === "tool.call.started" || payload.kind === "tool.result.settled") fields.push({ label: "工具", value: payload.toolName });
  if (payload.kind === "tool.result.settled" && payload.errorClass) fields.push({ label: "错误类型", value: observabilityLabel(payload.errorClass) });
  if (payload.kind === "usage.settled") usageDetails(payload, fields);
  if (payload.kind === "context.snapshot") fields.push({ label: "上下文来源", value: observabilityLabels(payload.sourceCategories).join("、") || "未提供" }, { label: "计量质量", value: observabilityLabel(payload.accountingQuality) });
  if (payload.kind === "governance.evaluated") fields.push({ label: "能力", value: payload.capabilityId }, { label: "治理决定", value: observabilityLabel(payload.decision) });
  if (payload.kind === "approval.requested" || payload.kind === "approval.decided") fields.push({ label: "能力", value: payload.capabilityId }, { label: "审批状态", value: observabilityLabel(payload.state) });
  return fields;
}

function usageDetails(payload: Extract<RunEvent["payload"], { kind: "usage.settled" }>, fields: Array<{ label: string; value: string }>): void {
  fields.push({ label: "用量质量", value: observabilityLabel(payload.quality) });
  for (const [label, value] of [["输入 Token", payload.inputTokens], ["非缓存输入", payload.inputTokenDetails?.noCacheTokens], ["缓存读取", payload.inputTokenDetails?.cacheReadTokens], ["缓存写入", payload.inputTokenDetails?.cacheWriteTokens], ["输出 Token", payload.outputTokens], ["文本输出", payload.outputTokenDetails?.textTokens], ["推理 Token", payload.outputTokenDetails?.reasoningTokens], ["总 Token", payload.totalTokens]] as const) if (value !== undefined) fields.push({ label, value: String(value) });
  if (payload.inputTokenDetails?.cacheReadTokens === undefined && payload.inputTokenDetails?.cacheWriteTokens === undefined) fields.push({ label: "缓存信息", value: "缓存信息未提供" });
}

function technicalDetails(runEvent: RunEvent): Array<{ label: string; value: string }> {
  const payload = runEvent.payload as Record<string, unknown>; const fields = [{ label: "事件 ID", value: runEvent.eventId }, { label: "运行 ID", value: runEvent.runId }, ...(runEvent.attemptId ? [{ label: "尝试 ID", value: runEvent.attemptId }] : []), { label: "序号", value: String(runEvent.seq) }, { label: "Schema", value: runEvent.schemaVersion }, { label: "来源", value: runEvent.source }, { label: "载荷摘要", value: payloadDigest(runEvent) }];
  for (const [label, key] of [["执行 ID", "effectId"], ["模型调用 ID", "callId"], ["工具调用 ID", "toolCallId"], ["响应 ID", "responseId"], ["审批 ID", "approvalId"]] as const) if (typeof payload[key] === "string") fields.push({ label, value: payload[key] });
  return fields;
}

function matchesFilters(item: { raw: Record<string, unknown>; run: RunMonitorSummary; events: RunEvent[] }, params: RunMonitorListParams): boolean {
  const run = item.run;
  if (params.initiators && !params.initiators.includes(run.initiator)) return false;
  if (params.states && !params.states.includes(run.state)) return false;
  if (params.outcomes && (!run.outcome || !params.outcomes.includes(run.outcome))) return false;
  if (params.deliveryClasses && !params.deliveryClasses.includes(run.deliveryClass)) return false;
  if (params.provider && !hasModelIdentity(item, { provider: params.provider })) return false;
  if (params.modelId && !hasModelIdentity(item, { modelId: params.modelId })) return false;
  if (params.toolName && !item.events.some((event) => (event.payload.kind === "tool.call.started" || event.payload.kind === "tool.result.settled") && event.payload.toolName === params.toolName)) return false;
  if (params.errorCode && !item.events.some((event) => "errorCode" in event.payload && event.payload.errorCode === params.errorCode)) return false;
  if (params.hasRetry !== undefined && item.events.some((event) => event.kind === "run.retry") !== params.hasRetry) return false;
  if (params.hasFailure !== undefined && hasFailure(item.events) !== params.hasFailure) return false;
  if (params.taskId && item.raw.task_id !== params.taskId) return false;
  if (params.parentRunId && item.raw.parent_run_id !== params.parentRunId) return false;
  if (params.categories && !item.events.some((event) => params.categories?.includes(event.category))) return false;
  if (params.kinds && !item.events.some((event) => params.kinds?.includes(event.kind))) return false;
  if (params.from && run.queuedAt < params.from) return false;
  if (params.to && run.queuedAt > params.to) return false;
  if (params.text && !searchText(item).includes(params.text.toLowerCase())) return false;
  return true;
}

function searchText(item: { run: RunMonitorSummary; events: RunEvent[] }): string {
  const eventText = item.events.flatMap((event) => {
    const payload = event.payload; const values = [event.kind, event.category, "summary" in payload ? payload.summary : undefined, "errorCode" in payload ? payload.errorCode : undefined, "provider" in payload ? payload.provider : undefined, "modelId" in payload ? payload.modelId : undefined, "toolName" in payload ? payload.toolName : undefined];
    return values.filter((value): value is string => typeof value === "string");
  });
  return [item.run.title, item.run.triggerLabel, item.run.summary ?? "", ...eventText].join(" ").toLowerCase();
}

function hasModelIdentity(
  item: { run: RunMonitorSummary; events: RunEvent[] },
  expected: { provider?: string; modelId?: string },
): boolean {
  if ((!expected.provider || item.run.provider === expected.provider)
    && (!expected.modelId || item.run.modelId === expected.modelId)) return true;
  return item.events.some((event) => {
    const payload = event.payload;
    if (payload.kind !== "model.request.started" && payload.kind !== "model.response.settled") return false;
    return (!expected.provider || payload.provider === expected.provider)
      && (!expected.modelId || payload.modelId === expected.modelId);
  });
}

function hasFailure(events: RunEvent[]): boolean { return events.some((event) => (event.payload.kind === "model.response.settled" || event.payload.kind === "tool.result.settled") && event.payload.outcome !== "completed"); }
function sumComplete(values: Array<number | undefined>): number | undefined { return values.length === 0 || values.some((value) => value === undefined) ? undefined : values.reduce<number>((sum, value) => sum + (value ?? 0), 0); }
function aggregateQuality(values: Array<"reported" | "estimated" | "unknown">): "reported" | "estimated" | "unknown" { return values.includes("unknown") ? "unknown" : values.includes("estimated") ? "estimated" : "reported"; }
function compact<T extends Record<string, number | undefined>>(value: T): T | undefined { return Object.values(value).some((item) => item !== undefined) ? value : undefined; }
function surfaceOf(event: RunEvent): TrajectoryRow["surface"] { if (["attempt.prepared", "effect.intent_committed", "effect.waiting"].includes(event.kind)) return "log-only"; if (event.kind === "attempt.settled" && event.payload.kind === "attempt.settled" && event.payload.retryability === "retryable") return "shadowed"; return "current"; }
function phaseOf(event: RunEvent): TrajectoryRow["phase"] { if (event.kind === "run.admitted") return "trigger"; if (event.kind.startsWith("attempt.")) return "attempt"; if (event.kind.startsWith("effect.")) return "effect"; if (event.kind === "recovery.classified") return "recovery"; return event.category === "lifecycle" ? "run" : event.category; }
function effectContext(source: Extract<RunEvent["payload"], { kind: "effect.intent_committed" | "effect.waiting" | "effect.settled" }>["sourceRef"]): string { switch (source.type) { case "model": return `${observabilityLabel(source.provider)} / ${source.modelId}`; case "tool": return source.toolName; case "approval": return "审批决定"; case "host": return "Host 操作"; case "mcp": return `MCP · ${source.serverId}`; case "memory": return `记忆 · ${observabilityLabel(source.operation)}`; } }
function isEffectPayload(payload: RunEvent["payload"]): payload is Extract<RunEvent["payload"], { kind: "effect.intent_committed" | "effect.waiting" | "effect.settled" }> { return payload.kind === "effect.intent_committed" || payload.kind === "effect.waiting" || payload.kind === "effect.settled"; }
