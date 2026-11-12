/**
 * INPUT:  loaded safe trajectory rows with optional exact request/invocation identities
 * OUTPUT: chronological semantic records, pairing only producer-confirmed model/tool facts
 * POS:    ui/monitor — DSH trajectory-record/layout adaptation; see third-party-notices.md (DeepSeek MIT)
 */
import { getKnownToolDisplayName, getValidToolDisplayName, type TrajectoryRow } from "@taki/shared";

export interface RecordTiming {
  start: number;
  end: number;
  startKind: "request" | "processing" | "received" | "recorded";
  durationMs?: number;
  firstOutputMs?: number;
}
export interface TrajectoryRecord {
  key: string;
  row: TrajectoryRow;
  sources: readonly TrajectoryRow[];
  attemptKey?: string;
  requestKey?: string;
  name: string;
  timing: RecordTiming;
  usage?: Extract<TrajectoryRow, { kind: "usage" }>;
  error: boolean;
}

export function projectTrajectoryRecords(rows: readonly TrajectoryRow[]): TrajectoryRecord[] {
  const models = buckets(rows, modelIdentity);
  const tools = buckets(rows, toolIdentity);
  const consumed = new Set<string>();
  const records: TrajectoryRecord[] = [];
  for (const [key, candidates] of models) {
    if (!validModel(candidates)) continue;
    const modelRows = candidates.filter((row) => row.kind === "model");
    const representative = modelRows.find((row) => row.eventKind === "model.response.settled") ?? modelRows[0]!;
    const record = makeRecord(representative, candidates, key);
    // A loaded start proves the request boundary; an isolated result never invents its omitted history.
    if (modelRows.some((row) => row.eventKind === "model.request.started")) record.requestKey = key;
    records.push(record);
    for (const row of candidates) consumed.add(row.rowKey);
  }
  const knownRequests = new Set(records.flatMap((record) => record.requestKey ? [record.requestKey] : []));
  for (const [key, candidates] of tools) {
    if (!validTool(candidates)) continue;
    const representative = candidates.find((row) => row.eventKind === "tool.result.settled") ?? candidates[0]!;
    const record = makeRecord(representative, candidates, key);
    const requestKey = requestIdentity(representative);
    if (requestKey && knownRequests.has(requestKey)) record.requestKey = requestKey;
    records.push(record);
    for (const row of candidates) consumed.add(row.rowKey);
  }
  for (const row of rows) if (!consumed.has(row.rowKey)) records.push(makeRecord(row, [row], `event:${row.rowKey}`));
  return records.sort((left, right) => firstSequence(left) - firstSequence(right));
}

function buckets(rows: readonly TrajectoryRow[], identify: (row: TrajectoryRow) => string | undefined) {
  const result = new Map<string, TrajectoryRow[]>();
  for (const row of rows) {
    const key = identify(row);
    if (key) { const values = result.get(key) ?? []; values.push(row); result.set(key, values); }
  }
  return result;
}

function requestIdentity(row: TrajectoryRow): string | undefined {
  if (!row.modelEffectId) return undefined;
  return `model:${JSON.stringify([row.groupKey ?? null, row.modelEffectId])}`;
}

function modelIdentity(row: TrajectoryRow): string | undefined {
  if (row.kind !== "model" && row.kind !== "usage" && !(row.kind === "effect" && row.effectKind === "model")) return undefined;
  return requestIdentity(row);
}

function toolIdentity(row: TrajectoryRow): string | undefined {
  if (row.kind !== "tool") return undefined;
  if (row.invocationId) return `tool:${JSON.stringify([row.groupKey ?? null, row.invocationId])}`;
  if (row.modelEffectId && row.toolCallId) return `tool:${JSON.stringify([row.groupKey ?? null, row.modelEffectId, row.toolCallId])}`;
  return undefined;
}

function validModel(rows: readonly TrajectoryRow[]): boolean {
  if (!rows.some((row) => row.kind === "model")) return false;
  const kinds = ["model.request.started", "model.response.settled", "model.stream.first", "usage.settled"];
  if (kinds.some((kind) => rows.filter((row) => row.eventKind === kind).length > 1)) return false;
  const models = rows.filter((row): row is Extract<TrajectoryRow, { kind: "model" }> => row.kind === "model");
  return new Set(models.flatMap((row) => row.modelId ? [`${row.provider ?? ""}\0${row.modelId}`] : [])).size <= 1;
}

function validTool(rows: readonly TrajectoryRow[]): boolean {
  const tools = rows.filter((row): row is Extract<TrajectoryRow, { kind: "tool" }> => row.kind === "tool");
  if (new Set(tools.map((row) => JSON.stringify([row.toolName, row.toolCallId, row.modelEffectId]))).size !== 1) return false;
  return tools.filter((row) => row.eventKind === "tool.call.started").length <= 1
    && tools.filter((row) => row.eventKind === "tool.result.settled").length <= 1;
}

function makeRecord(row: TrajectoryRow, sources: readonly TrajectoryRow[], key: string): TrajectoryRecord {
  return {
    key, row, sources, attemptKey: row.groupKey, name: recordName(row), timing: recordTiming(row, sources),
    usage: sources.find((candidate): candidate is Extract<TrajectoryRow, { kind: "usage" }> => candidate.kind === "usage"),
    error: row.outcome === "失败" || row.outcome === "结果未知" || row.status === "校验失败" || row.status === "失败",
  };
}

function recordName(row: TrajectoryRow): string {
  if (row.kind === "tool") return getValidToolDisplayName(row.displayName) ?? getKnownToolDisplayName(row.toolName) ?? "工具调用";
  if (row.kind === "model") return [row.provider, row.modelId].filter(Boolean).join(" / ") || "模型请求";
  return row.label;
}

function recordTiming(row: TrajectoryRow, sources: readonly TrajectoryRow[]): RecordTiming {
  const request = sources.find((source) => source.eventKind === "model.request.started");
  const start = request?.startedAt ?? request?.occurredAt ?? row.startedAt;
  const timestamp = Date.parse(start ?? row.occurredAt);
  const measured = start !== undefined && row.durationMs !== undefined;
  return {
    start: timestamp, end: timestamp + (measured ? row.durationMs! : 0),
    startKind: request ? "request" : row.startedAt ? "processing" : row.eventKind === "tool.call.started" ? "received" : "recorded",
    durationMs: row.durationMs,
    ...(row.kind === "model" ? { firstOutputMs: row.timeToFirstOutputMs } : {}),
  };
}

export function firstSequence(record: TrajectoryRecord): number {
  return Math.min(...record.sources.map((row) => row.seq));
}

export function recordContains(record: TrajectoryRecord, rowKey: string | undefined): boolean {
  return rowKey !== undefined && record.sources.some((row) => row.rowKey === rowKey);
}
