/**
 * INPUT:  the trusted primary custody repo, the Timeline repo and the store's post-commit append/remove observers
 * OUTPUT: createPrimaryPersistence -> per-turn { writer, finalize } whose appends enroll exact members in one transaction
 * POS:    core/agents — the only path that opens a primary group; Chat's turn loop owns begin/finalize, nothing else enrolls
 */
import type { PrimaryMemoryCustody, PrimaryTimelineWriter } from "../db/primary-memory-custody-repo.ts";
import type { TimelineRepo } from "../db/timeline-repo.ts";
import { createConversationWriter, type ConversationWriter, type ConversationWriterDeps } from "./conversation-writer.ts";

export interface PrimaryTurnPersistence {
  writer: ConversationWriter;
  repo: PrimaryTimelineWriter;
  atomic(work: () => void): void;
  onAppend?: ConversationWriterDeps["onAppend"];
  onRemove?: ConversationWriterDeps["onRemove"];
  /** Idempotent terminal notice: finalizes retained members (user-only included), no-op after a silent retraction. */
  finalize(): void;
}
export interface PrimaryPersistence {
  begin(input: { characterId: string; runId?: string }): PrimaryTurnPersistence;
}

export function createPrimaryPersistence(input: Omit<ConversationWriterDeps, "repo"> & {
  custody: PrimaryMemoryCustody; repo: TimelineRepo; atomic(work: () => void): void;
}): PrimaryPersistence {
  return {
    begin: (turn) => {
      const session = input.custody.begin({ ...turn, repo: input.repo });
      return { repo: session.repo, atomic: input.atomic, onAppend: input.onAppend, onRemove: input.onRemove,
        writer: createConversationWriter({ repo: session.repo, onAppend: input.onAppend, onRemove: input.onRemove }),
        finalize: session.finalize };
    },
  };
}
