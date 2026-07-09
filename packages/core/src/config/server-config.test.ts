import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_WS_HOST, DEFAULT_WS_PORT } from "@taki/shared";
import { loadServerConfig } from "./server-config.ts";

describe("loadServerConfig", () => {
  it("applies defaults when optional vars are absent", () => {
    const config = loadServerConfig({});
    expect(config).toMatchObject({ host: DEFAULT_WS_HOST, port: DEFAULT_WS_PORT, logLevel: "info" });
    expect(config.dataDir).toBe(join(homedir(), ".takiagent"));
  });

  it("reads provided values and coerces the port", () => {
    expect(
      loadServerConfig({
        TAKI_WS_HOST: "127.0.0.1",
        TAKI_WS_PORT: "9000",
        TAKI_LOG_LEVEL: "debug",
        TAKI_DATA_DIR: "/tmp/taki",
      }),
    ).toEqual({ host: "127.0.0.1", port: 9000, logLevel: "debug", dataDir: "/tmp/taki" });
  });

  it("reads TAKI_DATA_DIR when provided", () => {
    expect(loadServerConfig({ TAKI_DATA_DIR: "/custom/root" }).dataDir).toBe("/custom/root");
  });

  it("rejects a non-numeric port", () => {
    expect(() => loadServerConfig({ TAKI_WS_PORT: "abc" })).toThrow();
  });

  it("rejects an out-of-range port", () => {
    expect(() => loadServerConfig({ TAKI_WS_PORT: "70000" })).toThrow();
  });

  it("rejects an unknown log level", () => {
    expect(() => loadServerConfig({ TAKI_LOG_LEVEL: "verbose" })).toThrow();
  });

  it("rejects wildcard hosts (no auth exists yet)", () => {
    expect(() => loadServerConfig({ TAKI_WS_HOST: "0.0.0.0" })).toThrow(/wildcard/);
    expect(() => loadServerConfig({ TAKI_WS_HOST: "::" })).toThrow(/wildcard/);
  });
});
