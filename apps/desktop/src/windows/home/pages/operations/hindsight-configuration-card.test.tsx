import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { HindsightConfigurationStatus } from "@taki/shared";
import { configurationObservationFixture } from "../../../../../../../packages/core/src/testing/hindsight-configuration-fixture.ts";
import { HindsightConfigurationCard } from "./hindsight-configuration-card.tsx";
import type { ConfigurationViewState } from "./hindsight-configuration-controller.ts";

const params = { scope: { kind: "global" as const } };
const owned: ReturnType<typeof configurationObservationFixture>[] = [];
afterEach(() => { for (const f of owned.splice(0)) f.service.dispose(); });
function fixture() { const f = configurationObservationFixture(); owned.push(f); return f; }
function render(state: ConfigurationViewState, connectionReady = true) {
  return renderToStaticMarkup(<HindsightConfigurationCard scope={params.scope} select={() => undefined} characters={["taki"]}
    rosterFailed={false} retryRoster={() => undefined} view={{ state, connectionReady, observe: async () => undefined, refresh: async () => undefined }} />);
}
const ready = (data: HindsightConfigurationStatus) => render({ kind: "ready", data });

describe("configuration card presentation over actual Core results", () => {
  it("renders not-observed, observed aliases and partial coverage without runtime internals", async () => {
    const f = fixture(); expect(ready(f.service.status(params))).toContain("尚未观测");
    const result = await f.service.observe(params); const html = ready(result);
    for (const text of ["Taki 期望设置", "API 已观测配置", "不一致", "mock · model", "已禁用", "其他 API 副本", "后台 Worker", "配置别名"]) expect(html).toContain(text);
    expect(html).not.toContain(result.observation!.runtimeSessionId);
    expect(html).not.toContain(result.observation!.nonce);
    expect(html).not.toContain(result.observation!.source.compatibilityBuild);
  });

  it("renders denied, unsupported and unavailable without disabling other feature promises", async () => {
    const f = fixture(); f.state.mode = "deny";
    expect(ready(await f.service.observe(params))).toContain("未获配置披露授权");
    delete f.manifest.contracts.configuration_observation;
    expect(ready(await f.service.observe(params))).toContain("此实例不支持配置观测；其他记忆功能仍可使用");
    f.state.available = false;
    expect(ready(f.service.status(params))).toContain("Hindsight 连接或所选 Bank 不可用");
  });

  it("renders stale and wrong identity with no previous match", async () => {
    const f = fixture(); await f.service.observe(params); f.state.time = 60_000;
    const stale = ready(f.service.status(params)); expect(stale).toContain("观测已过期"); expect(stale).not.toContain(">一致<");
    f.state.rewrite = (value) => ({ ...value, target: { ...value.target, bankId: "wrong-bank" } });
    const wrong = ready(await f.service.observe(params)); expect(wrong).toContain("Bank 身份不一致"); expect(wrong).not.toContain(">一致<");
  });

  it("keeps routed/custom profiles unknown and unpinned observations separate from activation", async () => {
    const f = fixture(); f.current.providerLineage = null; f.current.bankGeneration = null;
    f.state.rewrite = (value) => ({ ...value, profiles: { ...value.profiles,
      retain: { kind: "unknown", reason: "routed_profile" }, reflect: { kind: "unknown", reason: "unsupported_provider" } } });
    const html = ready(await f.service.observe(params));
    expect(html).toContain("未知（路由 / 多模型）"); expect(html).toContain("未知（不支持的实现）");
    expect(html).toContain("Bank 身份尚未固定；此观测不能用于启用或切换");
  });

  it("shows real loading/failure affordances and disables reads offline", () => {
    expect(render({ kind: "loading", data: null })).toContain("正在读取 Core 状态");
    expect(render({ kind: "observing", data: null })).toContain("正在读取 API 配置");
    expect(render({ kind: "failed", data: null })).toContain("读取配置状态失败，旧观测已隐藏");
    const html = render({ kind: "idle", data: null }, false);
    expect(html).toContain("等待 Core 连接"); expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
  });
});
