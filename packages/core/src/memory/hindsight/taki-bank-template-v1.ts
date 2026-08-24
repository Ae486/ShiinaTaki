/**
 * INPUT:  the configured Taki template revision and an exported Hindsight Bank Template projection
 * OUTPUT: immutable v1 template/digest plus verification of only Taki-owned fields
 * POS:    core/memory/hindsight — trusted repository configuration; credentials and infrastructure never enter it
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  HindsightBankTemplateManifestSchema,
  type HindsightBankTemplateManifest,
} from "./hindsight-contracts.ts";
import { hindsightError } from "./hindsight-errors.ts";

export const TAKI_BANK_TEMPLATE_REVISION = "taki-bank-v1" as const;

const TemplateSchema = z.strictObject({
  takiTemplateRevision: z.literal(TAKI_BANK_TEMPLATE_REVISION),
  hindsightManifestVersion: z.literal("1"),
  ownership: z.strictObject({
    configKeys: z.array(z.string()).max(16),
    mentalModelIds: z.array(z.string()).max(16),
    directiveNames: z.array(z.string()).max(16),
  }),
  manifest: HindsightBankTemplateManifestSchema,
});

export type TakiHindsightBankTemplate = z.infer<typeof TemplateSchema>;

export function loadTakiBankTemplate(revision: string, scope: "global" | "character"): TakiHindsightBankTemplate {
  if (revision !== TAKI_BANK_TEMPLATE_REVISION) throw hindsightError("HINDSIGHT_TEMPLATE_INVALID");
  return templateFor(scope);
}

function templateFor(scope: "global" | "character"): TakiHindsightBankTemplate {
  const relation = scope === "global" ? "user-wide continuity across Characters" : "this Character-user relationship";
  const suffix = scope === "global" ? "global" : "character";
  return TemplateSchema.parse({
    takiTemplateRevision: TAKI_BANK_TEMPLATE_REVISION,
    hindsightManifestVersion: "1",
    ownership: {
      configKeys: ["retain_mission", "observations_instructions", "reflect_mission"],
      mentalModelIds: [`taki-${suffix}-continuity-v1`],
      directiveNames: [`taki-${suffix}-memory-policy-v1`],
    },
    manifest: {
      version: "1",
      bank: {
        retain_mission: `Extract durable facts, preferences, experiences, intentions, and corrections that belong to ${relation}. Preserve source meaning and avoid inventing details.`,
        observations_instructions: `Synthesize only durable observations supported by source facts for ${relation}. Preserve uncertainty and provenance.`,
        reflect_mission: `Use durable memories to support ${relation} without crossing its ownership boundary.`,
      },
      mental_models: [{
        id: `taki-${suffix}-continuity-v1`,
        name: scope === "global" ? "Taki Global Continuity" : "Taki Character Relationship",
        source_query: `What durable patterns and corrections should guide ${relation}?`,
        tags: ["taki-owned", `taki-scope:${scope}`],
        max_tokens: 1024,
      }],
      directives: [{
        name: `taki-${suffix}-memory-policy-v1`,
        content: "Respect Taki Memory Layer ownership and visibility metadata. Treat unclassified memory conservatively and never invent provenance.",
        priority: 100,
        is_active: true,
        tags: ["taki-owned", "taki-template-v1", `taki-scope:${scope}`],
      }],
    },
  });
}

export function takiBankTemplateDigest(template: TakiHindsightBankTemplate): string {
  return createHash("sha256").update(canonicalJson(TemplateSchema.parse(template))).digest("hex");
}

export function verifyTakiBankTemplate(
  exported: HindsightBankTemplateManifest,
  template: TakiHindsightBankTemplate,
): void {
  const actual = HindsightBankTemplateManifestSchema.parse(exported);
  if (actual.version !== template.hindsightManifestVersion) throw hindsightError("HINDSIGHT_TEMPLATE_INVALID");
  verifyOwnedConfig(actual, template);
  verifyOwnedDirectives(actual, template);
  verifyOwnedMentalModels(actual, template);
}

function verifyOwnedConfig(actual: HindsightBankTemplateManifest, template: TakiHindsightBankTemplate): void {
  const actualBank = actual.bank ?? {};
  const expectedBank = template.manifest.bank ?? {};
  for (const key of template.ownership.configKeys) {
    if (canonicalJson(actualBank[key]) !== canonicalJson(expectedBank[key])) {
      throw hindsightError("HINDSIGHT_TEMPLATE_INVALID");
    }
  }
}

function verifyOwnedDirectives(actual: HindsightBankTemplateManifest, template: TakiHindsightBankTemplate): void {
  const actualByName = new Map((actual.directives ?? []).map((item) => [item.name, item]));
  const expectedByName = new Map((template.manifest.directives ?? []).map((item) => [item.name, item]));
  for (const name of template.ownership.directiveNames) {
    const actualItem = actualByName.get(name);
    const expectedItem = expectedByName.get(name);
    if (!actualItem || !expectedItem || canonicalJson(projectDirective(actualItem)) !== canonicalJson(projectDirective(expectedItem))) {
      throw hindsightError("HINDSIGHT_TEMPLATE_INVALID");
    }
  }
}

function verifyOwnedMentalModels(actual: HindsightBankTemplateManifest, template: TakiHindsightBankTemplate): void {
  const actualById = new Map((actual.mental_models ?? []).map((item) => [item.id, item]));
  const expectedById = new Map((template.manifest.mental_models ?? []).map((item) => [item.id, item]));
  for (const id of template.ownership.mentalModelIds) {
    const actualItem = actualById.get(id);
    const expectedItem = expectedById.get(id);
    if (!actualItem || !expectedItem || canonicalJson(projectMentalModel(actualItem)) !== canonicalJson(projectMentalModel(expectedItem))) {
      throw hindsightError("HINDSIGHT_TEMPLATE_INVALID");
    }
  }
}

function projectDirective(value: Record<string, unknown>): unknown {
  return { name: value.name, content: value.content, priority: value.priority ?? 0, is_active: value.is_active ?? true, tags: value.tags ?? [] };
}

function projectMentalModel(value: Record<string, unknown>): unknown {
  return { id: value.id, name: value.name, source_query: value.source_query, tags: value.tags ?? [], max_tokens: value.max_tokens ?? 2048 };
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}
