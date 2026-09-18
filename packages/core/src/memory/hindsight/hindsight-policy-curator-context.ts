/**
 * INPUT:  Core authority/replica/Block readers, the durable work journal and common application writer
 * OUTPUT: narrow curator dependency, review and run-state contracts
 * POS:    core/memory/hindsight — one process Utility Slot; only the subsystem owns writer/sync lifecycle
 */
import type { CanonicalMemoryBank, MemoryReplicaBank } from "@taki/shared";
import type { MemoryConfig } from "../../config/memory-config.ts";
import type { HindsightPolicyConfig } from "../../config/hindsight-policy-config.ts";
import type { CanonicalMemoryAuthorityRepo } from "../../db/canonical-memory-authority-repo.ts";
import type { HindsightApplicationReplicaRepo } from "../../db/hindsight-application-replica-contract.ts";
import type { BlockScope, StructuredMemoryBlock } from "../../db/structured-memory-block-repo.ts";
import type { HindsightPolicyWorkRepo } from "../../db/hindsight-policy-work-repo.ts";
import type { HindsightPolicyWorkRecord, HindsightPolicyWorkScope, HindsightPolicyBlockSnapshot,
  HindsightPolicyPromptEvidence } from "../../db/hindsight-policy-work-contract.ts";
import type { UtilitySlot, UtilityUsage } from "../utility-slot.ts";
import type { HindsightApplicationWriter } from "./hindsight-application-writer.ts";
import type { HindsightCallContext } from "./hindsight-client.ts";
import type { HindsightPolicyCuratorDriver } from "./hindsight-policy-curator-model.ts";

export interface HindsightPolicyCuratorDeps {
  authority: Pick<CanonicalMemoryAuthorityRepo, "authorityEpoch">;
  replica: HindsightApplicationReplicaRepo;
  work: HindsightPolicyWorkRepo;
  writer: Pick<HindsightApplicationWriter, "prepare" | "get" | "run" | "applied">;
  slot: UtilitySlot;
  resolveBanks(characterId: string): readonly MemoryReplicaBank[];
  readBlock(blockId: string, scope: BlockScope): StructuredMemoryBlock | undefined;
  refreshBank(bankId: string, context: HindsightCallContext): Promise<void>;
  config(): { memory: MemoryConfig; policy: HindsightPolicyConfig };
  driver?: HindsightPolicyCuratorDriver;
  now?: () => string;
}
export interface HindsightPolicyCuratorOutcome {
  status: "clean" | "ran" | "failed";
  assessed: number; blocks: number; edits: number; pending: number; steps: number;
  usage: UtilityUsage;
}
export interface HindsightPolicyCuratorRun {
  deps: HindsightPolicyCuratorDeps;
  epochId: string; lineage: string; characterId: string;
  config: ReturnType<HindsightPolicyCuratorDeps["config"]>;
  signal: AbortSignal;
  stopped(): boolean;
  call(): HindsightCallContext;
  alive(): void;
  outcome: Omit<HindsightPolicyCuratorOutcome, "usage">;
}
export interface HindsightPolicyCuratorReview {
  run: HindsightPolicyCuratorRun;
  scope: HindsightPolicyWorkScope;
  bank: CanonicalMemoryBank;
  records: Map<string, HindsightPolicyWorkRecord>;
  blocks: HindsightPolicyBlockSnapshot[];
  prompt: HindsightPolicyPromptEvidence;
  finished: boolean;
  closed: boolean;
}
