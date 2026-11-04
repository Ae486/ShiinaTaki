import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ModelCapabilitiesResult } from "@taki/shared";
import type { ModelCapabilitiesViewState } from "./use-model-capabilities.ts";
import { ModelCapabilitiesSection } from "./model-capabilities-section.tsx";

let state: ModelCapabilitiesViewState = { phase: "idle" };
vi.mock("./use-model-capabilities.ts", () => ({
  useModelCapabilities: () => ({ state, model: "configured-model", connected: true, refresh: vi.fn() }),
}));
const render = () => renderToStaticMarkup(<ModelCapabilitiesSection entries={[]} />);
const metadata = {
  displayName: "DeepSeek V4 Flash", providerName: "DeepSeek", canonicalModelId: "deepseek/deepseek-v4.1-flash-1017",
  logoUrl: "https://models.dev/logos/deepseek.svg", reasoning: true,
  inputModalities: ["text", "image"], outputModalities: ["text"], contextLimit: 1_000_000, outputLimit: 384_000,
};
function ready(catalog: ModelCapabilitiesResult["catalog"]) {
  state = { phase: "ready", data: {
    configured: { model: "configured-model", identity: "a".repeat(64) }, apply: "restart",
    adapter: { kind: "openai-compatible", toolCalling: true, imageInput: true, nativeWebSearch: false }, catalog,
  } };
}

describe("model capability guidance", () => {
  it("labels declarations separately from activation and connection-native search", () => {
    state = { phase: "ready", data: {
      configured: { model: "configured-model", identity: "a".repeat(64) }, apply: "restart",
      adapter: { kind: "openai-compatible", toolCalling: true, imageInput: true, nativeWebSearch: false },
      catalog: { status: "declared", source: "models.dev", provider: "openai", model: "configured-model",
        fetchedAt: "2026-11-02T00:00:00Z", lastUpdated: "2026-03-05", toolCalling: true, imageInput: false },
    } };
    const html = render();
    expect(html).toContain("目录声明支持");
    expect(html).toContain("目录声明不支持");
    expect(html).toContain("models.dev");
    expect(html).toContain("未验证此连接");
    expect(html).toContain("重启后生效");
    expect(html).toContain("当前连接方式不支持");
    expect(html).toContain("应用搜索工具");
    expect(html).toContain('aria-label="主模型信息"');
    expect(html).toContain("配置 ID：");
    expect(html).toContain('aria-label="通用模型图标"');
    expect(html).not.toContain("目录详情");
    expect(html).not.toContain("模型没有联网能力");
    state = { phase: "pending", data: state.data };
    const refreshing = render();
    expect(refreshing).toContain("目录声明支持");
    expect(refreshing).toContain("目录声明不支持");
    expect(refreshing).toContain("正在读取能力声明");
  });

  it("does not turn unknown or unavailable metadata into unsupported capabilities", () => {
    for (const catalog of [{ status: "unknown", reason: "endpoint" }, { status: "unavailable" }] as const) {
      state = { phase: "ready", data: {
        configured: { model: "configured-model", identity: "a".repeat(64) }, apply: "restart",
        adapter: { kind: "openai-compatible", toolCalling: true, imageInput: true, nativeWebSearch: false }, catalog,
      } };
      expect(render()).toContain("未知");
      expect(render()).not.toContain("目录声明不支持");
      expect(render()).toContain("configured-model");
      expect(render()).toContain('aria-label="通用模型图标"');
      expect(render()).not.toContain("<img");
    }
    expect(render()).toContain("模型配置仍可使用");
    expect(render()).toContain("稍后重试");
  });

  it("shows maintained names alongside the original ID and keeps canonical identity/limits in collapsed details", () => {
    ready({ status: "declared", source: "models.dev", provider: "deepseek", model: "configured-model",
      fetchedAt: "2026-11-04T00:00:00Z", lastUpdated: null, toolCalling: true, imageInput: true, metadata });
    const html = render();
    for (const fact of ["DeepSeek V4 Flash", "DeepSeek", "configured-model", "文本、图片", "推理：",
      "deepseek/deepseek-v4.1-flash-1017", "1,000,000 tokens", "384,000 tokens", "不会自动修改 Core 的运行设置"]) {
      expect(html).toContain(fact);
    }
    expect(html).toContain('src="https://models.dev/logos/deepseek.svg"');
    expect(html).toContain('alt="DeepSeek标识"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain("图标代表提供方品牌");
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).not.toContain("价格");
  });

  it("renders missing metadata as unknown facts with generic artwork", () => {
    ready({ status: "declared", source: "models.dev", provider: "deepseek", model: "configured-model",
      fetchedAt: "2026-11-04T00:00:00Z", lastUpdated: null, toolCalling: null, imageInput: null,
      metadata: { displayName: null, providerName: null, canonicalModelId: null, logoUrl: null, reasoning: null,
        inputModalities: null, outputModalities: null, contextLimit: null, outputLimit: null } });
    const html = render();
    expect(html).toContain("configured-model");
    expect(html).toContain("目录未提供");
    expect(html).toContain("未知");
    expect(html).toContain('aria-label="通用模型图标"');
    expect(html).not.toContain("目录声明不支持");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("0 tokens");
  });
});
