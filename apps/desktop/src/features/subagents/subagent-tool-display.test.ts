import { describe, expect, it } from "vitest";
import { subagentToolDisplay } from "./subagent-tool-display.ts";
import { summary, work } from "../../../test/s7-subagent-data.ts";

describe("readable delegation results", () => {
  it("shows worker/state and exact navigation without echoing the input or receipts", () => {
    const result = subagentToolDisplay({ conversation: summary(), input: work(), cancellationRequested: false });
    expect(result.details).toContain(summary().label); expect(result.details).toContain("输入已接收");
    expect(result.details).not.toContain(work().direction); expect(result.details).not.toContain("controlVersion");
    expect(result.target).toEqual({ characterId: "taki", subagentId: summary().subagentId, workInputId: work().workInputId });
  });
  it("does not turn a collector proposal into a durable acceptance", () => {
    const result = subagentToolDisplay({ ok: true, proposed: true, accepted: false });
    expect(result.details).toContain("等待本轮结果保存后确认"); expect(result.target).toBeUndefined();
  });
});
