import { afterEach, expect, it } from "vitest";
import type { TimelineEntry } from "@taki/shared";
import { openDatabase, type Database } from "../db/sqlite.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { createTimelineRepo } from "../db/timeline-repo.ts";
import { createSummaryRepo } from "../db/summary-repo.ts";
import { createCompactionOperationRepo } from "../db/compaction-operation-repo.ts";
import { createCompactionPass } from "./compaction-pass.ts";
import { createConversationStore } from "./conversation-store.ts";
import { createUtilitySlot } from "../memory/utility-slot.ts";
import { generatingModel } from "../testing/mock-language-model.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

function fixture(drift: boolean) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  const timeline = createTimelineRepo(db); const summaries = createSummaryRepo(db);
  for (let index = 0; index < 10; index += 1) timeline.append({ characterId: "taki", role: index === 0 || index === 2 ? "assistant" : "user",
    content: index === 0 ? "I lost my job. My project stopped." : index === 1
      ? "I did not lose my job. My project also stopped."
      : index === 2 ? "The narrator and user each reported a stopped project; only the narrator reported job loss."
        : `Unrelated ordinary dialogue ${index}`,
    ...(index === 0 ? { sourceContext: { materials: [{ label: "Interview", speaker: "Narrator" }] } } : {}) });
  let generated = false;
  const model = generatingModel("I remember we discussed the interview narrator's job loss; the user did not report job loss.");
  const generate = model.doGenerate.bind(model);
  model.doGenerate = async (options) => { const value = await generate(options); generated = true; return value; };
  const range = timeline.rangeAscending.bind(timeline);
  const observed = { ...timeline, rangeAscending: (...args: Parameters<typeof range>): TimelineEntry[] => range(...args).map((entry) =>
    drift && generated && entry.sourceContext ? { ...entry, sourceContext: { materials: [{ speaker: "Changed speaker" }] } } : entry) };
  const operations = createCompactionOperationRepo(db); const logger = createCaptureLogger().logger;
  const pass = createCompactionPass({ timeline: observed, summaries, operations,
    view: { estimatedTokens: () => 900, budget: () => 100 },
    slot: createUtilitySlot({ mainModel: model, logger }), config: { triggerRatio: 0.8, keepMessages: 3 }, logger });
  return { db, timeline, summaries, model, pass };
}

it("supplies immutable source facts to the actual compactor and preserves its attributed record in later replay", async () => {
  const f = fixture(false); await f.pass.maybeRun("taki");
  expect(f.model.doGenerateCalls).toHaveLength(1);
  const prompt = JSON.stringify(f.model.doGenerateCalls[0]!.prompt);
  expect(prompt).toContain("Narrator"); expect(prompt).toContain("I lost my job.");
  expect(prompt).toContain("first-person narrator is the Companion");
  expect(prompt).toContain("I lost my job. My project stopped.");
  expect(prompt).toContain("I did not lose my job. My project also stopped.");
  expect(prompt).toContain("keep the source/person attached to each");
  expect(prompt).toContain("reported event and explicit negation");
  expect(prompt).toContain("A user's clarification does not retract another person's sourced event");
  expect(prompt).toContain("Do not invent a correction narrative from");
  const replay = createConversationStore({ repo: f.timeline, summaries: f.summaries }).history("taki");
  expect(JSON.stringify(replay)).toContain("interview narrator's job loss");
  expect(f.db.prepare("SELECT state FROM conversation_compaction_operations").get()?.state).toBe("committed");
});

it("refuses summary CAS when source facts differ between capture and the exact final reader", async () => {
  const f = fixture(true); await f.pass.maybeRun("taki");
  expect(f.model.doGenerateCalls).toHaveLength(1); expect(f.summaries.get("taki")).toBeNull();
  expect(f.db.prepare("SELECT state,failure_code FROM conversation_compaction_operations").get())
    .toMatchObject({ state: "failed", failure_code: "SOURCE_STALE" });
});
