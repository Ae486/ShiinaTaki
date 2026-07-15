# PRD — #18 Character import (generic Cubism + `.zst`) + costume switching

> **Status**: design locked from research (`research/ra-asset-architecture.md` fable5, `research/rb-zst-and-cubism.md` opus — two independent streams, converged). The last M4 issue.
> **User pre-authorization (2026-07-15)**: "#18 按当前设计的做，精致管理留到之后完善。可以根据需要权衡地学习参考 BANDORI 的设计。" So精致 management UI (character roster, import wizard, costume-picker, new-character authoring) → M5; #18 ships the addressable storage + serving + live switch layer beneath it. Reference-first: BanG Dream `references/BANDORI-PET-REV-main/` (GPLv3) studied for FORMAT + ALGORITHM only; all shipped code is clean-room to our conventions.

## 1. What ships

The characterId-addressable model layer + live costume switching:
- **Generic Cubism import** (baseline): a folder OR a `.zip` containing `model.json`/`*.model.json`/`*.model3.json` → validated → extracted to the Workspace, renderable.
- **BanG Dream `.zst` import**: a `character.zst` collection archive → a collection adapter (clean-room) enumerates costumes, extracts the chosen one to the Workspace.
- **Live costume switch**: swap the loaded model to another costume; the renderer re-extracts the new costume's motion/expression manifest and re-reports it → #16's avatar vocabulary updates automatically.
- Models live under the Workspace, characterId-addressable; nothing proprietary is committed or bundled.

**NOT in #18** (→ M5 #24 / D22): the character-selection UI (`ACTIVE_CHARACTER_ID` stays the compile-time `"taki"`), the import wizard/roster panel, the soul-swap persona selector, new-character authoring, pretty costume display names. #18's UI surface is minimal: an operator import affordance + a costume switch affordance for the single active character.

## 2. Locked decisions (each = a research lean, all user-preauthorized)

1. **Serving path = Tauri `asset:` protocol** (arch §6 Option A). `Live2DModel.from()` resolves every sub-resource (moc3/textures/motions/physics/expressions) by **fetchable URL** and loads motions/expressions **lazily** (the gating fact, arch §1); the `asset:` protocol serves the Workspace `characters/` subtree to the WebView with zero per-file wiring and preserves laziness. Rejected: WS-base64+blob (Option C) forces eager materialization of dozens of multi-MB files at +33% base64 — kept only as the v1.5 split-machine escape hatch (decision 7). Custom `taki-model://` (Option B) is the back-pocket if `asset:` scope proves insufficient.
2. **Extraction locus = Core-side `node:fs`** into the Workspace (ADR 0007 v1 + invariant 2: Core is the single Workspace writer). Same operator-driven-fs family as attachment-store/screenshot-store → invariant 1 intact (not an agent OS action). Decompression/untar/unzip is pure computation; only the extracted-file WRITES are fs, and they stay Core-side.
3. **On-disk layout** = `<dataDir>/workspace/characters/<characterId>/<costume>/…` (sibling to `memory/`, `attachments/`, `screenshots/`) + a character-level `character.json` marker (`{characterId, source, importedAt, costumes:[...], defaultCostume}`). characterId-addressable now (AC), even though v1 UI is single-character.
4. **`.zst` decode = Node built-in `node:zlib` zstd** (zero dep; Node ≥24 has `zstdDecompressSync`/`createZstdDecompress`, verified on the real assets); **tar via `tar-stream`** (PAX-safe — the zst stream empirically hit the `././@PaxHeader` bug that a naive ustar walker surfaces as bogus members; `tar-stream` handles pax natively). **zip via `fflate`** (`unzipSync`, MIT, ~8kB, pure-JS — Node has no built-in ZIP reader). Enumerate archive members via the `.bandori_zst_index.json` manifest member (never trust raw tar names). Cap decode-window memory (`ZSTD_d_windowLogMax`) against hostile archives.
5. **Import trigger = UI reads picked bytes → WS upload** (reuse #17's file-pick→bytes seam; `apps/desktop` has no `@tauri-apps/plugin-dialog` JS binding, and this keeps the Core from reading an arbitrary operator-chosen host path). A new operator-only WS method `character.import`.
6. **Missing-resource policy = import-with-warnings for OPTIONAL refs, hard-fail only on missing moc/textures** (essential). Resolves `live2d-renderer.md:36`: taki `casual/` (C2) references an external `../_mtn_emp/` shared-motion pool absent from the `.zst`; C2 validation checks only moc+textures (the zst stream proved the reference does the same), so that reference passes import and is **tolerated at load** (the renderer degrades a missing motion gracefully, never crashes). Every resource path passes a `..`/absolute/traversal guard (Zip-Slip / archive-member normalization) before any write.
7. **v1.5 split-machine asset locality = DEFER + register (D30).** In split-machine the Workspace `characters/` sits on the VPS Core while the serving protocol is host-side, so `asset:` cannot read it. Moot in v1 single-machine. Trigger = split-machine build; resolve then via the ADR 0007 file-RW host-migration or a switch to Option C.
8. **CSP = set a scoped CSP as part of #18.** `tauri.conf.json` currently has `csp:null`. The engine uses **XHR**, so `connect-src` is load-bearing; enable `app.security.assetProtocol` with `scope: ["$HOME/.takiagent/workspace/characters/**"]` and a CSP allowing the asset origin (`connect-src`/`img-src` include `asset:`/`http://asset.localhost`/`blob:`/`data:` per Tauri's example).
9. **Costume switch = reload via `Live2DModel.from(newCostumeUrl)`** (teardown + reload; the renderer already re-reports vocab on load — `avatar-report.ts:21`: "Pet UI re-reports on load / costume-swap; set() fully replaces prior vocabulary"). Manifest re-extraction runs **client-side in the renderer** (reads the loaded model's managers via `model-vocabulary.ts`), then `reportAvatar` again — the Core only stores what the UI reports, so NO new vocab plumbing.

## 3. Protocol (new, `@taki/shared`)

Operator-only methods (no Rust serde mirror — like `media.*`, keep out of `protocol-fixtures.test.ts`; standalone schema test):
- `character.import { sourceKind: "zip" | "zst" | "folder-archive", archiveBase64: string, fileName: string, characterId?: string }` → `{ characterId, costumes: string[], defaultCostume: string, warnings: string[] }`. (v1 folder import is delivered as a zip of the folder from the UI; the Core path handles zip + zst.)
- `character.list {}` → `{ characters: [{ characterId, costumes: string[], defaultCostume, source }] }` (reads `character.json` markers; feeds the switch affordance + reserved for the M5 roster).
- `character.costumes { characterId }` → `{ costumes: string[], current?: string, defaultCostume }`.
- **Costume switch is client-side** (the renderer loads a new `asset:` URL + re-reports vocab); the only server involvement is the vocab it re-reports through the EXISTING `avatar.report`. No `costume.switch` WS method needed — flag if implementation finds one is.
- `CharacterImportError` codes (clean-room vocabulary from the reference): `no_model_json`, `bad_model_json`, `missing_moc`, `missing_textures`, `unsafe_resource_path`, `bad_zip`, `bad_zst`, `name_exists`, `invalid_name`. Reuse an existing `ErrorCode` for the WS envelope where one fits; do NOT extend the Rust-mirrored enum for these import-domain codes (ride `error.data`).

## 4. Data flow

### 4.1 Import (operator → Workspace)
```
UI: file-pick (accept .zip,.zst) → read bytes → base64 (reuse #17 use-image-attach FileReader seam)
  → character.import { sourceKind, archiveBase64, fileName, characterId? }
Core character-import module (new, packages/core/src/characters/):
  decode base64 → bytes
  sourceKind "zst": zstdDecompress (node:zlib, windowLogMax capped) → tar-stream parse
                    → read .bandori_zst_index.json member → enumerate costumes (dirs w/ a model manifest)
  sourceKind "zip": fflate.unzipSync → { path: bytes } (Zip-Slip guard per path)
  for the chosen/each costume: detect C2 (top-level {model,textures}) vs C3 ({FileReferences.Moc,...})
    validate: moc + every texture exists (hard-fail if not); optional refs (motions/physics/pose/expr) warn-if-missing
    normalize every member path (reject absolute/../traversal) BEFORE writing
    write files → <dataDir>/workspace/characters/<characterId>/<costume>/...
  write <characterId>/character.json marker
  return { characterId, costumes, defaultCostume, warnings }
```
characterId: from param, else archive filename stem (`.zst`) / a slug of the picked name; validate `^[a-z0-9][a-z0-9_-]{0,63}$`.

### 4.2 Serving (Workspace → renderer)
```
tauri.conf.json: app.security.assetProtocol.enable=true, scope ["$HOME/.takiagent/workspace/characters/**"] + scoped CSP
renderer: resolve the active character+costume's settings-file absolute path
  → convertFileSrc(absPath) → asset URL → Live2DModel.from(url)
  the engine's resolveURL fetches each sibling resource (moc3/textures/motions/...) under the same scope, lazily
```
The renderer needs the settings-file path. The Core provides it: `character.list`/`character.costumes` return costume ids; the renderer composes `<workspace>/characters/<id>/<costume>/<settings>` — OR the Core returns the settings filename per costume (it knows it from extraction; simplest: include `settingsFile` per costume in the list result). **Lock at impl: return `settingsFile` per costume** so the renderer never guesses the manifest name.

### 4.3 Costume switch (live)
```
UI switch affordance → renderer: teardown current Live2DModel → Live2DModel.from(newCostumeAssetUrl)
  → createAvatarController → readVocabulary(model) [model-vocabulary.ts] → new {motions, expressions}
  → client.reportAvatar({ characterId, motions, expressions })  [EXISTING avatar.report]
Core: avatar-report → vocabulary.set(characterId, ...) fully replaces → next turn's instructionsExtra(characterId) updated
```
No new vocab plumbing (arch §6b). The new work is the renderer model-swap trigger + the switch affordance.

## 5. File map

### Backend (`packages/core/`)
| File | Change |
|---|---|
| `packages/shared/src/character-schema.ts` (new) | `CHARACTER_METHODS {import, list, costumes}`, `CharacterImport*`/`CharacterList*`/`CharacterCostumes*` schemas, `CharacterImportErrorSchema`. Operator-only, no Rust mirror. |
| `packages/shared/src/character-schema.test.ts` (new) | round-trip |
| `packages/shared/src/index.ts` + `index.md` | export |
| `packages/core/src/characters/character-store.ts` (new) | Workspace `characters/` R/W: write extracted costume trees, read/write `character.json`, `list()`, `costumesOf(id)`, path confined under `characters/` |
| `packages/core/src/characters/zst-archive.ts` (new) | clean-room `.zst` reader: zstdDecompress + tar-stream + index-member enumeration + member normalization |
| `packages/core/src/characters/zip-archive.ts` (new) | fflate unzip + Zip-Slip guard |
| `packages/core/src/characters/cubism-manifest.ts` (new) | C2/C3 detection + validation (moc/textures hard, optional refs warn) + motion/expression name extraction (both generations) |
| `packages/core/src/characters/character-import.ts` (new) | orchestrates: decode → archive-parse → per-costume validate → write → marker → result+warnings |
| colocated `*.test.ts` for each of the above | generic import (folder-as-zip + zip), `.zst` adapter extraction (on a fixture archive), manifest re-extraction, C2/C3 detection, traversal rejection, missing-moc hard-fail, missing-optional warn |
| `packages/core/src/server/methods/character-import.ts` / `character-list.ts` / `character-costumes.ts` (new) | operator-only WS methods, thin delegation to the characters module |
| colocated method `*.test.ts` | ok + reject paths |
| `packages/core/src/main.ts` | wire character-store (Workspace `characters/` root) + register the 3 methods |
| touched `index.md`s | update (`characters/` new dir index) |

### Frontend + Shell (`apps/desktop/`)
| File | Change |
|---|---|
| `apps/desktop/src-tauri/tauri.conf.json` | `app.security.assetProtocol.enable=true` + `scope` + a scoped CSP (was `csp:null`) |
| `apps/desktop/src-tauri/capabilities/pet.json` | any asset-protocol permission the pet webview needs (verify identifier at impl; `cargo check` validates) |
| `apps/desktop/src/lib/ws-client.ts` | +`importCharacter`, `listCharacters`, `characterCostumes` (zod-parsed) |
| `apps/desktop/src/renderer/live2d/load-taki-model.ts` → generalize | load from an `asset:` URL for `(characterId, costume)` instead of the dev `/spike-assets/` route; keep the dev route as a fallback when no imported character exists (so dev still runs) |
| `apps/desktop/src/renderer/live2d/costume-switch.ts` (new) | teardown + reload `Live2DModel.from(newUrl)` + re-report vocab |
| `apps/desktop/src/features/character-import/` (new, minimal) | operator import affordance (file-pick → `character.import`) + a costume switch control for the active character; NOT the full M5 roster |
| `apps/desktop/vite.config.ts` | the dev `spike-assets` middleware stays for dev; production uses `asset:` (no change needed beyond keeping dev working) |
| touched `index.md`s | update |

## 6. TDD (the AC-pinning tests)
| # | Test | Asserts |
|---|---|---|
| T1 | `zst-archive.test.ts` | decompress+enumerate a REAL small archive fixture (`models/asuka.zst` is 1.1MB — use it read-only via an env-gated path, or a tiny synthetic tar+zstd); PAX pseudo-members are NOT surfaced as files; index-member enumeration matches |
| T2 | `zip-archive.test.ts` | unzip a synthetic zip; a `../escape` member is rejected |
| T3 | `cubism-manifest.test.ts` | C2 `{model,textures}` detected; C3 `{FileReferences}` detected; missing moc → hard error; missing optional motion → warning not error; motion+expression names extracted from BOTH generations at the right JSON paths |
| T4 | `character-import.test.ts` | folder-as-zip import → files under `characters/<id>/<costume>/`, `character.json` written, characterId-addressable; `.zst` import extracts the chosen costume; traversal member rejected; missing-texture hard-fail leaves no partial dir |
| T5 | `character-store.test.ts` | list()/costumesOf() read markers; path confined under `characters/` |
| T6 | `character-schema.test.ts` | params/results round-trip; NOT in protocol-fixtures |
| T7 | method tests | import/list/costumes ok + operator-only + reject shapes |
| T8 | frontend `costume-switch` (unit-testable core) | given a new costume, composes the right asset URL + calls reportAvatar with the re-read vocab (mock the engine) |

## 7. Constraints (hard)
- **D1 turn runtime UNTOUCHED** (arch §8): import is a new Core module + operator-only WS methods + a renderer model-swap. Nothing edits `agents/` turn code, `persistTurn`, abort, or `toolApproval`.
- **Invariant 1/2/8**: extraction is operator-driven Core-fs (attachment-store family), Core stays single Workspace writer, `characters/` code is OS-neutral (`path.join`, `node:zlib`, no Windows-only APIs); the `asset:` serving is host-side config, not core/shared code.
- **Reference-first, clean-room** (GPLv3): study `references/BANDORI-PET-REV-main/` for format+algorithm, write our own — no verbatim GPLv3 code in `@taki/*`. Cite the format facts, not the code.
- **Proprietary assets never committed/bundled**: extracted models live only in the runtime Workspace (git-ignored home dir), never in the repo tree or a build. `models/*.zst` are dev assets (git-ignored) — a test that reads one must be env-gated so CI without them still passes.
- **Traversal safety is the security surface** (→ fable5 check): every archive member + every referenced resource path is normalized and confined under the character dir BEFORE any write; a `..`/absolute/Windows-absolute path is a structured reject. The `asset:` scope is the second layer (read side).
- Headers (INPUT/OUTPUT/POS) on every new file; size caps (TS ≤300/fn ≤50/params ≤3); kebab-case; one method per file; `XSchema`+`type`; update every touched `index.md`.
- Verify `node:zlib` zstd + `tar-stream` + `fflate` + Tauri `asset:` protocol APIs against installed types/docs — never from memory.

## 8. Phasing
- **Phase A (backend)**: schema + characters module (zst/zip/manifest/import/store) + 3 WS methods + wiring → implement (Opus) → **check (fable5** — traversal security surface + clean-room + archive-format correctness on a real fixture).
- **Phase B (frontend + shell)**: `asset:` protocol config + CSP + generalized load path + costume-switch + minimal import affordance → implement (Opus) → check (fable5 if it sets the asset-protocol convention, else Opus). Depends on Phase A's protocol + a extracted-character fixture.
- Commit in layers. Gates: `pnpm -r typecheck && -r lint && -r test` + `cargo check` (capability/asset-protocol config validates) + desktop build. Leader live smoke: import a real `.zst`, render a costume, switch costumes, confirm vocab re-report — via a real core (the smoke may need a real archive; the backend extraction is unit-testable on a fixture, the render/switch is the human/live layer).

> Deferrals to register at task start: **D30** (v1.5 split-machine asset locality), **D31** (`.zst` packer / author-side archive creation — only if we later add "re-pack a custom character", per the zst stream's provenance note). The character-selection UI + roster + soul-swap remain D22 (M5 #24).
