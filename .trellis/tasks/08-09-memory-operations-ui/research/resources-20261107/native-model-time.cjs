// Leader-only: sum Native's own embedding/rerank/recall timings from a Hindsight native.log.
const fs = require("fs");
const text = fs.readFileSync(process.argv[2], "utf8");
const sum = (re, group = 1) => { let total = 0, n = 0, max = 0; for (const m of text.matchAll(re)) { const v = Number(m[group]); total += v; n++; max = Math.max(max, v); } return { n, seconds: +total.toFixed(2), max: +max.toFixed(3) }; };
let candidates = 0; for (const m of text.matchAll(/Reranking \[cross-encoder\]: (\d+) candidates scored in ([\d.]+)s/g)) candidates += Number(m[1]);
console.log(JSON.stringify({
  queryEmbedding: sum(/Generate query embedding: ([\d.]+)s/g),
  rerank: { ...sum(/Reranking \[cross-encoder\]: \d+ candidates scored in ([\d.]+)s/g), candidates },
  retainEmbeddings: sum(/Generate embeddings: \d+ embeddings in ([\d.]+)s/g),
  consolidationEmbedding: sum(/\[CONSOLIDATION\][^\n]*llm_batch[^\n]*embedding=([\d.]+)s/g),
  temporalExtraction: sum(/temporal_extraction=([\d.]+)s/g),
  recallTotal: sum(/\[RECALL [^\]]+\] Complete:[^\n]*\| ([\d.]+)s/g),
}, null, 1));
