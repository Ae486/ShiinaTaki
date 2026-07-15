# PRD — #17 Full chat window: timeline, markdown, image attachments

> M4's depth-on-demand conversation surface. The **bubble (#16) is the glance**; the **chat window is the depth** — same characterId timeline, same streaming path, no second conversation. Adds the first multimodal (image) input path to the agent.

## 1. Scope

### In (v1)
- A dedicated **`chat` Tauri window** (own html + rollup input + capability), opened on demand, NOT visible at startup. Reuses `ws-client.ts` for its own operator connection. `main` window untouched (D20 stays deferred).
- Renders the **continuous per-character timeline** (paged via `timeline.history` seq cursor + live via `timeline.subscribe`/`timeline.appended`), **grouped by date** in the UI, with **markdown** for text, **tool cards** for the tool-call/tool-result parts already persisted (#16), and **image thumbnails** for image parts.
- **Streaming replies** token-by-token (`chat.delta` → grow the in-flight assistant row). **No session list** anywhere.
- **Image attachment**: user picks an image → sent with `chat.send` → agent receives it as **multimodal input** → routed to the configured **vision model**.
- **Bubble + chat window reflect the same stream live** (both subscribe to the same characterId).

### Out (deferred, logged)
- Paste-from-clipboard / drag-drop image (v1 = file-pick button). → increment, note in issue.
- Server-side thumbnailing; multi-image galleries; image cropping.
- Date-jump calendar (v1 = date dividers while scrolling).
- Merging/replacing the `main` window (D20).
- Compaction of images out of the replay window (D4 owns token budgeting).

## 2. Locked design decisions (rationale)

1. **New dedicated `chat` window**, on-demand, not-at-startup. Depth view is distinct from the glance bubble; keeps `main` deferral (D20) intact. Opens via Tauri `WebviewWindow` from the bubble's "expand" affordance.
2. **Media lives in the Workspace, never the DB.** Clone `screenshot-store.ts` into a single `attachment-store` (the sanctioned attachment R/W site). Content-addressed by **sha256** (dedup + stable ref). The timeline image part stores a **workspace-relative `ref`**, not bytes. Rationale: single-DB-writer (inv. 2), OS-neutral Workspace, screenshot precedent; avoids bloating every `timeline.history` page with base64.
3. **`media.get` WS method** (operator-only) serves attachment bytes to the webview for **scroll-back** (a live-attached image renders from local bytes with no fetch). Operator↔core only → **no Rust serde mirror** (server-push spec); tested in a standalone `media-schema.test.ts`, NOT `protocol-fixtures.test.ts`.
4. **Image `TimelinePart` variant** `{type:"image", mediaType, ref}` — advances D14 for the image/file part specifically (its stated trigger: "M4 聊天窗需要渲染…文件卡").
5. **Two parallel, user-adjustable model slots — text + vision — routed on the CURRENT turn only.** Text slot = `TAKI_PROVIDER_*` (today deepseek-v4-flash, text-only); vision slot = `TAKI_VLM_*` (today gemini assists); the slots **may point to the same model/endpoint** (a vision-capable main model fills both). `chat.send` gains `attachments`; a turn routes to the vision slot **iff the current message carries attachments**, otherwise the text slot. No vision slot configured → the backend **rejects before persisting** with a structured `chat.error`; **v1 UI keeps the attach button enabled and renders that error inline** (no config-discovery method exists yet — proactive disable arrives with the M5 settings config surface).
6. **Image bytes are in-flight only; cross-turn memory is the vision model's TEXT description** (user directive 2026-07-14; supersedes the old D26 deferral). The attached image reaches the model **only on the turn it is sent** (an AI SDK **`file` part** from the in-flight base64 — `ImagePart` is `@deprecated` in v7). After the turn, a **detached step** parses the retained image via the vision slot and writes the description into the memory engine as an episodic memory (user choice 1a). Text is the **authoritative, permanent** record; later turns recall the image via memory retrieval (works on the text model too). The timeline row's model projection stays `[image]`+caption (display only). **This is a thin optimization, not a subsystem** (user, 2026-07-14): ONE deletable writer module (`image-description-writer.ts`) riding a parallel detached post-turn hook (like `autoMemory.onTurnCompleted`), writing through the EXISTING memory store API. The memory engine itself is untouched — its redesign is deferred (**D28**: high cohesion, low coupling; nothing added now may make that redesign harder).
7. **Markdown** = `react-markdown@^10.1.0` + `remark-gfm@^4.0.1`, **default-safe** (no `rehype-raw`/`rehype-sanitize`: react-markdown escapes raw HTML and defangs `javascript:` URLs by default). Streaming = re-render the growing string each delta; wrap settled rows in `React.memo` so only the in-flight row re-parses.
8. **`attachment-store` = one pluggable module** (`packages/core/src/media/`, invariant 7): `save(dataBase64, mediaType)→{ref}` (chat-agent), `read(ref)→{mediaType,dataBase64}` (media.get + description writer), `sweepExpired`/`usage`/`clear` (lifecycle). Refs live in a **closed content-addressed namespace** — `attachments/<sha256hex>.<png|jpg|webp|gif>` — so read-side confinement is a **strict whole-ref regex** (`^attachments/[a-f0-9]{64}\.(png|jpg|webp|gif)$`): anything else is a structured reject before any fs call. Strictly stronger than general path resolution for this namespace (no traversal is even expressible); `workspace-paths` stays the gate for the open workspace namespace, not needed here.
9. **Image lifecycle is user-managed; TEXT is authoritative.** The raw image is retained **temporarily** in the Workspace under a **configurable TTL** (a config value, user-editable — D11-style) and GC-swept on expiry; the **description-memory is never GC'd**. A `media.clear` method purges images on demand; a **cache-usage query** (attachment bytes + memory-text bytes) is built backend-side and **reserved for the M5 settings UI** (**D27**). After an image expires its timeline row shows the description/`[image]` — text survives.

## 3. Protocol design (`@taki/shared` zod — single source, inv. 3)

### 3.1 `chat-schema.ts` (edit, additive/back-compat)
```ts
export const IMAGE_MEDIA_TYPES = ["image/png","image/jpeg","image/webp","image/gif"] as const;
export const ImageAttachmentSchema = z.object({
  mediaType: z.enum(IMAGE_MEDIA_TYPES),
  dataBase64: z.string().min(1),           // raw base64 (no data: prefix)
});
// ChatSendParamsSchema gains:
  attachments: z.array(ImageAttachmentSchema).max(MAX_ATTACHMENTS_PER_MESSAGE).optional(),
```
`message` relaxes to `z.string()` (an empty caption is legitimate with an image), with a `.refine`: **at least one of** a non-empty `message` OR ≥1 attachment must be present. Text-only sends (non-empty `message`, no `attachments`) are byte-identical to today.

### 3.2 `timeline-schema.ts` (edit) — add to `TimelinePartSchema` union
```ts
z.object({ type: z.literal("image"), mediaType: z.enum(IMAGE_MEDIA_TYPES), ref: z.string().min(1) }),
```
`ref` = workspace-relative path (e.g. `attachments/<sha256>.png`). Reuse `IMAGE_MEDIA_TYPES` from chat-schema (import; do not redeclare).

### 3.3 `media-schema.ts` (new) — operator-only, NO Rust mirror
```ts
export const MEDIA_METHODS = { get: "media.get" } as const;
export const MediaGetParamsSchema = z.object({ ref: z.string().min(1) });
export const MediaGetResultSchema = z.object({
  mediaType: z.enum(IMAGE_MEDIA_TYPES),
  dataBase64: z.string().min(1),
});
```
Add `media-schema.test.ts` (round-trip only). Export both from `index.ts`; add index.md lines.

## 4. Data flow

### 4.1 Inbound image (user → agent) — bytes in-flight
```
chat window: file-pick → raw base64 + mediaType (R3) → chat.send{characterId, message, attachments}
core chat-send: params validated → chatAgent.stream(params, turn)
chat-agent.runTurn (additive seams only; the D1 stream loop is byte-unchanged):
  if attachments?.length && !deps.visionModel: throw structured "images require a vision model" → chat.error
  imageRefs = attachments ? attachments.map(a => attachmentStore.save(a.dataBase64, a.mediaType)) : []
  store.appendUser(characterId, message, imageRefs)          // persist for DISPLAY (text + image parts)
  history = store.history(characterId)                        // oldest-first; last row = current user msg (TEXT projection)
  messages = attachments?.length
    ? [...history.slice(0, -1), buildMultimodalUser(message, attachments)]   // swap the tail with in-flight file parts
    : history
  model = attachments?.length ? deps.visionModel : deps.model
  agent = new ToolLoopAgent({ model, ... })                   // rest of the loop UNCHANGED
  result = await agent.stream({ messages, abortSignal: turn?.signal })        // was `messages: history`

buildMultimodalUser(text, attachments):
  { role:"user", content:[ {type:"text", text},
      ...attachments.map(a => ({ type:"file", mediaType:a.mediaType, data:a.dataBase64 })) ] }
  // FilePart (ImagePart is @deprecated in v7). `data` = RAW base64, no `data:` prefix
  // (a tagged {type:'data', data:'data:...'} throws InvalidDataContentError — R1).
```

### 4.2 Persistence + replay (text projection — the model never re-sees bytes)
- `appendUser(characterId, text, images?)` → `toUserEntryInput`: `parts=[{type:"text",text}, {type:"image",mediaType,ref}...]`, `content = text.length>0 ? text : "[image]"`. Pure text (no images) stays legacy `{role:"user", content}` with NO parts — byte-identical to today.
- `toModelMessage(user row)`: image parts → **text projection** (`{role:"user", content: <caption or "[image]">}`, image parts omitted); no-parts row → `{role:"user", content}`. The model NEVER replays image bytes (decision 6) → conversation-store needs NO byte reader.
- **Cross-turn memory (decision 6, user choice 1a)**: after an image turn, a detached step reads the retained image (pre-expiry) + calls the **VLM** to produce a faithful description, then writes it as an **episodic memory** via the memory engine's declarative layer path (D9: add via the registry, don't rework the framework). Fired like the existing `void autoMemory.onTurnCompleted` — zero user-facing latency. This is the authoritative record; retrieval surfaces it on later turns.

### 4.3 Display (timeline → chat window)
- History page + live `timeline.appended` → a message-list store keyed by `seq`. Assistant streaming: `chat.delta` grows the in-flight row until `chat.complete`.
- Row render dispatches on `entry.parts` (the UI reads parts directly, not `toModelMessage`): text→markdown; `tool-call`/`tool-result`→tool card (renders #16's persisted records for free); `image`→thumbnail. **Image display is one path**: every image part resolves via `media.get(ref)` (lazy, cached by ref → data URL) — live-attached and scroll-back images alike (bytes are local, loopback WS is cheap; one path beats two). The composer shows its own local preview before send.
- Date dividers computed from `createdAt` (local date boundaries).

## 5. File map

### Phase A — backend (protocol + runtime + media capability)
| File | Change |
|---|---|
| `packages/shared/src/chat-schema.ts` | +`IMAGE_MEDIA_TYPES`, `ImageAttachmentSchema`, `attachments` on params, `MAX_ATTACHMENTS_PER_MESSAGE` |
| `packages/shared/src/timeline-schema.ts` | +`image` variant on `TimelinePartSchema` |
| `packages/shared/src/media-schema.ts` (new) | `MEDIA_METHODS` {get, clear, usage}, `MediaGet*` + `MediaClear*` + `MediaUsage*` schemas (usage RESERVED for the M5 settings UI) |
| `packages/shared/src/media-schema.test.ts` (new) | round-trip |
| `packages/shared/src/chat-schema.test.ts` / `timeline-schema.test.ts` | +cases for the new shapes |
| `packages/shared/src/index.ts` + `index.md` | export + list media-schema |
| `packages/core/src/media/attachment-store.ts` (new) | pluggable media module (inv. 7): `save`/`read` + `sweepExpired` (TTL GC) + `usage()` + `clear()`; sha256 content-address `attachments/<sha256>.<ext>`; dedup refreshes mtime (TTL restart); read confined by the strict whole-ref regex (decision 8) |
| `packages/core/src/media/attachment-store.test.ts` (new) | save→read round-trip; dedup (one file, mtime refreshed); traversal/absolute/malformed ref rejected; sweepExpired removes only stale; usage/clear |
| `packages/core/src/media/index.md` (new) | module index |
| `packages/core/src/config/attachment-config.ts` (new) | `TAKI_ATTACHMENT_TTL_DAYS` (user-editable, D11-style; default 14; positive int; fail-closed parse — garbage errors at boot) |
| `packages/core/src/config/attachment-config.test.ts` (new) | default + override + fail-closed parse |
| `packages/core/src/config/vision-config.ts` (new) | the VISION slot (parallel to provider-config's text slot; may hold identical values): `loadVisionConfig(env)→{baseUrl,apiKey,model}|null` from `TAKI_VLM_*` (all-or-nothing; partial = fatal, names the missing var) |
| `packages/core/src/config/vision-config.test.ts` (new) | present / absent / partial |
| `packages/core/src/agents/turn-mapping.ts` | +`toUserEntryInput(text, images)` (text+image parts; content = caption or `[image]`); `toModelMessage`'s user branch is ALREADY the text projection (`{role:"user", content}`) — zero change there |
| `packages/core/src/agents/conversation-store.ts` | `appendUser(id, text, images?)` persists text+image parts (no images → legacy row, byte-identical); **no byte reader** (replay is text) |
| `packages/core/src/agents/chat-agent.ts` | +`visionModel?`, +`attachments?` (store), +`imageMemory?` (detached hook, mirrors `autoMemory`); reject attachments-without-visionModel (structured, before any append); save→appendUser with refs; in-flight `messages` tail swap via `buildMultimodalUser` (FilePart, raw base64); `model:` picks vision slot iff current attachments; fire `imageMemory.onImageTurn` detached post-turn; **D1 stream loop/persistTurn/abort/toolApproval byte-unchanged** |
| `packages/core/src/server/methods/media-get.ts` (new) | `media.get` operator-only; thin `attachmentStore.read` delegation; regex-invalid/missing ref → structured reject |
| `packages/core/src/server/methods/media-get.test.ts` (new) | ok read, escape reject, non-attachments ref reject |
| `packages/core/src/server/methods/media-clear.ts` (new) | `media.clear` operator-only — purge attachments on demand |
| `packages/core/src/server/methods/media-usage.ts` (new) | `media.usage` operator-only — attachment bytes + memory-text bytes (reserved for M5 settings) |
| `packages/core/src/memory/image-description-writer.ts` (new) | **thin, deletable** (D28 constraint): `onImageTurn({characterId, refs, caption})` detached — read bytes, ONE vision-slot `generateText` call (all images + caption, faithful concise English description prompt), write ONE entry via the EXISTING memory store write path (same call family episodic-writer uses; no new memory machinery); failure = log warn + drop (auto-memory's policy) |
| GC hook | boot sweep + `setInterval(..., 6h).unref()` `sweepExpired` in `main.ts` (lightweight; NOT the croner scheduler — D5 is M5) |
| `packages/core/src/main.ts` | visionConfig → vision-slot model (`createOpenAICompatible` again, name "taki-vision"); attachmentStore (+TTL config); image-description writer (only when vision slot present); wire chat-agent deps; register media.get/clear/usage; boot+interval GC |
| touched `index.md`s | update |

### Phase B — frontend (the chat window)
| File | Change |
|---|---|
| `apps/desktop/chat.html` (new) | window entry (clone `pet.html`, opaque, NO Cubism scripts) |
| `apps/desktop/vite.config.ts` | +`input.chat: chat.html` |
| `apps/desktop/src-tauri/capabilities/chat.json` (new) | `"windows":["chat"]` + `core:event:default` (R4) |
| `apps/desktop/src-tauri/capabilities/pet.json` (edit) | +`core:webview:allow-create-webview-window`, +`core:window:allow-set-focus` (pet opens the chat window) |
| `apps/desktop/src-tauri/tauri.conf.json` | **no chat entry** — window is runtime-created (R4). If the window-state plugin denylists positions, add `"chat"` iff we do NOT want its position persisted (decide at impl) |
| `apps/desktop/src/windows/chat/main.tsx` (new) | react mount |
| `apps/desktop/src/windows/chat/chat-window.tsx` (new) | root: ws-client connect + layout |
| `apps/desktop/src/windows/chat/use-chat-timeline.ts` (new) | history paging + subscribe + delta assembly (store) |
| `apps/desktop/src/windows/chat/timeline-view.tsx` (new) | scroll-back list + date dividers |
| `apps/desktop/src/windows/chat/timeline-message.tsx` (new) | one row (role-styled; parts dispatch) |
| `apps/desktop/src/windows/chat/markdown-view.tsx` (new) | react-markdown + remark-gfm wrapper |
| `apps/desktop/src/windows/chat/composer.tsx` (new) | text + attach + send |
| `apps/desktop/src/windows/chat/use-image-attach.ts` (new) | file-pick → base64+mediaType+preview |
| `apps/desktop/src/windows/chat/image-attachment.tsx` (new) | image part render (local preview / media.get) |
| `apps/desktop/src/windows/chat/date-group.ts` (new) | createdAt → date-divider grouping |
| open affordance | bubble "expand" button → `WebviewWindow.getByLabel("chat")` (async, v2) show+focus, else `new WebviewWindow("chat", {url:"chat.html", ...})` (R4) |
| touched `index.md`s | update |
| deps | add `react-markdown@^10.1.0` + `remark-gfm@^4.0.1` to `apps/desktop/package.json` (R2; default-safe, no rehype-raw/sanitize) |

## 6. TDD table (write/verify these)
| # | Test | Asserts |
|---|---|---|
| T1 | `chat-schema.test.ts` | attachments parse; too many rejected; bad mediaType rejected; text-only still valid |
| T2 | `timeline-schema.test.ts` | image part parses; round-trips through `TimelineEntry.parts` |
| T3 | `media-schema.test.ts` | MediaGet params/result round-trip |
| T4 | `attachment-store.test.ts` | save→read same bytes+mediaType; identical bytes dedup to one file (mtime refreshed); `../`/absolute/malformed ref rejected by the whole-ref regex before fs; `sweepExpired` deletes only stale; `usage`/`clear` |
| T5 | `vision-config.test.ts` | all three `TAKI_VLM_*` present → config; none → null; partial → fatal naming the var |
| T6 | `turn-mapping.test.ts` | `toUserEntryInput(text, images)` → entry with text+image parts, content=caption-or-`[image]`; pure text → legacy row (no parts); user row's `toModelMessage` stays text-only projection (image parts omitted) |
| T7 | `conversation-store.test.ts` | appendUser with images persists parts; appendUser without images = legacy row (byte-identical to today); history of an image row replays as `{role:"user", content}` text (NO bytes) |
| T8 | `chat-agent.*.test.ts` | image turn routes to the vision slot; text turn stays on the text slot; attachments + no vision slot → structured error, nothing persisted; multimodal in-flight tail carries FilePart (raw base64); `imageMemory.onImageTurn` fired detached with refs+caption; **existing D1 tests (lifecycle/tools/approval + the L2 hallucination repro) stay green UNMODIFIED** |
| T9 | `media-get.test.ts` + clear/usage | ok read returns bytes+mediaType; regex-invalid ref rejected; missing file structured reject; clear purges; usage reports |
| T9b | `image-description-writer.test.ts` | mocked vision model → writes one memory entry via the store path; model failure → warn + drop, no throw |
| T10 | frontend `use-chat-timeline` | history page renders rows; `timeline.appended` appends; `chat.delta` grows the in-flight row; `chat.complete` finalizes |
| T11 | frontend `use-image-attach` | data-URL → {mediaType, base64}; oversize handling per R3 |
| T12 | frontend `date-group` | entries split into correct local-date groups |

## 7. Constraints & open questions
**Constraints (hard):**
- **D1 turn runtime is byte-frozen** except the named additive seams: the attachments guard + save, the `appendUser` call-site (may pass refs), the in-flight `messages` tail swap, the `model:` slot pick, and the detached `imageMemory` fire. The `for await (result.stream)` loop, `persistTurn`, abort/`onClose` wiring, and `toolApproval` MUST be identical. The L2 hallucination-repro test must stay green.
- **D28 — memory low-coupling (user, 2026-07-14)**: the memory system will be REDESIGNED later (it does not yet meet the user's bar); nothing in #17 may make that harder. The description writer is ONE deletable file riding its own optional detached hook and the EXISTING store write path; the memory engine/layer machinery is untouched. High cohesion, low coupling, modular — a later redesign swaps this writer, not walls.
- **Ref confinement is the security surface** (→ **fable5 check**): `attachment-store.read` accepts ONLY the strict whole-ref regex `^attachments/[a-f0-9]{64}\.(png|jpg|webp|gif)$` — reject BEFORE any fs call; `media.get` is a thin delegation so the reject is single-sourced. Writes are content-addressed (name derived from sha256, never from input).
- **Error codes**: read `error-code-schema.ts` first; PREFER an existing code for the no-vision-slot reject (the enum may be Rust-mirrored — extending it means updating the mirror + fixtures; do that only if genuinely warranted).
- **Invariant 3**: `media.*` and the image part are operator-only → NO Rust serde mirror; keep them OUT of `protocol-fixtures.test.ts` (standalone `media-schema.test.ts`).
- **OS-neutral** (inv. 8): paths via `path.join` under the Workspace root; sha256/base64 via `node:crypto`/`Buffer`; no Windows-only APIs in core/shared.
- Headers (INPUT/OUTPUT/POS) on every new file; size caps (TS ≤300 file / ≤50 fn / ≤3 params); kebab-case; one method per file; `XSchema`+`type` zod pattern; update every touched `index.md`.
- Verify AI SDK 7 + react-markdown APIs against installed types/docs (research R1/R2) — never from memory.

**Resolved (research-backed):**
- Q1 → `message` relaxed to `z.string()` + `.refine` (non-empty text OR ≥1 attachment). Empty caption + image is valid; text projection is `[image]`.
- Q2 → (R3) `MAX_ATTACHMENTS_PER_MESSAGE = 4`; reject a source image > 20 MB; ≤ 1 MB send as-is; else canvas-downscale to 2048 px longest edge, JPEG q0.85 (flatten alpha to white). ws server default 100 MiB → no transport limit.
- Q3 → a small "expand" affordance on the bubble opens the chat window (get-by-label-or-create).
- History-replay of image turns → text projection; cross-turn recall = the vision model's description as an episodic memory (decision 6; D26 DONE-by-design, D27 = M5 cache-management UI, D28 = memory-redesign coupling constraint).
- Drag-drop / clipboard-paste attach → deferred (R3: HTML5 drag-drop needs `dragDropEnabled:false` on the window; v1 is click-to-pick). Note in the issue.

## 8. Phasing
- **Phase A (backend)** → implement (Opus, this PRD) → **check (fable5** — protocol + D1-adjacent + workspace-security surface).
- **Phase B (frontend)** → implement (Opus) → check (Opus; fable5 if it sets a convention). Depends on Phase A's protocol.
- Commit in layers (shared → core → desktop → docs). Gates: `pnpm -r typecheck && pnpm -r lint && pnpm -r test` + `cargo clippy` green; real-flow smoke (image turn hits the VLM) via a non-default-port core, kill the tree after.

> External-API specifics (exact AI SDK 7 image message shape, react-markdown version/config, file-pick snippet, chat-window wiring) are filled from research `r1..r4` before Phase A dispatch — do not code them from memory.
