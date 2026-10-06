import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createHindsightClient, type HindsightTransport } from "./hindsight-client.ts";
import { applicationTestCompatibility } from "../../testing/hindsight-application-runtime-fixtures.ts";
import { APPLICATION_TEST_SCOPE } from "../../testing/hindsight-application-fixtures.ts";

function request() {
  return { namespace: APPLICATION_TEST_SCOPE.namespace,
    executor: { transition_id: randomUUID(), attempt_id: randomUUID(), generation: 1, fence_token: randomUUID() },
    descriptor: { body_id: randomUUID(), body_schema: "application-source.v1" as const, payload_hash: "a".repeat(64),
      bytes_sha256: "b".repeat(64), total_bytes: 1, total_parts: 1, part_bytes: 262_144 as const } };
}
describe("independent Source-evidence capability admission", () => {
  it.each(["missing", "version", "unsupported", "foreign"])("refuses %s support before the new upload route", async (kind) => {
    const body = request(); const manifest = applicationTestCompatibility();
    manifest.contracts.transitions = { version: "1.0.0", support: { state: "supported", reason: "all_contracts_available" } };
    if (kind !== "missing") manifest.contracts.transition_source_evidence = { version: kind === "version" ? "2.0.0" : "1.0.0",
      support: kind === "unsupported" ? { state: "unsupported", reason: "transition_source_evidence_unavailable" }
        : { state: "supported", reason: "all_contracts_available" } };
    if (kind === "foreign") manifest.provider.lineage = randomUUID();
    const transport = vi.fn<HindsightTransport>().mockResolvedValue({ status: 200, body: JSON.stringify(manifest) });
    const client = createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey: () => "owned", transport });
    await expect(client.uploadTransitionSourceBody!({ bankId: APPLICATION_TEST_SCOPE.bankId, request: body, context: { timeoutMs: 1000 } })).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1); expect(transport.mock.calls[0]?.[1]?.method).toBeUndefined();
    expect(String(transport.mock.calls[0]?.[0])).toContain("/ext/taki-memory/version");
  });
});
