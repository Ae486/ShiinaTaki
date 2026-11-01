import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AttentionView } from "./subagent-attention-controller.ts";
import { EMPTY_ATTENTION_VIEW } from "./subagent-attention-controller.ts";
import { SubagentAttention } from "./subagent-attention.tsx";
import { CHILD_A, WORK_A } from "../../../test/s7-subagent-data.ts";

let state: AttentionView = EMPTY_ATTENTION_VIEW;
const controller = { refresh: vi.fn(), older: vi.fn(), newest: vi.fn(), resume: vi.fn() };
vi.mock("./use-subagent-attention.ts", () => ({ useSubagentAttention: () => ({ state, controller }) }));

beforeEach(() => {
  state = { ...EMPTY_ATTENTION_VIEW, fresh: true, page: { entries: [], nextCursor: null } };
});

describe("persistent Home attention entry", () => {
  it("shows the actual requested user decision as safe persistent text", () => {
    state.page!.entries = [{ attentionId: "attention-decision", kind: "needs_user_input", subagentId: CHILD_A,
      workInputId: WORK_A, label: "Research worker", eventId: "event-a", consumerId: null,
      reason: "Choose source A or B.\nKeep <script> as quoted evidence.", canResume: false }];
    const html = renderToStaticMarkup(<SubagentAttention />);
    expect(html).toContain("Choose source A or B.");
    expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
    expect(html).toContain("打开工作并决定");
  });

  it("explains the actual reconciliation refusal without exposing an internal code", () => {
    state.page!.entries = [{ attentionId: "attention-uncertain", kind: "reconciliation_needed", subagentId: CHILD_A,
      workInputId: WORK_A, label: "Research worker", eventId: "event-a", consumerId: "consumer-a",
      reason: "SUBAGENT_INBOX_UNCERTAIN_EFFECT", canResume: false }];
    const html = renderToStaticMarkup(<SubagentAttention />);
    expect(html).toContain("此前工具操作结果未知，需先核对该操作。");
    expect(html).not.toContain("SUBAGENT_INBOX_UNCERTAIN_EFFECT"); expect(html).not.toContain("继续主助手处理");
  });

  it("distinguishes exhausted pre-intent retry from an admitted reconciliation batch", () => {
    state.page!.entries = [{ attentionId: "attention-retry", kind: "inbox_retry_exhausted", subagentId: CHILD_A,
      workInputId: WORK_A, label: "Research worker", eventId: "event-a", consumerId: null,
      reason: "retry exhausted", canResume: true }];
    const html = renderToStaticMarkup(<SubagentAttention />);
    expect(html).toContain("主助手接入重试已结束"); expect(html).toContain("重试接入主助手");
    expect(html).not.toContain("继续主助手处理"); expect(html).not.toContain("需要你的补充输入");
  });
  it("keeps an explicit user-only check-in explanation and work action discoverable", () => {
    state.page!.entries = [{ attentionId: "attention-a", kind: "check_in_user", subagentId: CHILD_A,
      workInputId: WORK_A, label: "Research worker", eventId: "event-a", consumerId: null,
      reason: "internal evidence", canResume: false }];
    const html = renderToStaticMarkup(<SubagentAttention />);
    expect(html).toContain('aria-label="子代理待处理"'); expect(html).toContain("Research worker");
    expect(html).toContain("主助手无法代为放行"); expect(html).toContain("打开工作并决定");
    expect(html).not.toContain("internal evidence"); expect(html).not.toContain("继续主助手处理");
  });

  it("distinguishes reconciliation and exposes explicit recovery only when Core allows it", () => {
    state.page!.entries = [{ attentionId: "attention-a", kind: "reconciliation_needed", subagentId: CHILD_A,
      workInputId: WORK_A, label: "Research worker", eventId: "event-a", consumerId: "consumer-a",
      reason: "uncertain effect", canResume: false }];
    let html = renderToStaticMarkup(<SubagentAttention />);
    expect(html).toContain("主助手处理需要核对"); expect(html).toContain("核对主助手恢复记录");
    expect(html).not.toContain("继续主助手处理");
    state.page!.entries[0]!.canResume = true;
    html = renderToStaticMarkup(<SubagentAttention />); expect(html).toContain("继续主助手处理");
    state.fresh = false;
    html = renderToStaticMarkup(<SubagentAttention />); expect(html).toContain("上次记录尚未核对");
    expect(html).toMatch(/disabled=""[^>]*>.*?继续主助手处理/s);
  });
});
