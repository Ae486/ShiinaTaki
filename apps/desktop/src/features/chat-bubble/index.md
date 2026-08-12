# features/chat-bubble/
The on-pet conversation bubble (#16): click taki's body → input → reply streams into a bubble on the shared timeline.
- chat-bubble.tsx — editable local draft + readiness-gated submit + streaming reply; an "expand" button opens the full chat window (#17)
- use-chat-bubble.ts — connection readiness plus fail-fast send and delta accumulation through the shared presentation gate; the component's only ws touchpoint
- chat-bubble-store.ts — Zustand: the streamed reply content (empty/streaming/done/error); the interaction store owns bubbleOpen
