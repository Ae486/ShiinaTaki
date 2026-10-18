/**
 * INPUT:  owned loopback HTTP endpoint, actual Native extraction/consolidation seed and a fresh SQLite file
 * OUTPUT: real HTTP exchange evidence and verified per-unit Canonical policies across physical SQLite reopen
 * POS:    core/testing — subprocess entry for Native pytest; provider/model routes outside this sync boundary refuse
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { HINDSIGHT_TEMPLATE_MAX_BYTES } from "@taki/shared";
import { createHindsightClient, type HindsightTransport } from "../memory/hindsight/hindsight-client.ts";
import { hindsightHttpTransport } from "../memory/hindsight/hindsight-http-transport.ts";
import { openTemplateExchange, TemplateExchangeSeedSchema, verifyTemplateExchange,
  type TemplateExchange, type TemplateExchangeSeed } from "./hindsight-template-exchange-fixture.ts";

interface Options { endpoint: string; seedPath: string; sqlite: string; evidencePath: string }

function options(): Options {
  assert.equal(process.env.TAKI_TEMPLATE_LABEL_HTTP_FIXTURE, "1", "owned fixture environment required");
  const args = process.argv.slice(2); assert.equal(args.length, 6);
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]; const value = args[index + 1];
    assert.ok(key && ["--endpoint", "--seed", "--sqlite"].includes(key) && value && !values.has(key)); values.set(key, value);
  }
  const endpoint = values.get("--endpoint"); const seedPath = values.get("--seed"); const sqlite = values.get("--sqlite");
  assert.ok(endpoint && seedPath && sqlite); const url = new URL(endpoint);
  assert.equal(url.protocol, "http:"); assert.equal(url.hostname, "127.0.0.1"); assert.ok(url.port);
  assert.equal(url.origin, endpoint); assert.equal(url.username, ""); assert.equal(url.password, "");
  assert.ok(isAbsolute(seedPath) && isAbsolute(sqlite)); assert.equal(dirname(seedPath), dirname(sqlite));
  assert.equal(basename(sqlite), "owned.sqlite"); assert.equal(existsSync(sqlite), false);
  assert.ok(statSync(seedPath).isFile() && statSync(seedPath).size <= HINDSIGHT_TEMPLATE_MAX_BYTES);
  const evidencePath = join(dirname(sqlite), "http-exchanges.jsonl"); assert.equal(existsSync(evidencePath), false);
  return { endpoint, seedPath, sqlite, evidencePath };
}

function recorder(input: { options: Options; seed: TemplateExchangeSeed; fixture: () => TemplateExchange | undefined }) {
  const counters = { requests: 0, labelEvidenceReads: 0, applicationCommits: 0 };
  writeFileSync(input.options.evidencePath, "", { encoding: "utf8", flag: "wx" });
  const transport: HindsightTransport = async (address, init, maxResponseBytes) => {
    const url = new URL(address); assert.equal(url.origin, input.options.endpoint);
    assert.ok(allowedPath(url.pathname, input.seed), "fixture refuses an unrelated or model-producing endpoint");
    const fixture = input.fixture(); assert.ok(fixture); assert.equal(fixture.inTransaction(), false, "remote I/O entered SQLite");
    const method = init?.method ?? "GET"; const body = typeof init?.body === "string" ? init.body : null;
    counters.requests++; const ordinal = counters.requests;
    if (url.pathname.endsWith("/template/label-evidence")) counters.labelEvidenceReads++;
    if (method === "POST" && url.pathname.endsWith("/application-state/commits")) counters.applicationCommits++;
    const response = await hindsightHttpTransport(address, init, { maxBytes: maxResponseBytes, responseStatuses: [403, 410, 413, 503] });
    assert.equal(fixture.inTransaction(), false);
    appendFileSync(input.options.evidencePath, JSON.stringify({ ordinal, method, path: url.pathname + url.search,
      requestBody: body, requestSha256: hash(body ?? ""), status: response.status,
      responseBody: response.body, responseSha256: hash(response.body) }) + "\n", "utf8");
    return response;
  };
  return { transport, counters };
}

function allowedPath(path: string, seed: TemplateExchangeSeed): boolean {
  if (["/health", "/version", "/ext/taki-memory/version", "/ext/taki-memory/template/label-evidence"].includes(path)) return true;
  return seed.banks.some((bank) => {
    const prefix = "/ext/taki-memory/banks/" + encodeURIComponent(bank.target.bank_id);
    if (!path.startsWith(prefix + "/")) return false;
    const suffix = path.slice(prefix.length);
    return /^\/snapshots(?:\/|$)/.test(suffix)
      || /^\/application-state\/(?:initialize|snapshots|changes|bodies|commits)(?:\/|$)/.test(suffix);
  });
}

async function consume(config: Options): Promise<void> {
  const seed = TemplateExchangeSeedSchema.parse(JSON.parse(readFileSync(config.seedPath, "utf8")));
  let fixture: TemplateExchange | undefined;
  const recorded = recorder({ options: config, seed, fixture: () => fixture });
  const client = createHindsightClient({ endpoint: config.endpoint, resolveApiKey: () => seed.apiKey, transport: recorded.transport });
  const open = () => openTemplateExchange({ path: config.sqlite, seed, client });
  fixture = open();
  try {
    for (const bank of seed.banks) await fixture.synchronize(bank.target.bank_id);
    const first = verifyTemplateExchange(fixture, seed);
    const commands = JSON.stringify(fixture.db.prepare("SELECT * FROM hindsight_application_command_jobs ORDER BY operation_id").all());
    const before = { ...recorded.counters }; assert.ok(before.labelEvidenceReads > 0 && before.applicationCommits > 0);
    await fixture.close(); fixture = open();
    for (const bank of seed.banks) await fixture.synchronize(bank.target.bank_id);
    assert.deepEqual(verifyTemplateExchange(fixture, seed), first);
    assert.equal(JSON.stringify(fixture.db.prepare("SELECT * FROM hindsight_application_command_jobs ORDER BY operation_id").all()), commands);
    assert.equal(recorded.counters.labelEvidenceReads, before.labelEvidenceReads);
    assert.equal(recorded.counters.applicationCommits, before.applicationCommits);
    process.stdout.write(JSON.stringify({ ...first, ...recorded.counters, reopenVerified: true, remoteIoOutsideSqlite: true,
      exchangeFile: config.evidencePath, exchangeSha256: hash(readFileSync(config.evidencePath)) }) + "\n");
  } finally { await fixture.close(); }
}

function hash(value: string | Uint8Array): string { return createHash("sha256").update(value).digest("hex"); }

await consume(options());
