import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";
import { createSummaryRepo } from "./summary-repo.ts";

const dbs: Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function repo() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  dbs.push(db);
  return createSummaryRepo(db);
}

describe("createSummaryRepo (T5-R3 rolling summary record)", () => {
  it("returns null for a character that has never been compacted", () => {
    expect(repo().get("taki")).toBeNull();
  });

  it("round-trips a summary through upsert + get", () => {
    const summaries = repo();
    summaries.upsert({ characterId: "taki", throughSeq: 160, text: "那段时间我们聊了旅行的计划" });

    expect(summaries.get("taki")).toEqual({ throughSeq: 160, text: "那段时间我们聊了旅行的计划" });
  });

  it("overwrites the character's single row on a second upsert (one overwritable record, R3)", () => {
    const summaries = repo();
    summaries.upsert({ characterId: "taki", throughSeq: 100, text: "第一版" });
    summaries.upsert({ characterId: "taki", throughSeq: 200, text: "第二版，合并了更多内容" });

    expect(summaries.get("taki")).toEqual({ throughSeq: 200, text: "第二版，合并了更多内容" });
  });

  it("keeps characters isolated", () => {
    const summaries = repo();
    summaries.upsert({ characterId: "taki", throughSeq: 10, text: "taki 的记录" });

    expect(summaries.get("yui")).toBeNull();
    expect(summaries.get("taki")?.text).toBe("taki 的记录");
  });
});
