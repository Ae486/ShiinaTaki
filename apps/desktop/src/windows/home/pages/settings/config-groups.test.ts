import { describe, expect, it } from "vitest";
import type { ConfigEntry } from "@taki/shared";
import {
  CONFIG_GROUPS,
  configGroupOf,
  configLabelOf,
  configHintOf,
  filterConfigEntries,
  groupConfigEntries,
} from "./config-groups.ts";

function entry(key: string, description = "descriptor"): ConfigEntry {
  return { key, value: null, stored: false, envLocked: false, default: null, apply: "restart", secret: false, secretSet: false, input: { kind: "string" }, description };
}

const KEYS = [
  "TAKI_PROVIDER_MODEL",
  "TAKI_AMBIENT_SCREENSHOT",
  "TAKI_WS_PORT",
  "TAKI_MEMORY_PINNED_BUDGET",
  "TAKI_DATA_DIR",
  "TAKI_TRUST_LOOPBACK_OPERATOR",
] as const;

describe("config groups", () => {
  it("exposes both check-in knobs with Chinese labels and next-interval application semantics", () => {
    for (const key of ["TAKI_SUBAGENT_CHECKIN_STEPS", "TAKI_SUBAGENT_CHECKIN_PARENT_APPROVALS"]) {
      expect(configGroupOf(key).id).toBe("model-context"); expect(configLabelOf(key)).toContain("子代理");
      expect(configHintOf(key)).toContain("下一个进度检查间隔");
      expect(filterConfigEntries([entry(key)], "子代理")).toHaveLength(1);
    }
    expect(configHintOf("TAKI_MAX_STEPS")).toBeNull();
  });
  it("resolves exact keys to their group and Chinese label", () => {
    expect(configLabelOf("TAKI_PROVIDER_MODEL")).toBe("主模型 ID");
    expect(configGroupOf("TAKI_PROVIDER_MODEL").id).toBe("model-context");
    expect(configGroupOf("TAKI_AMBIENT_SCREENSHOT").id).toBe("perception-privacy");
    expect(configGroupOf("TAKI_DATA_DIR").id).toBe("storage-cache");
    expect(configGroupOf("TAKI_TRUST_LOOPBACK_OPERATOR").id).toBe("permissions");
  });

  it("falls back to the 高级 group for unknown keys and prefix families, with the raw key as label", () => {
    expect(configGroupOf("TAKI_NOT_A_REAL_KNOB").id).toBe("advanced");
    expect(configLabelOf("TAKI_NOT_A_REAL_KNOB")).toBeNull();
    expect(configGroupOf("TAKI_MEMORY_FUTURE_KNOB").id).toBe("advanced");
    expect(configGroupOf("TAKI_HINDSIGHT_FUTURE_KNOB").id).toBe("advanced");
    expect(configLabelOf("TAKI_MEMORY_FUTURE_KNOB")).toBeNull();
  });

  it("groups in fixed order while preserving the server's within-group order", () => {
    const entries = [...KEYS, "TAKI_VLM_MODEL", "TAKI_PROVIDER_MODEL"].map((key) => entry(key));
    const views = groupConfigEntries(entries);
    expect(views.map((view) => view.group.id)).toEqual(["permissions", "model-context", "perception-privacy", "storage-cache", "advanced"]);
    const model = views.find((view) => view.group.id === "model-context")!;
    expect(model.entries.map((row) => row.key)).toEqual(["TAKI_PROVIDER_MODEL", "TAKI_VLM_MODEL", "TAKI_PROVIDER_MODEL"]);
    // every knob survives grouping (nothing removed or hidden)
    expect(views.flatMap((view) => view.entries)).toHaveLength(entries.length);
  });

  it("skips empty groups", () => {
    expect(groupConfigEntries([entry("TAKI_WS_PORT")]).map((view) => view.group.id)).toEqual(["advanced"]);
  });

  it("filters by key, mapped Chinese label and description, case-insensitively", () => {
    const entries = KEYS.map((key) => entry(key, key === "TAKI_WS_PORT" ? "WS listen port." : "descriptor"));
    expect(filterConfigEntries(entries, "").map((row) => row.key)).toHaveLength(KEYS.length);
    expect(filterConfigEntries(entries, "ws_port").map((row) => row.key)).toEqual(["TAKI_WS_PORT"]);
    expect(filterConfigEntries(entries, "listen port").map((row) => row.key)).toEqual(["TAKI_WS_PORT"]);
    expect(filterConfigEntries(entries, "主模型").map((row) => row.key)).toEqual(["TAKI_PROVIDER_MODEL"]);
    expect(filterConfigEntries(entries, "没有这个东西")).toHaveLength(0);
  });

  it("keeps the declared group vocabulary closed with hints", () => {
    expect(CONFIG_GROUPS.map((group) => group.label)).toEqual(["权限与审批", "模型与上下文", "感知与隐私", "存储与缓存", "高级"]);
    for (const group of CONFIG_GROUPS) expect(group.hint.length).toBeGreaterThan(0);
  });
});
