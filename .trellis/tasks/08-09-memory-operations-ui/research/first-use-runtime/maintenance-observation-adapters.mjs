/**
 * INPUT: existing task-only provider/Native launchers and in-memory replay results
 * OUTPUT: opt-in timestamp adapters and content-free diagnostic projections
 * POS: task-only; shared journey helpers and production modules remain unchanged on disk
 */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

async function instrumentedImport(relative, transform) {
  const url = new URL(relative, import.meta.url);
  url.search = "maintenance-observation";
  const hook = registerHooks({ load(name, context, nextLoad) {
    const loaded = nextLoad(name, context);
    if (name !== url.href) return loaded;
    const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
    return { ...loaded, source: transform(source) };
  } });
  try { return await import(url.href); } finally { hook.deregister(); }
}

function replace(source, anchor, value) {
  assert.equal(source.split(anchor).length - 1, 1, "observation adapter anchor changed");
  return source.replace(anchor, value);
}

export async function startObservedProvider(input) {
  const provider = await instrumentedImport("../../../archive/2026-09/09-25-hindsight-native-smoke/research/smoke-fake-provider.mjs", (source) => {
    source = replace(source, "    const chunks = [];", "    const receivedAt = Date.now();\n    const chunks = [];");
    source = replace(source, "      log.push({ id, at: new Date().toISOString(), model:", "      log.push({ id, receivedAt, at: new Date().toISOString(), model:");
    return replace(source, "      if (body.stream === true) stream(response, body, answer, id);", [
      "      const observation = log.at(-1);",
      "      response.once('finish', () => { observation.answeredAt = Date.now(); });",
      "      if (body.stream === true) stream(response, body, answer, id);",
    ].join("\n"));
  });
  return provider.startFakeProvider(input);
}

export async function spawnObservedNative(input) {
  const launcher = fileURLToPath(new URL("./maintenance-native-launcher.py", import.meta.url));
  const native = await instrumentedImport("./smoke-native.mjs", (source) => replace(source, ": LAUNCHER;", `: ${JSON.stringify(launcher)};`));
  return native.spawnNative(input);
}

export function metadataProvider(log) {
  return log.map((entry) => ({ id: entry.id, at: entry.at, receivedAt: entry.receivedAt ?? null,
    answeredAt: entry.answeredAt ?? null, kind: entry.kind, stream: entry.stream,
    tools: entry.tools ?? [], answerTools: entry.answer?.tools ?? (entry.answer?.tool ? [entry.answer.tool] : []),
    toolResultBytes: entry.toolResult === null || entry.toolResult === undefined ? null : Buffer.byteLength(entry.toolResult),
  }));
}

export function metadataReplay(result) {
  const { chat, provider, failure, memoryFailure, ...rest } = result;
  return { ...rest, ...(failure ? { failure: "REPLAY_STAGE_FAILED" } : {}),
    teardown: Object.fromEntries(Object.entries(result.teardown ?? {}).map(([key, value]) => [key,
      value && typeof value === "object" && "error" in value ? { error: "CLEANUP_FAILED" } : value])),
    ...(memoryFailure ? { memoryFailure: "RECALL_ASSERTION_FAILED" } : {}),
    chat: Object.fromEntries(["startedAt", "completedAt", "ackMs", "notificationMs", "totalMs", "messageId", "runId", "outcome", "exactMatches", "providerOffset"]
      .filter((key) => chat?.[key] !== undefined).map((key) => [key, chat[key]])),
    chatState: chat?.run?.state ?? null, chatFailed: !!chat?.failure,
    ...(provider ? { provider: metadataProvider(provider) } : {}) };
}
