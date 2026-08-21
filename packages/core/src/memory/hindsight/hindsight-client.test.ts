import { describe, expect, it, vi } from "vitest";
import { createHindsightClient, type HindsightTransport } from "./hindsight-client.ts";

const key = "hindsight-test-secret";
const manifest = {
  base_api_version: "0.9.0", compatibility_version: "1.0.0",
  source_identity: { upstream_commit: "abc", compatibility_build: "taki-memory-hindsight-0.9.0-batch0-v2" },
  provider: { lineage: "11111111-1111-4111-8111-111111111111", database_dialect: "postgresql", storage_mode: "sql_rows" },
  support: { state: "supported", reason: "all_contracts_available" },
  journal: { schema_version: 1, retention_mode: "operator_managed_cursor_floor", cursor_reset_supported: true },
  snapshot: { schema_version: 1, default_page_size: 1, max_page_size: 10, default_ttl_seconds: 60, max_ttl_seconds: 120 },
  contracts: Object.fromEntries(["change_journal", "conditional_mutation", "logical_snapshot", "additive_observation_instructions", "controlled_layer_projection"].map((name) => [name, { version: "1.0.0", support: { state: "supported", reason: "all_contracts_available" } }])),
};

function client(transport: HindsightTransport, resolveApiKey: () => string | null = () => key) {
  return createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey, transport });
}
const context = { timeoutMs: 1_000 };

describe("Hindsight client", () => {
  it("sends Bearer authentication on every read-only connection check", async () => {
    const transport = vi.fn<HindsightTransport>(async () => ({ status: 200, body: JSON.stringify(manifest) }));
    await client(transport).compatibility(context);
    expect(transport.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: `Bearer ${key}` });
  });

  it("refuses a missing key before calling transport", async () => {
    const transport = vi.fn<HindsightTransport>();
    await expect(client(transport, () => null).health(context)).rejects.toMatchObject({ code: "HINDSIGHT_SECRET_UNAVAILABLE" });
    expect(transport).not.toHaveBeenCalled();
  });

  it("isolates the known OpenAPI template body exception with dry_run", async () => {
    const transport = vi.fn<HindsightTransport>(async () => ({ status: 200, body: JSON.stringify({ bank_id: "b", config_applied: true, dry_run: true }) }));
    await client(transport).importTemplate({ bankId: "b", template: { version: "1", directives: [{ name: "taki", content: "only owned" }] }, dryRun: true, context });
    const [url, init] = transport.mock.calls[0] ?? [];
    expect(String(url)).toContain("/import?dry_run=true");
    expect(init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(String(init?.body)).toContain("only owned");
  });

  it("maps auth and malformed response failures without leaking the key", async () => {
    const unauthorized = async () => ({ status: 401, body: '{"detail":"bad"}' });
    await expect(client(unauthorized).health(context)).rejects.toMatchObject({ code: "HINDSIGHT_AUTHENTICATION_FAILED" });
    const broken = async () => ({ status: 200, body: "<html>provider said no</html>" });
    await expect(client(broken).health(context)).rejects.toMatchObject({ code: "HINDSIGHT_RESPONSE_INVALID" });
  });

  it("normalizes status-only LLM health without provider configuration", async () => {
    const transport = async () => ({ status: 200, body: JSON.stringify({ bank_id: "b", operations: [{ operation: "retain", ok: true, status: "connected", latency_ms: 1 }] }) });
    await expect(client(transport).bankLlmHealth("b", context)).resolves.toEqual({ bankId: "b", operations: [{ operation: "retain", ok: true, status: "connected", latencyMs: 1 }] });
  });

  it("polls operation status without including unstable result metadata", async () => {
    const transport = async () => ({ status: 200, body: JSON.stringify({ operation_id: "op-1", status: "completed", result_metadata: { private: "ignored" } }) });
    await expect(client(transport).operationStatus("b", "op-1", context)).resolves.toEqual({ operationId: "op-1", status: "completed" });
  });
});
