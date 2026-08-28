import { describe, expect, it } from "vitest";
import { observabilityLabel, observabilityLabels } from "./observability-presentation.ts";

describe("observability presentation", () => {
  it("centralizes Chinese labels for visible status, phase, surface, and context values", () => {
    expect(observabilityLabel("running")).toBe("运行中");
    expect(observabilityLabel("model")).toBe("模型请求");
    expect(observabilityLabel("intent_committed")).toBe("意图已提交");
    expect(observabilityLabel("log-only")).toBe("仅记录");
    expect(observabilityLabel("taki-provider.chat")).toBe("OpenAI 兼容接口");
    expect(observabilityLabels(["character", "memory", "extensions"]))
      .toEqual(["角色", "记忆", "扩展"]);
  });

  it("leaves unknown future identifiers stable instead of inventing a translation", () => {
    expect(observabilityLabel("future-wire-value")).toBe("future-wire-value");
  });
});
