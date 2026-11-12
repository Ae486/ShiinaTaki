import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { coWatchingInput } from "../testing/co-watching-fixture.ts";
import { createCoWatchingCatalog } from "./analysis-catalog.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "co-watching-catalog-")); roots.push(root);
  const path = join(root, "catalog.json"); const { analysis } = coWatchingInput();
  const input = { analysisId: analysis.analysisId, title: analysis.title, media: analysis.media,
    serverId: analysis.serverId, native: analysis.native, expectedRevision: 0 };
  return { path, input, catalog: createCoWatchingCatalog(path) };
}
describe("bounded operator reference catalog", () => {
  it("persists before publishing and enforces CAS across update/remove with defensive reads", () => {
    const f = fixture(); const created = f.catalog.register(f.input);
    expect(createCoWatchingCatalog(f.path).get(created.analysisId)).toEqual(created);
    expect(() => f.catalog.register(f.input)).toThrow("CO_WATCHING_CATALOG_CONFLICT");
    const copy = f.catalog.list(); copy[0]!.title = "mutated"; expect(f.catalog.list()[0]?.title).toBe(f.input.title);
    expect(f.catalog.register({ ...f.input, expectedRevision: 1 }).revision).toBe(1);
    expect(f.catalog.register({ ...f.input, expectedRevision: 1, title: "updated" }).revision).toBe(2);
    expect(() => f.catalog.remove(created.analysisId, 1)).toThrow("CO_WATCHING_CATALOG_CONFLICT");
    f.catalog.remove(created.analysisId, 2); expect(createCoWatchingCatalog(f.path).list()).toEqual([]);
  });
  it("fails closed on duplicate persisted identities", () => {
    const f = fixture(); f.catalog.register(f.input); const file = JSON.parse(readFileSync(f.path, "utf8"));
    file.entries.push(file.entries[0]); writeFileSync(f.path, JSON.stringify(file));
    expect(() => createCoWatchingCatalog(f.path)).toThrow("CO_WATCHING_CATALOG_INVALID");
  });
  it("replaces only the latest matching request while preserving both original references", () => {
    const f = fixture(); const input = { media: f.input.media, serverId: f.input.serverId };
    const first = f.catalog.reserve(input).request;
    const next = f.catalog.reserve({ ...input, replaceRequestId: first.requestId }).request;
    expect(next.requestId).not.toBe(first.requestId);
    expect(() => f.catalog.reserve({ ...input, replaceRequestId: first.requestId })).toThrow("CO_WATCHING_CATALOG_CONFLICT");
    const restored = createCoWatchingCatalog(f.path);
    expect(restored.request(first.analysisId)).toEqual(first);
    expect(restored.reserve(input)).toEqual({ request: next, created: false });
  });
});
