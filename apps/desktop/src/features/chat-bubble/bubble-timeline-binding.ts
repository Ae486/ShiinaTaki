/**
 * INPUT: a current Pet connection's ordinary Timeline append/commit/removal channel
 * OUTPUT: latest bounded committed language, including autonomous speech, without opening the bubble
 * POS: ui/chat-bubble — canonical read binding independent of segmented foreground activity recovery
 */
import { ACTIVE_CHARACTER_ID } from "@/lib/active-character.js";
import type { ConnectionGenerationContext } from "@/lib/connection-generation-controller.js";
import type { WsClient } from "@/lib/ws-client.js";
import type { TimelineEntry } from "@taki/shared";
import { sharedPresentationGate, type PresentationGate } from "@/lib/presentation-gate.js";
import { projectCommittedBubble, type CommittedBubble } from "./bubble-committed-timeline.ts";
import { useChatBubbleStore } from "./chat-bubble-store.ts";
import { bubbleVisibility, type BubbleVisibilitySource } from "./bubble-visibility.ts";

export type BubbleTimelineClient = Pick<WsClient, "onTimelineAppended" | "onTimelineCommitted" | "onTimelineRemoved" | "timelineHistory" | "onClose">;
interface PresentationInput { gate?: PresentationGate; visibility?: BubbleVisibilitySource }

export class BubbleTimelineBinding {
  private readonly client: BubbleTimelineClient;
  private readonly context: ConnectionGenerationContext;
  private disposed = false;
  private epoch = 0;
  private latest: CommittedBubble | null = null;
  private readonly rows = new Map<number, TimelineEntry>();
  private readonly removed = new Set<number>();
  private readonly gate: PresentationGate;
  private readonly visibility: BubbleVisibilitySource;
  private readonly unsubscribe: () => void;
  private readonly unwatch: () => void;

  constructor(client: BubbleTimelineClient, context: ConnectionGenerationContext, input: PresentationInput) {
    this.client = client; this.context = context;
    this.gate = input.gate ?? sharedPresentationGate;
    this.visibility = input.visibility ?? bubbleVisibility;
    client.onTimelineAppended((entry) => {
      if (!this.current()) return;
      this.accept(entry);
      // Modern multi-row commits remain atomic. Standalone autonomous speech is already committed.
      if (!entry.presentation) this.publish();
    });
    this.unsubscribe = client.onTimelineCommitted((batch) => {
      if (!this.current() || batch.characterId !== ACTIVE_CHARACTER_ID) return;
      batch.entries.forEach((entry) => this.accept(entry)); this.publish();
    });
    client.onTimelineRemoved((ref) => {
      if (!this.current() || ref.characterId !== ACTIVE_CHARACTER_ID) return;
      this.removed.add(ref.seq); this.rows.delete(ref.seq);
      if (this.removed.size > 200) this.removed.delete(Math.min(...this.removed));
      const owns = (value: CommittedBubble | null) => value?.transcript.items.some((item) => item.kind === "text"
        && item.committed?.some((target) => target.timelineSeq === ref.seq));
      if (owns(this.latest)) { this.latest = null; this.epoch += 1; }
      if (owns(useChatBubbleStore.getState().committed)) useChatBubbleStore.getState().clearCommitted();
    });
    this.unwatch = this.visibility.subscribe(() => { this.epoch += 1; this.present(); });
    client.onClose(this.dispose);
  }
  private current() { return !this.disposed && this.context.isCurrent(); }
  private publish() {
    if (!this.current()) return;
    const committed = projectCommittedBubble([...this.rows.values()]);
    if (!committed || (this.latest && committed.seq <= this.latest.seq)) return;
    this.latest = committed; this.epoch += 1; this.present();
  }
  private present() {
    if (!this.current() || !this.visibility.visible() || !this.latest) return;
    const committed = this.latest;
    const store = useChatBubbleStore.getState();
    const snapshot = store.activitySource?.snapshot;
    // Old history and late commits cannot cover a different, newer foreground turn.
    if (snapshot?.status === "active" && snapshot.messageId !== committed.messageId) return;
    const ticket = this.epoch;
    this.gate.present(() => {
      if (!this.current() || ticket !== this.epoch || !this.visibility.visible()) return;
      const current = useChatBubbleStore.getState();
      const active = current.activitySource?.snapshot;
      if (active?.status === "active" && active.messageId !== committed.messageId) return;
      if (!current.committed || committed.seq > current.committed.seq) current.observeCommitted(committed);
    });
  }
  private accept(entry: TimelineEntry) {
    if (entry.characterId !== ACTIVE_CHARACTER_ID || this.removed.has(entry.seq)) return;
    this.rows.set(entry.seq, entry);
    if (this.rows.size > 200) this.rows.delete(Math.min(...this.rows.keys()));
  }
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true; this.epoch += 1;
    this.unsubscribe(); this.unwatch(); this.rows.clear(); this.removed.clear(); this.latest = null;
  };
  async restore() {
    const page = await this.client.timelineHistory({ characterId: ACTIVE_CHARACTER_ID, limit: 200 });
    if (!this.current()) return;
    page.entries.forEach((entry) => { if (!this.rows.has(entry.seq)) this.accept(entry); });
    this.publish();
  }
}

export function bindBubbleTimeline(client: BubbleTimelineClient, context: ConnectionGenerationContext, input: PresentationInput = {}): BubbleTimelineBinding {
  return new BubbleTimelineBinding(client, context, input);
}
