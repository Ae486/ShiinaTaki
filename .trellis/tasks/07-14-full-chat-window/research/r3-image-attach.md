# Research: Image attachment in the Tauri 2 WebView2 (chat window)

- **Query**: plain HTML file pick + base64 extraction in WebView2 (no Tauri plugin), large-image guidance for WS transport
- **Scope**: mixed (web platform APIs + Tauri docs/issues + repo WS server config)
- **Date**: 2026-07-15

## 1. Plain `<input type="file">` + FileReader works — no Tauri dialog plugin needed

- WebView2 is Chromium: a standard `<input type="file" accept="image/*">` opens the native Windows
  file picker and yields standard web `File` objects. This is pure web-platform behavior; Tauri's
  dialog plugin exists only for driving native dialogs from Rust/JS APIs, and is NOT required for a
  form file input. No capability/permission entry is needed for it (capabilities gate Tauri IPC,
  not web platform APIs).
- `File.type` gives the MIME type directly (e.g. `image/png`) — prefer it over parsing the data-URL
  header (both come from the same sniff, but `file.type` is simpler).
- Caveat for later (NOT v1): HTML5 **drag-and-drop** of OS files into the page does NOT work while
  Tauri's own drag-drop is enabled (`dragDropEnabled`, default true — Tauri intercepts the drop on
  Windows). Official docs: "Disabling it is required to use HTML5 drag and drop on the frontend on
  Windows" (https://v2.tauri.app/reference/config/, `dragDropEnabled`; also
  https://github.com/tauri-apps/tauri/issues/13171). Click-to-pick is unaffected. If the chat
  window ever wants drop-to-attach, set `"dragDropEnabled": false` on the chat window entry.

### Verified snippet — pick to `{ mediaType, base64 }`

```tsx
// In the chat composer:
<input type="file" accept="image/*" onChange={(e) => void onPick(e.target.files?.[0])} />
```

```ts
/** Reads a picked image file into the raw-base64 + mediaType pair the turn payload carries. */
async function readImage(file: File): Promise<{ mediaType: string; base64: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string); // "data:image/png;base64,iVBOR..."
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsDataURL(file);
  });
  const comma = dataUrl.indexOf(",");
  return {
    mediaType: file.type || dataUrl.slice(5, dataUrl.indexOf(";")), // "image/png"
    base64: dataUrl.slice(comma + 1),                               // raw base64, no data: prefix
  };
}
```

Sending **raw base64 (no `data:` prefix)** matches the AI SDK finding in
`r1-ai-sdk-multimodal.md` section 2 (tagged data-URL strings throw in ai@7.0.17; raw base64 +
explicit mediaType is the reliable shape).

## 2. Large images: cap + canvas downscale (v1 recommendation)

Transport facts:

- The Core's WS server is `new WebSocketServer({ host, port })` with no `maxPayload` override
  (`packages/core/src/server/ws-server.ts:40`) — the `ws` library default is 100 MiB, so a
  multi-MB base64 frame passes. The cost is JSON-parse + zod-parse of the whole frame and holding
  it in the SQLite-bound turn path, not a hard limit.
- Base64 inflates bytes by 4/3. Vision endpoints downscale internally anyway (Gemini's OpenAI
  compat bills per-image tokens by resolution) — pixels beyond ~2k on the long edge buy nothing.

**Concrete v1 rule** (single function, no config):

1. Reject files over **20 MB** raw (structured UI error, never send).
2. If the file is **<= 1 MB**, send as-is (preserves PNG transparency and exact pixels — screenshots).
3. Otherwise downscale so the longest edge is **<= 2048 px** and re-encode **JPEG quality 0.85**
   (flattens alpha onto white; acceptable for photos, and files this large are photos in practice).

```ts
const MAX_EDGE = 2048;

/** Downscale + re-encode an oversized image; returns the original file when small enough. */
async function normalizeImage(file: File): Promise<Blob> {
  if (file.size <= 1_000_000) return file;
  const bitmap = await createImageBitmap(file); // Chromium/WebView2 supported
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file; // degrade: send the original rather than fail the attach
  ctx.fillStyle = "#fff"; // JPEG has no alpha — flatten instead of black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  return blob ?? file;
}
// then: readImage(new File([blob], file.name, { type: blob.type }))  // mediaType becomes image/jpeg
```

Result: worst-case payload ~ a few hundred KB base64 per image — negligible over the loopback WS.

## Sources

- Web platform (`FileReader`, `createImageBitmap`, `canvas.toBlob`) — Chromium/WebView2 baseline APIs, no version dependency.
- https://v2.tauri.app/reference/config/ — `dragDropEnabled` ("Disabling it is required to use HTML5 drag and drop on the frontend on Windows")
- https://github.com/tauri-apps/tauri/issues/13171 — maintainer confirmation that Tauri drag-drop and HTML5 drag-drop are mutually exclusive on Windows
- `H:\TakiAgent\packages\core\src\server\ws-server.ts:40` — no maxPayload override (ws default 100 MiB)

## Caveats / Not found

- None blocking. (Multi-image per turn works with the same shape — an array of parts; v1 can cap at 1-4 attachments purely as a UI decision.)
