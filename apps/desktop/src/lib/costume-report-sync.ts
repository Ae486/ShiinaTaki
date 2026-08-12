/**
 * INPUT:  committed costume ids and the outcome of avatar.report attempts from switch/reconnect paths.
 * OUTPUT: a window-local observable tracker for pending, recovery-needed, and synchronized costume reports.
 * POS:    ui/lib - non-authoritative D61 synchronization health; the live PetScene remains presentation truth.
 */

export type CostumeReportSource = "switch" | "reconnect";

export type CostumeReportSyncState =
  | { kind: "idle" }
  | { kind: "pending"; costumeId: string; source: CostumeReportSource }
  | { kind: "recovery-needed"; costumeId: string; source: CostumeReportSource; message: string }
  | { kind: "synced"; costumeId: string; source: CostumeReportSource };

export interface CostumeReportTicket {
  readonly id: number;
  readonly costumeId: string;
  readonly source: CostumeReportSource;
}

export interface CostumeReportSyncTracker {
  snapshot(): CostumeReportSyncState;
  subscribe(listener: (state: CostumeReportSyncState) => void): () => void;
  begin(costumeId: string, source: CostumeReportSource): CostumeReportTicket;
  synchronized(ticket: CostumeReportTicket): void;
  recoveryNeeded(ticket: CostumeReportTicket, cause: unknown): void;
}

type TransitionListener = (next: CostumeReportSyncState, previous: CostumeReportSyncState) => void;

export function createCostumeReportSyncTracker(onTransition?: TransitionListener): CostumeReportSyncTracker {
  let sequence = 0;
  let activeTicket = 0;
  let state: CostumeReportSyncState = { kind: "idle" };
  const listeners = new Set<(state: CostumeReportSyncState) => void>();

  const publish = (next: CostumeReportSyncState): void => {
    const previous = state;
    state = next;
    onTransition?.(next, previous);
    for (const listener of [...listeners]) listener(next);
  };

  return {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    begin(costumeId, source) {
      const ticket = { id: ++sequence, costumeId, source };
      activeTicket = ticket.id;
      publish({ kind: "pending", costumeId, source });
      return ticket;
    },
    synchronized(ticket) {
      if (ticket.id !== activeTicket) return;
      publish({ kind: "synced", costumeId: ticket.costumeId, source: ticket.source });
    },
    recoveryNeeded(ticket, cause) {
      if (ticket.id !== activeTicket) return;
      publish({
        kind: "recovery-needed",
        costumeId: ticket.costumeId,
        source: ticket.source,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    },
  };
}

export const costumeReportSync = createCostumeReportSyncTracker((next, previous) => {
  if (next.kind === "recovery-needed") {
    console.warn(`[pet] committed costume ${next.costumeId} report needs recovery: ${next.message}`);
  } else if (next.kind === "synced" && previous.kind === "recovery-needed") {
    console.info(`[pet] committed costume ${next.costumeId} report recovered via ${next.source}`);
  }
});
