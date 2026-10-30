/**
 * INPUT: semantic fixture records/state, including hidden technical metadata and literal authored identifiers.
 * OUTPUT: assertions for meaningful content, truthful states and bounded detail/retention presentation.
 * POS: Home QQ page tests; actual interaction and native attachment are covered by the isolated WebView smoke.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { HistoryRecord, ManagementController, ManagementState } from "@qqmm/management-client";
import { QqmmContent } from "./qqmm-page.tsx";
import { QqmmDetail } from "./qqmm-detail.tsx";
import { captureScrollAnchor, restoreScrollAnchor } from "./qqmm-timeline.tsx";

const row: HistoryRecord = {
  recordId: "private-record-hash", sequence: 123456, kind: "message", severity: "info", occurredAt: 1_800_000_000_000,
  expiresAt: 1_810_000_000_000, conversationRef: "private-conversation-hash", conversationType: "group", conversationId: "12345",
  conversationName: "项目讨论", senderUin: "67890", senderName: "小林", direction: "in", sourceTimestamp: null,
  preview: "保留原文 deadbeef-1.2.3 <script>alert(1)</script>", snapshotStatus: "captured",
};
const state: ManagementState = {
  connection: "connected", loading: false, loadingOlder: false, error: null, filters: {}, records: [row], detail: null,
  detailLoading: false, detailMode: "record", sourcePage: null, sourceDetail: null, sourceLoading: false, sourceError: null,
  conversations: [], paused: false, pendingCount: 0, followLatest: true, hasOlder: true,
  config: { retentionDays: 30, revision: "private-revision" }, retentionDraft: { text: "7", status: "dirty", preview: null, message: null },
  settings: null, settingsDraft: { status: "idle", values: {}, dimensions: [], base: null, preview: null, issues: [], message: null },
  controlsLoading: false, controlsError: null, session: null, control: { status: "idle", action: null, operationId: null, message: null },
  secrets: null, secretDraft: { name: null, value: "", status: "idle", message: null }, artifact: null,
  retry: { loading: false, eligibility: null, request: null, status: "idle", message: null },
  monitor: { captureState: "stopped", backend: "private-backend-version", account: "12345", historyState: "ready", recordingAvailable: true,
    maintenanceFailed: false, retention: null, generatedAt: row.occurredAt, pollIntervalMs: 2000, summary: null, upgradePreview: null },
};
const controller = new Proxy({}, { get: () => vi.fn() }) as ManagementController;
const markup = (patch: Partial<ManagementState> = {}) => renderToStaticMarkup(<QqmmContent state={{ ...state, ...patch }} controller={controller} />);

describe("QQ history presentation", () => {
  it("shows authored content and meaningful provenance, escapes markup and excludes transport labels", () => {
    const html = markup();
    expect(html).toContain("项目讨论 · 小林");
    expect(html).toContain("deadbeef-1.2.3");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    for (const value of [row.recordId, "private-revision", "private-backend-version", row.senderUin]) expect(html).not.toContain(value);
    expect(html).toContain("历史记录可查询");
    expect(html).toContain("采集已停止");
  });

  it("keeps pending arrivals bounded and distinguishes pause/clear from stored deletion", () => {
    const html = markup({ paused: true, pendingCount: 10000, records: [] });
    expect(html).toContain("10000+"); expect(html).toContain("显示已暂停");
    expect(html).toContain("继续显示"); expect(html).toContain("清空当前视图");
    expect(html).toContain("回到最新");
  });

  it("distinguishes same-name and unnamed conversations with meaningful QQ numbers", () => {
    const html = markup({ conversations: [
      { conversationRef: "private-a", conversationType: "group", conversationId: "12345", conversationName: "项目讨论", recordCount: 1, latestAt: row.occurredAt },
      { conversationRef: "private-b", conversationType: "group", conversationId: "54321", conversationName: "项目讨论", recordCount: 1, latestAt: row.occurredAt },
      { conversationRef: "private-c", conversationType: "friend", conversationId: "67890", conversationName: "项目讨论", recordCount: 1, latestAt: row.occurredAt },
      { conversationRef: "private-d", conversationType: "group", conversationId: "98765", conversationName: "", recordCount: 1, latestAt: row.occurredAt },
    ] });
    expect(html).toContain(">群聊 · 项目讨论（12345）</option>");
    expect(html).toContain(">群聊 · 项目讨论（54321）</option>");
    expect(html).toContain(">私聊 · 项目讨论</option>");
    expect(html).toContain(">群聊 · 未命名群聊（98765）</option>");
    expect(html).not.toMatch(/>[^<]*private-[abcd][^<]*</);
  });

  it("distinguishes an empty view from no filter matches and offers a filter reset", () => {
    const empty = markup({ records: [] });
    expect(empty).toContain("当前视图暂无日志");
    expect(empty).not.toContain("清除筛选");
    const filtered = markup({ records: [], filters: { search: "不存在的内容" } });
    expect(filtered).toContain("暂无符合条件的日志");
    expect(filtered).toContain("清除筛选");
    const loading = markup({ records: [], filters: { search: "等待查询" }, loading: true });
    expect(loading).toContain("正在读取日志");
    expect(loading).not.toContain("暂无符合条件的日志");
  });

  it("gates stale rows/details on disconnect and describes upgrade impact without identifiers", () => {
    const disconnected = markup({ connection: "disconnected", error: "连接已断开" });
    expect(disconnected).not.toContain(row.preview);
    expect(disconnected).not.toContain("历史记录可查询");
    expect(disconnected).toContain("上次读取 30 天");
    const html = markup({ monitor: { ...state.monitor!, historyState: "upgrade_required", upgradePreview: { unknownSummaryCount: 3, affectedConversationCount: 2 } } });
    expect(html).toContain("3 份摘要、2 个会话"); expect(html).not.toContain("项目讨论 · 小林");
  });

  it("renders only the current detail chunk with a next-segment action and provenance notice", () => {
    const html = renderToStaticMarkup(<QqmmDetail controller={controller} state={{ ...state, detail: { record: { ...row, snapshotStatus: "legacy_available" }, text: "当前分段", offset: 4096, totalCharacters: 9000, nextOffset: 4100, retention: { retentionDays: 30, cutoff: 0, now: 0, generation: 4, datasetId: "private-dataset", nextExpiryAt: null } } }} />);
    expect(html).toContain("第 4097–4100 字 / 共 9000 字"); expect(html).toContain("下一段");
    expect(html).toContain("目前可用内容"); expect(html).not.toContain("private-dataset");
  });

  it("opens a dismissible loading dialog before the first detail read completes", () => {
    const html = renderToStaticMarkup(<QqmmDetail controller={controller} state={{ ...state, detail: null, detailLoading: true }} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("正在读取内容…");
    expect(html).toContain('aria-label="关闭"');
    expect(html).not.toContain(row.preview);
    expect(renderToStaticMarkup(<QqmmDetail controller={controller} state={{ ...state, detail: null, detailLoading: false }} />)).toBe("");
  });

  it("preserves the first visible row on prepend and ignores an expired detached anchor", () => {
    let rowTop = 110;
    const visible = { isConnected: true, getBoundingClientRect: () => ({ top: rowTop, bottom: rowTop + 20 }) };
    const hidden = { getBoundingClientRect: () => ({ top: 40, bottom: 60 }) };
    const container = { scrollTop: 200, getBoundingClientRect: () => ({ top: 100 }), querySelectorAll: () => [hidden, visible] } as unknown as HTMLElement;
    const anchor = captureScrollAnchor(container);
    rowTop += 70; restoreScrollAnchor(container, anchor); expect(container.scrollTop).toBe(270);
    visible.isConnected = false; rowTop += 30; restoreScrollAnchor(container, anchor); expect(container.scrollTop).toBe(270);
  });

  it("shows captured summary stages and saved dimension titles without a fabricated sender", () => {
    const summary = { ...row, kind: "summary" as const, summary: { status: "completed" as const, sourceCount: 23,
      sourceFrom: row.occurredAt - 86400000, sourceTo: row.occurredAt, containsRecalled: true, failureCount: 2,
      failureReason: null, context: "existing_state" as const, timeBasis: "observed_time" as const } };
    const html = markup({ records: [summary], detail: { record: summary, text: "原始分项内容😀", offset: 4096, totalCharacters: 9000,
      nextOffset: 4103, retention: { retentionDays: 30, cutoff: 0, now: 0, generation: 4, datasetId: "private-dataset", nextExpiryAt: null },
      section: { part: 1, type: "dimension", title: "当时保存的关注事项 <b> literal", nextPart: 2 } } });
    expect(html).toContain("项目讨论 · 摘要"); expect(html).not.toContain("未命名成员");
    expect(html).toContain("记录时已完成"); expect(html).toContain("原始消息 23 条"); expect(html).toContain("已记录 2 次失败");
    expect(html).toContain("当时保存的关注事项 &lt;b&gt; literal"); expect(html).toContain("下一项"); expect(html).toContain("下一段");
    expect(html).toContain("第 4097–4103 字"); expect(html).not.toContain("private-dataset");
  });

  it("keeps missing and recalled sources local, literal, bounded and absent after retirement", () => {
    const summary = { ...row, kind: "summary" as const, summary: { status: "completed" as const, sourceCount: 2,
      sourceFrom: row.occurredAt, sourceTo: row.occurredAt, containsRecalled: false, failureCount: 0,
      failureReason: null, context: "initial" as const, timeBasis: "stage_time" as const } };
    const retention = { retentionDays: 30, cutoff: 0, now: 0, generation: 4, datasetId: "private-dataset", nextExpiryAt: null };
    const detail = { record: summary, text: "已保存摘要", offset: 0, totalCharacters: 5, retention };
    const source = { sourceKey: "private-source", availability: "available" as const, reason: null,
      snapshotStatus: "captured" as const, senderUin: "67890", senderName: "小林", direction: "in" as const,
      timestamp: row.occurredAt, recalled: true, preview: "记录原文 <script>😀" };
    const page = { parentRecord: summary, sourceCount: 2, unavailableCount: 1, retention, nextCursor: "private-cursor", sources: [source] };
    const sourceState: Partial<ManagementState> = { detail, detailMode: "sources", sourcePage: page };
    const html = markup(sourceState);
    expect(html).toContain("当时记录的原文"); expect(html).toContain("已撤回"); expect(html).toContain("1 条原文不可用");
    expect(html).toContain("下一页来源"); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("private-source");
    expect(html).not.toContain("private-cursor"); expect(html).not.toContain("已保存摘要");
    const absent = markup({ ...sourceState, detailMode: "source", sourceDetail: { parentRecord: summary, retention, offset: 0, totalCharacters: 0, text: null,
      source: { ...source, availability: "unavailable", snapshotStatus: null, preview: null, reason: "recorded_source_unavailable" } } });
    expect(absent).toContain("未保留这条来源的原文"); expect(absent).toContain("摘要详情"); expect(absent).toContain("返回摘要");
    expect(absent).not.toContain("内容为空");
    const retired = markup({ ...sourceState, detail: null });
    expect(retired).not.toContain("记录原文"); expect(retired).not.toContain("来源消息");
  });
});
