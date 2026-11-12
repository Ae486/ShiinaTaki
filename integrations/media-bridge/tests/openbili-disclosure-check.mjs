/** Actual SDK request serialization with discovered MCP schemas and offline provider responses. */
import assert from "node:assert/strict";
import { ToolLoopAgent, jsonSchema, stepCountIs, tool } from "../../../packages/core/node_modules/ai/dist/index.js";
import { createOpenAICompatible } from "../../../packages/core/node_modules/@ai-sdk/openai-compatible/dist/index.js";
import { createToolDisclosure } from "../../../packages/core/src/agents/tool-disclosure.ts";

export async function checkOpenbiliDisclosure(client, definitions) {
  const native = client.toolsFromDefinitions({ tools: definitions });
  const selected = "openbili_peek_recommendations";
  const extensionId = "fixture:openbili-peek";
  const tools = { ...native, extension_describe: tool({
    inputSchema: jsonSchema({ type: "object", properties: { extensionId: { type: "string" } },
      required: ["extensionId"], additionalProperties: false }),
    execute: async () => ({ entry: { identity: { extensionId }, available: true }, toolName: selected }),
  }) };
  const snapshot = { deferredToolNames: Object.keys(native), describedTools: { [extensionId]: selected }, skills: {} };
  const disclosure = createToolDisclosure({ tools, snapshot, bundles: [] });
  const requests = [];
  const provider = createOpenAICompatible({ name: "offline-disclosure", baseURL: "https://fixture.invalid/v1",
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init.body)));
      const operation = requests.length === 1 ? { name: "extension_describe", arguments: JSON.stringify({ extensionId }) }
        : requests.length === 2 ? { name: selected, arguments: '{"limit":1}' } : undefined;
      return new globalThis.Response(JSON.stringify({ id: "fixture", object: "chat.completion", created: 0,
        model: "fixture", choices: [{ index: 0, message: { role: "assistant", content: operation ? null : "Done",
          ...(operation ? { tool_calls: [{ id: `fixture-${requests.length}`, type: "function", function: operation }] } : {}) },
        finish_reason: operation ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
      { headers: { "content-type": "application/json" } });
    },
  });
  const agent = new ToolLoopAgent({ model: provider("fixture"), tools, stopWhen: stepCountIs(4),
    prepareStep: ({ steps }) => ({ activeTools: disclosure.activeTools(steps) }) });
  await agent.generate({ prompt: "Read the existing recommendation list after describing its exact extension." });
  assert.equal(requests.length, 3);
  const names = request => request.tools.map(value => value.function.name).sort();
  assert.deepEqual(names(requests[0]), ["extension_describe"]);
  for (const request of requests.slice(1)) assert.deepEqual(names(request), ["extension_describe", selected]);
  assert.deepEqual(disclosure.activeTools([]), ["extension_describe"]);
  const actualSchema = requests[1].tools.find(value => value.function.name === selected).function.parameters;
  assert.equal(actualSchema.properties.limit.maximum, 20);
  assert.equal(actualSchema.additionalProperties, false);
  return { provider_requests: requests.length, initial_tools: names(requests[0]),
    after_describe_tools: names(requests[1]), real_model_used: false };
}
