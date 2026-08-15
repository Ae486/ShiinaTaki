# windows/home/pages/chat/
The home window's chat page (#17, migrated out of the retired standalone chat window): the depth view of the same
per-character timeline the bubble glances at. Markdown text, tool cards, image thumbnails; streaming replies; image
attachments. One continuous timeline, NO session list.
- chat-page.tsx — page root: own WS connection + layout + that socket's single Approval modal owner; provides the client via context
- chat-client-context.ts — React context exposing the WsClient to deep image parts (no prop-drilling)
- use-chat-connection.ts — the page's independent fresh-generation owner; authentication plus timeline restoration completes before connected
- restore-chat-timeline.ts — guarded handlers → subscribe → authoritative newest-page reconciliation; removes stale covered cache rows without dropping older pages or raced live rows
- use-chat-timeline.ts — connected-client actions and store selectors: streamed sends/cancel, older paging, grouped rows, retracted-draft hand-back
- chat-timeline-store.ts — seq-keyed timeline + reconnect reconciliation/tombstones + in-flight streaming row (zustand); errors toast via components/toast (D34)
- date-group.ts — pure: chronological entries → consecutive local-date groups (date dividers)
- timeline-view.tsx — the scrollable conversation: date dividers, rows, streaming bubble; sticks to bottom, loads older on top-reach
- use-timeline-scroll.ts — scroll behavior: stick-to-bottom, top-reach load-older, position hold on prepend
- timeline-message.tsx — one role-styled row (React.memo); dispatches parts (text→markdown, tool→card, image→thumb)
- markdown-view.tsx — react-markdown@10 + remark-gfm wrapper, default-safe, with prose utilities (Tailwind v4)
- tool-card.tsx — a compact tool-call/tool-result card (name + status label)
- image-attachment.tsx — image part renderer (presentational): shimmer / "图片已过期" / resolved thumbnail
- use-attachment-image.ts — lazy media.get + module ref→dataURL cache (the ws touchpoint for image parts)
- composer.tsx — draft/attachments remain editable during reconnect; send is readiness-gated; in-flight state still owns chat.cancel and retracted-draft recovery
- use-image-attach.ts — file-pick → normalize (downscale/JPEG) → { mediaType, raw base64, preview }, capped at 4
- image-attach-decode.ts — pure size-gate verdict + data-URL split (the node-testable core of use-image-attach)
