// A minimal 3-method stdio MCP server fixture (research §4a): initialize / tools/list / tools/call.
// Plain .mjs so it is spawned by node directly (never through the TS pipeline). Notifications are ignored.
// Env TAKI_FIXTURE_DIE=1 makes tools/call exit(1) mid-call to exercise the connection-dropped path.
import { createInterface } from "node:readline";
import process from "node:process";

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.id === undefined) return; // notification (e.g. notifications/initialized)

  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture-server", version: "0.0.1" },
      },
    });
  } else if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echoes text",
            inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
          },
        ],
      },
    });
  } else if (msg.method === "tools/call") {
    if (process.env.TAKI_FIXTURE_DIE === "1") process.exit(1);
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { content: [{ type: "text", text: `echo: ${msg.params.arguments.text}` }] },
    });
  } else {
    send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } });
  }
});
