/**
 * INPUT: versioned Taki missions, two preserved isolated retain sources and three labelled synthetic controls.
 * OUTPUT: finite real Native extraction comparison in an owned G: directory; no semantic PASS is inferred.
 * POS: task-only diagnostic; no database writer, service boot or owner-data access.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";

const revisions = ["taki-bank-v2", "taki-bank-v3"];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const option = (name) => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; };
const synthetic = [
  { id: "confirmed-study", scope: "character", source: "synthetic-confirmation", eventDate: "2026-11-05T11:21:21.315Z",
    content: "2026-11-05，Taki 问用户是否正在二刷 408。用户明确回答：是的，我正在二刷 408，下午已经复习了 408，今晚准备刷数学。",
    context: "2026-11-05 用户与 Taki 关于学习安排的对话。" },
  { id: "denied-study", scope: "character", source: "synthetic-denial-and-plan", eventDate: "2026-11-05T11:21:21.315Z",
    content: "2026-11-05，Taki 问用户是否正在二刷 408。用户回答：不是，我还在第一遍。下周如果有时间，我可能开始第二遍；今晚只打算刷数学。",
    context: "2026-11-05 用户与 Taki 关于学习安排的对话。" },
  { id: "unconfirmed-move", scope: "global", source: "synthetic-transfer-case", eventDate: "2026-11-05T11:21:21.315Z",
    content: "2026-11-05，助手问用户：你已经搬到上海了吗？用户回答：我只是考虑下个月去上海看看房子，还没有决定是否搬家。",
    context: "2026-11-05 用户与助手关于居住安排的对话。" },
];

function cases() {
  const db = new DatabaseSync("G:/taki-real-memory-Ld9jwy/core-data/taki.db", { readOnly: true });
  try {
    const originals = [
      ["original-study", "character", "3aae5c27-c00b-4522-ba54-052b85155d15"],
      ["original-global", "global", "638b178c-8f82-4f28-bccd-9ae64040fc14"],
    ].map(([id, scope, requestId]) => {
      const row = db.prepare("SELECT payload_bytes FROM hindsight_memory_write_intents WHERE request_id = ?").get(requestId);
      if (!row) throw new Error("PRESERVED_SOURCE_MISSING");
      const { request } = JSON.parse(Buffer.from(row.payload_bytes).toString("utf8")).identity.operation;
      return { id, scope, source: "preserved-isolated-retain", requestId, content: request.content,
        context: request.context, eventDate: request.provenance.capturedAt };
    });
    return [originals[0], ...synthetic, originals[1]];
  } finally { db.close(); }
}

async function main() {
  const caseFilter = option("--case"); const revisionFilter = option("--revision");
  const selectedRevisions = revisionFilter ? revisions.filter((value) => value === revisionFilter) : revisions;
  const selectedCases = cases().filter((value) => !caseFilter || value.id === caseFilter);
  if (!selectedRevisions.length || !selectedCases.length) throw new Error("UNKNOWN_EVAL_SELECTION");
  const { loadManagedTemplate } = await import("../../../../../packages/core/src/memory/hindsight/template-lifecycle/template-catalog.ts");
  const templates = selectedRevisions.flatMap((revision) => ["global", "character"].map((scope) => loadManagedTemplate(revision, scope)));
  const values = parseEnv(readFileSync("H:/TakiAgent-worktrees/t4/.env.local", "utf8"));
  const endpoint = new URL(values.TAKI_PROVIDER_BASE_URL);
  if (endpoint.protocol !== "https:" || !values.TAKI_PROVIDER_API_KEY || !values.TAKI_PROVIDER_MODEL) throw new Error("MODEL_CONFIG_INVALID");
  const root = mkdtempSync("G:/taki-extraction-prompts-");
  mkdirSync(join(root, "tmp"));
  const input = { cases: selectedCases, templates, revisions: selectedRevisions,
    sourceHashes: selectedCases.map(({ id, content, context }) => ({ id, content: hash(content), context: hash(context ?? "") })) };
  writeFileSync(join(root, "input.private.json"), JSON.stringify(input, null, 2) + "\n");
  const allowed = new Set(["PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "WINDIR", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "NUMBER_OF_PROCESSORS"]);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
  Object.assign(env, { TEMP: join(root, "tmp"), TMP: join(root, "tmp"), PYTHONIOENCODING: "utf-8",
    PYTHONPATH: "H:/hindsight/hindsight-api-slim", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1",
    NO_PROXY: endpoint.hostname, no_proxy: endpoint.hostname,
    HINDSIGHT_API_LLM_PROVIDER: "openai", HINDSIGHT_API_LLM_BASE_URL: endpoint.href,
    HINDSIGHT_API_LLM_API_KEY: values.TAKI_PROVIDER_API_KEY, HINDSIGHT_API_LLM_MODEL: values.TAKI_PROVIDER_MODEL,
    HINDSIGHT_API_LLM_TIMEOUT: "240" });
  console.log(`[extraction-prompts] owned root ${root}; ${selectedCases.length * selectedRevisions.length} planned extractions`);
  const child = spawn("H:/hindsight/.venv/Scripts/python.exe", [fileURLToPath(new URL("real-extraction-prompts.py", import.meta.url)), root],
    { cwd: "H:/hindsight", env, windowsHide: true, stdio: "inherit" });
  process.exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => resolve(code ?? 1)); });
}

if (process.argv.includes("--self-check")) {
  if (synthetic.length !== 3 || new Set(synthetic.map(({ id }) => id)).size !== 3 || revisions.length !== 2) throw new Error("EVAL_CASES_INVALID");
  console.log("[extraction-prompts] self-check passed; no config, fixture, model or service opened");
} else {
  await main().catch(() => { console.error("[extraction-prompts] launcher failed; no semantic result established"); process.exitCode = 1; });
}
