// Research probe for D69: how the INSTALLED ai@7.0.17 streaming loop treats invalid tool calls.
// Runs against packages/core/node_modules (the same install the Core uses). Read-only; no project code imported.
// Usage: node .trellis/tasks/09-19-avatar-command-outcome/research/ai-sdk-invalid-tool-calls-probe.mjs
import { ToolLoopAgent, isStepCount, simulateReadableStream, tool } from "file:///H:/TakiAgent-worktrees/t4/packages/core/node_modules/ai/dist/index.js";
import { MockLanguageModelV4 } from "file:///H:/TakiAgent-worktrees/t4/packages/core/node_modules/ai/dist/test/index.js";
import { z } from "file:///H:/TakiAgent-worktrees/t4/packages/core/node_modules/zod/index.js";

const USAGE = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

// Same shape as packages/core/src/testing/mock-language-model.ts `textTool` / `text` steps.
const textToolStep = (deltas, call) => ({
  stream: simulateReadableStream({ chunks: [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" }, ...deltas.map((delta) => ({ type: "text-delta", id: "t1", delta })), { type: "text-end", id: "t1" },
    { type: "tool-call", toolCallId: call.toolCallId, toolName: call.toolName, input: JSON.stringify(call.input) },
    { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage: USAGE },
  ] }),
});
const toolOnlyStep = (call) => ({
  stream: simulateReadableStream({ chunks: [
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId: call.toolCallId, toolName: call.toolName, input: JSON.stringify(call.input) },
    { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage: USAGE },
  ] }),
});
const textStep = (deltas) => ({
  stream: simulateReadableStream({ chunks: [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t1" }, ...deltas.map((delta) => ({ type: "text-delta", id: "t1", delta })), { type: "text-end", id: "t1" },
    { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: USAGE },
  ] }),
});

// Verbatim copy of packages/core/src/avatar/presentation-stop.ts (kept inline so the probe imports no project code).
const PRESENTATION_TOOL_NAMES = new Set(["avatar_set_expression", "avatar_play_motion"]);
const presentationTailStop = ({ steps }) => {
  const last = steps.at(-1);
  if (!last || last.toolCalls.length === 0) return false;
  const presentationOnly = last.toolCalls.every((call) => PRESENTATION_TOOL_NAMES.has(call.toolName));
  if (!presentationOnly) return false;
  return steps.some((step) => step.text.trim().length > 0);
};

function makeTools({ executeMode = "ok", captureOptions } = {}) {
  return {
    avatar_set_expression: tool({
      description: "probe",
      inputSchema: z.object({ name: z.enum(["default", "smile"]) }),
      execute: async ({ name }, options) => {
        captureOptions?.(options);
        if (executeMode === "throw") throw new Error("renderer boom");
        if (executeMode === "okfalse") return { ok: false, code: "INTERNAL_ERROR", message: "publish failed" };
        return { ok: true };
      },
    }),
  };
}

const compact = (value) => JSON.stringify(value, (key, v) => (key === "usage" || key === "performance" || key === "request" ? undefined : v), 1);

async function run(label, { steps, tools, stopWhen, repair }) {
  const model = new MockLanguageModelV4({ doStream: steps });
  const stopCalls = [];
  const recordingStop = ({ steps: s }) => { stopCalls.push(s.map((st) => ({ text: st.text, toolCalls: st.toolCalls.map((c) => ({ toolName: c.toolName, invalid: c.invalid, dynamic: c.dynamic })) }))); return false; };
  const agent = new ToolLoopAgent({ model, instructions: "probe", tools, stopWhen: [isStepCount(3), recordingStop, ...(stopWhen ?? [])], experimental_repairToolCall: repair });
  const result = await agent.stream({ prompt: "hi" });
  const parts = [];
  for await (const part of result.stream) parts.push(part);
  const stepResults = await result.steps;
  console.log(`\n=== ${label} ===`);
  console.log(`doStream calls: ${model.doStreamCalls.length}`);
  console.log(`stream parts (types): ${parts.map((p) => p.type).join(", ")}`);
  stepResults.forEach((step, i) => {
    console.log(`step[${i}].finishReason = ${step.finishReason}; text = ${JSON.stringify(step.text)}`);
    console.log(`step[${i}].toolCalls = ${compact(step.toolCalls)}`);
    console.log(`step[${i}].toolResults = ${compact(step.toolResults)}`);
    console.log(`step[${i}].content tool-error parts = ${compact(step.content.filter((p) => p.type === "tool-error"))}`);
    console.log(`step[${i}].response.messages = ${compact(step.response.messages)}`);
  });
  console.log(`stopCondition invocations: ${stopCalls.length}; steps seen at each = ${compact(stopCalls)}`);
  if (model.doStreamCalls.length > 1) {
    console.log(`prompt sent on 2nd model call (LanguageModelV4 prompt) = ${compact(model.doStreamCalls[1].prompt)}`);
  }
  return { model, stepResults };
}

// --- Case A: out-of-enum name, text spoken in the same step, presentationTailStop active (production wiring) ---
await run("A. invalid enum + spoke, WITH presentationTailStop", {
  steps: [textToolStep(["你好呀！"], { toolCallId: "c1", toolName: "avatar_set_expression", input: { name: "not_in_vocab" } }), textStep(["(step 1 would run here)"])],
  tools: makeTools(), stopWhen: [presentationTailStop],
});

// --- Case B: same call, NO presentationTailStop — shows what the model would read on step 1 ---
await run("B. invalid enum + spoke, WITHOUT presentationTailStop", {
  steps: [textToolStep(["你好呀！"], { toolCallId: "c1", toolName: "avatar_set_expression", input: { name: "not_in_vocab" } }), textStep(["corrected"])],
  tools: makeTools(),
});

// --- Case C: missing required name ({}), tool-only step (no text yet) WITH presentationTailStop ---
await run("C. missing name, tool-only step (no text yet), WITH presentationTailStop", {
  steps: [toolOnlyStep({ toolCallId: "c1", toolName: "avatar_set_expression", input: {} }), textStep(["now I talk"])],
  tools: makeTools(), stopWhen: [presentationTailStop],
});

// --- Case D: non-existent tool (typo), spoke, WITH presentationTailStop ---
await run("D. non-existent tool name + spoke, WITH presentationTailStop", {
  steps: [textToolStep(["你好"], { toolCallId: "c1", toolName: "avatar_set_expresion", input: { name: "smile" } }), textStep(["after error"])],
  tools: makeTools(), stopWhen: [presentationTailStop],
});

// --- Case E: valid call, execute RETURNS {ok:false,...} ---
await run("E. valid call, execute returns {ok:false}", {
  steps: [toolOnlyStep({ toolCallId: "c1", toolName: "avatar_set_expression", input: { name: "smile" } }), textStep(["done"])],
  tools: makeTools({ executeMode: "okfalse" }),
});

// --- Case F: valid call, execute THROWS ---
await run("F. valid call, execute throws", {
  steps: [toolOnlyStep({ toolCallId: "c1", toolName: "avatar_set_expression", input: { name: "smile" } }), textStep(["done"])],
  tools: makeTools({ executeMode: "throw" }),
});

// --- Case G: experimental_repairToolCall fixes the enum once ---
let repairCalls = 0;
await run("G. invalid enum, repair hook returns a fixed call", {
  steps: [textToolStep(["hi"], { toolCallId: "c1", toolName: "avatar_set_expression", input: { name: "not_in_vocab" } }), textStep(["done"])],
  tools: makeTools(), stopWhen: [presentationTailStop],
  repair: async ({ toolCall, error }) => { repairCalls += 1; console.log(`repair invoked: error.name=${error.name}; toolCall.input=${toolCall.input}`); return { ...toolCall, input: JSON.stringify({ name: "default" }) }; },
});
console.log(`repair hook invocations: ${repairCalls}`);

// --- Case H: repair hook returns null (declines) ---
await run("H. invalid enum, repair hook returns null", {
  steps: [textToolStep(["hi"], { toolCallId: "c1", toolName: "avatar_set_expression", input: { name: "not_in_vocab" } }), textStep(["done"])],
  tools: makeTools(), repair: async () => null,
});

// --- Case I: ToolExecutionOptions keys available inside execute ---
let seenOptions;
await run("I. execute options shape", {
  steps: [toolOnlyStep({ toolCallId: "c1", toolName: "avatar_set_expression", input: { name: "smile" } }), textStep(["done"])],
  tools: makeTools({ captureOptions: (o) => { seenOptions = o; } }),
});
console.log(`execute options keys: ${Object.keys(seenOptions).join(", ")}; toolCallId=${seenOptions.toolCallId}; abortSignal is AbortSignal: ${seenOptions.abortSignal instanceof AbortSignal}; messages.length=${seenOptions.messages.length}`);
