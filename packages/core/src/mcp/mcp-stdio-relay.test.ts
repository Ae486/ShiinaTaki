import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RELAY = fileURLToPath(new URL("./mcp-stdio-relay.mjs", import.meta.url));

describe("mcp-stdio-relay", () => {
  it("preserves command arguments containing shell metacharacters", async () => {
    const value = "%PATH% & | < >";
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [RELAY, process.execPath, "-e", "process.stdout.write(process.argv[1])", value], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `relay exited ${code}`)));
    });
    expect(output).toBe(value);
  });
});
