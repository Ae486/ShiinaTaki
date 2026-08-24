import { describe, expect, it, vi } from "vitest";
import { HINDSIGHT_METHODS } from "@taki/shared";
import { createConfigRepo } from "../db/config-repo.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase } from "../db/sqlite.ts";
import { createConfigSource } from "../config/config-source.ts";
import { createLogger } from "../logging/logger.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";
import type { Connection } from "../server/connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../server/method-registry.ts";
import { composeHindsightSetup } from "./hindsight-setup-boot.ts";

describe("Hindsight setup boot", () => {
  it("registers status without resolving secrets or making network/provider calls", async () => {
    const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
    const resolve = vi.fn(() => null);
    const secrets = {
      resolve,
      presence: () => ({ secretRef: "memory.hindsight.connection.api-key", present: false, provenance: null, health: "locked" }),
    } as unknown as SecretCatalogService;
    const registry = createMethodRegistry();
    composeHindsightSetup({ db, config: createConfigSource({ env: {}, repo: createConfigRepo(db) }), secrets, registry, logger: createLogger("fatal") });
    const connection: Connection = { state: { status: "authenticated", deviceId: "d", role: "operator", capabilities: [] } };
    const ctx: MethodContext = { connection, notify: () => undefined, close: () => undefined, onClose: () => undefined };
    const response = await registry.dispatch({ jsonrpc: "2.0", id: 1, method: HINDSIGHT_METHODS.status, params: {} }, ctx);
    expect(response).toMatchObject({ result: { phase: "unconfigured", modelHealth: "not-run" } });
    expect(resolve).not.toHaveBeenCalled();
    db.close();
  });
});
