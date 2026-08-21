import { describe, expect, it } from "vitest";
import { hindsightBankBindings } from "./hindsight-bank-identity.ts";
import { TAKI_BANK_TEMPLATE_REVISION, loadTakiBankTemplate, takiBankTemplateDigest } from "./taki-bank-template-v1.ts";

describe("Taki Hindsight Bank setup identity", () => {
  it("derives distinct deterministic opaque Global and Character ids", () => {
    const first = hindsightBankBindings("shiina-taki");
    expect(first).toEqual(hindsightBankBindings("shiina-taki"));
    expect(first[0].externalBankId).not.toBe(first[1].externalBankId);
    expect(first[1].externalBankId).not.toContain("shiina-taki");
  });

  it("ships an immutable schema-v1 secret-free additive template", () => {
    const template = loadTakiBankTemplate(TAKI_BANK_TEMPLATE_REVISION, "global");
    expect(template.takiTemplateRevision).toBe(TAKI_BANK_TEMPLATE_REVISION);
    expect(template.hindsightManifestVersion).toBe("1");
    expect(takiBankTemplateDigest(template)).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(template)).not.toMatch(/api[_-]?key|password|database_url|endpoint/i);
    expect(template.ownership.mentalModelIds).toHaveLength(1);
    expect(takiBankTemplateDigest(template)).not.toBe(takiBankTemplateDigest(loadTakiBankTemplate(TAKI_BANK_TEMPLATE_REVISION, "character")));
  });
});
