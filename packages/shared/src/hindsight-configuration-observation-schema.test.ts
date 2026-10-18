import { expect, it } from "vitest";
import { HindsightConfigurationParamsSchema, HindsightObservedModelIdentifierSchema,
  HindsightObservedProfileSchema, HindsightConfigurationRefusalSchema } from "./hindsight-configuration-observation-schema.ts";

it("accepts safe aliases and rejects URI, path, controls, overflow and non-ASCII identifiers", () => {
  for (const alias of ["model", "org/model-v1:latest", "model@2026+preview", "x".repeat(240)]) {
    expect(HindsightObservedModelIdentifierSchema.safeParse(alias).success).toBe(true);
  }
  for (const alias of ["https://secret", "C:/private", "/private/model", "../private", "a\nb", "模型", "x".repeat(241)]) {
    expect(HindsightObservedModelIdentifierSchema.safeParse(alias).success).toBe(false);
  }
});

it("uses exact partial variants without hidden keys or arbitrary target inputs", () => {
  expect(HindsightObservedProfileSchema.parse({ kind: "disabled" })).toEqual({ kind: "disabled" });
  expect(HindsightObservedProfileSchema.parse({ kind: "unknown", reason: "routed_profile" })).toEqual({ kind: "unknown", reason: "routed_profile" });
  for (const profile of [{ kind: "single", provider: "custom", configuredModel: "x" },
    { kind: "unknown", reason: "routed_profile", members: [] }, { kind: "disabled", apiKey: "secret" }]) {
    expect(HindsightObservedProfileSchema.safeParse(profile).success).toBe(false);
  }
  expect(HindsightConfigurationParamsSchema.safeParse({ scope: { kind: "global" }, endpoint: "http://other" }).success).toBe(false);
  expect(HindsightConfigurationRefusalSchema.safeParse({ error: "taki_configuration_observation_refused", reason: "unavailable", message: "secret" }).success).toBe(false);
});
