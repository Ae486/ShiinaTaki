/**
 * INPUT:  every packages/shared/fixtures/protocol/*.json golden fixture (valid + invalid instances)
 * OUTPUT: T2 — asserts each fixture parses/rejects under its prefix's zod schema, matching its filename validity tag
 * POS:    shared — the vitest half of the dual anti-drift contract (invariant 3); cargo test asserts the SAME files
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";
import { z } from "zod";
import { ErrorCodeSchema } from "./error-code-schema.ts";
import { JsonRpcClientFrameSchema, JsonRpcIdSchema } from "./json-rpc-schema.ts";
import { ConnectParamsSchema, ConnectResultSchema } from "./connect-schema.ts";
import {
  CapabilityChallengeSchema,
  CapabilityRequestSchema,
  CapabilityRespondParamsSchema,
  CapabilityResumeSchema,
} from "./capability-schema.ts";
import { CapabilityCancelSchema, CapabilityExecuteSchema, HostCatalogPublishParamsSchema, HostFrameAckSchema } from "./host-control-schema.ts";
import {
  LegacyPermissionCellSetParamsSchema,
  LegacyPermissionCellStateSchema,
  LegacyPermissionLevelStateSchema,
} from "./permission-level-schema.ts";
import {
  ClipboardReadOutputSchema,
  ClipboardWriteOutputSchema,
  ExecOutputSchema,
  ForegroundWindowOutputSchema,
  ProcessListOutputSchema,
  ScreenshotOutputSchema,
  ShellOpenOutputSchema,
} from "./capability-outputs.ts";

// The app-error frame is a JSON-RPC error response whose data carries a closed-union domain code — the
// stricter shape the node branches on (PAIRING_REQUIRED vs AUTH_FAILED). The generic envelope leaves data
// as unknown, so the fixture sweep validates it against this narrowed schema (mirrored by the serde AppErrorFrame).
const AppErrorFrameSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: JsonRpcIdSchema.nullable(),
  error: z.object({
    code: z.literal(-32000),
    message: z.string(),
    data: z.object({ code: ErrorCodeSchema }),
  }),
});

// Filename prefix (the dot-free head of `<prefix>.<label>.<valid|invalid>.json`) -> the schema that owns it.
// The cargo-test manifest maps the SAME prefixes to serde types; a divergence turns one side red.
const SCHEMA_BY_PREFIX: Record<string, ZodType> = {
  "connect-request": ConnectParamsSchema,
  "connect-result": ConnectResultSchema,
  "app-error": AppErrorFrameSchema,
  "client-frame": JsonRpcClientFrameSchema,
  "capability-request": CapabilityRequestSchema,
  "capability-execute": CapabilityExecuteSchema,
  "capability-challenge": CapabilityChallengeSchema,
  "capability-resume": CapabilityResumeSchema,
  "capability-cancel": CapabilityCancelSchema,
  "capability-respond": CapabilityRespondParamsSchema,
  "host-catalog-publish": HostCatalogPublishParamsSchema,
  "host-frame-ack": HostFrameAckSchema,
  // Per-capability output payloads (Option A): the channel treats `output` as opaque, so each capability's own
  // output schema owns its fixtures — the SAME files the cargo serde structs re-parse (anti-drift, invariant 3).
  "screenshot-output": ScreenshotOutputSchema,
  "process-list-output": ProcessListOutputSchema,
  "clipboard-read-output": ClipboardReadOutputSchema,
  "clipboard-write-output": ClipboardWriteOutputSchema,
  "shell-open-output": ShellOpenOutputSchema,
  "exec-output": ExecOutputSchema,
  "foreground-window-output": ForegroundWindowOutputSchema,
  // Permission Level config surface (T2b): leaf shapes only — enforced Shell-side too, so drift is a gate bug.
  "permission-level-state": LegacyPermissionLevelStateSchema,
  "permission-cell-state": LegacyPermissionCellStateSchema,
  "permission-cell-set": LegacyPermissionCellSetParamsSchema,
};

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/protocol", import.meta.url));

interface Fixture {
  file: string;
  prefix: string;
  valid: boolean;
  value: unknown;
}

function loadFixtures(): Fixture[] {
  return readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      const parts = file.replace(/\.json$/, "").split(".");
      const validity = parts.at(-1);
      return {
        file,
        prefix: parts[0] ?? "",
        valid: validity === "valid",
        value: JSON.parse(readFileSync(`${FIXTURE_DIR}/${file}`, "utf8")),
      };
    });
}

describe("protocol golden fixtures (T2)", () => {
  const fixtures = loadFixtures();

  it("discovers a non-trivial fixture set with both valid and invalid instances", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(12);
    expect(fixtures.some((f) => f.valid)).toBe(true);
    expect(fixtures.some((f) => !f.valid)).toBe(true);
  });

  for (const fixture of fixtures) {
    it(`${fixture.file} ${fixture.valid ? "parses" : "is rejected"}`, () => {
      const schema = SCHEMA_BY_PREFIX[fixture.prefix];
      if (!schema) throw new Error(`no schema mapped for prefix "${fixture.prefix}" (${fixture.file})`);
      expect(schema.safeParse(fixture.value).success).toBe(fixture.valid);
    });
  }
});
