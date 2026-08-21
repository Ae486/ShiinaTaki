import { describe, expect, it } from "vitest";
import { createConfigRepo } from "../db/config-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase } from "../db/sqlite.ts";
import { createConfigSource } from "./config-source.ts";
import { resolveHindsightConfig } from "./hindsight-config.ts";

describe("Hindsight config", () => {
  it("follows env > stored > default and remains unconfigured without an endpoint", () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    const repo = createConfigRepo(db);
    expect(resolveHindsightConfig(createConfigSource({ env: {}, repo })).state).toBe("disabled");
    repo.upsert("TAKI_HINDSIGHT_ENABLED", true);
    expect(resolveHindsightConfig(createConfigSource({ env: {}, repo })).state).toBe("unconfigured");
    repo.upsert("TAKI_HINDSIGHT_ENDPOINT", "http://stored:8888");
    const resolved = resolveHindsightConfig(createConfigSource({ env: { TAKI_HINDSIGHT_ENDPOINT: "http://env:8888" }, repo }));
    expect(resolved.projection?.endpoint).toBe("http://env:8888");
    expect(resolved.projection?.apiKeySecretRef).toBe("memory.hindsight.connection.api-key");
    db.close();
  });
});
