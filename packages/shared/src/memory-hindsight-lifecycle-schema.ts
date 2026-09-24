/**
 * INPUT:  the live Hindsight connection state, B3 Bank rows, replica binding evidence and open lifecycle operations
 * OUTPUT: HindsightBankReadinessSchema and MemoryHindsightStatusSectionSchema (the memory.authority.status `hindsight` section)
 * POS:    shared/protocol — read-only lifecycle projection under Hindsight authority; actions are Core-derived, never client rules
 */
import { z } from "zod";
import { HindsightErrorCodeSchema } from "./hindsight-connection-schema.ts";

const Id = z.string().min(1).max(256);
const Timestamp = z.iso.datetime({ offset: true });

export const HindsightBankReadinessSchema = z.enum(["ready", "syncing", "provisioning", "failed", "not_provisioned"]);
export type HindsightBankReadiness = z.infer<typeof HindsightBankReadinessSchema>;

const BankSchema = z.strictObject({
  scope: z.enum(["global", "character"]),
  characterId: Id.nullable(),
  /** Null only for a Character whose identity cannot map to a native Bank id. */
  nativeBankId: z.string().min(1).max(120).nullable(),
  readiness: HindsightBankReadinessSchema,
  errorCode: HindsightErrorCodeSchema.nullable(),
});

export const MemoryHindsightStatusSectionSchema = z.strictObject({
  connection: z.strictObject({
    config: z.enum(["ready", "disabled", "unconfigured"]),
    drift: z.enum(["none", "config_changed", "unreviewed"]),
    admittedAt: Timestamp.nullable(),
  }),
  banks: z.array(BankSchema).max(256),
  actions: z.strictObject({ revalidate: z.boolean(), provision: z.array(Id).max(256) }),
}).superRefine((section, context) => {
  const fail = (message: string) => context.addIssue({ code: "custom", message });
  if (section.connection.config !== "ready" && (section.connection.drift !== "none" || section.connection.admittedAt !== null)) {
    fail("drift and admission evidence exist only for a ready connection");
  }
  const identities = section.banks.map((bank) => bank.scope === "global" ? "global" : `character:${bank.characterId}`);
  if (new Set(identities).size !== identities.length) fail("each Bank scope appears once");
  for (const bank of section.banks) {
    if ((bank.scope === "character") !== (bank.characterId !== null)) fail("Bank scope and Character binding disagree");
    if (bank.nativeBankId === null && bank.readiness !== "not_provisioned") fail("only an unprovisioned Bank lacks a native id");
    if (bank.errorCode !== null && (bank.readiness === "ready" || bank.readiness === "syncing")) fail("a serving Bank carries no setup error");
  }
  if (new Set(section.actions.provision).size !== section.actions.provision.length) fail("provision actions are unique");
});
export type MemoryHindsightStatusSection = z.infer<typeof MemoryHindsightStatusSectionSchema>;
