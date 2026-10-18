/**
 * INPUT:  Core-owned Bank identity and explicit user customization documents
 * OUTPUT: strict independent user revisions and enrollment identity; Native wire shapes are reused
 * POS:    Core overlay domain/storage boundary, not a second public protocol or operation journal
 */
import { z } from "zod";
import { HindsightTemplateTargetSchema, MemoryTemplateUserRevisionSchema } from "@taki/shared";
import { hindsightBankBindings } from "../hindsight-bank-identity.ts";

export const TemplateBankIdentitySchema = z.strictObject({
  target: HindsightTemplateTargetSchema, scope: z.enum(["global", "character"]),
  canonicalIdentity: z.string().min(1).max(170),
}).refine((value) => {
  const character = value.scope === "character" ? value.canonicalIdentity.slice(10) : "unused";
  if (value.scope === "character" && (!value.canonicalIdentity.startsWith("character:") || !character || character.length > 160)) return false;
  const bank = hindsightBankBindings(character)[value.scope === "global" ? 0 : 1];
  return bank.canonicalIdentity === value.canonicalIdentity && bank.externalBankId === value.target.bank_id;
}, "noncanonical Bank identity");
export type TemplateBankIdentity = z.infer<typeof TemplateBankIdentitySchema>;

export const TemplateUserRevisionSchema = MemoryTemplateUserRevisionSchema;
export type TemplateUserRevision = z.infer<typeof TemplateUserRevisionSchema>;
export function emptyTemplateUserRevision(): TemplateUserRevision {
  return { revision: 0, config: [], labels: [], models: [], directives: [] };
}
