/**
 * INPUT:  a Taki canonical Global or Character Bank scope
 * OUTPUT: stable canonical identity plus opaque versioned Hindsight Bank ID
 * POS:    core/memory/hindsight — provider binding seam; raw Character IDs never become remote Bank IDs
 */
import { createHash } from "node:crypto";

export interface HindsightBankBinding {
  scope: "global" | "character";
  canonicalIdentity: string;
  externalBankId: string;
}

export function hindsightBankBindings(characterId: string): [HindsightBankBinding, HindsightBankBinding] {
  if (characterId.length < 1 || characterId.length > 160) throw new Error("invalid Character identity");
  return [binding("global", "global"), binding("character", `character:${characterId}`)];
}

function binding(scope: HindsightBankBinding["scope"], canonicalIdentity: string): HindsightBankBinding {
  const digest = createHash("sha256").update(`taki-hindsight-bank-v1\0${canonicalIdentity}`).digest("hex").slice(0, 32);
  return { scope, canonicalIdentity, externalBankId: `taki-hs-v1-${scope === "global" ? "g" : "c"}-${digest}` };
}
