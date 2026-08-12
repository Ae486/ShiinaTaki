import { describe, expect, it } from "vitest";
import { connectionStatusNotice, type ConnectionStatus } from "./connection-status.ts";

describe("connectionStatusNotice", () => {
  it("maps every non-connected status through one semantic copy table", () => {
    const cases: Array<[ConnectionStatus, string]> = [
      [{ kind: "connecting" }, "正在连接 Agent Core…"],
      [{ kind: "reconnecting" }, "与 Agent Core 的连接已中断，正在重连…"],
      [{ kind: "pairing-required" }, "需要完成配对后才能连接 Agent Core"],
      [{ kind: "disconnected" }, "与 Agent Core 的连接已断开"],
      [{ kind: "error", code: null, message: "认证响应无效" }, "认证响应无效"],
    ];
    for (const [status, text] of cases) expect(connectionStatusNotice(status)?.text).toBe(text);
  });

  it("renders no notice while connected", () => {
    expect(connectionStatusNotice({ kind: "connected" })).toBeNull();
  });
});
