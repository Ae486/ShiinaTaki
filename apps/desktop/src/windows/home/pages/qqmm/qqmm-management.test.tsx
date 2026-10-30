import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createManagementController, settingsValues, type ManagementController, type ManagementState, type QqSessionSnapshot, type SettingsConfig, type SummaryRetryEligibility, type SummaryRetryRequest } from "@qqmm/management-client";
import { confirmSettings, QqmmSettings } from "./qqmm-settings.tsx";
import { QqmmControls } from "./qqmm-controls.tsx";
import { QqmmRetry } from "./qqmm-retry.tsx";

const now = Date.UTC(2026, 8, 27, 12);
const config: SettingsConfig = {
  configVersion: 2, account: { targetSelfUin: "10001" },
  connection: { backend: "direct", direct: { authTokenSecretRef: "direct.authToken", signProxyPath: "[redacted]", signProxySha256: "PRIVATE-DIGEST", reconnectInitialDelayMs: 1000, reconnectMaxDelayMs: 30000 },
    pmhq: { artifactPath: "PRIVATE-PATH", artifactSha256: "PRIVATE-ARTIFACT", artifactVersion: "8.1.1", managerTokenSecretRef: "pmhq.managerToken", attachPolicy: { mode: "auto-identify", scanIntervalMs: 1000, candidateStabilizationMs: 1000, identityProbeTimeoutMs: 1000 } } },
  bridge: { provider: "llonebot", protocol: "onebot11", mode: "forward-websocket", url: "ws://localhost:3000", accessTokenEnv: "BRIDGE_TOKEN", connectTimeoutMs: 1000, reconnectIntervalMs: 1000, heartbeatTimeoutMs: 5000, requireSelfMessageReporting: true },
  capture: { groups: { whitelist: ["12345"] }, friends: { mode: "whitelist", whitelist: [] } },
  messages: { retainRecalledContent: true, exposeRecalledContentToAgent: false }, storage: { databasePath: "PRIVATE-DATABASE", retentionDays: 30, cleanupIntervalHours: 1 },
  summary: { enabled: true, groupWhitelist: ["12345"], threshold: 10, maxConcurrentTasks: 2, maxInputTokensPerCall: 10000, maxRetries: 2, retryBaseDelayMs: 1000, requestTimeoutMs: 5000, additionalPrompt: "关注项目进展", dimensions: { private_dimension: { description: "原文 <b>deadbeef v1.2.3</b>" } }, producer: { type: "openai-compatible", baseUrl: "https://provider.example/v1", model: "operator-selected-model", apiKeyEnv: "SUMMARY_API_KEY" } },
  agent: { consumerId: "PRIVATE-CONSUMER" }, logging: { level: "info", includeMessageContent: false },
};
const snapshot = { revision: "PRIVATE-REVISION", config };
const controller = new Proxy({}, { get: () => vi.fn() }) as ManagementController;
const createState = (): ManagementState => {
  const real = createManagementController({ request: async () => { throw new Error("unused"); }, subscribe: () => () => {} });
  const state = real.getState(); real.dispose();
  return { ...state, connection: "connected", settings: snapshot,
    settingsDraft: { status: "dirty", base: snapshot, values: settingsValues(config), dimensions: [{ key: "private_dimension", description: config.summary.dimensions.private_dimension!.description }], preview: null, issues: [], message: null } };
};
const allowed = { supported: true, enabled: true, reason: null } as const;
const session: QqSessionSnapshot = { backend: "direct", generatedAt: now, loginState: "login_required", discovery: null,
  actions: { start: allowed, stop: allowed, logout: allowed }, currentOperation: null, lastOperation: null,
  authAcquisition: { method: "external_url_manual_input", url: "https://auth.luckylillia.com", openMode: "system_browser" }, qr: null };
const renderSettings = (state: ManagementState) => renderToStaticMarkup(<QqmmSettings state={state} controller={controller} />);
const renderControls = (state: ManagementState) => renderToStaticMarkup(<QqmmControls state={state} controller={controller} />);

describe("complete QQ management presentation", () => {
  it("rejects a clicked confirmation after its reviewed preview has changed or retired", () => {
    const state = createState(), applySettings = vi.fn(async () => {});
    const preview = { valid: true as const, revision: "reviewed", normalizedConfig: config, issues: [],
      applyPlan: { mode: "runtime_restart" as const, affectedComponents: ["monitor-runtime"], requiresConfirmation: true },
      retentionImpact: { previousDays: 30, nextDays: 30, cutoffAt: now, expiresEarlier: false, noRevival: true as const } };
    const current = { getState: () => state, applySettings };
    state.settingsDraft.preview = { ...preview };
    confirmSettings(current, preview); expect(applySettings).not.toHaveBeenCalled();
    state.settingsDraft.preview = null;
    confirmSettings(current, preview); expect(applySettings).not.toHaveBeenCalled();
    state.settingsDraft.preview = preview;
    confirmSettings(current, preview); expect(applySettings).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("keeps over-limit dimension text intact for validation instead of clipping a paste", () => {
    const state = createState(), description = "完整保留".repeat(300);
    state.settingsDraft.dimensions = [{ key: "private_dimension", description }];
    const html = renderSettings(state);
    expect(html).toContain(description); expect(html).not.toMatch(/maxlength=/i);
  });

  it("renders one deliberate configuration form and hides transport metadata while preserving literal descriptions", () => {
    const html = renderSettings(createState());
    expect(html.match(/>保留天数</g)).toHaveLength(1);
    for (const label of ["监控 QQ 号", "消息与保留期", "摘要密钥环境变量名", "关注事项 1", "确认保存"]) expect(html).toContain(label);
    expect(html).toContain("原文 &lt;b&gt;deadbeef v1.2.3&lt;/b&gt;");
    for (const internal of ["PRIVATE-", "private_dimension", "[redacted]", "8.1.1", "authTokenSecretRef", "configVersion", "consumerId"]) expect(html).not.toContain(internal);
    expect(html).not.toContain('type="password"');
    expect(html).toContain("SUMMARY_API_KEY");
  });
  it("preserves incomplete numeric text and conflict/unknown feedback without a saveable preview", () => {
    for (const status of ["conflict", "outcome_unknown", "invalid"] as const) {
      const state = createState(); state.settingsDraft = { ...state.settingsDraft, status,
        values: { ...state.settingsDraft.values, "storage.retentionDays": "７天" }, message: "草稿已保留，请重新预览。", issues: [{ path: "summary.dimensions.PRIVATE-KEY", code: "invalid", message: "PRIVATE-ERROR" }] };
      const html = renderSettings(state);
      expect(html).toContain('value="７天"'); expect(html).toContain("草稿已保留");
      expect(html).toMatch(/disabled=""[^>]*>确认保存/); expect(html).toContain("摘要关注事项：请检查");
      expect(html).not.toContain("PRIVATE-");
    }
  });
  it("describes actual apply and deletion impact without rendering internal component identifiers", () => {
    const state = createState(); state.settingsDraft = { ...state.settingsDraft, status: "preview", preview: { valid: true, revision: "PRIVATE-PREVIEW", normalizedConfig: config, issues: [],
      applyPlan: { mode: "runtime_restart", affectedComponents: ["monitor-runtime", "native-process-binding", "maintenance"], requiresConfirmation: true },
      retentionImpact: { previousDays: 30, nextDays: 7, cutoffAt: now, expiresEarlier: true, noRevival: true } } };
    const html = renderSettings(state);
    expect(html).toContain("将重启监控运行环境"); expect(html).toContain("从 30 天改为 7 天"); expect(html).toContain("无法撤销");
    for (const internal of ["runtime_restart", "native-process-binding", "PRIVATE-PREVIEW"]) expect(html).not.toContain(internal);
  });
  it("distinguishes PMHQ discovery and actual identity from an established connection, with only supported actions", () => {
    const state = createState(); state.session = { ...session, backend: "pmhq", loginState: "probing", authAcquisition: null,
      actions: { start: allowed, stop: allowed, logout: { supported: false, enabled: false, reason: "unsupported" } },
      discovery: { candidateCount: 3, eligibleCandidateCount: 2, quarantinedMismatchCount: 1, activeTargetVerified: false, failed: false } };
    state.secrets = { revision: "PRIVATE-SECRET-REVISION", slots: [{ name: "pmhq.managerToken", configured: true, activeStatus: "valid", candidateStatus: "validation_unavailable", nextAttemptAt: now }] };
    const html = renderControls(state);
    expect(html).toContain("恢复发现 QQ"); expect(html).toContain("暂停发现 QQ"); expect(html).toContain("发现 3 个 QQ 进程");
    expect(html).toContain("目标 QQ 尚未确认"); expect(html).toContain("凭据已保存不代表 QQ 已连接");
    expect(html).not.toContain("退出 QQ 登录"); expect(html).not.toContain("获取 Direct 授权"); expect(html).not.toContain("QQ 登录二维码"); expect(html).not.toContain("PRIVATE-");
  });
  it("renders current ephemeral QR but clears it, credentials and actions on disconnected or absent session state", () => {
    const state = createState(); state.session = { ...session, qr: { state: "available", operationId: "PRIVATE-OPERATION", qrCode: "data:image/png;base64,iVBORw0KGgo=", expiresAt: now + 60000 } };
    state.secrets = { revision: "PRIVATE-SECRET", slots: [{ name: "direct.authToken", configured: true, activeStatus: "valid", candidateStatus: "none" }] };
    state.secretDraft = { name: "direct.authToken", value: "TRANSIENT-CREDENTIAL", status: "idle", message: null };
    const html = renderControls(state); expect(html).toContain('alt="QQ 登录二维码"'); expect(html).toContain('type="password"'); expect(html).not.toContain("PRIVATE-");
    for (const retired of [{ ...state, connection: "disconnected" as const }, { ...state, session: null }]) {
      const output = renderControls(retired); expect(output).not.toContain("data:image"); expect(output).not.toContain("TRANSIENT-CREDENTIAL"); expect(output).not.toContain("启动连接");
    }
    state.session = { ...session, qr: null }; expect(renderControls(state)).not.toContain("data:image");
  });
  it("does not reinterpret an earlier operation after the current backend changes", () => {
    const lastOperation = { id: "PRIVATE-OLD-DIRECT-OPERATION", kind: "qq_start" as const, state: "succeeded" as const,
      createdAt: now, updatedAt: now, errorCode: null };
    for (const backend of ["direct", "pmhq"] as const) {
      const state = createState();
      state.session = { ...session, backend, lastOperation, currentOperation: null };
      const html = renderControls(state);
      expect(html).toContain("最近操作 · 启动请求：已完成");
      expect(html).not.toContain("恢复发现 QQ：已完成");
      expect(html).not.toContain(lastOperation.id);
    }
  });
});

function retryState(): ManagementState {
  const state = createState();
  state.detail = { record: { recordId: "PRIVATE-RECORD", sequence: 1, kind: "summary", severity: "error", occurredAt: now, expiresAt: now + 60000,
    conversationRef: "PRIVATE-CONVERSATION", conversationType: "group", conversationId: "12345", conversationName: "项目讨论", senderUin: null, senderName: null,
    direction: null, sourceTimestamp: null, preview: "摘要失败", snapshotStatus: "captured", summary: { status: "failed", sourceCount: 10, sourceFrom: now - 1000, sourceTo: now, containsRecalled: false, failureCount: 2, failureReason: null, context: "initial", timeBasis: "stage_time" } },
    text: "摘要失败", offset: 0, totalCharacters: 4, retention: { retentionDays: 30, cutoff: 0, now, generation: 1, datasetId: "PRIVATE-DATASET", nextExpiryAt: now + 60000 } };
  return state;
}
describe("provider-checked summary retry presentation", () => {
  const renderRetry = (state: ManagementState) => renderToStaticMarkup(<QqmmRetry state={state} controller={controller} />);
  const eligibility: SummaryRetryEligibility = { recordId: "PRIVATE-RECORD", datasetId: "PRIVATE-DATASET", summaryRef: "PRIVATE-SUMMARY", expectedGeneration: 99, eligible: false, reason: "input_unavailable", waitingReason: null, activeRequest: null };
  it("does not infer eligibility from an immutable failed row and explains unavailable original input", () => {
    const state = retryState(); expect(renderRetry(state)).not.toContain("重新生成这份摘要");
    state.retry = { ...state.retry, eligibility }; expect(renderRetry(state)).toContain("原始执行内容不可用"); expect(renderRetry(state)).not.toContain("重新生成这份摘要");
    state.retry = { ...state.retry, eligibility: { ...eligibility, eligible: true, reason: null, waitingReason: "summary_disabled" } };
    const html = renderRetry(state); expect(html).toContain("等待启用摘要"); expect(html).toContain("重新生成这份摘要"); expect(html).not.toContain("PRIVATE-");
  });
  it("shows actual durable attempt budget and source range without request/generation metadata", () => {
    const state = retryState();
    const request: SummaryRetryRequest = { requestId: "PRIVATE-REQUEST", datasetId: "PRIVATE-DATASET", summaryRef: "PRIVATE-SUMMARY", status: "backoff", createdAt: now, updatedAt: now,
      expiresAt: now + 60000, attemptsUsed: 2, attemptsLimit: 3, nextAttemptAt: now + 1000, reason: "automatic_retry", target: { conversationType: "group", conversationId: "12345", sourceFrom: now - 86400000, sourceTo: now, sourceCount: 10 }, resultRecordId: "PRIVATE-RESULT" };
    state.retry = { ...state.retry, request, status: "observing" };
    const html = renderRetry(state); expect(html).toContain("已尝试 2 / 3 次"); expect(html).toContain("原始消息 10 条"); expect(html).toContain("原始范围"); expect(html).not.toContain("PRIVATE-");
    state.detail = null; expect(renderRetry(state)).toBe("");
  });
});
