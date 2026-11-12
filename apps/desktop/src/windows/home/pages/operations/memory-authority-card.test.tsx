import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AT, bankStatus, degradedStatus, disabledSection, hindsightStatus, localStatus, operation, policyReview, provisioningSection, unreviewedSection } from "./memory-authority-fixtures.ts";
import { MemoryAuthorityCard } from "./memory-authority-card.tsx";
import type { MemoryOperationsView } from "./use-memory-operations.ts";

const noop = async () => undefined;

function view(overrides: Partial<MemoryOperationsView> = {}): MemoryOperationsView {
  return { status: null, loading: false, error: null, busyKey: null, feedback: null, connectionReady: true, tidy: null, tidyLoading: false, tidyError: null, submitTidy: noop, refresh: noop, submit: noop, submitSync: noop, configureSync: noop, cancel: noop, ...overrides };
}

function card(overrides: Partial<MemoryOperationsView> = {}): string {
  return renderToStaticMarkup(<MemoryAuthorityCard ops={view(overrides)} />);
}

const buttons = (markup: string) => [...markup.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((match) => match[1]?.replace(/<[^>]*>/g, ""));
const LIFECYCLE_BUTTONS = ["重新校验连接", "创建 Bank（nana）", "创建 Bank（yui）"];
/** The lifecycle block's own markup up to its diagnostics, so replica Bank controls below it are not counted. */
const lifecycleBlock = (markup: string) => markup.split("Hindsight 连接与 Bank")[1]!.split("技术诊断")[0]!;
const unreviewed = hindsightStatus({ hindsight: unreviewedSection() });
const reviewBlock = (markup: string) => markup.split("策略巡检")[1]!;

describe("memory authority card", () => {
  it.each([true, false])("renders waiting separately from failure and keeps a new check available (automatic=%s)", (automatic) => {
    const markup = card({ status: hindsightStatus({ replica: [bankStatus("global", { mode: "waiting", automatic,
      retryDueAt: automatic ? AT : null, retryKind: automatic ? "incremental" : null,
      nextAction: automatic ? "automatic_retry_scheduled" : "explicit_retry_required" })] }) });
    expect(markup).toContain("已受理，等待 Hindsight 处理");
    expect(markup).toContain(automatic ? "已排定自动检查处理结果" : "稍后手动同步以检查处理结果");
    expect(markup).toContain("1 待写 / 0 失败 / 1 未知 / 2 父写");
    const syncButton = [...markup.matchAll(/<button([^>]*)>(.*?)<\/button>/g)]
      .find((match) => match[2]?.replace(/<[^>]*>/g, "") === "立即同步");
    expect(syncButton).toBeDefined();
    expect(syncButton?.[1]).not.toContain('disabled=""');
    expect(markup).not.toContain("HINDSIGHT_PENDING_REMAINS");
  });

  it.each([
    { state: "pending", label: "待处理" }, { state: "running", label: "执行中" },
    { state: "paused", label: "已暂停" }, { state: "error", label: "错误" }, { state: null, label: "空闲" },
  ] as const)("renders the actual $state policy review state", ({ state, label }) => {
    const markup = reviewBlock(card({ status: hindsightStatus({ review: [policyReview({ state })] }) }));
    expect(markup).toContain(`>${label}</dd>`);
    expect(markup).toContain("待巡检数量"); expect(markup).toContain("已保存待发布");
  });

  it.each([undefined, null, [], [policyReview({ bankId: "different-bank" })]])("keeps absent Bank review evidence unknown: %j", (review) => {
    const markup = reviewBlock(card({ status: hindsightStatus({ review }) }));
    expect(markup).toContain("未知");
    expect(markup).not.toContain(">空闲</dd>");
    expect(markup.split("策略巡检")[0]).not.toContain(">0</dd>");
  });

  it("preserves measured zeros and distinguishes saved awaiting publication from completion", () => {
    const saved = reviewBlock(card({ status: hindsightStatus({ review: [policyReview({ eligibleRemaining: 0, savedAwaitingPublication: 2 })] }) }));
    expect(saved).toMatch(/待巡检数量<\/dt><dd[^>]*>0<\/dd>/);
    expect(saved).toMatch(/已保存待发布<\/dt><dd[^>]*>2<\/dd>/);
    expect(saved).toMatch(/上次巡检完成<\/dt><dd[^>]*>未知<\/dd>/);
    const zero = reviewBlock(card({ status: hindsightStatus({ review: [policyReview({ state: "running", eligibleRemaining: null, savedAwaitingPublication: 0 })] }) }));
    expect(zero).toMatch(/待巡检数量<\/dt><dd[^>]*>未知<\/dd>/);
    expect(zero).toMatch(/已保存待发布<\/dt><dd[^>]*>0<\/dd>/);
  });

  it("keeps the historical catch-up record after completion and never calls later work current catch-up", () => {
    const completed = policyReview({ state: null, dueSince: null, eligibleRemaining: 0, savedAwaitingPublication: 0, lastCompletedAt: AT });
    const fresh = reviewBlock(card({ status: hindsightStatus({ review: [completed] }) }));
    expect(fresh).toContain(">空闲</dd>"); expect(fresh).toContain(AT);
    expect(fresh).toContain('data-catch-up-occurrence="policy-review:catch-up-1"');
    expect(fresh).toContain("当前进度以上方巡检状态为准");
    const later = reviewBlock(card({ status: hindsightStatus({ review: [{ ...completed, state: "pending", eligibleRemaining: 1 }] }) }));
    expect(later).toContain(">待处理</dd>"); expect(later).not.toContain("正在补跑");
  });

  it("renders durable review during runtime loss without replica controls or fabricated counts", () => {
    const status = degradedStatus(); status.review = [policyReview({ state: "paused", eligibleRemaining: null, savedAwaitingPublication: 1 })];
    const markup = card({ status });
    expect(markup).toContain("策略巡检"); expect(markup).toContain(">已暂停</dd>");
    expect(markup).not.toContain("立即同步"); expect(markup).not.toContain("保存同步设置");
    expect(markup).toMatch(/待巡检数量<\/dt><dd[^>]*>未知<\/dd>/);
  });

  it.each([
    { overrides: { loading: true }, label: "正在刷新" },
    { overrides: { error: "read rejected" }, label: "读取失败" },
    { overrides: { connectionReady: false }, label: "连接已断开" },
  ])("identifies retained review frames during $label", ({ overrides, label }) => {
    const markup = card({ status: hindsightStatus({ review: [policyReview()] }), ...overrides });
    expect(markup).toContain(`${label}；以下为上次读取的状态（${AT}）`);
    expect(markup).toContain("策略巡检");
  });

  it("renders persisted mode, interval units and bounds in each Bank's sync form", () => {
    const markup = card({ status: hindsightStatus() });
    for (const text of ["后台同步模式", "已保存：自动", "增量同步间隔", "完整对账间隔", "1 分钟至 31 天", "1 分钟至 90 天", "保存同步设置", "仅手动关闭后台同步"]) expect(markup).toContain(text);
    expect(markup).toContain('value="6"'); expect(markup).toContain('value="7"');
    expect(markup).toContain('value="hours" selected=""'); expect(markup).toContain('value="days" selected=""');
  });
  it.each([{ name: "refresh", overrides: { loading: true } }, { name: "read failure", overrides: { error: "refresh failed" } }])("keeps last-good settings visible but locks stale saves during $name", ({ overrides }) => {
    const markup = card({ status: hindsightStatus(), ...overrides });
    expect(markup).toContain("已保存：自动");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>保存同步设置(?:<span[^>]*><\/span>)?<\/button>/);
  });
  it("renders no Hindsight lifecycle block outside Hindsight authority", () => {
    expect(card({ status: localStatus() })).not.toContain("Hindsight 连接与 Bank");
  });

  it("renders connection, readiness rows and the Core-listed lifecycle actions while the runtime is degraded", () => {
    const markup = card({ status: degradedStatus() });
    expect(markup).toContain("运行时不可用：连接配置已变更，需要重新校验");
    expect(markup).toContain("Hindsight 连接与 Bank");
    // The backup block (Core admits or refuses the capture) follows the lifecycle block.
    expect(buttons(markup)).toEqual(["重新校验连接", "创建备份"]);
    const [primary, diagnostics] = markup.split("技术诊断");
    expect(primary).not.toContain("HINDSIGHT_TEMPLATE_INVALID");
    expect(diagnostics).toContain("character-nana · HINDSIGHT_TEMPLATE_INVALID");
    const provisioning = card({ status: hindsightStatus({ hindsight: provisioningSection() }) });
    for (const label of ["可用", "同步中", "创建中", "失败", "未创建"]) expect(lifecycleBlock(provisioning)).toContain(`>${label}<`);
    expect(buttons(lifecycleBlock(provisioning))).toEqual([]);
    expect(card({ status: degradedStatus(disabledSection(), "connection_disabled") })).toContain("Hindsight 连接已关闭");
  });

  it("locks the lifecycle actions while a submission is pending or the connection is down", () => {
    expect(buttons(lifecycleBlock(card({ status: unreviewed })))).toEqual(LIFECYCLE_BUTTONS);
    const busy = lifecycleBlock(card({ status: unreviewed, busyKey: "provision:nana" }));
    expect(busy.match(/disabled=""/g)).toHaveLength(LIFECYCLE_BUTTONS.length);
    expect([...busy.matchAll(/<button[^>]*aria-busy="true"[^>]*>([^<]*)</g)].map((match) => match[1])).toEqual(["创建 Bank（nana）"]);
    const offline = lifecycleBlock(card({ status: unreviewed, connectionReady: false }));
    expect(offline.match(/disabled=""/g)).toHaveLength(LIFECYCLE_BUTTONS.length);
    expect(lifecycleBlock(card({ status: unreviewed }))).not.toContain("disabled=");
  });

  it("renders the skeleton before the first read and the retry line after a failed one", () => {
    expect(card({ loading: true })).toContain("animate-pulse");
    expect(card({ connectionReady: false, loading: true })).not.toContain("animate-pulse");
    const failed = card({ error: "deadline" });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("deadline");
    expect(failed).toContain("重试");
  });

  it("renders Local mode without Bank controls", () => {
    const markup = card({ status: localStatus() });
    expect(markup).toContain("Local（canonical）");
    expect(markup).not.toContain("立即同步");
    expect(markup).toContain("无进行中的操作。");
  });

  it("renders an unavailable Hindsight runtime with its closed reason and no Bank controls", () => {
    const markup = card({ status: hindsightStatus({
      runtime: { providerId: "hindsight", available: false, unavailableReason: "not_installed" }, replica: null, pending: null,
    }) });
    expect(markup).toContain("运行时不可用：运行时未安装");
    expect(markup).not.toContain("立即同步");
    expect(markup).not.toContain("尚无 Bank。");
  });

  it("renders Hindsight Banks with sync controls, Pending counts and Retry only for explicit_retry_required", () => {
    const failed = bankStatus("character", { mode: "failed", automatic: false, errorCode: "HINDSIGHT_UNREACHABLE", nextAction: "explicit_retry_required", retryKind: "full" });
    const markup = card({ status: hindsightStatus({ replica: [bankStatus("global"), failed] }) });
    expect(markup).toContain("Global");
    expect(markup).toContain("Character · taki");
    expect(markup).toContain("1 待写 / 0 失败 / 1 未知 / 2 父写");
    expect(markup).toContain("未知");
    expect(markup.match(/立即同步/g)).toHaveLength(2);
    expect(buttons(markup).filter((label) => label === "完整对账")).toHaveLength(2);
    expect(markup.match(/重试（full）/g)).toHaveLength(1);
    expect(markup).toContain("HINDSIGHT_UNREACHABLE");
  });

  it("offers Cancel for an admitted replica.sync only and locks controls while a mutation is in flight", () => {
    const active = [operation(), operation({ operationId: "33333333-3333-4333-8333-333333333333", state: "running" })];
    const markup = card({ status: hindsightStatus({ operations: { active, recent: [] } }) });
    expect(markup.match(/>取消</g)).toHaveLength(1);
    expect(markup).toContain("已受理（未认领）");
    expect(markup).toContain("执行中");
    const busy = card({ status: hindsightStatus({ operations: { active, recent: [] } }), busyKey: "sync:global" });
    expect(busy.match(/disabled=""/g)).toHaveLength(10);
    expect(busy.match(/<button[^>]*aria-busy="true"/g)).toHaveLength(2);
  });

  it("shows the last mutation feedback line", () => {
    const markup = card({ status: localStatus(), feedback: { tone: "warn", message: "Core 拒绝了该操作：MEMORY_OPERATION_BUSY" } });
    expect(markup).toContain("Core 拒绝了该操作：MEMORY_OPERATION_BUSY");
  });
});

it("keeps internal epoch, Bank and operation identities out of every rendered attribute and label", () => {
  const privateBank = "private-bank-identity";
  const active = operation({ request: { kind: "replica.sync", bankId: privateBank, syncKind: "incremental" } });
  const markup = card({ status: hindsightStatus({ replica: [bankStatus(privateBank)], operations: { active: [active], recent: [] } }) });
  expect(markup).not.toContain(privateBank);
  expect(markup).not.toContain(active.operationId);
  expect(markup).not.toContain("epoch-2");
});

it("ends first-load skeleton on a failed Memory read", () => {
  expect(card({ loading: false, error: "failed" })).not.toContain("animate-pulse");
});
