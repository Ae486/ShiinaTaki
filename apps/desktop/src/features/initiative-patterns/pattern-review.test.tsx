import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PatternReview } from "./pattern-review.tsx";
import { PatternHistory } from "./pattern-history.tsx";
import { PatternEditor } from "./pattern-editor.tsx";
import { InitiativePolicyView } from "./initiative-policy-view.tsx";
import { definition, pattern, setupStatus } from "./pattern-test-fixtures.ts";
import { PatternDetail } from "@/windows/home/pages/initiative/pattern-detail.js";
import { PatternController } from "./pattern-controller.ts";
import { INITIAL_PATTERN_STATE } from "./pattern-state.ts";

const noop = () => undefined;

describe("Pattern semantic review", () => {
  it("shows complete effective meaning and before/after changes without identifiers anywhere in markup", () => {
    const initial = pattern();
    const reviewed = { ...initial, effectiveRevision: { ...initial.candidateRevision!, revisionId: "opaque-old-revision", definition: { ...definition(), purpose: "原来的互动目的" }, acceptedAt: "2026-09-27T10:00:00Z" } };
    const markup = renderToStaticMarkup(<PatternReview reviewed={reviewed} latest={reviewed} available policy={<InitiativePolicyView setup={setupStatus()} />} actions={{ close: noop, useLatest: noop, confirm: noop }} />);
    for (const text of ["晚间回顾", "晚饭后轻松聊聊今天", "原来：", "原来的互动目的", "60 分钟", "25%", "19:00–21:00", "不设结束时间", "角色记忆", "保持安静", "有效全局限制"]) expect(markup).toContain(text);
    for (const hidden of ["opaque-pattern", "opaque-revision", "opaque-old-revision", "178923", "178922", "candidateRevisionId", "expectedVersion"]) expect(markup).not.toContain(hidden);
    expect(markup).toContain("确认这份提案并生效");
  });

  it("keeps the displayed old candidate and disables its confirmation on concurrent revision", () => {
    const reviewed = pattern();
    const markup = renderToStaticMarkup(<PatternReview reviewed={reviewed} latest={pattern({ version: 178924 })} available policy={null} actions={{ close: noop, useLatest: noop, confirm: noop }} />);
    expect(markup).toContain("不能确认旧内容");
    expect(markup).toContain("查看更新后的提案");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>确认这份提案并生效/);
  });

  it("shows accepted history as a new-proposal action rather than restore/autoactivation", () => {
    const revision = { ...pattern().candidateRevision!, acceptedAt: "2026-09-28T10:00:00Z" };
    const markup = renderToStaticMarkup(<PatternHistory pattern={pattern({ state: "active" })} history={{ revisions: [revision], nextBefore: null }} disabled={false} rollback={noop} loadMore={noop} />);
    expect(markup).toContain("以此内容创建新提案");
    expect(markup).not.toContain(revision.revisionId);
    expect(markup).not.toContain("178922");
  });

  it("retains draft content during conflict and hides completion transport bindings", () => {
    const initial = pattern();
    initial.candidateRevision!.definition.conditions.all.push({ kind: "completion_of", runId: "opaque-run", label: "整理今天的笔记" });
    const markup = renderToStaticMarkup(<PatternEditor initial={initial} latest={pattern({ version: 178924 })} disabled={false} completions={[{ runId: "opaque-run", label: "整理今天的笔记" }]} submit={async () => true} close={noop} />);
    expect(markup).toContain("你的草稿已保留"); expect(markup).toContain("晚饭后轻松聊聊今天");
    expect(markup).toContain("整理今天的笔记"); expect(markup).not.toContain("opaque-run");
    expect(markup).not.toContain("opaque-pattern");
  });

  it("keeps a last-good detail readable but disables its actions after detail recovery fails", () => {
    const row = pattern();
    const markup = renderToStaticMarkup(<PatternDetail policy={null} edit={noop} patterns={{
      available: true, controller: new PatternController(noop), state: { ...INITIAL_PATTERN_STATE,
        fresh: true, selectedId: row.patternId, requestedId: row.patternId, detailError: "读取失败",
        detail: { pattern: row, history: { revisions: [], nextBefore: null } }, list: { patterns: [row], nextAfter: null } },
    }} />);
    expect(markup).toContain("晚间回顾");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>查看并确认/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>修改并提案/);
  });
});
