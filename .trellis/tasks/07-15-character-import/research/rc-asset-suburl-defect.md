# #18 Phase B live-smoke defect — asset: sub-resource URL resolution

**Found**: 2026-07-15, leader A-mode live smoke (real Core + `pnpm desktop:dev`, imported `taki.zst`).

## Symptom
The costume's settings JSON loads, but every sub-resource 404s:
```
ERROR tauri::protocol::asset: asset protocol not configured to allow the path: data/model.moc
ERROR tauri::protocol::asset: asset protocol not configured to allow the path: data/textures/texture_00.png
```
Panel shows "Network error. 无法更换服装." The dev fallback model (`/spike-assets/arbeit/model.json`) renders fine; only an IMPORTED costume (an `asset:` URL) fails.

## Root cause (fully traced, with evidence — NOT a scope-config issue)
The rejected path is **relative** (`data/model.moc`), not the absolute path under the scope. That is the tell. Chain:

1. `character-asset-url.ts` composes the absolute settings path and calls `convertFileSrc(absolutePath)`. On Windows Tauri 2 this yields `http://asset.localhost/<url-encoded WHOLE absolute path>` — the entire device path is ONE URL path segment.
2. The engine loads the settings JSON, then resolves each sub-resource via `ModelSettings.resolveURL(relPath)` → `resolveURL(this.url, relPath)` (engine `dist/index.js:507`).
3. `resolveURL(base, path)` for a relative `path` (no scheme, no leading `/`) with a scheme-bearing `base` returns `new URL(path, base).toString()` (`dist/index.js:193`).
4. **`new URL("data/model.moc", "http://asset.localhost/C%3A...arbeit%2Fmodel.json")` = `http://asset.localhost/data/model.moc`** — verified live with node. Standard URL resolution replaces the LAST segment (the encoded absolute path sits in the "filename" position, not a "directory" position), so the absolute prefix is discarded.
5. The asset protocol receives `data/model.moc`, which does not match `$HOME/.takiagent/workspace/characters/**/*` → rejected.

**No scope string can fix this** — the path reaching the protocol is already wrong (relative). The fault is `convertFileSrc`'s single-segment encoding being incompatible with the engine's `new URL` relative resolution.

## Why it passed every gate + both checks
- `cargo check` validates the asset config schema, not runtime path resolution.
- Unit tests mock the engine; `costume-switch.test.ts` never exercises real `resolveURL`.
- fable5's check (correctly, given the info then) accepted the arch research's assumption that a URL-serving protocol "just works" because `Live2DModel.from` is URL-based — true, but the research did not trace how `convertFileSrc`'s encoded-single-segment URL interacts with the engine's `new URL` join. Only a real webview loading a real multi-file model surfaces it.
- The dev fallback uses `/spike-assets/arbeit/model.json` — a normal http path where `new URL` join works correctly, so dev rendering masked the bug.

## The fix (each step has source evidence)
Rewrite every sub-resource to its OWN absolute `asset:` URL before load, bypassing the engine's relative join:
1. `fetch(settingsUrl)` → settings JSON (the settings file itself loads; only sub-resources fail).
2. Detect generation via the engine's own `CubismModelSettings.isValidJSON` / `CubismLegacyModelSettings.isValidJSON` (both exported, d.ts:6017/4980) and `new` the matching subclass with `{ ...json, url: settingsUrl }`.
3. `settings.replaceFiles((file) => costumeFile(file))` — the engine's own traverser covers moc/textures[i]/motions/expressions for BOTH generations (d.ts:584 example). `costumeFile` returns `convertFileSrc(<costumeDir>/<file>)`, an absolute asset URL.
4. `Live2DModel.from(settings, options)`.
   - Safe because `resolveURL(base, path)` short-circuits `if (SCHEME_RE.test(path)) return path` (dist:187) — a replaced value that is already a full `http:` URL is returned as-is, never re-joined.
5. `replaceFiles`'s replacer calls `convertFileSrc` (a Tauri API), so it is built in `lib/character-asset-url.ts` and injected into the renderer as a plain `(relPath) => string` function — the renderer stays framework-free.

## Deferred/registered
The dev-vs-prod CSP caveat still stands (D18 packaging track). This defect is a v1 blocker for #18, fixed inline.
