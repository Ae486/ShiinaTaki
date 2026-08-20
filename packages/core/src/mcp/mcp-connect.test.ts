import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultConnect } from "./mcp-connect.ts";

const FIXTURE = fileURLToPath(new URL("../testing/mcp-fixture.mjs", import.meta.url));

describe("defaultConnect stdio compatibility", () => {
  it("launches an MCP child through the portable npx command on Windows and Unix", async () => {
    const client = await defaultConnect({
      key: "npx-fixture",
      config: { command: "npx", args: ["--yes", "-c", `node "${FIXTURE}"`] },
    });
    try {
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name)).toContain("echo");
      const result = await client.callTool({ name: "echo", arguments: { text: "npx works" } });
      expect(result).toMatchObject({ content: [{ text: "echo: npx works" }] });
    } finally {
      await client.close();
    }
  }, 30_000);
});
