import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hindsightTemplateHashJson } from "../../../../packages/shared/src/hindsight-template-encoding.ts";

const definitions = [
  ["presence", { absent: { kind: "absent" }, tombstone: { kind: "null_tombstone" }, value: { kind: "value", value: "" } }],
  ["unicode-and-own-keys", JSON.parse('{"__proto__":null,"constructor":[],"😀":"雪","𐀀":"é","":"é"}')],
  ["binary64", { integer: 9007199254740991, large: 1e21, fraction: 0.1, negative_zero: -0, small: 5e-324 }],
  ["complete-trigger", { id: "test-model", name: "雪", source_query: "What changed?", tags: ["b", "a"], max_tokens: 1024,
    trigger: { mode: "delta", refresh_after_consolidation: false, refresh_cron: null, fact_types: ["experience", "world"],
      exclude_mental_models: false, exclude_mental_model_ids: [], tags_match: "all_strict", tag_groups: [{ not: { tags: ["private"] } }],
      include_chunks: null, recall_max_tokens: 256, recall_chunks_max_tokens: null,
      response_schema: JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'), keep_trace: true } }],
];
const vectors = definitions.map(([name, value]) => {
  const canonical = hindsightTemplateHashJson("definition", value);
  return { name, domain: "definition", value, canonical, hash: createHash("sha256").update(canonical).digest("hex") };
});
const content = JSON.stringify(vectors, null, 2) + "\n";
const paths = [
  fileURLToPath(new URL("b1-template-hash-vectors.json", import.meta.url)),
  fileURLToPath(new URL("../../../../packages/shared/src/fixtures/hindsight-template-vectors.json", import.meta.url)),
  "H:/hindsight/hindsight-api-slim/tests/native_results/template_hash_vectors.json",
];
for (const path of paths) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content, "utf8"); }
process.stdout.write(JSON.stringify(vectors.map(({ name, hash }) => ({ name, hash }))) + "\n");
