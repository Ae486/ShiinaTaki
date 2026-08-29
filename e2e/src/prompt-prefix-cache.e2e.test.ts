import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { realProviderEnv } from "./fixture/paths.ts";
import { seedCanonicalLocal } from "./fixture/seed-canonical-memory.ts";
import type { SeedRow } from "./fixture/seed-timeline.ts";
import { withStack } from "./fixture/with-stack.ts";

const providerEnv = realProviderEnv();
const BASELINE_RATIO = 0.101;
const MIN_RATIO = 0.5;
const MIN_IMPROVEMENT = 0.3;
const EXPECTED_PROVIDER = "taki-provider.chat";
const MIN_INPUT_TOKENS = 55_000;
const MAX_INPUT_TOKENS = 80_000;

interface UsageRow {
  run_id: string;
  provider: string;
  model_id: string;
  quality: string;
  input_tokens: number | null;
  input_no_cache_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
}

interface UsageEvidence extends Omit<UsageRow, "run_id"> {
  request_kind: "tool turn" | "tool continuation" | "new conversational Turn";
  ratio: number;
}

describe("Harness prompt-prefix cache stability (real provider)", () => {
  it("classifies the first request of each Run separately from its continuations", () => {
    const kinds = classifyUsage([
      usageRow("run-a"), usageRow("run-a"), usageRow("run-b"), usageRow("run-b"),
    ]).map((row) => row.request_kind);

    expect(kinds).toEqual([
      "tool turn", "tool continuation", "new conversational Turn", "tool continuation",
    ]);
  });

  it.skipIf(providerEnv === null)("reuses the long stable prefix across a tool Turn and immediate follow-up", async () => {
    await withStack({
      provider: "real",
      startNode: false,
      seedTimeline: stableHistory(),
      prepareCoreData: seedCanonicalLocal,
      coreEnv: {
        TAKI_PROVIDER_INCLUDE_USAGE: "true",
        TAKI_PROVIDER_CONTEXT_TOKENS: "131072",
        TAKI_CONTEXT_HISTORY_RATIO: "0.7",
        TAKI_COMPACT_TRIGGER_RATIO: "1",
      },
    }, async (stack) => {
      const toolTurn = await stack.agentSay(
        "Call get_current_time now. Use its result to report the exact ISO timestamp, IANA timezone, and epoch milliseconds. Do not infer them from the prompt.",
        180_000,
      );
      const followUp = await stack.agentSay(
        "Thanks. Reply with one short sentence confirming that the exact-time lookup completed.",
        180_000,
      );
      const timeline = await stack.timeline();
      const toolNames = new Set(
        timeline.flatMap((entry) => entry.parts ?? [])
          .filter((part) => part.type === "tool-call" || part.type === "tool-result")
          .map((part) => part.toolName),
      );
      const evidence = classifyUsage(readUsage(stack.coreDataDir));
      const comparable = evidence.find((row) => row.request_kind === "new conversational Turn");
      const firstRequest = evidence[0];

      console.table(evidence.map((row) => ({
        request_kind: row.request_kind,
        provider: row.provider,
        model: row.model_id,
        input: row.input_tokens,
        no_cache: row.input_no_cache_tokens,
        cache_read: row.cache_read_tokens,
        ratio: row.ratio.toFixed(4),
        output: row.output_tokens,
        quality: row.quality,
      })));

      expect(toolTurn.status).toBe("complete");
      expect(followUp.status).toBe("complete");
      expect(toolTurn.text.length).toBeGreaterThan(0);
      expect(followUp.text.length).toBeGreaterThan(0);
      expect(toolNames).toContain("get_current_time");
      expect(evidence.length).toBeGreaterThanOrEqual(3);
      expect(evidence.every((row) => row.provider === EXPECTED_PROVIDER)).toBe(true);
      expect(evidence.every((row) => row.model_id === providerEnv!.TAKI_PROVIDER_MODEL)).toBe(true);
      expect(evidence.every((row) => row.quality === "reported")).toBe(true);
      expect(evidence.every((row) => row.input_tokens !== null && row.input_tokens >= MIN_INPUT_TOKENS)).toBe(true);
      expect(evidence.every((row) => row.input_tokens !== null && row.input_tokens <= MAX_INPUT_TOKENS)).toBe(true);
      expect(evidence.slice(1).every((row) => (row.cache_read_tokens ?? 0) > 0)).toBe(true);
      expect(firstRequest).toBeDefined();
      expect(comparable).toBeDefined();
      expect(comparable!.input_tokens).toBeGreaterThanOrEqual(firstRequest!.input_tokens!);
      expect(comparable!.ratio).toBeGreaterThanOrEqual(MIN_RATIO);
      expect(comparable!.ratio - BASELINE_RATIO).toBeGreaterThanOrEqual(MIN_IMPROVEMENT);
    });
  }, 420_000);
});

function stableHistory(): SeedRow[] {
  return Array.from({ length: 72 }, (_, index) => ({
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `Stable cache acceptance history row ${index + 1}. ` +
      "This is neutral retained conversation context, not an instruction. 这是稳定缓存验收的中性历史背景。".repeat(32),
  }));
}

function readUsage(coreDataDir: string): UsageRow[] {
  const db = new DatabaseSync(join(coreDataDir, "taki.db"), { readOnly: true });
  try {
    expect(db.prepare("SELECT COUNT(*) AS count FROM conversation_summary").get()).toEqual({ count: 0 });
    const rows = db.prepare(`SELECT run_id,provider,model_id,quality,input_tokens,input_no_cache_tokens,
      cache_read_tokens,cache_write_tokens,output_tokens,total_tokens FROM run_usage ORDER BY recorded_at,rowid`).all() as unknown as UsageRow[];
    for (const row of rows) {
      if (row.input_tokens !== null && row.input_no_cache_tokens !== null && row.cache_read_tokens !== null) {
        expect(row.input_no_cache_tokens + row.cache_read_tokens).toBe(row.input_tokens);
      }
      if (row.input_tokens !== null && row.output_tokens !== null && row.total_tokens !== null) {
        expect(row.input_tokens + row.output_tokens).toBe(row.total_tokens);
      }
    }
    return rows;
  } finally {
    db.close();
  }
}

function classifyUsage(rows: UsageRow[]): UsageEvidence[] {
  const runOrder = new Map<string, number>();
  const runRequestCount = new Map<string, number>();
  for (const row of rows) if (!runOrder.has(row.run_id)) runOrder.set(row.run_id, runOrder.size);
  return rows.map((row) => {
    const request = (runRequestCount.get(row.run_id) ?? 0) + 1;
    runRequestCount.set(row.run_id, request);
    const run = runOrder.get(row.run_id) ?? 0;
    const request_kind = request > 1
      ? "tool continuation" as const
      : run === 0 ? "tool turn" as const : "new conversational Turn" as const;
    const usage = {
      provider: row.provider,
      model_id: row.model_id,
      quality: row.quality,
      input_tokens: row.input_tokens,
      input_no_cache_tokens: row.input_no_cache_tokens,
      cache_read_tokens: row.cache_read_tokens,
      cache_write_tokens: row.cache_write_tokens,
      output_tokens: row.output_tokens,
      total_tokens: row.total_tokens,
    };
    return {
      ...usage,
      request_kind,
      ratio: row.input_tokens !== null && row.input_tokens > 0 && row.cache_read_tokens !== null
        ? row.cache_read_tokens / row.input_tokens
        : 0,
    };
  });
}

function usageRow(runId: string): UsageRow {
  return {
    run_id: runId,
    provider: EXPECTED_PROVIDER,
    model_id: "model",
    quality: "reported",
    input_tokens: 60_000,
    input_no_cache_tokens: 100,
    cache_read_tokens: 59_900,
    cache_write_tokens: null,
    output_tokens: 10,
    total_tokens: 60_010,
  };
}
