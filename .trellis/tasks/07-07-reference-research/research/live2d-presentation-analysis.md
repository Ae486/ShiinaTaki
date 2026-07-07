# Research: BandoriPet Live2D Presentation Layer — Feature Inventory + 连/造 Verdicts

- **Query**: What presentation features did BANDORI-PET-REV build beyond raw model rendering; for each, does our web stack (PixiJS 8 + untitled-pixi-live2d-engine / @naari3 fork) already provide it (连) or must we build it (造), and at what cost.
- **Scope**: internal (reference repo, GPLv3 study-only) + external (renderer docs — see `web-stack-live2d-coverage.md`)
- **Date**: 2026-07-07
- **Reference root**: `H:\TakiAgent\references\BANDORI-PET-REV-main`

> All code is GPLv3 — patterns/algorithms are described in prose for porting; no code is copied. Line numbers are evidence anchors.

---

## Architecture context

The reference is Python/PySide6 rendering into a `QOpenGLWidget` (`live2d_widget.py`, 1294 lines). The actual Cubism runtime is a **self-built LuaJIT core** (`Live2D-v2-Lua`, third-party) bridged via `lupa` FFI in `live2d_lua_adapter.py` (838 lines). The presentation logic (tracking, hit-test, lip-sync, quality, window compositing) all lives in Python around that core and is **renderer-agnostic in spirit** — this is exactly the layer we must reproduce on PixiJS 8. See the "LuaJIT core" section at the end for why the core itself is irrelevant to us.

---

## Feature Inventory

### 1. Head / eye cursor tracking ("老婆跟着鼠标转头")

**Mechanism**: A 30 fps `QTimer` (`live2d_widget.py:229-232`) polls the global cursor (`_poll_head_tracking` → `_track_current_head_target` :722-733). `_track_head_at_global` (:689-720) computes cursor delta vs the model's on-screen center, applies a **min-delta squared gate** (`_head_track_min_delta_sq = 16`, :243, :698) to skip micro-moves, **clamps the reach to 600px radius** (:710-717) so off-screen cursors don't peg the head, then calls `model.Drag(local_x, local_y)`. `Drag` in the SDK drives `ParamAngleX/Y`, `ParamBodyAngleX`, `ParamEyeBallX/Y` — i.e. this is the standard Cubism "focus/look-at" behavior with a custom polling + gating wrapper.

- **连/造**: **连 (built-in).** Both `pixi-live2d-display` derivatives expose automatic **focusing** — `model.focus(x, y)` and pointer-follow. See `web-stack-live2d-coverage.md`. The 600px clamp and delta-gate are trivial UI-local tweaks.
- **Cost if porting the polish**: **small** — call `model.focus()` on a throttled `pointermove`/`requestAnimationFrame`; clamp the target vector to a max radius; skip updates below a pixel delta.

### 2. Mutual gaze / 对视 (multi-character look-at-peer)

**Mechanism**: When enabled, `_update_mutual_gaze` (`pet_window.py:1512-1536`) finds the nearest *other* pet window and calls `widget.set_gaze_target(gx, gy)` (`live2d_widget.py:383-390`). A gaze target **overrides** cursor tracking inside `_track_current_head_target` (:727-729). Recomputed on `moveEvent` (:1546-1547).

- **连/造**: **造 (small).** The look-at primitive is `model.focus()` (连); the "aim at nearest peer window" policy is app logic. On web, peer positions come over our WS bus, then feed `focus()`.
- **Cost**: **small** — a few lines once window positions are shared.

### 3. Click / touch hit-testing — TWO independent systems

**(a) Alpha-mask pixel hit-test (also powers click-through).** The widget reads back the rendered **alpha** at the cursor via OpenGL `glReadPixels`, cached, and compares against a threshold (`DEFAULT_HIT_ALPHA_THRESHOLD = 8`, :14, :190). To avoid stalling the GL pipeline it uses a **4-deep PBO (Pixel Buffer Object) ring with fence sync** for async readback: `_init_hit_pbos` (:1084-1116), `_queue_hit_pbo_read` (:1179-1208), `_process_hit_pbo_results` polls fences (:1140-1170), `_alpha_near`/`_alpha_at` sample a small neighborhood (:1210-1243). A synchronous path (`_get_alpha_sync` :1274-1285) is used for actual clicks; the async path feeds the click-through poll. Purpose: pixel-accurate "did the user click the drawn character, not the transparent margin".

**(b) SDK + custom named hit areas.** `hit_area_name_at` (:916) first tries **custom rectangular areas** then SDK areas. Custom areas are defined in model-space and **projected to screen space every frame** by an affine transform in `custom_hit_area_state.lua` (:29-76): it takes 3 canvas corner points (c0,c1,c2), builds the inverse of the 2×2 basis (`det`, `inv_det` :37-42), and maps each area's model-space AABB corners into screen pixels, storing min/max (`hit_test_name` :78-86, `bounds_for`, `union_bounds`). Python wrapper `lua_hit_area_projection.py` (`LuaCustomHitAreaState`) marshals areas in/out. Reprojected on resize/DPR change (`_update_custom_hit_area_projection` :473-487).

- **连/造**:
  - Named hit areas → **连**: `model.hitTest(x,y)` returns hit-area names; `model.on('hit', areas => ...)` fires `tap_*`. Built into both renderers.
  - Pixel-alpha hit-test → **造 (medium)**, but **cheap on web**: PixiJS gives `renderer.extract.pixels()` / an alpha render-texture readback, and containers have `hitArea`/alpha. We don't need the PBO fence machinery — that entire 120-line async-readback subsystem exists only because Python↔GL `glReadPixels` is expensive and blocking; in a WebGL/PixiJS pipeline you either use the library's bounding hit-test (连) or one `extract` call.
- **Cost**: named-area reactions **small** (wire `hit` event). Pixel-perfect click mask **medium** if we want it for click-through (see #11). The affine-projection algorithm is a **worth-porting pattern** if we ever want named clickable regions the SDK model doesn't define.

### 4. Click-region → motion/expression mapping (personality presets)

**Mechanism**: `click_motion_region_for_point` (`live2d_click_actions.py:92-138`) buckets a click into one of **7 regions** — `head`, `upper_body_{left,center,right}`, `lower_body_{left,center,right}` — by normalized x/y ratio (head if `y<0.38`; upper vs lower at `0.64`; left/center/right at `0.38`/`0.62`), optionally relative to the hit area's bounds. `click_motion_presets.py` defines **7 built-in personality profiles** (`auto`, `genki`, `tsundere`, `shy`, `cool`, `surprised`, `random`, :6-89) each mapping region→emotion tag. `_AUTO_BUCKETS` (`live2d_click_actions.py:21-50`) gives fallback motion buckets per region. `resolve_motion_by_tag` / `resolve_expression_by_tag` (`click_motion_presets.py:94-169`) fuzzy-match a tag to the model's actual motion/expression names (exact → prefix → char-prefixed → regex `(^|[_-])tag($|[_-]?\d)`), with an `_EXPRESSION_TAG_MAP` synonym table. Dispatch: `pet_window._trigger_click_motion` (:2595-2625).

- **连/造**: **造 (medium).** No renderer provides region-bucketing, personality presets, or fuzzy tag→motion resolution — this is pure app content logic.
- **Cost**: **medium** — straightforward TS port (ratio bucketing + dictionaries + a regex resolver). **High-value pattern to port**: the fuzzy tag-resolver and the 7-region scheme make arbitrary community models feel reactive without per-model config, which aligns with our "generic Cubism import" requirement (TECH-STACK).

### 5. Emotion-driven expression system

**Mechanism**: `emotion_behavior.py` — `infer_emotion_behavior(text, actions)` (:148-169) resolves an emotion either from **LLM action tags** (`ACTION_EMOTION` map :20-47, e.g. `smile→happy`, `pui→angry`) or, failing that, by **scoring Chinese keyword hits** in the reply text (`_EMOTION_KEYWORDS` :130-143). The chosen emotion indexes `EMOTION_BEHAVIOR` (:49-128) → a bundle of `expressions`, `motions`, a **window animation** name (`hop`/`shake`/`settle`/`wobble`/…), and a **TTS rate**. `_emotion_intensity` (:202-212) bumps intensity from punctuation (`!!`/`？？`), ellipsis, short text; `_scaled_tts_rate` (:215-218) scales speech rate by intensity.

- **连/造**: **造 (medium).** Renderer only plays `model.expression(id)` / `model.motion(group)` (连 primitive); the emotion inference + behavior table is entirely ours. Note our architecture puts expression/motion selection in the **Agent Core via typed tools** (`avatar.set_expression`), so the LLM drives it directly — we may not even need keyword scanning. The **window-animation + tts-rate coupling** per emotion is the reusable idea.
- **Cost**: **medium**, but partly redundant with our tool-driven design; port selectively.

### 6. Lip-sync pipeline

**Mechanism** (two signals combined):
- **Amplitude envelope**: `TTSPlayer._audio_callback` (`tts_manager.py:701-732`) computes per-buffer **RMS and peak** (`rms*4.0`, `peak*0.35`, capped 0.55, :719-721) during playback.
- **Text→viseme sequence**: `_estimate_viseme_units` (:223-243) tokenizes text and maps **kana / latin / CJK** to 7 visemes (`_VISEME_POSES` :212-220: `aa/ow/iy/uw/mbp/fv/neutral`, each a (mouth_open, mouth_form) pair). `_estimate_latin_word_visemes` (:246-282) and `_estimate_kana_visemes` (:285-302) are hand-written grapheme→viseme rules; units are time-allocated across the audio (`_allocate_chunk_visemes` :653-668, `_estimate_units_per_second` :305-311).
- **Combine + drive**: a 33 ms timer (`_emit_level` :746-772) blends amplitude with the current viseme's mouth pose and emits `mouth_pose_changed(open, form)`. `SingleShotTTSCallbacksMixin._on_tts_mouth_pose_changed` (`tts_common.py:40-42`) republishes via `publish_lip_sync`, ending at `live2d_widget.set_lip_sync_pose(level, form)` (:313-316) → `_apply_lip_sync` (:879-890) **exponential-smooths** the value (`*0.55` / `*0.45`) and writes `PARAM_MOUTH_OPEN_Y` + `PARAM_MOUTH_FORM`.

- **连/造**: **连 for the plumbing, 造 for the polish.** `untitled-pixi-live2d-engine` and the `pixi-live2d-display-lipsync` lineage provide **real-time lip sync** — you hand them audio and they drive the mouth from amplitude automatically (see coverage doc). So amplitude-based lip-sync is **连**. The **viseme (mouth-form) estimation from text** — the `PARAM_MOUTH_FORM` shaping that makes "o"/"i" look different, not just open/closed — is **造 (medium)** and is the genuinely clever part here.
- **Cost**: basic amplitude lip-sync **small** (wire audio to the lib). Text-viseme mouth-form shaping **medium** and only worth it if we want higher-fidelity mouths; the kana/latin viseme tables are a **worth-porting pattern**.

### 7. Drag behavior (move the whole pet window)

**Mechanism**: `mousePressEvent` (:590-602) records origin only if the press landed on an **opaque** pixel (`_is_model_hit_at ... sync=True`). `mouseMoveEvent` (:670-687) applies a **4px dead-zone** (`total_dx²+dy² < 16`, :678) before starting a drag, then feeds per-frame deltas to a `_window_drag_callback` that repositions the OS window. `mouseReleaseEvent` (:604-631) fires a click **only if not dragged** (`_drag_moved` guard :622-623). No physics/inertia — it's a 1:1 window move.

- **连/造**: **造 (small).** Renderer has no window concept. On Tauri, dragging moves the OS window via `appWindow.startDragging()` / manual `setPosition`. The opaque-pixel gate reuses the alpha hit-test (#3a).
- **Cost**: **small** (Tauri window drag + dead-zone + click-vs-drag guard).

### 8. Idle / proactive behavior

**Mechanism**:
- **Idle motion loop**: `_start_idle_motion` (`pet_window.py:4112-4141`) filters motions whose names look idle (`_is_idle_motion_name` :4141) and plays them; `StartRandomMotion` with `IDLE` priority (`live2d_lua_adapter.py:777-788`).
- **Context idle timer**: 5 s tick (`pet_window.py:461-463`, `LIVE2D_CONTEXT_IDLE_INTERVAL_MS=5000` :215) → `_choose_context_idle_motion` picks a motion by desktop context (:2203).
- **Mouse-approach reaction**: if the cursor dwells near the pet while the user has been idle ≥12 s, play a greeting (`LIVE2D_MOUSE_APPROACH_MIN_IDLE_SECONDS` :220, dwell logic :2100-2110).
- **Proactive care policy** (`proactive_care_policy.py`, 285 lines): a **desktop-state-aware gate** (states `gaming/coding/writing/idle/...`, :12-22) with per-state `mode` (`normal/quiet/silent/encourage`), `cooldown_multiplier`, quiet-hours (:181-189), and cooldown accounting (:205-214). `evaluate_proactive_care` (:226-269) decides whether the character may proactively speak and returns a **tone hint**. This governs *when the character initiates*, not rendering.

- **连/造**: **造 (small–medium).** Idle motion auto-detection = 连 primitive (the lib auto-plays idle motions when nothing else is queued) + a small name-filter (造). The mouse-approach and proactive-care policy are entirely app/agent logic — and in our design the **proactive policy belongs in Agent Core**, not the Pet UI.
- **Cost**: idle motion **small**; proactive-care policy **medium** but it's a backend concern, not renderer. The **desktop-state → cooldown/tone table** is a worth-noting pattern for our companion-behavior layer.

### 9. Render quality tricks (SSAA, moc3 scale, texture filtering)

**Mechanism**:
- **SSAA (supersampling AA)**: `Live2DSSAAFramebuffer` (:22-86). For **moc3 models in "balanced" quality**, it renders into an FBO at **2× resolution** (`MOC3_BALANCED_SSAA_SCALE=2`, :17; gate `_moc3_ssaa_scale` :789-792), then `glBlitFramebuffer` downscales with `GL_LINEAR` to the default framebuffer (:48-71, paint path :827-855), with a direct-draw fallback. This removes the shimmer/aliasing on high-frequency moc3 edges.
- **moc3 render scale**: `DEFAULT_MOC3_RENDER_SCALE = 1.35` (:16) — moc3 models are drawn slightly larger to compensate for their framing.
- **Texture quality profiles**: `live2d_quality.py` — `performance` vs `balanced` set `texture_scale` (0.5 vs 1.0), `use_mipmap`, `bleed_passes`. Applied in `live2d_lua_adapter._apply_texture_quality` (:535-567): binds each texture, generates mipmaps, sets `GL_NEAREST` (performance) or `GL_LINEAR_MIPMAP_LINEAR` (balanced) min/mag filters + `CLAMP_TO_EDGE`. `bleed_passes` dilates texture edges to prevent transparent-seam bleeding.
- **DPR-aware viewport**: `_apply_physical_viewport` scales the GL viewport by `devicePixelRatio` (:786-811).

- **连/造**: **mostly 连.** PixiJS 8 handles AA and DPR natively: set `antialias: true` and/or `resolution = devicePixelRatio` on the renderer; `untitled-pixi-live2d-engine` advertises **Texture LOD + automatic high-precision mask detection** (coverage doc). So SSAA/mipmap/DPR are **连** via renderer config. The moc3 1.35 framing scale and per-profile perf/balanced toggle are **造 (small)** UI-local settings.
- **Cost**: **small** — mostly renderer/PixiJS config flags, not hand-rolled FBO blitting. We do **not** need to port the FBO/blit code; that's manual work PixiJS already does.

### 10. Window transparency / borderless / always-on-top (Qt + DWM)

**Mechanism**:
- Qt: `FramelessWindowHint | WindowStaysOnTopHint`, `WA_TranslucentBackground` (`pet_window.py:507-518`).
- **Win32 DWM fixes** (`win32_dwm.py`, 114 lines): on Windows 11, disable rounded corners (`DWMWA_WINDOW_CORNER_PREFERENCE=DWMWCP_DONOTROUND`, :90-91) and remove the border color (`DWMWA_BORDER_COLOR=DWMWA_COLOR_NONE`, :94-95) so the translucent window has **no visible frame**; `frame_changed` forces a `SetWindowPos` recompute (:103-114). Version-gated via `RtlGetVersion` (:68-75).
- Extended styles toggled directly: `WS_EX_TOOLWINDOW` (hide from taskbar/alt-tab), `WS_EX_NOACTIVATE` (don't steal focus), `WS_EX_APPWINDOW` (`pet_window.py:91-94, 937-959`).

- **连/造**: **连 (Tauri config), small residual 造.** Tauri window options give `transparent: true`, `decorations: false`, `alwaysOnTop`, `skipTaskbar` declaratively — replacing all the Qt flags and most `WS_EX_*`. The **Win11 DWM rounded-corner/border removal** is the one thing that may still need a `windows` crate `DwmSetWindowAttribute` call (our TECH-STACK already picks the `windows` crate for the click-through module).
- **Cost**: **small** — Tauri config + one optional Rust DWM call. The DWM attribute constants are a **worth-noting pattern** (they're the same Win32 API from either language).

### 11. Window click-through (pass clicks through transparent pixels)

**Mechanism** (the reference's own "hardest module", matching our TECH-STACK note): Because a fully click-through window can't receive events, and a fully opaque one blocks the desktop, they **poll**. `_tick_mouse_passthrough` (:1171-1181) samples the cursor each timer tick, tests whether the pixel under it is **opaque** (`_is_pet_opaque_at_global` → alpha hit-test from #3a, :1200-1203), and toggles `WS_EX_TRANSPARENT` accordingly in `_set_mouse_passthrough` (:1303-1323) via `SetWindowLong` + `SetWindowPos`. When over a drawn pixel → interactive; over transparent margin → clicks fall through to whatever is behind. Cross-platform: macOS and X11 (XFixes) variants exist (:1154-1158). A comment (:1151-1153) explains WS_EX_TRANSPARENT polling is needed to pass clicks to windows *owned by other processes*, with `WM_NCHITTEST` as a same-window fallback.

- **连/造**: **造 (large) — and this exactly matches TECH-STACK's flagged spike.** No web renderer touches this. Tauri exposes `setIgnoreCursorEvents(bool)` (the WS_EX_TRANSPARENT equivalent); the **hard part is the alpha-under-cursor test driving the toggle**, which our TECH-STACK already scopes to the Rust `windows` crate ("cursor hit-test vs canvas alpha mask", "hardest module; budget spike time").
- **Cost**: **large.** The **entire pattern is directly portable and worth porting**: (1) poll cursor position, (2) read the canvas alpha at that point (in web we can ask the Pet UI / PixiJS `extract` for the alpha, or share an alpha bitmap to Rust), (3) toggle `setIgnoreCursorEvents`. Their PBO async-readback is a Python-GL optimization we won't need; a debounced per-frame alpha lookup in the WebView is enough. The **edge-margin sampling** (`_passthrough_sample_pos` :1183-1198) and the "disable passthrough while dragging / any mouse button down" guards (:1175-1177) are the non-obvious details worth copying.

### 12. Multi-character support

**Mechanism**: Each character is an independent top-level `PetWindow`; windows **broadcast their positions** to peers (`_peer_window_positions`, peer-pos broadcast timer :1564) enabling mutual gaze (#2). No shared render surface — N windows, N GL contexts.

- **连/造**: **造 (small).** Our design already routes per-character state over the WS bus; multiple Pet UI instances/canvases is app composition. Peer-position sharing is a bus message.
- **Cost**: **small**, mostly architectural (we already have a bus).

---

## The "self-built LuaJIT core" (6× speedup) — is it relevant to us?

**What it actually is**: `Live2D-v2-Lua` is a **pure-LuaJIT reimplementation of the Cubism 2 render/update runtime** (plus a `live2d_moc3_pet_embed` path for moc3), loaded and driven from Python through `lupa`'s LuaJIT FFI. `live2d_lua_adapter.py` shows the seams: it hands the LuaJIT runtime a **GL proc-address loader** so Lua's FFI calls OpenGL directly (`_install_gl_proc_address_loader` :199-250, `qt_gl.py` bridges to the Qt GL context), lazily loads Lua modules (:174-196), and **batches an entire frame's parameters into one Lua table** per `Draw()` (`LuaLAppModel.Draw` :727-747) so there's essentially one Python→Lua crossing per frame.

**Why the 6× (30→180 fps) vs `live2d-py`**: `live2d-py` is a Python binding over the C++ Cubism SDK. Its cost is the **language-boundary tax**: every parameter set, motion update, and draw call crosses Python↔C, under the GIL, marshaling per call, dozens–hundreds of times per frame. LuaJIT's tracing JIT compiles the hot update+draw loop to native code and its FFI makes GL/struct calls at near-C cost **without leaving Lua**, so the per-frame boundary crossings collapse to ~one. The speedup is **eliminating interpreter/binding overhead**, not a better rendering algorithm.

**Relevance to our WebGL stack**: **None — this is a Python-specific problem we structurally don't have.**
- Our renderer is **PixiJS 8 + Cubism Core (WASM/JS)**. The Cubism Core is already native WASM; the update+draw loop runs **entirely inside the JS/WASM engine (V8)** with no per-call language-boundary marshaling. There is no Python↔C GIL tax to remove.
- The one transferable idea — **batch a whole frame's parameter writes into a single call** — is already how the pixi Live2D libraries and Cubism WASM operate internally; we get it for free.
- moc2/moc3 dual-format support (which the Lua core hand-rolls, `live2d_lua_adapter.py:292-304, 616-619`) is provided by `untitled-pixi-live2d-engine` via separate Cubism 2/5 bundle entries (coverage doc). We do not reimplement a runtime.

**Verdict**: Do **not** port or emulate the LuaJIT core. It solves "Python is slow at calling native code per frame," a problem absent in a WebGL/WASM pipeline. Our performance path is: use the renderer's native pipeline, enable PixiJS AA/DPR, and keep our per-frame JS work (focus/lip-sync/hit-poll) light — none of which requires a bespoke render core.

---

## Summary verdict table

| Feature | Verdict | Web build cost | Notes / pattern worth porting |
|---|---|---|---|
| Head/eye cursor tracking | 连 (`model.focus()`) | small (polish) | 600px reach clamp + delta gate |
| Mutual gaze (peer look-at) | 造 | small | reuses `focus()`; peer pos over bus |
| Named hit areas → reactions | 连 (`hit` event / `hitTest`) | small | wire `model.on('hit')` |
| Pixel-alpha hit-test | 造 | medium | PixiJS `extract`; skip their PBO machinery |
| Affine hit-area projection | 造 | medium | **port pattern** for custom named regions |
| Click-region → motion presets | 造 | medium | **port pattern**: 7-region + fuzzy tag resolver |
| Emotion → expression/motion | 造 | medium | partly redundant (we use LLM tools); port emotion→tts-rate/window coupling |
| Lip-sync (amplitude) | 连 | small | hand audio to lib |
| Lip-sync (text→viseme mouth-form) | 造 | medium | **port pattern**: kana/latin viseme tables |
| Drag = move window | 造 | small | Tauri `startDragging` + dead-zone/click guard |
| Idle motion loop | 连 + small 造 | small | lib auto-idles; add name filter |
| Proactive-care policy | 造 (Agent Core) | medium | desktop-state→cooldown/tone table pattern |
| SSAA / mipmap / DPR quality | 连 (PixiJS config) | small | `antialias`, `resolution`; **don't** port FBO blit |
| moc3 1.35 framing + perf/balanced toggle | 造 | small | UI settings |
| Transparent/borderless/on-top window | 连 (Tauri config) | small | + optional Win11 DWM corner/border Rust call |
| **Window click-through** | 造 | **large** | **port pattern** (matches TECH-STACK spike); alpha-under-cursor → `setIgnoreCursorEvents` |
| Multi-character | 造 | small | already bus-architected |
| Self-built LuaJIT render core | **skip** | n/a | Python-only problem; irrelevant to WebGL/WASM |

Renderer coverage evidence (URLs, Cubism 2 caveat) is in `web-stack-live2d-coverage.md`.
