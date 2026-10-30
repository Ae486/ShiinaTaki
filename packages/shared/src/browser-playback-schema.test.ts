import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BrowserAttachmentFrameSchema, BrowserPlaybackAckSchema, BrowserPlaybackReportSchema, BrowserPlaybackSampleSchema } from "./browser-playback-schema.ts";

const sample = { state: "playing", positionSeconds: 1, durationSeconds: 299.3, playbackRate: 1,
  visible: true, pictureInPicture: false };
const report = { schemaVersion: "taki.browser-playback.v1", catalogGeneration: 1,
  attachmentId: randomUUID(), attachmentGeneration: 1, sequence: 1, kind: "sample",
  source: { tabId: 1, frameId: 0, documentId: randomUUID(), playerId: randomUUID(),
    media: { kind: "bilibili", bvid: "BV1UEaq6qEZt", cid: "42265479965", page: 1 } }, sample, observedAgeMs: 0 };

describe("browser playback wire contract", () => {
  const directory = fileURLToPath(new URL("../fixtures/browser-playback/", import.meta.url));
  it.each(readdirSync(directory).filter((name) => name.endsWith(".json")))("matches the shared Shell fixture %s", (name) => {
    const value: unknown = JSON.parse(readFileSync(`${directory}/${name}`, "utf8"));
    expect(BrowserAttachmentFrameSchema.safeParse(value).success).toBe(name.endsWith(".valid.json"));
  });
  it("round-trips a selected sample and keeps unavailable numeric evidence unknown", () => {
    expect(BrowserPlaybackReportSchema.parse(report)).toEqual(report);
    expect(BrowserPlaybackSampleSchema.parse({ ...sample, positionSeconds: null, durationSeconds: null,
      playbackRate: null })).toMatchObject({ positionSeconds: null, durationSeconds: null, playbackRate: null });
  });
  it("preserves Chromium's opaque 32-hex document token without treating it as a player UUID", () => {
    const documentId = "65AC7F3F61AF6FF1EA1451137F00A91B";
    const chromium = { ...report, source: { ...report.source, documentId } };
    expect(BrowserPlaybackReportSchema.parse(chromium)).toEqual(chromium);
    expect(BrowserPlaybackReportSchema.safeParse({ ...chromium, source: { ...chromium.source, playerId: documentId } }).success).toBe(false);
    for (const invalid of ["", documentId.slice(1), `${documentId}F`, `Z${documentId.slice(1)}`, ` ${documentId}`]) {
      expect(BrowserPlaybackReportSchema.safeParse({ ...chromium, source: { ...chromium.source, documentId: invalid } }).success).toBe(false);
    }
  });
  it.each([NaN, Infinity, -Infinity, -1])("rejects invalid timing %s", (positionSeconds) => {
    expect(BrowserPlaybackSampleSchema.safeParse({ ...sample, positionSeconds }).success).toBe(false);
  });
  it("rejects forged authority and exact media identity gaps", () => {
    for (const extra of [{ hostId: randomUUID() }, { accepted: true }, { token: "secret" }]) {
      expect(BrowserPlaybackReportSchema.safeParse({ ...report, ...extra }).success).toBe(false);
    }
    expect(BrowserPlaybackReportSchema.safeParse({ ...report, source: { ...report.source,
      media: { ...report.source.media, cid: null } } }).success).toBe(false);
    expect(BrowserPlaybackSampleSchema.safeParse({ ...sample, positionSeconds: 300 }).success).toBe(false);
  });
  it("retirement carries only the original attachment identity and sequence", () => {
    const retired = { schemaVersion: report.schemaVersion, catalogGeneration: 1, attachmentId: report.attachmentId,
      attachmentGeneration: 1, sequence: 2, kind: "retired" };
    expect(BrowserPlaybackReportSchema.parse(retired)).toEqual(retired);
    expect(BrowserPlaybackReportSchema.safeParse({ ...retired, sample }).success).toBe(false);
    expect(BrowserPlaybackAckSchema.parse({ accepted: false, reason: "stale_source" })).toEqual({ accepted: false, reason: "stale_source" });
  });
});
