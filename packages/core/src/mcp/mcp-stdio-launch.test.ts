import { describe, expect, it } from "vitest";
import { resolveStdioLaunch } from "./mcp-stdio-launch.ts";

describe("resolveStdioLaunch", () => {
  it("keeps the portable launch tuple unchanged on Unix", () => {
    expect(resolveStdioLaunch({ command: "npx", args: ["-y", "demo"] }, { platform: "linux" })).toEqual({ command: "npx", args: ["-y", "demo"] });
  });

  it("routes the same portable command through the Windows relay", () => {
    expect(resolveStdioLaunch({ command: "npx", args: ["-y", "demo"] }, {
      platform: "win32", nodeExecutable: "node.exe", relayPath: "relay.mjs",
    })).toEqual({
      command: "node.exe",
      args: ["relay.mjs", "npx", "-y", "demo"],
    });
  });

  it("keeps a native Windows executable direct", () => {
    expect(resolveStdioLaunch({ command: "node.exe", args: ["server.mjs"] }, { platform: "win32", nodeExecutable: "node.exe", relayPath: "relay.mjs" })).toEqual({ command: "node.exe", args: ["server.mjs"] });
  });

  it("preserves empty and metacharacter arguments as discrete relay argv", () => {
    expect(resolveStdioLaunch({ command: "tool.cmd", args: ["", "%PATH%", "a&b"] }, {
      platform: "win32", nodeExecutable: "node.exe", relayPath: "relay.mjs",
    }).args).toEqual(["relay.mjs", "tool.cmd", "", "%PATH%", "a&b"]);
  });
});
