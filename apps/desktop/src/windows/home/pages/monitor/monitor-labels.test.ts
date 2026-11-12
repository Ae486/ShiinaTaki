import { describe, expect, it } from "vitest";
import {
  ATTEMPT_GROUP_LABEL,
  INITIATOR_OPTIONS,
  RUN_GROUP_LABEL,
  STATE_OPTIONS,
  attemptGroupLabel,
  connectionKindLabel,
  wireLabel,
} from "./monitor-labels.ts";

describe("monitor labels", () => {
  it("maps known wire values to Chinese and keeps unknown system values out of visible copy", () => {
    expect(wireLabel("queued")).toBe("排队中");
    expect(wireLabel("deadline_exceeded")).toBe("超过截止时间");
    expect(wireLabel("tool")).toBe("工具");
    expect(wireLabel("brand-new-wire-value")).toBe("未知");
  });

  it("supplements wire values the shared map does not cover yet", () => {
    expect(wireLabel("mcp")).toBe("MCP 调用");
    expect(wireLabel("host")).toBe("宿主调用");
  });

  it("derives one Chinese filter option per initiator/state enum member", () => {
    expect(INITIATOR_OPTIONS).toHaveLength(6);
    expect(INITIATOR_OPTIONS[0]).toEqual(["primary", "用户发起"]);
    expect(STATE_OPTIONS.map(([value]) => value)).toContain("cancel_requested");
    expect(STATE_OPTIONS.find(([value]) => value === "outcome_unknown")?.[1]).toBe("结果未知");
  });

  it("renders Run/Attempt group headers in Chinese", () => {
    expect(RUN_GROUP_LABEL).toBe("运行");
    expect(ATTEMPT_GROUP_LABEL).toBe("尝试");
    expect(attemptGroupLabel(2)).toBe("尝试 2");
  });

  it("maps connection kinds with a Chinese fallback", () => {
    expect(connectionKindLabel("reconnecting")).toBe("重连中");
    expect(connectionKindLabel("connected")).toBe("已连接");
    expect(connectionKindLabel("future-kind")).toBe("连接状态未知");
  });
});
