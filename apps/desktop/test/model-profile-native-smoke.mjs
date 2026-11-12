/**
 * INPUT: an already-running isolated production Desktop/Core and its explicit CDP endpoint.
 * OUTPUT: real WebView interaction evidence against a local deterministic compatible provider.
 * POS: installation-flow QA only; does not launch processes or read a real user profile.
 */
import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";
import { connectCdp, waitFor } from "./c2-native-driver.mjs";

const { fetch } = globalThis;
const debugPort = process.env.MODEL_UI_CDP_PORT;
const artifacts = process.env.MODEL_UI_ARTIFACTS;
const runTag = randomUUID().slice(0, 8);
assert.ok(debugPort && artifacts, "Explicit isolated CDP port and artifact path required");
await mkdir(artifacts, { recursive: true });
const calls = [], checks = [];
const provider = createServer(async (request, response) => {
  let raw = ""; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw);
  calls.push({ model: body.model, stream: Boolean(body.stream), authorization: request.headers.authorization !== undefined });
  const envelope = { id: `fixture-${calls.length}`, created: Math.floor(Date.now() / 1000), model: body.model };
  const content = `本地配置验证 ${runTag}：${body.model}`;
  if (body.stream) {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write(`data: ${JSON.stringify({ ...envelope, object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ ...envelope, object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 8, total_tokens: 58 } })}\n\n`);
    response.end("data: [DONE]\n\n");
  } else {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ...envelope, object: "chat.completion", choices: [{ index: 0,
      message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 8, total_tokens: 58 } }));
  }
});
provider.listen(0, "127.0.0.1"); await once(provider, "listening");
const baseUrl = `http://127.0.0.1:${provider.address().port}/v1`;
const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
const page = pages.find((item) => item.type === "page" && item.url.includes("home"));
assert.ok(page, "Actual Home page is required");
if (process.env.MODEL_UI_EXPECT_ORIGIN) {
  assert.equal(new URL(page.url).origin, process.env.MODEL_UI_EXPECT_ORIGIN);
}
const session = await connectCdp(page);
const pass = (message) => { checks.push(message); console.log(`PASS ${message}`); };
const scope = (slot) => `document.querySelector('section[aria-label="${slot === "main" ? "主模型 Main" : "后台模型 Utility"}"]')`;
const text = () => session.evaluate("document.body.innerText");
const click = async (label, slot) => {
  const root = slot ? scope(slot) : "document";
  const expression = `[...${root}.querySelectorAll('button')].find(button => !button.closest('[hidden]') && button.textContent.trim() === ${JSON.stringify(label)} && !button.disabled)`;
  await waitFor(() => session.evaluate(`Boolean(${expression})`), `enabled ${slot ?? "page"} ${label}`);
  await session.evaluate(`${expression}.click()`);
};
const field = (label, value, slot = "main") => session.evaluate(`(() => {
  const root = ${scope(slot)};
  const label = [...root.querySelectorAll('label')].find(item => item.textContent === ${JSON.stringify(label)});
  const input = label && document.getElementById(label.htmlFor); if (!input) throw Error('Missing field');
  input.focus();
  const prototype = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true}));
})()`);
const value = (label, slot = "main") => session.evaluate(`(() => {
  const label = [...${scope(slot)}.querySelectorAll('label')].find(item => item.textContent === ${JSON.stringify(label)});
  return label && document.getElementById(label.htmlFor).value;
})()`);
const screenshot = async (name) => {
  const image = await session.call("Page.captureScreenshot", { format: "png" });
  await writeFile(join(artifacts, `${name}.png`), Buffer.from(image.data, "base64"));
};

try {
  await click("设置"); await waitFor(() => session.evaluate(`Boolean(${scope("main")})`), "profile cards");
  await screenshot("01-profile-settings");
  await field("使用方式", "configured");
  await field("服务地址", baseUrl); await field("模型 ID", ""); await field("认证方式", "none");
  await click("保存", "main"); await waitFor(async () => (await text()).includes("草稿已保存"), "draft save");
  assert.equal(calls.length, 0); pass("incomplete draft saved without a provider request");
  await session.call("Page.reload");
  await waitFor(async () => (await text()).includes("设置"), "reopened Home");
  await click("设置"); await waitFor(() => session.evaluate(`Boolean(${scope("main")})`), "reopened profile cards");
  assert.equal(await value("服务地址"), baseUrl);
  pass("reopened native Home restores the saved draft without local enrollment");
  await field("模型 ID", "local-main-a"); await click("保存", "main");
  await waitFor(async () => (await text()).includes("当前使用：local-main-a"), "first keyless activation");
  assert.equal(calls.length, 0); pass("complete custom keyless model applies with the ordinary Save action and no test");
  await screenshot("02-keyless-model-active");
  await field("模型 ID", "unsaved-test-model"); await click("测试连接（可能产生费用）", "main");
  await waitFor(() => calls.some((call) => call.model === "unsaved-test-model"), "explicit test request");
  assert.equal(calls.length, 1); assert.equal(calls[0].authorization, false);
  await waitFor(async () => (await text()).includes("本次测试不保存或应用配置"), "test outcome");
  assert.ok((await text()).includes("当前使用：local-main-a")); pass("explicit cost-labelled test uses unsaved input once without activation");
  await field("模型 ID", "local-main-a"); await field("服务地址", "invalid-address"); await click("保存", "main");
  await waitFor(async () => (await text()).includes("应用失败"), "invalid candidate");
  assert.ok((await text()).includes("当前使用：local-main-a")); pass("invalid candidate preserves the active profile and shows failure");
  await screenshot("03-failed-candidate-retained-active");
  await field("服务地址", baseUrl); await click("保存", "main");
  await waitFor(async () => !(await text()).includes("应用失败"), "candidate repaired");
  await field("使用方式", "configured", "utility"); await field("服务地址", baseUrl, "utility");
  await field("模型 ID", "local-utility", "utility"); await field("认证方式", "none", "utility"); await click("保存", "utility");
  await waitFor(async () => (await text()).includes("当前使用：local-utility"), "independent Utility");
  await field("使用方式", "disabled", "utility"); await click("保存", "utility");
  await waitFor(() => session.evaluate(`${scope("utility")}.innerText.includes('已停用')`), "Utility disabled");
  await field("使用方式", "inherit", "utility"); await click("保存", "utility");
  await waitFor(() => session.evaluate(`${scope("utility")}.innerText.includes('继承主模型')`), "Utility inherited");
  pass("Utility independently configures, disables and deliberately inherits Main");
  await click("聊天");
  const sendMessage = async (message) => {
    await session.evaluate(`(() => { const input = document.querySelector('textarea'); input.focus();
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(message)});
      input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
    await click("发送");
  };
  await sendMessage(`验证首次本地回复 ${runTag}`);
  await waitFor(async () => (await text()).includes(`本地配置验证 ${runTag}：local-main-a`), "first reply", 30000);
  await click("设置"); await field("模型 ID", "local-main-b"); await click("保存", "main");
  await waitFor(async () => (await text()).includes("当前使用：local-main-b"), "next model activation");
  await click("聊天"); await sendMessage(`验证同一对话的新配置 ${runTag}`);
  await waitFor(async () => (await text()).includes(`本地配置验证 ${runTag}：local-main-b`), "next model reply", 30000);
  pass("first reply and next message in the same conversation use live Main changes without restart");
  await screenshot("04-chat-live-model-switch");
  await click("设置"); await field("使用方式", "disabled"); await click("保存", "main");
  await waitFor(() => session.evaluate(`${scope("main")}.innerText.includes('已停用')`), "Main disable");
  await click("聊天"); await waitFor(async () => (await text()).includes("主模型已停用"), "Chat corrective entry");
  assert.ok((await text()).includes(`本地配置验证 ${runTag}：local-main-a`));
  assert.deepEqual(calls.map((call) => call.model), ["unsaved-test-model", "local-main-a", "local-main-b"]);
  assert.ok(calls.every((call) => !call.authorization));
  pass("Main disable preserves history and exposes configuration recovery");
  await screenshot("05-disabled-model-history");
} finally {
  await writeFile(join(artifacts, "model-ui-native-results.json"), JSON.stringify({ checks, calls, baseUrl, runTag, origin: new URL(page.url).origin, paidProviderCalls: 0 }, null, 2));
  session.close(); await new Promise((done) => provider.close(done));
  console.log(`Evidence: ${artifacts}`);
}
