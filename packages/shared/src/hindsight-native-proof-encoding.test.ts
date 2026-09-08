import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HindsightTrackedMutationRequestSchema, HindsightTrackedRetainRequestSchema } from "./hindsight-native-result-schema.ts";
import { nativeMutationRequestFields, nativeNormalizedTime, nativeProofJson, nativeRetainRequestFields, nativeStringPairs } from "./hindsight-native-proof-encoding.ts";

const identity = { contract_version: "1.0.0", operation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  provider_lineage: "11111111-1111-4111-8111-111111111111", bank_generation: "22222222-2222-4222-8222-222222222222" };
const hash = (fields: unknown) => createHash("sha256").update(nativeProofJson(fields), "utf8").digest("hex");

describe("G1 portable Python/TypeScript request hash vectors", () => {
  it("matches the native frozen retain vector including UTF-8 key order, defaults and microseconds", () => {
    const request = HindsightTrackedRetainRequestSchema.parse({ ...identity, document_tags: ["document-tag"], items: [{
      content: "Alice ☕\n第二行", timestamp: "2026-09-07T13:14:15.1234+08:00", context: null, document_id: "source",
      metadata: { "2": "二", "10": "十", "\ue000": "BMP", "\u{10000}": "astral" },
      entities: [{ text: "Alice", type: null }, { text: "taki-layer:profile", type: "CONCEPT" }], tags: ["a", "b"],
      observation_scopes: [["global", "taki"]], strategy: "", update_mode: "append",
    }] });
    expect(hash(nativeRetainRequestFields("memory/中文", request))).toBe("fe427ac833736262ceba68cda0a47671be750dd4810114672d863d582af2bdca");
    const minimal = HindsightTrackedRetainRequestSchema.parse({ ...identity, items: [{ content: "A" }] });
    expect(hash(nativeRetainRequestFields("memory/中文", minimal))).toBe("8ab2cb6f39423d90d7ea367dac970d9e42d4650f4df14da419755311c15e834a");
  });

  it("fingerprints wire entities and distinguishes explicit clear from omitted dates", () => {
    const request = HindsightTrackedMutationRequestSchema.parse({ ...identity, mutation: { text: " 修订😀", context: "",
      entities: [" Alice ", "alice", "", "\u001cBob\u001c", "\ufeffCharlie\ufeff"], occurred_start: null,
      occurred_end: "2026-09-07T00:00:00+08:00", fact_type: "experience", expected_revision: 4, mutation_id: identity.operation_id } });
    const fields = () => nativeMutationRequestFields({ bankId: "memory/中文", memoryId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", request });
    const original = hash(fields());
    expect(original).toBe("67855e3d9b871d5fecbe17babc2667fa5f6445714fdaa2ddf5b4a4f80593e9a3");
    delete request.mutation.occurred_start;
    expect(hash(fields())).not.toBe(original);
  });

  it("preserves native timestamp precision and refuses ambiguous portable values", () => {
    expect(nativeNormalizedTime("2026-09-07T13:14:15.1234+08:00")).toBe("2026-09-07T05:14:15.123400Z");
    expect(nativeStringPairs({ "2": "two", "10": "ten", "\ue000": "bmp", "\u{10000}": "astral" }).map(([key]) => key))
      .toEqual(["10", "2", "\ue000", "\u{10000}"]);
    for (const value of ["\ud800", "\udfff", NaN, Infinity, 1.25, Number.MAX_SAFE_INTEGER + 1, { untyped: "object" }]) {
      expect(() => nativeProofJson(["vector.v1", value])).toThrow("HINDSIGHT_NATIVE_RESULT_INVALID");
    }
  });

  it("fingerprints original wire entities independently of runtime Unicode case mappings", () => {
    const entities = ["\u1c89", "\u1c8a", "\u{10d50}", "\u{10d70}", " Alice ", "alice", ""];
    const request = HindsightTrackedMutationRequestSchema.parse({ ...identity, mutation: { entities, expected_revision: 4 } });
    const fields = nativeMutationRequestFields({ bankId: "memory/中文", memoryId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", request });
    expect(hash(fields)).toBe("735043973bdf7f2cb8e75753ec10d9561b4c196b5ebb29368563e98eb0211a56");
    expect(fields[12]).toEqual(entities);
  });
});
