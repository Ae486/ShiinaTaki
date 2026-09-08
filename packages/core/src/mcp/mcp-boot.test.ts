import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApprovalInteractionService } from "../approval/approval-interaction-service.ts";
import { MIGRATIONS } from "../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../db/sqlite.ts";
import type { ExtensionChangeObserver } from "../extensions/notify-extension-change.ts";
import type { GovernancePolicyService } from "../governance/governance-policy-service.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";
import { createCaptureLogger } from "../testing/capture-logger.ts";
import { InMemoryTransport, memConnect } from "../testing/mcp-test-transport.ts";
import { bootMcpLifecycle, type McpBoot } from "./mcp-boot.ts";
import { defaultConnect } from "./mcp-connect.ts";

// The production transport constructor is never loaded by this boot fixture.
vi.mock("./mcp-connect.ts", () => ({ defaultConnect: vi.fn() }));

const OWNER = "11111111-1111-4111-8111-111111111111";
const REF = "mcp.srv.env.TOKEN";
const databases: Database[] = [];
const roots: string[] = [];
const boots: McpBoot[] = [];
afterEach(async () => {
  await Promise.allSettled(boots.splice(0).map((boot) => boot.manager.close()));
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.clearAllMocks();
});

function fixture(onChange?: ExtensionChangeObserver) {
  const dataDir = mkdtempSync(join(tmpdir(), "mcp-boot-change-")); roots.push(dataDir);
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  writeFileSync(join(dataDir, "mcp-servers.json"), JSON.stringify({ srv: { command: "fixture-only", env: { TOKEN: `secret-ref:${REF}` } } }));
  const values = new Map([[REF, "fixture-value"]]);
  const catalog = {
    resolve: (ref: string) => values.get(ref) ?? null,
    set: (ref: string, value: string) => { values.set(ref, value); return { present: true as const, provenance: { source: "catalog" as const, keyVersion: 1, updatedAt: "2026-09-08T00:00:00.000Z" } }; },
    clear: (ref: string) => { values.delete(ref); return { present: false as const }; },
  } as SecretCatalogService;
  const transport = new InMemoryTransport([{ name: "echo", inputSchema: { type: "object" } }], () => undefined);
  const transports = new Map([["srv", transport]]);
  vi.mocked(defaultConnect).mockImplementation(memConnect(transports));
  const boot = bootMcpLifecycle({
    db, dataDir, coreHostId: OWNER, secretCatalog: catalog, logger: createCaptureLogger().logger, onChange,
    // No governed tool executes in this catalog/publication-only fixture.
    governance: {} as GovernancePolicyService, approval: {} as ApprovalInteractionService,
  });
  boots.push(boot);
  return { boot, transport, transports };
}

describe("MCP boot producer wiring", () => {
  it("observes seed, boot candidates and asynchronous secret replacements through the same callback", async () => {
    const onChange = vi.fn<ExtensionChangeObserver>();
    const { boot, transport, transports } = fixture(onChange);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(["mcp"]);
    expect(defaultConnect).not.toHaveBeenCalled();
    await boot.manager.reconcile(boot.desired.list());
    expect(onChange.mock.calls.slice(1)).toEqual([[["mcp"]], [["mcp", "extension-status"]], [["mcp"]]]);
    const replacement = new InMemoryTransport([{ name: "search", inputSchema: { type: "object" } }], () => undefined);
    transports.set("srv", replacement);
    onChange.mockClear();
    expect(boot.catalog.set(REF, "fixture-replacement").present).toBe(true);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(["mcp"]);
    await vi.waitFor(() => expect(boot.manager.statuses()[0]).toMatchObject({ phase: "connected", runtimeGeneration: 2 }));
    expect(onChange.mock.calls.some(([targets]) => targets.includes("extension-status"))).toBe(true);
    expect(transport.closedCount).toBe(1);
    onChange.mockClear();
    expect(boot.catalog.clear(REF)).toEqual({ present: false });
    expect(boot.manager.statuses()[0]).toMatchObject({ phase: "failed", toolCount: 0, lastOutcome: { reason: "secret-unresolvable" } });
    expect(onChange.mock.calls.some(([targets]) => targets.includes("extension-status"))).toBe(true);
    expect(JSON.stringify(onChange.mock.calls)).not.toContain(REF);
    expect(defaultConnect).toHaveBeenCalledTimes(2);
  });

  it("does no transport work when boot has no observer and isolates a throwing seed observer", () => {
    const withoutObserver = fixture();
    expect(withoutObserver.boot.desired.list()).toHaveLength(1);
    expect(defaultConnect).not.toHaveBeenCalled();
    const onChange = vi.fn(() => { throw new Error("observer failure"); });
    const { boot } = fixture(onChange);
    expect(boot.desired.list()).toHaveLength(1);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(["mcp"]);
    expect(defaultConnect).not.toHaveBeenCalled();
  });
});
