import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LatestPrimaryRequestSnapshot, RequestComposition } from "@taki/shared";
import { compositionDisplayRows, requestOccupancy, formatPercent } from "./request-composition-display.ts";
import { RequestContextStrip } from "./request-context-strip.tsx";
import { INITIAL_CACHE_USAGE_VIEW } from "./cache-usage-controller.ts";

const composition: RequestComposition = {
  estimator: "heuristic-v1", totalUnits: 1000,
  categories: { instructions: 100, persona: 200, injected_memory: 0, runtime_context: 50, summary: 50,
    conversation: 300, tool_definitions: 80, tool_interactions: 100, other: 120 },
  origins: {
    instructions: { builtin: 100, mcp: 0, skill: 0, unknown: 0 }, persona: { builtin: 200, mcp: 0, skill: 0, unknown: 0 },
    injected_memory: { builtin: 0, mcp: 0, skill: 0, unknown: 0 }, runtime_context: { builtin: 50, mcp: 0, skill: 0, unknown: 0 },
    summary: { builtin: 50, mcp: 0, skill: 0, unknown: 0 }, conversation: { builtin: 300, mcp: 0, skill: 0, unknown: 0 },
    tool_definitions: { builtin: 0, mcp: 80, skill: 0, unknown: 0 }, tool_interactions: { builtin: 0, mcp: 0, skill: 100, unknown: 0 },
    other: { builtin: 0, mcp: 0, skill: 0, unknown: 120 },
  }, coverage: { status: "partial", unestimatedParts: 0, unknownOriginUnits: 120, hasHeuristicMedia: true },
};
const snapshot: LatestPrimaryRequestSnapshot = { scope: "latest-primary-request", characterId: "taki", status: "partial",
  computedAt: "2026-11-02T11:00:00.000Z", reason: null, request: {
    runId: "hidden-run-id", effectId: "hidden-effect-id", primaryInputSeq: 7, stepNumber: 0,
    provider: "fixture", modelId: "fixture-primary", dispatchedAt: "2026-11-02T10:00:00.000Z", completedAt: "2026-11-02T11:00:00.000Z",
    outcome: "completed", inputTokens: 2400, window: { declaredRealTokens: 16000, effectiveRealTokens: 12000, estimatorWindowUnits: 6000, factor: 2 }, composition,
  } };
const render = (latest = snapshot) => renderToStaticMarkup(<RequestContextStrip view={{ ...INITIAL_CACHE_USAGE_VIEW, phase: "live", latestPrimaryRequest: latest }} />);

describe("latest request display mapping and estimate honesty", () => {
  it("sums selected raw counts before computing a merged group's ratio", () => {
    const merged = compositionDisplayRows(composition, [{ key: "instructions", label: "设定与指令", categories: ["instructions", "persona"] }]);
    expect(merged[0]).toMatchObject({ units: 300, ratio: 0.3 });
    expect(compositionDisplayRows(composition).reduce((sum, row) => sum + row.units, 0)).toBe(1000);
  });
  it("uses provider input and captured real-token window without mixing estimate units or reserve", () => {
    expect(requestOccupancy(snapshot.request)).toMatchObject({ value: "2,400 / 12,000", ratio: 0.2, estimated: false });
    const html = render();
    expect(html).toContain("20.0%"); expect(html).toContain("上游报告输入");
    expect(html).toContain("估算比例"); expect(html).toContain("多模态估算精度有限");
    expect(html).toContain("fixture-primary"); expect(html).toContain("循环第 1 步");
    expect(html).toContain("与上方摘要以来的缓存统计范围不同");
    expect(html).not.toMatch(/hidden-run-id|hidden-effect-id|primaryInputSeq|heuristic-v1|dispatchedAt/);
  });
  it("separates provider zero from missing usage and makes estimate-only fallback explicit", () => {
    expect(requestOccupancy({ ...snapshot.request!, inputTokens: 0 })).toMatchObject({ ratio: 0, value: "0 / 12,000", estimated: false });
    expect(requestOccupancy({ ...snapshot.request!, inputTokens: null })).toMatchObject({ ratio: 1 / 6, value: "1,000 / 6,000", estimated: true });
    const html = render({ ...snapshot, reason: "usage-missing", request: { ...snapshot.request!, inputTokens: null } });
    expect(html).toContain("估算输入 / 估算窗口"); expect(html).toContain("上游输入用量未知");
    expect(requestOccupancy({ ...snapshot.request!, window: null })).toMatchObject({ ratio: null, value: "2,400 / --" });
  });
  it("shows a differing response model without changing the requested model or occupancy window", () => {
    const html = render({ ...snapshot, request: { ...snapshot.request!, responseModelId: "served-primary" } });
    expect(html).toContain("请求模型：fixture / fixture-primary");
    expect(html).toContain("响应模型：served-primary");
    expect(html).toContain("2,400 / 12,000"); expect(html).toContain("20.0%");
    expect(render()).not.toContain("响应模型：");
    expect(render({ ...snapshot, request: { ...snapshot.request!, responseModelId: "fixture-primary" } })).not.toContain("响应模型：");
  });
  it("keeps zero composition proportions undefined rather than manufacturing nine zero shares", () => {
    const zero = { ...composition, totalUnits: 0, categories: Object.fromEntries(Object.keys(composition.categories).map((key) => [key, 0])) as RequestComposition["categories"] };
    expect(compositionDisplayRows(zero).every((row) => row.units === 0 && row.ratio === null)).toBe(true);
    expect(formatPercent(null)).toBe("--");
    expect(render({ ...snapshot, request: { ...snapshot.request!, composition: zero } })).toContain("比例无定义");
  });
  it("shows provenance as independent detail and never a tenth content category", () => {
    const html = render();
    expect(html).toContain("MCP 80"); expect(html).toContain("Skill 100"); expect(html).toContain("不另计入组成");
    expect((html.match(/class="[^"]*legendItem/g) ?? []).length).toBe(9);
    expect(html).toContain("未知 120");
  });
  it("distinguishes fully attributed media with heuristic token uncertainty from actual source coverage gaps", () => {
    const known = { ...composition, origins: { ...composition.origins, other: { builtin: 120, mcp: 0, skill: 0, unknown: 0 } },
      coverage: { ...composition.coverage, unknownOriginUnits: 0 } };
    const html = render({ ...snapshot, request: { ...snapshot.request!, composition: known } });
    expect(html).toContain("内容已归类"); expect(html).toContain("多模态估算精度有限");
    expect(html).not.toContain("覆盖不完整");
  });
  it("renders empty, unavailable, missing measurement and stale retained facts explicitly", () => {
    expect(render({ ...snapshot, status: "empty", request: null, reason: null })).toContain("暂无已完成的主对话请求");
    expect(render({ ...snapshot, status: "unavailable", request: null, reason: "read-failed" })).toContain("请求统计读取失败");
    expect(render({ ...snapshot, reason: "measurement-missing", request: { ...snapshot.request!, composition: null, window: null } })).toContain("组成或窗口未记录");
    const stale = renderToStaticMarkup(<RequestContextStrip view={{ ...INITIAL_CACHE_USAGE_VIEW, phase: "stale", latestPrimaryRequest: snapshot }} />);
    expect(stale).toContain("上次结果 · 等待恢复"); expect(stale).toContain("2,400 / 12,000");
  });
  it.each([["failed", "请求失败"], ["cancelled", "已取消"], ["deadline_exceeded", "请求超时"],
    ["outcome_unknown", "请求结果未知"], ["reconciliation_required", "请求结果待核对"]] as const)("keeps %s request outcomes explicit", (outcome, label) => {
    expect(render({ ...snapshot, request: { ...snapshot.request!, outcome } })).toContain(label);
  });
});
