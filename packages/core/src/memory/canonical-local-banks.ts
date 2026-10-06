/**
 * INPUT:  active Local authority and a trusted Character identity
 * OUTPUT: existing or newly initialized Global/Character Bank pair
 * POS:    core/memory — Local scope initialization; never creates or activates a Hindsight Bank
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { CanonicalMemoryBank } from "@taki/shared";
import type { CanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import type { CanonicalLocalWriteFence } from "./canonical-local-write-fence.ts";

const CharacterId = z.string().min(1).max(256);
export interface CanonicalLocalBanks { global: CanonicalMemoryBank; character: CanonicalMemoryBank; }

export function ensureCanonicalLocalBanks(input: {
  authority: CanonicalMemoryAuthorityRepo;
  epochId: string;
  characterId: string;
  writeFence?: CanonicalLocalWriteFence;
}): CanonicalLocalBanks {
  CharacterId.parse(input.characterId);
  input.authority.activeEpoch(input.epochId);
  const banks = input.authority.listBanks(input.epochId);
  if (input.writeFence && (!banks.some((bank) => bank.scope.kind === "global")
    || !banks.some((bank) => bank.scope.kind === "character" && bank.scope.characterId === input.characterId))) {
    return input.writeFence.admitSync(() => ensureCanonicalLocalBanks({ ...input, writeFence: undefined }));
  }
  // Existing Bank identity/configuration always wins. These neutral defaults match canonical migration's
  // Local initialization and apply only when a newly created Character has no Bank yet.
  const global = banks.find((bank) => bank.scope.kind === "global") ?? input.authority.createBank({
    authorityEpochId: input.epochId, bankId: randomUUID(), scope: { kind: "global", characterId: null },
    name: "Global Memory", disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "Preserve canonical Taki memory", config: {},
  });
  const character = banks.find((bank) => bank.scope.kind === "character" && bank.scope.characterId === input.characterId)
    ?? input.authority.createBank({ authorityEpochId: input.epochId, bankId: randomUUID(),
      scope: { kind: "character", characterId: input.characterId }, name: input.characterId,
      disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "Preserve canonical Taki memory", config: {} });
  return { global, character };
}
