/**
 * INPUT:  OpenAI-compatible chat-completion requests from the isolated Core (main + Utility slots)
 * OUTPUT: startFakeProvider({ watch }) -> { port, log, close }; scripted deterministic replies: a leading `[retain]` /
 *         `[recall]` marker in the typed user text (injected context blocks stripped) makes the main model call that memory
 *         tool once, Utility gate/extraction prompts get schema-valid JSON, everything else gets a short text reply; every
 *         request is classified into `log`
 * POS:    09-25-hindsight-backup-restore W6 drill — copied from the archived native-smoke harness; `[retain:<layer>]` picks
 *         the retain layer and tool results are logged whole; the only "model" the drill Core may reach
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
  if (afterTool) return { kind: "main-after-tool", ...base, toolResult: textOf(messages.at(-1).content) };
  const [, marker, layer] = /^\[(retain|recall)(?::([a-z]+))?\]/.exec(typed) ?? [];
  if (marker && tools.includes(marker)) return { kind: `main-${marker}-call`, ...base, layer };
  return { kind: tools.length > 0 || body.stream ? "main-text" : "utility-other", ...base };
}

function seqRange(text) {
  const seqs = [...text.matchAll(/^\[(\d+) /gm)].map((match) => Number(match[1]));
  return seqs.length ? { from: Math.min(...seqs), through: Math.max(...seqs), seqs } : null;
}

function layerFor(body, wanted) {
  const retain = (body.tools ?? []).find((entry) => entry.function?.name === "retain");
  const layers = retain?.function?.parameters?.properties?.layer?.enum ?? [];
  if (wanted && layers.includes(wanted)) return wanted;
  return layers.includes("profile") ? "profile" : layers[0];
}

function reply(body, decision) {
  const payload = decision.typed.replace(/^\[(retain|recall)(?::[a-z]+)?\]/, "").trim().slice(0, 200) || "a smoke fact";
  switch (decision.kind) {
    case "utility-gate": {
      const range = seqRange(decision.lastUser);
      decision.range = range;
      return { text: range ? JSON.stringify({ decision: "keep", route: "both", fromSeq: range.from, throughSeq: range.through }) : '{"decision":"skip"}' };
    }
    case "utility-extract":
      return { text: JSON.stringify([{ layer: "profile", content: `The user said: ${payload}`, importance: 5 }]) };
    case "main-retain-call":
      return { tool: { name: "retain", args: { content: `The user said: ${payload}`, layer: layerFor(body, decision.layer), context: null } } };
    case "main-recall-call":
      return { tool: { name: "recall", args: { query: payload, scope: "both", limit: 5, maxTokens: 512 } } };
    case "main-after-tool":
      return { text: "Noted, thank you." };
    default:
      return { text: decision.kind === "utility-other" ? "[]" : "Hello from the smoke model." };
  }
}

function completion(body, answer, id) {
  const message = answer.tool
    ? { role: "assistant", content: null, tool_calls: [{ id: `call_${id}`, type: "function", function: { name: answer.tool.name, arguments: JSON.stringify(answer.tool.args) } }] }
    : { role: "assistant", content: answer.text };
  return { id: `smoke-${id}`, object: "chat.completion", created: Math.floor(Date.now() / 1000), model: body.model,
    choices: [{ index: 0, message, finish_reason: answer.tool ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 64, completion_tokens: 8, total_tokens: 72 } };
}

function stream(response, body, answer, id) {
  const base = { id: `smoke-${id}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: body.model };
  const send = (choice, extra = {}) => response.write(`data: ${JSON.stringify({ ...base, choices: [choice], ...extra })}\n\n`);
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  if (answer.tool) {
    send({ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `call_${id}`, type: "function",
      function: { name: answer.tool.name, arguments: JSON.stringify(answer.tool.args) } }] }, finish_reason: null });
  } else {
    send({ index: 0, delta: { role: "assistant", content: answer.text }, finish_reason: null });
  }
  send({ index: 0, delta: {}, finish_reason: answer.tool ? "tool_calls" : "stop" },
    { usage: { prompt_tokens: 64, completion_tokens: 8, total_tokens: 72 } });
  response.end("data: [DONE]\n\n");
}

/** `watch`: phrases searched in the full latest user turn and logged as `watched` (the logged text itself is truncated). */
export async function startFakeProvider({ watch = [] } = {}) {
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
        toolResult: decision.toolResult ?? null, answer: answer.tool ? { tool: answer.tool.name } : { text: answer.text.slice(0, 200) },
        systemHead: decision.kind === "utility-other" ? decision.system.slice(0, 160) : undefined });
      if (body.stream === true) stream(response, body, answer, id);
      else response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(completion(body, answer, id)));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { port: server.address().port, log, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
