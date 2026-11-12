# windows/home/pages/chat/
The home window's chat page (#17, migrated out of the retired standalone chat window): the depth view of the same
per-character timeline the bubble glances at. Markdown text, tool cards, image thumbnails; streaming replies; image
attachments. One continuous timeline, NO session list.
- chat-page.tsx — page root: independent WS/presence/Approval lifetime, retained Timeline and Main availability scoped only to new-message admission
- chat-model-availability.tsx — actionable model setup/read-recovery feedback while navigation and history remain available
- chat-client-context.ts — React context exposing the WsClient to deep image parts (no prop-drilling)
- use-chat-connection.ts — the page's independent fresh-generation owner; authentication plus timeline restoration completes before connected
- restore-chat-timeline.ts — guarded activity/append/commit channels and subscribe/read restoration with pending-turn anchors and prior-tail gap coverage
- use-chat-timeline.ts — canonical/live selectors, stable ordered transcript/date groups and focused send/history hook composition
- use-chat-send.ts — exact acknowledgement/Run cancellation, stale-callback guards, ordered-activity ownership and retracted-draft hand-back
- use-chat-history.ts — serialized current-generation older paging, bounded P1b window restoration and visible retryable read failures
- chat-timeline-store.ts — seq-keyed canonical cache, atomic complete-batch handoff, reachable reconnect-gap cursors, restore tombstones and mounted-window paging
- chat-timeline-activity.ts — disposable pending live handoffs, canonical-row staging and bounded completed-message guards
- timeline-batch.ts — canonical seq merge, exact batch coverage, cross-row reference fallback and missing-prefix detection
- read-chat-history.ts — read-only recovery bounded by pending-turn anchors and prior canonical coverage, including batches wholly absent from the newest page
- chat-transcript.ts — one flat ordered canonical/live render model with stable text/invocation keys across handoff
- timeline-projection.ts — consistent cross-page presentation references, canonical fallback and conservative call/result pairing within each batch
- chat-delta-coalescer.ts — existing 40-ms legacy text fallback; segmented activity uses the shared generation-owned coalescer
- date-group.ts — typed chronological entries or display items to consecutive local-date groups
- timeline-view.tsx — narrow reusable conversation frame, stable flat row children, date dividers, keyboard scroll, older-page recovery and optional adjuncts
- use-timeline-scroll.ts — selection-aware follow, explicit/automatic prepend anchors, per-conversation reading-position restoration and cleaned-up observers
- timeline-message.tsx — shared sender-aware bubbles, attachments, safe lazy Markdown, tool cards, complete-body actions and semantic child navigation
- markdown-view.tsx — default-safe react-markdown@10/remark-gfm text and committed-exposure owner mounted only after the lazy chunk resolves
- tool-card.tsx — stable selected heading with truthful status and captured labels; useful details use an optional sibling native disclosure
- tool-result-display.ts — conservative legacy structured/MCP outcomes, literal useful results and Pattern/follow-up adapters that omit internal bindings and raw fallback errors
- image-attachment.tsx — image part renderer (presentational): Skeleton pulse block / "图片已过期" (image-off glyph) / resolved thumbnail
- use-attachment-image.ts — lazy media.get + module ref→dataURL cache (the ws touchpoint for image parts); P1b LRU-bounded at 40 resolved entries (in-flight fetches never evicted, failures self-evict for retry)
- composer.tsx — draft/attachments remain editable during reconnect; send is readiness-gated; in-flight state still owns chat.cancel and retracted-draft recovery; buttons ride the shared ActionButton pill and IconButton (≥32px hit targets)
- conversation-composer.tsx — shared controlled Chat/child composer geometry, optional attachments/actions and IME-safe Enter; adapters own submission and draft policies
- use-image-attach.ts — bounded file-pick/normalization and previews; current-pick failures notify once from the action, while send/clear/unmount retires old decoding without breaking additive picks within one draft
- image-attach-decode.ts — pure size-gate verdict + data-URL split (the node-testable core of use-image-attach)
