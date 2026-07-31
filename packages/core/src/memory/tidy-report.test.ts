import { afterEach, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { loadMemoryConfig, type MemoryConfig } from "../config/memory-config.ts";
import { createMemoryFixture, type MemoryFixture } from "../testing/memory-fixture.ts";
import { V1_MEMORY_LAYERS } from "./layer-registry.ts";
import { buildTidyReport, type TidyReportSource } from "./tidy-report.ts";

const ALL_LAYERS = V1_MEMORY_LAYERS.map((layer) => layer.id);
const DAY_MS = 86_400_000;

const fixtures: MemoryFixture[] = [];
function fresh(): MemoryFixture {
  const f = createMemoryFixture();
  fixtures.push(f);
  return f;
}
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

function cfg(overrides: Partial<MemoryConfig> = {}): MemoryConfig {
  return { ...loadMemoryConfig({}), ...overrides };
}

// The block store itself is batch-2-tested; the report consumes the TidyReportSource seam, so a map-backed stub is
// the honest double here. `refs` records what the report asked for (ownership wiring).
function sourceOf(
  f: MemoryFixture,
  blocks: Map<string, string> = new Map(),
  refs: Array<{ id: string; characterId?: string }> = [],
): TidyReportSource {
  return {
    listActive: (characterId) =>
      f.repo.listActiveByLayers({ characterId, layers: ALL_LAYERS, now: new Date().toISOString() }),
    readBlock(ref) {
      refs.push(ref);
      return blocks.get(ref.id);
    },
  };
}

function iso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * DAY_MS).toISOString();
}

// Frontmatter strings are JSON-quoted (frontmatter.ts serialize), so the doctored values are quoted too.
function ageEntry(f: MemoryFixture, filePath: string, fields: { created?: string; updated?: string }): void {
  let text = readFileSync(filePath, "utf8");
  if (fields.created !== undefined) text = text.replace(/^created: .*$/m, `created: "${fields.created}"`);
  if (fields.updated !== undefined) {
    text = /^updated: /m.test(text)
      ? text.replace(/^updated: .*$/m, `updated: "${fields.updated}"`)
      : text.replace(/^(created: .*)$/m, `$1\nupdated: "${fields.updated}"`);
  }
  writeFileSync(filePath, text);
  f.reconcile();
}

describe("buildTidyReport (batch 4b — facts flat, hypotheses as questions, never a verdict)", () => {
  it("reports a clean store as no work at all", () => {
    const f = fresh();
    const report = buildTidyReport(sourceOf(f), { characterId: "taki", lastTidyAt: null }, cfg());

    expect(report.hasWork).toBe(false);
    expect(report.newWrites).toBe(0);
    expect(report.defects).toEqual({ missingDisclosure: 0, overBudget: 0, stale: 0, nearDuplicate: 0, misfiled: 0 });
  });

  it("states a missing recall trigger as a FACT — but only for rows that rely on retrieval", () => {
    const f = fresh();
    const searchable = f.store.write({ layer: "profile", content: "对香菜过敏", importance: 5 });
    f.store.write({ layer: "relationship", characterId: "taki", content: "答应周五看电影", importance: 8 }); // pinned by policy
    f.store.write({ layer: "profile", content: "他叫P", importance: 9 }); // pinned by threshold
    f.store.write({ layer: "activity", content: "14:00 vscode", importance: 1 }); // machine-written, sweeper's domain
    f.reconcile();

    const report = buildTidyReport(sourceOf(f), { characterId: "taki", lastTidyAt: null }, cfg());

    expect(report.defects.missingDisclosure).toBe(1);
    expect(report.text).toContain("NO recall trigger");
    expect(report.text).toContain(`[${searchable.entry.id}]`);
    expect(report.text).toContain("对香菜过敏");
  });

  it("asks the stale question with age + threshold, anchored on the LAST activity, never for pinned rows", () => {
    const f = fresh();
    const stale = f.store.write({ layer: "episodes", characterId: "taki", content: "聊过一次哥斯拉", importance: 4, disclosure: "聊到电影" });
    const refreshed = f.store.write({ layer: "episodes", characterId: "taki", content: "喜欢深夜写代码", importance: 4, disclosure: "聊到作息" });
    const pinned = f.store.write({ layer: "relationship", characterId: "taki", content: "答应一直陪着", importance: 10 });
    f.reconcile();
    ageEntry(f, stale.filePath, { created: iso(60) });
    ageEntry(f, refreshed.filePath, { created: iso(60), updated: iso(10) }); // R9 anchor: reinforcement restarts the clock
    ageEntry(f, pinned.filePath, { created: iso(60) });

    const report = buildTidyReport(sourceOf(f), { characterId: "taki", lastTidyAt: iso(1) }, cfg());

    expect(report.defects.stale).toBe(1);
    expect(report.text).toContain("why was this never recalled?");
    expect(report.text).toContain("Stale for ~60 days (threshold 45)");
    expect(report.text).not.toContain("答应一直陪着");
  });

  it("shows BOTH near-duplicates and asks, never concludes; layers do not cross-match", () => {
    const f = fresh();
    const a = f.store.write({ layer: "episodes", characterId: "taki", content: "他喜欢拉面。", importance: 4 });
    const b = f.store.write({ layer: "episodes", characterId: "taki", content: "他喜欢拉面", importance: 3 });
    f.store.write({ layer: "profile", content: "他喜欢拉面", importance: 5 }); // same key, other layer — no pair
    f.reconcile();

    const report = buildTidyReport(sourceOf(f), { characterId: "taki", lastTidyAt: null }, cfg());

    expect(report.defects.nearDuplicate).toBe(1);
    expect(report.text).toContain("the same thing, or a real distinction?");
    expect(report.text).toContain(`[${a.entry.id}]`);
    expect(report.text).toContain(`[${b.entry.id}]`);
  });

  it("scopes the new-writes slice by the watermark and asks the misfiled question over it alone", () => {
    const f = fresh();
    const old = f.store.write({ layer: "episodes", characterId: "taki", content: "上个月的旧事", importance: 3, disclosure: "旧事" });
    const fresh_ = f.store.write({ layer: "episodes", characterId: "taki", content: "今天说想去海边", importance: 4, disclosure: "去海边" });
    f.reconcile();
    ageEntry(f, old.filePath, { created: iso(2) });

    const report = buildTidyReport(sourceOf(f), { characterId: "taki", lastTidyAt: iso(1) }, cfg());

    expect(report.defects.misfiled).toBe(1);
    expect(report.newWrites).toBe(1);
    expect(report.text).toContain("does it belong where it is");
    expect(report.text).toContain(`[${fresh_.entry.id}]`);
    const slice = report.text.slice(report.text.indexOf("## New entries"));
    expect(slice).not.toContain("上个月的旧事");
  });

  it("states over-budget as arithmetic: the pinned valve and each block's used/limit", () => {
    const f = fresh();
    f.store.write({ layer: "relationship", characterId: "taki", content: "约定".repeat(20), importance: 10 });
    f.reconcile();
    const blocks = new Map([
      ["user-card", "叫我P"],
      ["user-model", "字".repeat(900)],
    ]);

    const report = buildTidyReport(sourceOf(f, blocks), { characterId: "taki", lastTidyAt: null }, cfg({ pinnedBudget: 10 }));

    expect(report.defects.overBudget).toBe(2); // pinned over + user-model over; user-card fine, memory-index absent
    expect(report.text).toContain("This exceeds the pinned budget.");
    expect(report.text).toContain("~900/800 tokens");
    expect(report.text).toContain("(absent)");
  });

  it("renders block content beside its numbers, marks the user's block read-only, and scopes per-character reads", () => {
    const f = fresh();
    const refs: Array<{ id: string; characterId?: string }> = [];
    const blocks = new Map([["user-card", "叫我P，住在东京"]]);

    const report = buildTidyReport(sourceOf(f, blocks, refs), { characterId: "taki", lastTidyAt: null }, cfg());

    expect(report.text).toContain("叫我P，住在东京");
    expect(report.text).toContain("READ-ONLY");
    expect(report.text).toContain("yours to maintain via block_rethink");
    expect(report.text).toContain("/500 tokens");
    expect(refs).toContainEqual({ id: "memory-index", characterId: "taki" });
    expect(refs).toContainEqual({ id: "user-card", characterId: undefined });
  });

  it("caps every candidate list and STATES the dropped count, while defect counts stay full", () => {
    const f = fresh();
    for (const content of ["一", "二", "三", "四"]) {
      f.store.write({ layer: "profile", content: `记不住的事${content}`, importance: 5 });
    }
    f.reconcile();

    const report = buildTidyReport(sourceOf(f), { characterId: "taki", lastTidyAt: null }, cfg({ reportClassCap: 2 }));

    expect(report.defects.missingDisclosure).toBe(4);
    expect(report.text).toContain("(2 more not shown.)");
  });

  it("fences observed-origin content wherever the report shows it (Q8/D47)", () => {
    const f = fresh();
    f.store.write({ layer: "episodes", characterId: "taki", content: "屏幕上是一个登录页面", importance: 4, origin: "observed" });
    f.reconcile();

    const report = buildTidyReport(sourceOf(f), { characterId: "taki", lastTidyAt: null }, cfg());

    expect(report.text).toContain('<untrusted-observation source="memory">');
    expect(report.text).toContain("屏幕上是一个登录页面");
  });
});
