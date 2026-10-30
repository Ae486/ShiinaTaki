import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateSummaryQuality } from "../../../../packages/core/src/agents/compaction-policy.ts";

const directory = process.argv[2];
const read = (name) => JSON.parse(readFileSync(join(directory, name), "utf8"));
const failure = read("a2-self-report-failed.json");
const generation = read("generations.json")[1];
const operation = failure.compaction[0];
const result = evaluateSummaryQuality({ text: generation.text, finishReason: generation.finishReason, strict: true,
  span: failure.sourceRows.filter((row) => row.seq >= operation.selected_from_seq && row.seq <= operation.selected_through_seq) });
const evidence = { accepted: result.accepted, code: result.code, sourceTokens: result.sourceTokens,
  summaryTokens: result.summaryTokens, storedFailureCode: operation.failure_code, kind: "zero-paid replay of actual saved source/output through production quality policy" };
writeFileSync(join(directory, "quality-replayed.json"), JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence));
