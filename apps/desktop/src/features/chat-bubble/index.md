# features/chat-bubble/
The on-pet conversation bubble (#16): click taki's body → input → reply streams into a bubble on the shared timeline.
- chat-bubble.tsx — the input + streaming reply component (reaches ws-client/stores only via the hook)
- use-chat-bubble.ts — send + delta accumulation through the shared presentation gate; the component's only touchpoint
- chat-bubble-store.ts — Zustand: the streamed reply content (empty/streaming/done/error); the interaction store owns bubbleOpen
