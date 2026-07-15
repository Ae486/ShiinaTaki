# windows/chat/
On-demand opaque chat window (#17): the depth view of the same per-character timeline the bubble glances at. Markdown
text, tool cards, image thumbnails; streaming replies; image attachments. One continuous timeline, NO session list.
- main.tsx — React root mounting <ChatWindow> into chat.html #root
- chat-window.tsx — root: own WS connection + layout (header + timeline + composer); provides the client via context
- chat-client-context.ts — React context exposing the WsClient to deep image parts (no prop-drilling)
- use-chat-connection.ts — the window's own operator WS (shared device identity; concurrent with the pet's socket)
- use-chat-timeline.ts — wires the WS to the store: initial history page, live appends, streamed deltas, older paging
- chat-timeline-store.ts — Zustand: entries by seq + the in-flight assistant row + inline notices + reducers
- date-group.ts — pure: chronological entries → consecutive local-date groups (date dividers)
- timeline-view.tsx — the scroll container: date dividers, rows, in-flight bubble, notices; auto-stick-to-bottom
- use-timeline-scroll.ts — scroll behavior: stick-to-bottom, top-reach load-older, position hold on prepend
- timeline-message.tsx — one role-styled row (React.memo); dispatches parts (text→markdown, tool→card, image→thumb)
- markdown-view.tsx — react-markdown@10 + remark-gfm wrapper, default-safe, with prose utilities (Tailwind v4)
- tool-card.tsx — a compact tool-call/tool-result card (name + status label)
- image-attachment.tsx — image part renderer (presentational): shimmer / "图片已过期" / resolved thumbnail
- use-attachment-image.ts — lazy media.get + module ref→dataURL cache (the ws touchpoint for image parts)
- composer.tsx — textarea (Enter=send) + attach button + thumbnail previews + send
- use-image-attach.ts — file-pick → normalize (downscale/JPEG) → { mediaType, raw base64, preview }, capped at 4
- image-attach-decode.ts — pure size-gate verdict + data-URL split (the node-testable core of use-image-attach)
