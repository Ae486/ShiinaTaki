# windows/home/pages/chat/
The home window's chat page (#17, migrated out of the retired standalone chat window): the depth view of the same
per-character timeline the bubble glances at. Markdown text, tool cards, image thumbnails; streaming replies; image
attachments. One continuous timeline, NO session list.
- chat-page.tsx — page root: own WS connection + layout + that socket's single Approval modal owner; provides the client via context
- chat-client-context.ts — React context exposing the WsClient to deep image parts (no prop-drilling)
- use-chat-connection.ts — the page's independent fresh-generation owner; authentication plus timeline restoration completes before connected
- restore-chat-timeline.ts — guarded handlers → subscribe → authoritative newest-page reconciliation; removes stale covered cache rows without dropping older pages or raced live rows
- use-chat-timeline.ts — connected-client actions and store selectors: streamed sends/cancel, older paging, P1b jump-restore (widen window + refetch pages), grouped rows, retracted-draft hand-back
- chat-timeline-store.ts — seq-keyed timeline + reconnect reconciliation/tombstones + in-flight streaming row (zustand); P1b bounded mounted window (TIMELINE_MOUNT_CAP, oldest rows slide out and nextBefore re-points so the "加载更早消息" jump can refetch them); errors toast via components/toast (D34)
- chat-delta-coalescer.ts — P1a: chat.delta coalesced into ~40ms trailing-edge store updates (first delta of a turn immediate; full accumulated text per flush; a flush pending after a persisted swap/complete is a no-op via growInflightIfCurrent)
- date-group.ts — pure: chronological entries → consecutive local-date groups (date dividers)
- timeline-view.tsx — the scrollable conversation: date dividers, rows, streaming bubble; sticks to bottom, loads older on top-reach, shows the "加载更早消息" jump while the mounted window is trimmed; keyboard-scrollable (tabIndex) with an EmptyState for the empty timeline
- use-timeline-scroll.ts — scroll behavior: stick-to-bottom, top-reach load-older, position hold on prepend (keyed on the oldest mounted seq so the hold survives the P1b window trim)
- timeline-message.tsx — one role-styled row (React.memo); dispatches text/images and forwards captured tool names to cards
- markdown-view.tsx — react-markdown@10 + remark-gfm wrapper, default-safe, with prose utilities (Tailwind v4); lazy-loaded by its consumers (P1f) so the markdown stack rides an async chunk
- tool-card.tsx — compact tool cards with captured-name/fixed-name/generic Chinese fallbacks, wrapped long names, and existing result status
- image-attachment.tsx — image part renderer (presentational): Skeleton pulse block / "图片已过期" (image-off glyph) / resolved thumbnail
- use-attachment-image.ts — lazy media.get + module ref→dataURL cache (the ws touchpoint for image parts); P1b LRU-bounded at 40 resolved entries (in-flight fetches never evicted, failures self-evict for retry)
- composer.tsx — draft/attachments remain editable during reconnect; send is readiness-gated; in-flight state still owns chat.cancel and retracted-draft recovery; buttons ride the shared ActionButton pill and IconButton (≥32px hit targets)
- use-image-attach.ts — file-pick → normalize (downscale/JPEG) → { mediaType, raw base64, preview }, capped at 4
- image-attach-decode.ts — pure size-gate verdict + data-URL split (the node-testable core of use-image-attach)
