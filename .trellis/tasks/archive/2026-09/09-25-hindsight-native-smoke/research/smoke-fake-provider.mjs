/**
 * INPUT:  OpenAI-compatible chat-completion requests from the isolated Core (main + Utility slots)
 * OUTPUT: startFakeProvider({ watch }) -> { port, log, close }; scripted deterministic replies: a leading `[retain]` /
 *         `[recall]` marker in the typed user text (injected context blocks stripped) makes the main model call that memory
 *         tool once, Utility gate/extraction prompts get schema-valid JSON, policy reviews assess supplied work and finish
 *         in one tool-call response, everything else gets a short text reply; every
 *         request is classified into `log`
 * POS:    09-25-hindsight-native-smoke harness — the only "model" the smoke Core may reach; never a real provider
 */
import { once } from "node:events";
import { createServer } from "node:http";

const GATE_MARK = "Judge the eligibility and ownership of a committed primary conversation span";
const EXTRACT_MARK = "Extract concrete Local memory facts";

function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text ?? "").join("");
  return "";
}

// Core wraps injected context (<turn-context>, <untrusted-observation>, ...) around the typed text; a marker echoed
// from recalled memory or the timeline must not re-trigger a tool call.
function typedText(text) {
  return text.replace(/<([a-z-]+)[^>]*>[\s\S]*?<\/\1>/g, "").trim();
}

function classify(body) {
  const messages = body.messages ?? [];
  const system = messages.filter((message) => message.role === "system").map((message) => textOf(message.content)).join("\n");
  const users = messages.filter((message) => message.role === "user");
  const lastUser = textOf(users.at(-1)?.content);
  const typed = typedText(lastUser);
  const tools = (body.tools ?? []).map((entry) => entry.function?.name).filter(Boolean);
  const afterTool = messages.at(-1)?.role === "tool";
  const base = { lastUser, typed, tools, system };
  if (system.includes(GATE_MARK)) return { kind: "utility-gate", ...base };
  if (system.includes(EXTRACT_MARK)) return { kind: "utility-extract", ...base };
  if (tools.includes("policy_review_finish")) return { kind: "utility-policy-review", ...base };
  if (afterTool) return { kind: "main-after-tool", ...base, toolResult: textOf(messages.at(-1).content) };
  const marker = /^\[(retain|recall)\]/.exec(typed)?.[1];
  if (marker && tools.includes(marker)) return { kind: `main-${marker}-call`, ...base };
  return { kind: tools.length > 0 || body.stream ? "main-text" : "utility-other", ...base };
}

function seqRange(text) {
  const seqs = [...text.matchAll(/^\[(\d+) /gm)].map((match) => Number(match[1]));
  return seqs.length ? { from: Math.min(...seqs), through: Math.max(...seqs), seqs } : null;
}

function layerFor(body) {
  const retain = (body.tools ?? []).find((entry) => entry.function?.name === "retain");
  const layers = retain?.function?.parameters?.properties?.layer?.enum ?? [];
  return layers.includes("profile") ? "profile" : layers[0];
}

function reply(body, decision) {
  const payload = decision.typed.replace(/^\[(retain|recall)\]/, "").trim().slice(0, 200) || "a smoke fact";
  switch (decision.kind) {
    case "utility-policy-review":
      return policyReview(decision.lastUser);
    case "utility-gate": {
      const range = seqRange(decision.lastUser);
      decision.range = range;
      return { text: range ? JSON.stringify({ decision: "keep", route: "both", fromSeq: range.from, throughSeq: range.through }) : '{"decision":"skip"}' };
    }
    case "utility-extract":
      return { text: JSON.stringify([{ layer: "profile", content: `The user said: ${payload}`, importance: 5 }]) };
    case "main-retain-call":
      return { tool: { name: "retain", args: { content: `The user said: ${payload}`, layer: layerFor(body), context: null } } };
    case "main-recall-call":
      return { tool: { name: "recall", args: { query: payload, scope: "both", limit: 5, maxTokens: 512 } } };
    case "main-after-tool":
      return { text: "Noted, thank you." };
    default:
      return { text: decision.kind === "utility-other" ? "[]" : "Hello from the smoke model." };
  }
}

function policyReview(prompt) {
  // The real curator supplies escaped JSON inside this fence; do not infer IDs from recalled text.
  const encoded = /<policy-review-data>\s*([\s\S]*?)\s*<\/policy-review-data>/.exec(prompt)[1];
  const report = JSON.parse(encoded.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"));
  const tools = report.policies.map(({ workId, policy }) => {
    const { layerId, importance, visibility, disclosure, emotionalWeight, retention } = policy;
    // Neutral fixtures get a deterministic scoped classification; existing deliberate policy is preserved.
    const neutral = layerId === "unclassified";
    return { name: "memory_policy_assess", args: { id: workId,
      layerId: neutral ? (report.bank.scope.kind === "global" ? "profile" : "episodes") : layerId,
      importance: neutral ? Math.min(importance, 5) : importance, visibility, disclosure, emotionalWeight, retention } };
  });
  // Finish explicitly preserves untouched Blocks. One response also preserves this request class's call count.
  tools.push({ name: "policy_review_finish", args: {} });
  return { tools };
}

function toolCalls(answer, id) {
  return (answer.tools ?? (answer.tool ? [answer.tool] : [])).map((tool, index) => ({
    id: answer.tools ? `call_${id}_${index}` : `call_${id}`, type: "function",
    function: { name: tool.name, arguments: JSON.stringify(tool.args) },
  }));
}

function completion(body, answer, id) {
  const calls = toolCalls(answer, id);
  const message = calls.length
    ? { role: "assistant", content: null, tool_calls: calls }
    : { role: "assistant", content: answer.text };
  return { id: `smoke-${id}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: body.model,
    choices: [{ index: 0, message, finish_reason: calls.length ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 64, completion_tokens: 8, total_tokens: 72 } };
}

function stream(response, body, answer, id) {
  const calls = toolCalls(answer, id);
  const base = { id: `smoke-${id}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model };
  const send = (choice, extra = {}) => response.write(`data: ${JSON.stringify({ ...base, choices: [choice], ...extra })}\n\n`);
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  if (calls.length) {
    send({ index: 0, delta: { role: "assistant", tool_calls: calls.map((call, index) => ({ index, ...call })) }, finish_reason: null });
  } else {
    send({ index: 0, delta: { role: "assistant", content: answer.text }, finish_reason: null });
  }
  send({ index: 0, delta: {}, finish_reason: calls.length ? "tool_calls" : "stop" },
    { usage: { prompt_tokens: 64, completion_tokens: 8, total_tokens: 72 } });
  response.end("data: [DONE]\n\n");
}

/** `watch`: phrases searched in the full latest user turn and logged as `watched` (the logged text itself is truncated). */
export async function startFakeProvider({ watch = [], toolResultLimit = 600 } = {}) {
  const log = [];
  let sequence = 0;
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const id = ++sequence;
      if (request.method !== "POST" || !request.url.endsWith("/chat/completions")) {
        log.push({ id, at: new Date().toISOString(), kind: "unexpected-path", method: request.method, path: request.url });
        response.writeHead(404).end();
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const decision = classify(body);
      const answer = reply(body, decision);
      log.push({ id, at: new Date().toISOString(), model: body.model, stream: body.stream === true, kind: decision.kind,
        tools: decision.tools, lastUser: decision.lastUser.slice(-240), watched: watch.filter((phrase) => decision.lastUser.includes(phrase)),
        range: decision.range ?? null,
        toolResult: decision.toolResult?.slice(0, toolResultLimit) ?? null,
        answer: answer.tools ? { tools: answer.tools.map((tool) => tool.name) } : answer.tool ? { tool: answer.tool.name } : { text: answer.text.slice(0, 200) },
        systemHead: decision.kind === "utility-other" ? decision.system.slice(0, 160) : undefined });
      if (body.stream === true) stream(response, body, answer, id);
      else response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(completion(body, answer, id)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { port: server.address().port, log, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
