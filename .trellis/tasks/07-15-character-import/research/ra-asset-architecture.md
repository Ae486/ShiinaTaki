# Research: #18 Load-Bearing Asset Architecture (import → Workspace → renderer)

- **Query**: How do imported Live2D model bytes travel from the Core-owned Workspace to the WebView2 Pet UI renderer? Where are they stored, who extracts them, and what serving path replaces the dev-only vite middleware?
- **Scope**: internal (repo + installed deps) + external (Tauri 2 docs, engine types, Node docs)
- **Date**: 2026-07-15

---

## 0. Recommendation in brief

**Serve the extracted model files to the WebView through the Tauri built-in `asset:` protocol** (`app.security.assetProtocol.enable=true` + a `scope` glob over the Workspace `characters/` subtree), turning the absolute model-settings path into a fetchable URL with `convertFileSrc()` in the renderer and passing that URL string to `Live2DModel.from()`. **Extraction runs Core-side** (ADR 0007 v1): a new `packages/core` module unzips/un-zst the operator-supplied archive into `<Workspace>/characters/<characterId>/<costume>/…` via `node:fs` — the same single-writer pattern as attachment-store/screenshot-store. **The one gating fact that decided it**: `Live2DModel.from()` (and every path beneath it) resolves a model's sub-resources — moc3, N textures, motions, physics, expressions — **by URL through an XHR loader, lazily**; there is no in-memory `{path:bytes}` mode in the default pipeline (engine types, §1). A URL-serving protocol therefore preserves the engine's lazy motion/texture loading for free, whereas a bytes-over-WS scheme (option 1) would have to eagerly materialize dozens of multi-MB files as base64 and reimplement the resolver. Custom `register_uri_scheme_protocol` is the documented fallback if characterId-routing indirection or serving-straight-from-`.zst` is wanted later.

This touches **no hardened zone**: the D1 turn runtime is untouched (character import is a new Core module + new WS method, not a chat-turn change), and it does not cross invariant 1 illegitimately (§3). One **v1.5 (split-machine) open question** is real and flagged (§7, decision 7) — it rides the exact ADR 0007 file-RW migration already planned, so it is not a v1 blocker. No new ADR is strictly required, but two calls are ADR-adjacent (§8).

---

## 1. THE GATING FACT — what `Live2DModel.from()` accepts, and how sub-resources load

**Source**: `node_modules/.pnpm/untitled-pixi-live2d-engine@1.3.1/…/types/index.d.ts` (installed, verified — not from memory).

`from()` / `fromSync()` accept three source shapes (index.d.ts:4350, 4374):
```ts
static from<M …>(this: M, source: string | JSONObject | ModelSettings, options?: Live2DFactoryOptions): Promise<InstanceType<M>>;
```
`Live2DFactory.setupLive2DModel` restates it: *"source — Can be one of: settings file URL, settings JSON object, ModelSettings instance"* (index.d.ts:4192).

**But all three shapes still fetch every sub-resource by URL:**
- `ModelSettings` (index.d.ts:512-604) holds `moc: string`, `textures: string[]`, `pose?/physics?: string` — all **relative paths** — plus `url: string` (the settings-file URL) and `resolveURL(path)` (index.d.ts:567), which resolves each relative resource **against that settings `url`**. The resolver is plain string URL-join: `resolveURL(base, path)` — *"Resolves a path/URL against a base string without relying on Node's `url` module"* (index.d.ts:4853).
- The actual byte fetch is `Live2DLoader` → `XHRLoader.createXHR(target, url, type, …)` (index.d.ts:4735); `Live2DLoaderContext.url` is *"resolved by `ModelSettings.resolveURL` if a ModelSettings is provided"* (index.d.ts:4686-4689).
- **Motions and expressions load LAZILY**: `Live2DFactory.loadMotion(...)` / `loadExpression(...)` (index.d.ts:4205, 4213) run on first play, each issuing its own XHR at a resolved URL. This is the decisive property — see §6.

**Two escape hatches, both still URL-based** (so neither changes the conclusion):
1. `ModelSettings.replaceFiles(replacer)` (index.d.ts:584) rewrites every resource path before load — you could point them at any URL scheme (a custom protocol, or `blob:` object URLs). Still URLs.
2. `FileLoader` (index.d.ts:4758-4792, marked **Experimental**): `FileLoader.upload(files: File[], settings)` + `FileLoader.createSettings(files: File[])`. It reads browser `File[]` via `webkitRelativePath`, mints an **object URL** (`blob:`) per file into `filesMap`, and its `resolveURL(settingsURL, filePath)` returns that object URL. Even the "upload files" path is URL-based (just `blob:` instead of `http:`/custom).

**Conclusion for the PRD**: the real question is not "URL vs in-memory bytes" — the engine is URL-only. It is **which URL scheme serves the Workspace files to the webview**: (a) Tauri `asset:`/custom protocol, (b) `blob:` object URLs minted from WS-fetched base64, or (c) the dev `http://localhost:1420/spike-assets/…` (dev-only, absent in a packaged build).

---

## 2. The dev route today (what #18 must replace)

- `apps/desktop/src/renderer/live2d/load-taki-model.ts:14` — `const TAKI_MODEL_SOURCE = "/spike-assets/arbeit/model.json";` → `Live2DModel.from(TAKI_MODEL_SOURCE, {...})`.
- `apps/desktop/vite.config.ts:14-32` — `spikeAssets()` plugin, **`apply: "serve"`** (dev-server only), streams files from `models/extracted/taki` (git-ignored) at `/spike-assets/*`. Its own header: *"Keeps copyrighted assets out of public/ and out of any production build."*
- The `spike.html` input persists in prod `rollupOptions.input` (vite.config.ts:48) but the byte-serving middleware is `apply:"serve"` — **it does not run in `vite build` / the packaged Tauri app**. There is no production static-serve story today; that is the hole #18 fills.
- The model itself is loaded framework-free: `pet-scene.ts:47` calls `loadTakiModel(app)`. The Cubism runtimes load as `<script>` globals in `pet.html` (`/vendor/live2d/*.min.js`).

---

## 3. Constraints that bound the answer (cited)

- **CLAUDE.md invariant 1** — Core never touches the OS *on the agent's initiative*. Character import is **operator-driven** (a human picks an archive in settings), not an agent tool call. The sanctioned Core-fs family already exists and is broad: `attachment-store.save` (`main.ts:153`), `screenshot-store` (`main.ts:210`), the memory engine (`main.ts:127`), workspace file tools (`main.ts:235`). Extraction is the same class — the Core persisting operator-supplied bytes into its **own** Workspace — so Core-side extraction does not breach invariant 1. The *serving* side is Rust (the Shell), read-only, operator/UI-driven; the agent never fetches a model file.
- **CLAUDE.md invariant 2 / single Workspace writer** — `main.ts:209` comment: *"The core is the single sanctioned Workspace writer (invariant 2)."* Extraction MUST run Core-side to preserve this; the Shell only *reads* the extracted tree to serve it.
- **CLAUDE.md invariant 8** — `packages/core`/`shared` OS-neutral (must run on the Ubuntu VPS). Extraction code uses `os.homedir()` + `path.join`, no Windows-only APIs. The `asset:`/custom protocol lives in `apps/desktop/src-tauri` (Rust, host-side) — outside invariant 8's scope by construction, and consistent with ADR 0007's "the host is where user-facing assets physically land."
- **ADR 0007 (data locality)** — v1 = file R/W stays Core-side TS (Core+Shell share one disk); v1.5 = file R/W migrates to a Node-routed capability so it lands on the host. **Implication**: v1 Core-side `node:fs` extraction into `<Workspace>/characters/` is correct and indistinguishable from a host write (same disk). v1.5 splits the disk — see §7 decision 7.
- **ADR 0004 / CONTEXT.md** — the Pet UI is an **operator** client (converses + configures), the single DB writer is the Core, all other processes query/subscribe over WS. `media.*` and `avatar.*` are **operator-only, no Rust mirror** (webview↔core). A character-import/costume method would follow the same operator-only shape.
- **CONTEXT.md** — Workspace = `%USERPROFILE%\.takiagent\workspace`. **Character** = model + persona + voice, three decoupled parts, any Cubism model bindable to any persona; v1 ships exactly one (Shiina Taki). This is why the layer must be **characterId-addressable** even though v1's UI shows one character.
- **live2d-renderer.md** (locked spike) — engine `untitled-pixi-live2d-engine@1.3.1` + `pixi.js@8.19.0`, Cubism Core 5.1.0. **Both Cubism 2 (`.model.json`/`.moc`) and Cubism 3-5 (`.model3.json`/`.moc3`) must stay supported.** moc3 is ~4.5 MB, textures ~1.75 MB each (memory/latency matters). **Reference-first rule**: study `references/BANDORI-PET-REV-main/` `.zst` + import code, clean-room adapt (GPLv3 — patterns yes, no verbatim copy). Cubism 2 costumes may reference an external `../_mtn_emp/` shared motion pool absent from the `.zst` → *"handle missing motion refs gracefully at import (#18)."*

---

## 4. Workspace layout (confirmed root + proposed `characters/` subtree)

**Confirmed Workspace root** (`main.ts`): `serverConfig.dataDir` default `join(homedir(), ".takiagent")` (server-config.ts:30), Workspace = `join(dataDir, "workspace")`. All feature subdirs are siblings under it: `workspace/memory` (main.ts:127), `workspace/attachments` (main.ts:153), `workspace/screenshots` (main.ts:210), workspace file-tool root (main.ts:235). The Rust side already knows this path: `lib.rs:158` resolves `home.join(".takiagent").join("workspace")` for the exec cwd.

**Proposed `#18` layout** (a new sibling, pluggable module per invariant 7; characterId-addressable, multi-character reserved):
```
<dataDir>/workspace/characters/<characterId>/
    character.json                     # marker/metadata (imported flag, source, display name) — see BANDORI _custom.json
    <costume>/                         # one dir per costume
        <settings>.model3.json|.model.json
        *.moc3 | *.moc
        textures/*.png
        motions/*.motion3.json|*.mtn
        *.physics3.json, *.pose3.json, *.exp3.json, …
```
This mirrors the BANDORI reference exactly (`models/<character>/<costume>/…` + a `_custom.json` marker at character level; `custom_model_import.py:1-14, 278-287`).

---

## 5. Where extraction runs + the `.zst`/`.zip` format (Core-side, zero new deps)

**Extraction runs Core-side** in a new `packages/core/src/characters/` (or `character-import/`) module — the operator-driven analogue of `attachment-store`. It receives the archive bytes, validates + unpacks into the `characters/` subtree, and returns the imported characterId + costume list.

**Archive formats** (from the reference, clean-room to adapt):
- `.zst` = **a zstd-compressed tar stream** with a leading `.bandori_zst_index.json` member listing files (`zst_model_archive.py:332-353` opens `zstd.stream_reader` → `tarfile mode="r|"`; `TOOL-convert_models_to_zst.py:55-62` writes `tar mode="w|"` inside a zstd `stream_writer`, index first). Per-member/traversal safety via `_normalize_member` (rejects `..`, absolute, empty; `zst_model_archive.py:355-367`).
- `.zip` = plain zip with Zip-Slip defense (`custom_model_import.py:345-352`: resolve each member, reject if it escapes dest).

**Node can decompress `.zst` natively — no new dependency.** `node:zlib` gained `zstdDecompressSync` / `ZstdDecompress` in **v23.8.0** (also backported to v22.15.0) — Node docs, verified. The project floor is **Node ≥ 24 LTS** (CLAUDE.md toolchain table), so native zstd is guaranteed. The `.zst` is `zstd(tar(...))`, so extraction = `zlib.zstdDecompressSync(bytes)` → parse the tar. Tar parsing has no stdlib module; either a tiny hand-rolled ustar reader (the format is simple, and the reference shows exactly which members matter) or a small dep — **the PRD should pick** (decision 6). `.zip` decompression is likewise `node:zlib` inflate + local-file-header parsing, or a small dep.

**Manifest validation + Cubism generation detection** (clean-room from `custom_model_import.py:91-99, 170-240`):
- Cubism 2: top-level `{ model: string, textures: string[] }`.
- Cubism 3-5: `{ FileReferences: { Moc: string, Textures: string[], Physics?, Pose?, Motions?, Expressions? } }`.
- Validate each referenced resource exists after extract; **degrade gracefully on missing motion refs** (renderer-spec requirement for taki `casual/`'s external `../_mtn_emp/`), do not hard-fail the whole import.

---

## 6. The three serving options, weighed with evidence

### Option A — Tauri `asset:` protocol (RECOMMENDED, least new code)
- **What**: enable `app.security.assetProtocol` in `tauri.conf.json` with `enable:true` and `scope: ["$HOME/.takiagent/workspace/characters/**"]`; in the renderer, `convertFileSrc(absoluteModelSettingsPath)` → a fetchable URL (`http://asset.localhost/…` on Windows), passed to `Live2DModel.from(url)`. The engine's `resolveURL` resolves each sibling resource against that URL — they are also under the scope, so textures/motions/physics load, **lazily**, with zero extra wiring.
- **Evidence**: Tauri docs — *"Tauri can serve files from disk into the WebView through the asset custom protocol (for example when you use `convertFileSrc`)… controlled by `app.security.assetProtocol`… set `enable` to `true` and define a `scope`"* (v2.tauri.app/security/asset-protocol). Scope supports `$HOME` variables + globs. Because the subtree is a **fixed, known** path (not a user-picked arbitrary folder), the static `tauri.conf.json` scope suffices — **no `tauri-plugin-persisted-scope` needed** (that is only for runtime-picked arbitrary paths).
- **CSP**: `tauri.conf.json` currently has `"csp": null` (tauri.conf.json:38) → no CSP restriction today, so `asset:` loads out of the box. Hardening (recommended, not required): set a CSP with `connect-src` including the asset origin (the engine uses **XHR**, so `connect-src` is the load-bearing directive, plus `img-src`/`default-src` per the Tauri CSP example `img-src 'self' asset: http://asset.localhost blob: data:`).
- **Pros**: no Rust handler; Tauri-sanctioned, scoped, read-only; preserves the engine's lazy motion/texture loading (a motion is fetched only when played); zero base64 overhead.
- **Cons**: exposes absolute host paths in URLs (cosmetic); in v1.5 split-machine the files are on the VPS, not the host — see §7 decision 7.

### Option B — Custom `register_uri_scheme_protocol` (FALLBACK, more control)
- **What**: register `taki-model://…` (or `register_asynchronous_uri_scheme_protocol` for large reads off-thread) in `lib.rs`, mapping `taki-model://<characterId>/<costume>/<file>` to the Workspace subtree with an explicit read + traversal guard.
- **Evidence**: `tauri::Builder::register_uri_scheme_protocol(scheme, |ctx, req| …)` / `register_asynchronous_uri_scheme_protocol(scheme, |ctx, req, responder| …)` — docs.rs/tauri Builder; the documented example reads a file by path and returns bytes. Windows origin is `http://<scheme>.localhost/` (needs matching CSP `connect-src`).
- **Wiring cost**: a new module under `src-tauri/src/` (keep `lib.rs` a shim), and — if the scheme is used by the pet webview — likely no extra capability entry (URI-scheme protocols are registered on the Builder, not gated by the `capabilities/*.json` command allowlist the way plugin commands are; verify at implementation). CSP still applies.
- **Pros**: characterId-routing indirection (no absolute paths leaked); could serve **straight from the `.zst` without extracting** (mirrors the reference's `load_virtual_bytes`/virtual-path cache, `zst_model_archive.py:34-61`); one explicit security surface in Rust.
- **Cons**: more code than Option A for no v1 functional gain; still host-file-bound in v1.5 exactly like Option A.

### Option C — WS base64 + `blob:` URLs (extend #17) — NOT recommended for v1
- **What**: extract Core-side, add a WS method returning each file's base64 (like `media.get`), mint `blob:` object URLs client-side, feed the engine via `ModelSettings.replaceFiles()` or `FileLoader`.
- **Precedent exists**: `media-get.ts` + `attachment-store.ts` prove the WS-base64 byte-serving pattern (single-ref, whole-ref-regex confined). #17's file-pick→base64 path (`use-image-attach.ts`) proves the UI can read picked bytes without a Tauri plugin.
- **Why it loses for v1**: a model is a **graph** of files (moc3 + N textures + motions + physics + expressions), and the engine loads motions/expressions **lazily** (index.d.ts:4205/4213). A blob-map must either (a) pre-fetch **everything** up front — defeating laziness, forcing dozens of round-trips of 4.5 MB moc3 + 1.75 MB/texture, each +33% base64 — or (b) intercept the loader mid-flight (deep engine surgery). It reimplements the resolver the protocol gives for free. The renderer spec explicitly flags memory pressure on the always-on overlay (live2d-renderer.md:32), which base64-everything worsens.
- **Its one genuine advantage**: it works **unchanged in v1.5 split-machine** because bytes already flow from the Core over WS. This is exactly the v1.5 tension in §7 decision 7 — but it does not justify paying the eager-load + overhead cost in the v1 single-machine default.

**Decision logic**: the engine is URL-only and lazy (§1). A URL protocol (A or B) is the natural fit; A is the minimal one. Choosing A for v1 does **not** foreclose v1.5 — the same ADR 0007 file-RW migration (extraction moves host-side) keeps A working host-side, OR a v1.5 switch to C. Recommend **A for v1**, keep **B** in the back pocket, treat **C** as the v1.5 escape hatch, not v1 architecture.

---

## 6b. Import trigger + costume-switch data flow (what #16/#17 already give us)

**Import trigger — two shapes, recommend the UI-reads-bytes one for consistency:**
- **#17 precedent (recommended)**: a hidden `<input type="file">` in a settings/import view; the browser reads the picked archive to bytes (`use-image-attach.ts:22-29` FileReader → base64; `image-attach-decode.ts` size gates). The bytes travel to a new WS method (e.g. `character.import { archiveBase64 | fileName }`), the Core extracts. **No Tauri plugin needed** — `apps/desktop/package.json` has **no `@tauri-apps/plugin-dialog` JS binding** (only the Rust `tauri-plugin-dialog` used for the approval dialog, Cargo.toml:26). This keeps the operator→core byte flow identical to attachments.
- **Alternative (Tauri dialog returns a path)**: add the `@tauri-apps/plugin-dialog` JS plugin so the operator picks a path, then the Core reads the path directly. Rejected as default: it makes the Core read an arbitrary host path the operator chose (a fs-scope surface) and needs a new JS dep; the byte-upload path reuses the #17 seam. **PRD to lock (decision 5).**

**Costume-switch flow (the vocab re-report machinery already exists):**
1. Pet UI loads a model → `pet-scene.ts:47` `loadTakiModel` → `createAvatarController` (avatar-controller.ts:30) → `readVocabulary(model)` reads `motionManager.definitions` + `expressionManager.definitions` (model-vocabulary.ts:15-22).
2. On connect, `use-core-connection.ts:62` calls `client.reportAvatar({ characterId, ...scene.reportVocabulary() })` → WS `avatar.report` → `avatar-report.ts:20` `vocabulary.set(characterId, {motions, expressions})`.
3. `avatar-vocabulary.ts:26` stores per-character; `main.ts:285-286` injects it into every turn's `instructionsExtra(characterId)` (Option A, no baked enum).
4. **The re-report contract is already documented**: `avatar-report.ts:21` — *"The Pet UI re-reports on load / costume-swap; a `set()` fully replaces the character's prior vocabulary."* So a costume switch = load the new costume's model (new `Live2DModel.from(newCostumeUrl)`) → `readVocabulary` → `reportAvatar` again → the Core's vocab store + turn prompts update automatically. **The manifest re-extraction runs client-side in the renderer** (it reads the loaded model's managers), not Core-side — the Core only stores what the UI reports. **No new vocab plumbing needed; the new work is the model-swap + re-report trigger in the renderer/UI.**

**What #16/#17 give us for free**: characterId is already threaded end-to-end (chat, avatar, timeline all carry `characterId`); the avatar vocabulary store + `avatar.report`/`avatar.command` fan-out; the per-character turn-prompt injection; the Workspace single-writer fs pattern (attachment/screenshot stores); the operator-only WS-method shape (`media.*`); the UI file-pick→bytes path. **Genuinely new**: the extraction module (zst/zip → `characters/`), the serving protocol (asset:/custom), the import + costume-switch WS methods, and the renderer model-swap trigger. `ACTIVE_CHARACTER_ID` is currently a compile-time constant (`active-character.ts:8` = `"taki"`); making it selectable is scheduled for M5 #24/D22 — **#18 supplies the addressable storage layer beneath that**, and its UI is single-character.

---

## 7. Open design decisions the PRD MUST lock (each with a lean)

1. **Serving protocol** — Tauri `asset:` protocol (Option A) vs custom `taki-model://` (Option B) vs WS-base64 (Option C). **Lean: A for v1** (least code, preserves lazy load, engine is URL-only per §1). Evidence: §1, §6.
2. **Extraction locus** — Core-side `node:fs` into `<Workspace>/characters/` vs anywhere else. **Lean: Core-side**, per ADR 0007 v1 + invariant 2 (single Workspace writer). Evidence: §3, `main.ts:153/210`.
3. **On-disk layout** — `<Workspace>/characters/<characterId>/<costume>/…` + a character-level `character.json` marker. **Lean: yes**, characterId-addressable now even though v1 UI is single-character (CONTEXT.md Character decoupling; AC). Evidence: §4, BANDORI `custom_model_import.py`.
4. **`.zst` tar parsing** — hand-rolled ustar reader vs a small tar dep (decompression itself is dep-free native `node:zlib` zstd, §5). **Lean: hand-rolled minimal reader** (KISS, the format is trivial and the reference shows the members that matter) — but flag as the one spot a dep is defensible. Evidence: §5, `zst_model_archive.py`.
5. **Import trigger** — UI reads picked bytes → WS upload (reuse #17 seam) vs Tauri dialog returns a path the Core reads. **Lean: UI-reads-bytes** (no new dep, identical to attachments; Core never reads an arbitrary host path). Evidence: §6b, `use-image-attach.ts`, `package.json`.
6. **Missing-resource policy** — hard-fail the import vs import-with-warnings, skipping absent optional refs (e.g. Cubism 2 external `../_mtn_emp/` motions). **Lean: import-with-warnings for optional refs, hard-fail only on missing moc/textures** (essential). Evidence: live2d-renderer.md:36, `custom_model_import.py:185-240`.
7. **v1.5 split-machine asset locality (defer, but record)** — in split-machine the Workspace `characters/` sits on the VPS Core, but the Pet UI + serving protocol are host-side, so `asset:`/custom cannot read them. **Lean: defer to v1.5** (log in `docs/deferred-decisions.md` with trigger = "split-machine build"), resolving then via the SAME ADR 0007 file-RW host-migration (extraction moves host-side) OR a switch to Option C (WS-base64). v1 single-machine makes it moot. Evidence: ADR 0007 §3; §6 Option C.
8. **CSP** — leave `csp:null` (works, unhardened) vs set a scoped CSP now. **Lean: set a scoped CSP as part of #18** (`connect-src` is load-bearing since the engine uses XHR; add `asset:`/asset origin + `blob:`). Evidence: §6 Option A, Tauri CSP docs.
9. **Costume-switch model reload** — full teardown+`Live2DModel.from()` of the new costume vs in-place swap. **Lean: reload via `from()`** (the renderer already re-reports vocab on load; simplest correct path), reusing `pet-scene`'s load path. Evidence: §6b, `avatar-report.ts:21`.

---

## 8. Hardened zones / ADR flags

- **D1 turn runtime — UNTOUCHED.** Character import is a new Core module + new operator-only WS methods + a renderer model-swap. It does not modify the chat stream loop, `persistTurn`, abort wiring, or `toolApproval` (the frozen regions per `agent-runtime.md`). Confirmed: nothing in the proposed design edits `agents/` turn code.
- **Invariant boundaries — respected.** Extraction is operator-driven Core-fs (same family as attachments, not an agent OS action → invariant 1 intact); Core stays single Workspace writer (invariant 2); serving is host-side Rust (invariant 8 intact for core/shared).
- **ADR-adjacent calls** (not strictly new ADRs, but worth a one-line record): (a) **decision 1** introduces a new webview↔host file-serving channel (the `asset:`/custom protocol) — the first non-WS data path from host disk to the Pet UI; arguably an ADR or an ADR-0004 addendum. (b) **decision 7** is a genuine ADR-0007 follow-on (where character assets physically live in split-machine) — record it in the deferred register with an explicit trigger rather than a new ADR now.
