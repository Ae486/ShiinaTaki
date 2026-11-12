// Bounded real-provider verification using synthetic pixels and the production ChatAgent.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { realProviderEnv } from "../../../../e2e/src/fixture/paths.ts";
import { createCompanionFixture } from "../../../../packages/core/src/testing/companion-fixture.ts";
import { createConversationStore } from "../../../../packages/core/src/agents/conversation-store.ts";
import { createChatAgent } from "../../../../packages/core/src/agents/chat-agent.ts";
import { createTimelineRepo } from "../../../../packages/core/src/db/timeline-repo.ts";
import { createAttachmentStore } from "../../../../packages/core/src/media/attachment-store.ts";
import { createScreenshotStore } from "../../../../packages/core/src/capabilities/screenshot-store.ts";
import { nativeScreenshotResult } from "../../../../packages/core/src/capabilities/native-screenshot-result.ts";

if (!process.argv.includes("--allow-paid")) throw new Error("Explicit --allow-paid is required.");
const root = resolve(import.meta.dirname, "../../../..");
const require = createRequire(join(root, "packages/core/package.json"));
const { createOpenAICompatible } = await import(pathToFileURL(require.resolve("@ai-sdk/openai-compatible")).href);
const { tool } = await import(pathToFileURL(require.resolve("ai")).href);
const { z } = await import(pathToFileURL(require.resolve("zod")).href);
const env = realProviderEnv();
assert(env, "Configured main provider required");
const output = join(import.meta.dirname, "native-main-evidence");
mkdirSync(output, { recursive: true });
const wire = [];
const usage = [];
const outcomes = [];
let failure = null;
let physicalRequests = 0;
let captures = 0;
const maximumRequests = 4;
const nativeFetch = globalThis.fetch;
const provider = createOpenAICompatible({
  name: "taki-provider", baseURL: env.TAKI_PROVIDER_BASE_URL, apiKey: env.TAKI_PROVIDER_API_KEY, includeUsage: true,
  fetch: async (url, init) => {
    assert(++physicalRequests <= maximumRequests, "Physical request bound exceeded");
    const body = JSON.parse(String(init.body));
    body.max_tokens = 1024;
    const messages = body.messages ?? [];
    const imageParts = messages.flatMap((message) => Array.isArray(message.content)
      ? message.content.filter((part) => part.type === "image_url") : []);
    const text = messages.flatMap((message) => typeof message.content === "string" ? [message.content]
      : (message.content ?? []).flatMap((part) => part.type === "text" ? [part.text] : [])).join("\n");
    assert(!text.includes(image.dataBase64), "Pixels must not be encoded as ordinary text");
    wire.push({ request: physicalRequests, model: body.model, nativeImages: imageParts.length,
      toolResults: messages.filter((message) => message.role === "tool").length });
    return nativeFetch(url, { ...init, body: JSON.stringify(body), signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(120_000)]) });
  },
});
const model = provider.languageModel(env.TAKI_PROVIDER_MODEL);
const png = syntheticPng();
writeFileSync(join(output, "synthetic.png"), png);
const image = { mediaType: "image/png", dataBase64: png.toString("base64") };
const fixtures = [];
function fixture(extraTools = {}) {
  const f = createCompanionFixture(); fixtures.push(f);
  const attachments = createAttachmentStore({ attachmentsDir: join(f.root, "attachments"), ttlMs: () => 60_000 });
  const store = createConversationStore({ repo: createTimelineRepo(f.db), attachments, window: { budget: () => 30_000 } });
  const agent = createChatAgent({ model, store, memory: f.memory, attachments, extraTools, maxSteps: 2,
    useProviderUsage: true, onUsage: (sample) => usage.push({ input: sample.inputTokens, output: sample.outputTokens,
      cached: sample.measurement.cacheReadTokens ?? null, estimatedInput: sample.estimatedInput }) });
  return { ...f, store, agent, attachments };
}
async function run(agent, params, scenario) {
  let text = "";
  for await (const chunk of agent.stream({ characterId: "taki", ...params })) text += chunk;
  outcomes.push({ scenario, text });
  assert(/红|red/i.test(text) && /蓝|blue/i.test(text), `${scenario}: visual colors not recognized`);
}
let passed = false;
try {
  const chat = fixture();
  await run(chat.agent, { message: "观察这张测试图片。不要调用工具，只按左、右顺序回答两边各是什么颜色。", attachments: [image] }, "user-image");
  await run(chat.agent, { message: "仍然是刚才的图片。不要调用工具，再按左、右顺序说出两边颜色。" }, "retained-image-followup");
  assert.equal(wire[0].nativeImages, 1);
  assert.equal(wire[1].nativeImages, 1);
  const captured = fixture();
  const stores = { store: createScreenshotStore({ screenshotsDir: join(captured.root, "screenshots") }), attachments: captured.attachments };
  const screenshot = tool({ description: "Return a fixed synthetic test frame, not a live user screen.", inputSchema: z.object({}),
    execute: () => { captures++; return nativeScreenshotResult(stores, { ...image, width: 160, height: 80 }); } });
  const screenshotAgent = createChatAgent({ model, store: captured.store, memory: captured.memory, attachments: captured.attachments,
    extraTools: { capture_test_frame: screenshot }, maxSteps: 2 });
  await run(screenshotAgent, { message: "必须先调用 capture_test_frame 一次获取测试图，然后按左、右顺序回答两边颜色。不要调用其他工具。" }, "tool-image-next-request");
  assert.equal(captures, 1);
  assert.equal(physicalRequests, 4);
  assert.equal(wire[3].nativeImages, 1);
  assert(wire[3].toolResults >= 1);
  assert(wire.every((item) => item.model === env.TAKI_PROVIDER_MODEL));
  passed = true;
} catch (error) {
  failure = { name: error?.name ?? "Error", statusCode: error?.statusCode ?? null, code: error?.code ?? null };
} finally {
  await new Promise((resolveDone) => setTimeout(resolveDone, 0));
  const result = { passed, failure, requestedModel: env.TAKI_PROVIDER_MODEL, physicalRequests, maximumRequests, captures, wire, usage, outcomes };
  writeFileSync(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
  for (const f of fixtures) f.cleanup();
  process.exitCode = passed ? 0 : 1;
}

function syntheticPng() {
  const width = 160; const height = 80;
  const pixels = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * (1 + width * 3) + 1 + x * 3;
    pixels[index + (x < width / 2 ? 0 : 2)] = 255;
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]); const result = Buffer.alloc(body.length + 8);
  result.writeUInt32BE(data.length, 0); body.copy(result, 4);
  let crc = 0xffffffff;
  for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
