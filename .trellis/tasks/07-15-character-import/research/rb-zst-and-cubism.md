# Research: BanG Dream `.zst` collection-archive format + generic-Cubism baseline

- **Query**: Reverse-engineer the `.zst` character-collection format (clean-room-implementable), pick TS libs (zstd decode + zip), map archive→costume→file layout, the Cubism 2 vs 3 detection rule, the generic-import validation algorithm, and the exact JSON paths for motion/expression manifest extraction (both generations). For TakiAgent #18 (character import + costume switching).
- **Scope**: mixed (GPLv3 reference `references/BANDORI-PET-REV-main/` studied for FORMAT + ALGORITHM only; real git-ignored assets `models/*.zst` + `models/extracted/taki/` observed locally; external npm/Node docs).
- **Date**: 2026-07-15
- **Clean-room note**: The BANDORI reference is **GPLv3**. Everything below is FORMAT facts and ALGORITHM shape — no verbatim code is to be copied into `@taki/*`. All code we ship is a clean-room rewrite to our conventions (per CLAUDE.md references stance + `.trellis/spec/frontend/live2d-renderer.md` line 3).

---

## TL;DR (the load-bearing answers)

1. **Container** = a POSIX **ustar tar** (with PAX extended headers), streamed through **Zstandard** compression. i.e. `character.zst` == `tar | zstd`. Magic bytes `28 b5 2f fd` (verified on `taki.zst`). First tar member is a manifest `.bandori_zst_index.json` = `{"files":[<all arcnames in pack order>]}`. Every subsequent real file is preceded by a `././@PaxHeader` pseudo-member.
2. **zstd in TS** → **use Node's built-in `node:zlib`** (`zstdDecompressSync` / `createZstdDecompress`). Zstd landed in Node **v23.8.0 / v22.15.0**; our repo pins **Node >=24** (machine has v24.18.0), so **no third-party zstd dep is needed**. Verified: `zlib.zstdDecompressSync(fs.readFileSync('models/asuka.zst'))` yields a valid ustar tar.
3. **tar in TS** → **`tar-stream`** (streaming, explicitly pax-safe, 15M weekly dl) piped from `createZstdDecompress`; or **`nanotar`** (`parseTar`, tiny, in-memory) on a fully-decompressed buffer. The #1 clean-room risk is PAX-header handling (see Caveats).
4. **zip in TS** (generic-import baseline) → **`fflate`** (`unzipSync` → `{ [path]: Uint8Array }`, pure JS, ~8kB, zero deps). Node has **no** built-in ZIP-container support (`node:zlib` does raw deflate/gzip/brotli/zstd streams, not the ZIP central directory).
5. **Cubism generation is PER-COSTUME, not per-character.** One archive mixes C2 and C3 costumes (taki: `arbeit`/`casual` = C2, `live_01` = C3). Detection rule: **C3 iff the settings JSON has a `FileReferences` object (or `Version` starts with `3`); else C2** (top-level lowercase `model`/`textures`).
6. **Costume enumeration is purely structural**: costumes = top-level directories inside the archive that contain a model manifest (`model.json` or `*.model3.json`). There is **NO display-name metadata inside the archive**; costume display names come from an **external `outfit.json` sidecar** (optional; fall back to the folder-name id).

---

## Findings

### Files Found (reference — GPLv3, study-only)

| File Path | Description |
|---|---|
| `references/BANDORI-PET-REV-main/zst_model_archive.py` | Archive reader: zstd+tar streaming open, virtual-path (`archive::member`) lazy byte reads with LRU cache, `list_archive_files` (index-member fast path), safe-member normalization, model/action resource-member resolution (both generations). |
| `references/BANDORI-PET-REV-main/TOOL-convert_models_to_zst.py` | The CONVERTER (packer): `os.walk` a `models/<char>/` folder → tar (`mode="w|"`) inside `ZstdCompressor(level=10).stream_writer` → `.zst`; writes the `.bandori_zst_index.json` index member first. |
| `references/BANDORI-PET-REV-main/tests/test_zst_model_archive_moc3.py` | Pins the exact C3 `FileReferences` resource-member shapes (moc/textures/physics/pose/displayinfo/motions/expressions). |
| `references/BANDORI-PET-REV-main/custom_model_import.py` | Generic Cubism import (folder OR `.zip`): manifest discovery, C2/C3 detection, per-manifest validation, Zip-Slip guard, costume resolution, `_custom.json` marker. |
| `references/BANDORI-PET-REV-main/model_manager.py` | Costume/character enumeration from BOTH extracted dirs and `.zst` archives; motion/expression NAME extraction; default-costume preference; `outfit.json`/`band.json` parsing; character-image (thumbnail) resolution. |
| `references/BANDORI-PET-REV-main/tests/test_custom_model_import.py` | Pins import behavior + error codes (`unsafe_resource_path`, absolute-path reject, C2 vs C3 accept). |
| `references/BANDORI-PET-REV-main/OUTFIT.md` | Human-readable character/costume roster (13 configured chars, ~305 costumes) — evidence that display names are curated external metadata. |
| `references/BANDORI-PET-REV-main/outfit.json` | The machine sidecar: `characters.<key>.display` + `characters.<key>.costumes.<id> → display_name`. 2917 lines. **Lives outside the archives.** |

### Real assets observed (git-ignored, copyrighted — structure only, never copied)

- `models/*.zst`: **47 archives, one per character** (ako, anon, arisa, asuka, taki, yukina, …), 1.1 MB–57 MB each.
- `models/extracted/taki/`: 3 costume dirs — `arbeit/`, `casual/`, `live_01/`.
- `models/asuka.zst` (smallest, 1.1 MB → 4.8 MB decompressed): decompressed + tar-parsed with Node to confirm every claim below.

---

## 1. Exact `.zst` container format (clean-room extractor spec)

### Structural facts (verified)

```
character.zst
 └─ Zstandard frame  (magic 0x28 0xB5 0x2F 0xFD, little-endian FD2FB528)
     └─ POSIX ustar tar stream  (tar header magic "ustar" at offset 257)
         ├─ .bandori_zst_index.json      (typeflag '0' file; the manifest, added FIRST)
         ├─ ././@PaxHeader                (typeflag 'x'; pax ext header for next file)
         ├─ character.png                 (character thumbnail, archive root — optional)
         ├─ ././@PaxHeader
         ├─ <costume>/model.json          (or <costume>/<name>.model3.json)
         ├─ ././@PaxHeader
         ├─ <costume>/data/model.moc      (referenced resources…)
         └─ … (one @PaxHeader before each real file)
```

- **Compression**: Zstandard, single frame, streaming. Produced by Python `zstandard.ZstdCompressor(level=10).stream_writer(...)` (`TOOL-convert_models_to_zst.py:55-61`). Level is irrelevant to decoding — a conformant zstd decoder reads any level.
- **Framing**: plain zstd of a tar byte-stream — **NOT** a custom index-prefixed container, **NOT** a zip. The "index" is a normal file *inside* the tar, not a byte-offset header. So you cannot random-seek to a member without decompressing the stream up to it (zstd is not seekable here; no seek-table frame is written).
- **Tar dialect**: ustar + **PAX extended headers** (Python `tarfile` default is `PAX_FORMAT`). Confirmed empirically: real file members are each preceded by a `././@PaxHeader` entry (typeflag `x`). The manually-added index member has **no** preceding pax header (it is built via `tarfile.TarInfo` with a short ASCII name + integer mtime — `TOOL-convert_models_to_zst.py:35-40`).
- **Member header layout** (standard 512-byte ustar block, needed for a hand-rolled parser): name @0 (100 B, NUL-padded), size @124 (12 B octal ASCII), typeflag @156 (1 B: `0`/`\0`=file, `x`=pax, `g`=global-pax, `5`=dir), magic `ustar` @257. Body padded to 512-byte boundary. Two all-zero blocks terminate the archive.
- **Index member** (`.bandori_zst_index.json`, const `INDEX_MEMBER`, `zst_model_archive.py:11`): JSON `{"files": ["character.png","casual/model.json","casual/data/model.moc", …]}` — the complete list of arcnames in pack order. The reference reads THIS for enumeration (`list_archive_files`, `zst_model_archive.py:303-328`) rather than iterating tar headers, so PAX pseudo-members never pollute the file list on the fast path. **Fallback**: if the first member is not the index, it iterates all `.isfile()` members.
- **arcnames**: relative POSIX paths from the character-folder root (`file_path.relative_to(source_dir).as_posix()`, `TOOL-convert_models_to_zst.py:30`). Forward slashes; no leading `/`; no `..`.
- **Member safety** (reference `_normalize_member`, `zst_model_archive.py:355-367`): reject empty / absolute / any `.`/`..` segment; backslash→slash; strip leading `./`. A clean-room extractor MUST replicate this (path-traversal / Zip-Slip guard) before writing any member to disk.
- **Sizes**: taki.zst 37 MB→(large); asuka.zst 1.1 MB→4.8 MB. Decompression ratio ~4-5x; a 57 MB archive (anon) → ~250 MB decompressed. moc3 assets are individually large (taki `live_01` moc3 = 4.5 MB) — see memory note in Caveats.

### zstd-in-TS library pick (evidence-backed)

**Recommendation: Node built-in `node:zlib`. No dependency.**

- Node docs (v24.x zlib): "The `node:zlib` module provides compression functionality implemented using Gzip, Deflate/Inflate, Brotli, and **Zstd**." APIs: `zlib.zstdDecompressSync(buf)`, `zlib.createZstdDecompress([opts])` (streaming Transform), plus compress variants. **Added in: v23.8.0, v22.15.0** (https://nodejs.org/docs/latest-v24.x/api/zlib.html).
- Our stack pins **Node >=24 LTS** (CLAUDE.md toolchain table); this machine runs **v24.18.0**. Verified live: `typeof zlib.zstdDecompressSync === 'function'` and it correctly decompresses `models/asuka.zst` into a `ustar` tar.
- Stability: the Zstd surface is marked **Experimental (stability 1)** in Node 22–24 docs. Functionally stable and shipping, but a defensive wrapper + a pinned-Node CI check is prudent (flag for the arch stream).
- Decompressor safety knob: `createZstdDecompress` accepts `params: { [zlib.constants.ZSTD_d_windowLogMax]: N }` to cap decode-window memory against malicious input — worth setting when importing user-supplied archives.

**Third-party alternatives (only if Node built-in is ever unavailable):**
- `fzstd` (npm, MIT, ~8kB, pure-JS, 0 deps, streaming): `fzstd.decompress(compressed)`. Caveat: max backreference distance 2^25; may fail on "ultra" (level ≥20) archives >32 MB decompressed. Our archives are level-10 (`TOOL-convert_models_to_zst.py:83`) so this limit does not bite, but the built-in has no such caveat.
- `@mongodb-js/zstd` (native N-API addon): `decompress(buf): Promise<Buffer>`. Fast but a native build dep — avoid given the built-in exists and invariant-8 OS-neutrality (native addons complicate the Ubuntu VPS target).
- `zstd-codec` (Emscripten WASM): larger, older ergonomics. Not recommended.

**Rust-side alternative** (if the arch stream puts extraction in the Shell — see Caveats/invariant-1): crates `zstd` (binds libzstd) + `tar` + `zip` are the mature picks. Mirrors the Python reference's `zstd.stream_reader → tar r|` exactly. Pin versions against docs at build time per CLAUDE.md.

---

## 2. Archive internal layout — costume enumeration & metadata map

### The map (verified on `asuka.zst`: root = `.bandori_zst_index.json` + `character.png`; 4 manifests)

```
<character>.zst  (== models/<character>/ packed; character id = archive filename stem)
├─ .bandori_zst_index.json         # manifest: {"files":[...]}  (enumeration source of record)
├─ character.{png|jpg|webp}        # character thumbnail (archive-root OR <character>/character.ext). OPTIONAL
└─ <costume_id>/                    # ONE directory per costume; costume_id = folder name
    ├─ model.json                  # C2 manifest  — OR —
    ├─ <name>.model3.json          # C3 manifest  (+ .moc3/.cdi3.json/.physics3.json siblings)
    ├─ data/ | live2d/             # C2 resource subtrees (moc/textures/motions/expressions/physics)
    ├─ textures/ motions/ expressions/   # C3 resource subtrees
    └─ …
```

### Costume enumeration algorithm (from `model_manager._read_model_archive`, `model_manager.py:181-213`)

1. `files = list_archive_files(archive)` → read the `.bandori_zst_index.json` member, return its `files[]` (already normalized, sorted).
2. For each `member` in files, keep it iff `_is_model_manifest_name(member)` — **basename (lowercased) == `model.json` OR ends with `.model3.json`** (`model_manager.py:371-374`). (Note: the archive scanner matches only exact `model.json`, NOT the `*.model.json` variant that `custom_model_import` accepts — a minor inconsistency; see Caveats.)
3. `costume_id` = the **immediate parent directory's last path segment** of the manifest (`live_01/x.model3.json` → `live_01`; `casual/model.json` → `casual`; manifest at archive root → `"default"`).
4. `format` = `moc3` iff member ends `.model3.json`, else `moc`.
5. Emit `{id, path: "<absolute-archive>::<member>", format}`, sorted by `id`.

For an **extracted directory** (`model_manager._scan_model_dir` + `_find_model_manifest`, `model_manager.py:160-179, 376-382`): for each subdir, prefer `costume_dir/model.json`, else the first sorted `*.model3.json` in that dir. costume_id = subdir name.

### Character-level metadata

- **Thumbnail** (`_find_archive_character_image`, `model_manager.py:357-369`): look for `character.png` / `character.jpg` / `character.webp` at archive root, or `<character>/character.ext`. asuka archive has `character.png` at root.
- **Display name + costume display names**: NOT in the archive. Sourced from the external **`outfit.json`** (`_parse_outfit_json`, `model_manager.py:223-238`): `data.characters[key].display` and `data.characters[key].costumes[costume_id] = "显示名"`. If a character/costume is absent, the reference falls back to `character.title()` / the raw `costume_id` (`get_display_name` `:329-330`, `get_costume_display_name` `:405-406`). **Design implication for #18**: the archive is self-describing enough to import (structural), but pretty labels need a sidecar; our PRD must decide whether to ship a curated name map, read a bundled `outfit.json`, or just show folder-name ids.
- **Default costume** (`get_default_costume`, `model_manager.py:408-417`): first present of `["live_default","casual","school_winter","school_summer"]`, else first sorted costume. Useful default-selection heuristic.

---

## 3. Cubism generation split (C2 vs C3) — detection from the FILES

**Generation is per-costume.** Verified on taki: `arbeit/model.json` + `arbeit/{data,live2d}/model.moc` = C2; `casual/model.json` + `casual/live2d/model.moc` = C2 (397 motions, 216 expressions); `live_01/adv_live2d_taki_005_live_01.model3.json` + `.moc3` = C3. One `Live2DModel.from()` call must therefore handle either shape depending on which costume is selected.

### Detection rule (robust, combining both reference checks)

Given the parsed settings JSON:

- **Cubism 3+** iff `typeof json.FileReferences === 'object'` (and, in the strict import variant, `typeof json.FileReferences.Moc === 'string'`). Secondary signal: `String(json.Version).startsWith('3')` (C3 files carry `"Version": 3`).
- **Cubism 2.1** otherwise — identified by a top-level string `json.model` (the `.moc` path). C2 files carry `"version": "Sample 1.0.0"` (lowercase key, string) and have **no** `FileReferences`.

Reference sources:
- `custom_model_import._is_cubism3_model_data` (`:95-99`): `FileReferences` is dict AND `FileReferences.Moc` is str.
- `custom_model_import._is_cubism2_model_data` (`:91-93`): top-level `model` is str.
- `model_manager._model_format_from_data` (`:393-400`): C3 iff `FileReferences` is dict **OR** `Version` starts with `"3"` — the more lenient/robust form; prefer this for detection, the strict form for validation.

### File-extension cues (secondary, for manifest discovery before parsing)

| | Cubism 2.1 | Cubism 3+ |
|---|---|---|
| settings JSON | `model.json` / `*.model.json` | `*.model3.json` |
| model geometry | `*.moc` (top-level `model` field) | `*.moc3` (`FileReferences.Moc`) |
| physics | `*.json` (`physics` field) | `*.physics3.json` (`Physics`) |
| motions | `*.mtn` (`motions`) | `*.motion3.json` (`Motions`) |
| expressions | `*.exp.json` (`expressions`) | `*.exp3.json` (`Expressions`) |
| pose / display | — | `*.pose3.json` (`Pose`) / `*.cdi3.json` (`DisplayInfo`) |

### Does `Live2DModel.from()` auto-detect?

The renderer contract (`.trellis/spec/frontend/live2d-renderer.md:7-11`) states `Live2DModel.from(source)` is the load entry and that the **runtime split is by generation** (legacy Cubism-2 needs `live2d.min.js`; modern needs `live2dcubismcore.min.js`, both loaded as `<script>` before the module). The spec's line-14-27 gotcha is that **raw parameter access differs by generation** and any param-driven feature must branch. Confirming whether `Live2DModel.from` auto-detects C2 vs C3 purely from the settings-JSON shape (vs needing an explicit hint) is the **arch stream's** finding to lock against `untitled-pixi-live2d-engine@1.3.1` — from the FILES, the detection is unambiguous (presence of `FileReferences`), so any loader that branches on that key will route correctly. Coordinate the final ruling with the arch stream.

---

## 4. Generic Cubism import (the baseline AC) — validation algorithm

Clean-room shape from `custom_model_import.py`. Input: a **folder** or a **`.zip`**. Output: `(character, [costume_ids])`, stored as `models/<character>/<costume>/…` + a `_custom.json` marker at character level.

### Minimal valid Cubism model

- **C2**: settings JSON with a string `model` (the `.moc`) that exists on disk, and a non-empty `textures[]` array whose every entry exists. Motions/expressions/physics are **NOT required** (the `_write_model` test fixture has none and passes — `test_custom_model_import.py:11-22, 54-68`).
- **C3**: `FileReferences.Moc` (string, exists) + non-empty `FileReferences.Textures[]` (each exists) + **every referenced** `Physics`/`Pose`/`DisplayInfo`/`Motions[*].File`/`Expressions[*].File` must ALSO exist (`_validate_cubism3_model` + `_cubism3_optional_resources`, `:202-240`).

> **Key asymmetry (resolves the spec's `../_mtn_emp/` note).** C2 validation checks only moc+textures, so a C2 costume with missing/external motion refs **passes import** and fails (gracefully) only at runtime. C3 validation is strict: a missing motion/expression file **rejects the import**. `.trellis/spec/frontend/live2d-renderer.md:36` warns taki `casual/` (C2) references an external `../_mtn_emp/` shared motion pool absent from the `.zst`; because `casual` is C2, that reference is never validated at import and must be tolerated at load time. (Also note: `_resolve_relative_resource` would REJECT a `..` path if it were validated — so external `../_mtn_emp/` refs are import-safe only by virtue of C2 not validating motions.)

### Validation / import pipeline

1. **Discover manifests** (`_find_model_jsons`, `:102-143`): recursively find `*.json`; skip `_custom.json`/`outfit.json`/`band.json`/`config.json`; accept `model.json` (case-insensitive) | `*.model.json` | `*.model3.json` | any JSON that parses as a model (`_is_model_json`). Empty ⇒ error `no_model_json`.
2. **Resolve costumes** (`_resolve_costumes`, `:243-275`): **1 manifest** ⇒ single costume using the user-supplied id (fallback = parent folder name or `"default"`). **N manifests** ⇒ one costume per containing folder, ids from folder names, de-duplicated with `_2`, `_3`, … suffixes.
3. **Validate each manifest** (`_validate_model_manifest`, `:170-182`) via the C2/C3 rules above. Every referenced resource path goes through `_resolve_relative_resource` (`:146-160`): reject empty / absolute / Windows-absolute / any `.`|`..` segment; the resolved path must stay under the model dir ⇒ else `unsafe_resource_path`.
4. **Store**: `shutil.copytree(costume_dir → models/<character>/<costume_id>)`; write `_custom.json = {custom:true, imported_at, source}` at character level (`:278-286`); on any failure `rmtree` the partial target (atomic-ish).
5. **`.zip` path** (`import_from_zip`, `:326-342`): `is_zipfile` check ⇒ else `bad_zip`; extract to a temp dir with `_safe_extract_zip` (Zip-Slip guard: every member's resolved path must stay under dest — `:345-352`); then run the folder pipeline on the temp dir.

### Structured error codes (reuse as our import error vocabulary)

`no_model_json`, `bad_model_json`, `missing_moc`, `missing_textures`, `missing_resource`, `unsafe_resource_path`, `bad_zip`, `name_exists`, `invalid_name`, `source_missing`, `copy_failed`, `not_custom`. (Each is machine-readable; the reference localizes at the UI edge.)

### Zip library pick (TS)

**`fflate`** (npm, MIT, ~8kB, 0 deps, pure JS): `unzipSync(u8) → { [path]: Uint8Array }` (folders flattened into full-path keys); optional `filter(file)` to skip large members; async `unzip(...)` is parallelized/faster for big archives. Handles the ZIP central directory + DEFLATE. **You must still validate each `path` for Zip-Slip yourself** (fflate returns raw paths; reuse the `_normalize_member` guard). Node has **no** built-in ZIP-container reader, so a lib is mandatory here (unlike zstd). Alternatives if streaming/random-access is wanted: `yauzl` (central-directory random access) or `unzipper`; `fflate` is the lightest and matches our "minimum deps" stance.

---

## 5. Motion / expression manifest re-extraction (feeds #16 avatar vocabulary)

The **names** that feed the avatar vocabulary are: motion **group names** (the dict KEYS) and expression **names**. Exact JSON paths (from `model_manager.get_motion_names` `:445-458` and `get_expression_names` `:460-478`, cross-checked against the real taki `model3.json`/`model.json`):

| | Cubism 2.1 (`model.json`) | Cubism 3+ (`*.model3.json`) |
|---|---|---|
| **Motion names** | keys of top-level **`motions`** object | keys of **`FileReferences.Motions`** object |
| Motion file (for extraction) | `motions[<group>][i].file` (`*.mtn`) | `FileReferences.Motions[<group>][i].File` (`*.motion3.json`) |
| **Expression names** | **`expressions[].name`** | **`FileReferences.Expressions[].Name`** |
| Expression file (for extraction) | `expressions[].file` (`*.exp.json`) | `FileReferences.Expressions[].File` (`*.exp3.json`) |

Robust extraction pattern (reference `:453-458`): read lowercase `motions`/`expressions` first; if empty AND `FileReferences` is an object, read `FileReferences.Motions`/`FileReferences.Expressions`. For expression name, accept `item.name || item.Name` to survive mixed casing. Return sorted, de-duplicated.

Real-asset examples:
- taki `live_01` (C3): motion group names like `mtn_idle01_C`, `mtn_smile01_C`, `mtn_angry01_C`, `mtn_bye01_C` (~63 groups, `_C`/`_L`/`_R` variants); expression names like `exp_smile05`, `exp_angry03`, `exp_idle01` (33 expressions). `Groups` also carries `EyeBlink` (`ParamEyeLOpen`/`ParamEyeROpen`) and `LipSync` (`ParamMouthOpenY`) parameter mappings — relevant to #14/#31, not to #18 enumeration.
- taki `casual` (C2): 397 motion groups, 216 expressions (names like `smile01`, `angry01`, `idle01`).

Note motion FILE resolution for the actual extractor is spelled out in `zst_model_archive._action_resource_members`/`_model_resource_members` (`:199-286`) and pinned by `tests/test_zst_model_archive_moc3.py` — moc/textures/physics/pose/displayinfo (model resources) + motions/expressions (action resources), joined against the manifest's base dir with the same `..`-reject normalization.

---

## 6. `convert_models_to_zst` provenance — is it ours to ship?

- `TOOL-convert_models_to_zst.py` is a **standalone dev CLI** (argparse; `--models-dir`, `--level 10`, `--force`; walks `models/<char>/` folders → writes `<char>.zst`; keeps the source folders). It is the reference project's **packer** that PRODUCED the 47 `.zst` archives the user already has in `models/`.
- **For #18 we need the READER (extractor) + generic-import, not the WRITER.** Nothing in the character-import / costume-switch feature requires creating `.zst` archives.
- **Recommendation**: do NOT ship a `.zst` packer as part of #18. It is a **D-register candidate** only if we later want a "re-pack a custom character into `.zst`" dev/authoring tool — log it in `docs/deferred-decisions.md` with trigger "when we add author-side archive creation", per the defer-explicitly rule. The inverse-of-the-reader algorithm is fully documented above if/when that day comes (tar `w|` + `zstdCompressSync`/`createZstdCompress`, index member first).

---

## Caveats / Not Found / Risks

- **#1 clean-room risk — PAX headers.** The tar interleaves `././@PaxHeader` (typeflag `x`) pseudo-members before every real file (Python `PAX_FORMAT` default). A naive 512-byte tar walker surfaces these as bogus "files" (my hand-parser did). The extractor MUST skip typeflag `x`/`g` and apply their overrides — OR enumerate via the `.bandori_zst_index.json` member and never trust raw tar names. **Mitigation**: `tar-stream` (docs: "USTAR with additional support for pax extended headers") and `node-tar` handle this natively; **verify `nanotar` skips `@PaxHeader`** before choosing it (it exposes `attrs`, implying pax parsing, but this was not empirically confirmed here — cannot `pnpm add` from a research agent). Recommend `tar-stream` as the evidence-backed primary.
- **Extraction strategy is undecided and affects the tar-lib choice** (arch-stream call, needed by PRD): (a) **extract-to-disk at import** (decompress+untar once into a per-character workspace dir; costumes become plain folders the engine loads by path; unifies with the generic-import baseline; matches `custom_model_import`'s copytree model) — simplest, but `zstdDecompressSync` buffers the whole tar (~250 MB for the biggest archive) transiently; bound it with streaming `createZstdDecompress → tar-stream`. vs (b) **lazy virtual reads** (keep `.zst`, read members on demand + cache — the reference's approach) — memory-frugal and fast for costume switching, but requires the engine's loader to resolve referenced files from memory (needs the arch stream's `Live2DModel.from` capability finding). Recommend (a) for the first cut.
- **Invariant-1 / invariant-8 placement question** (arch-stream call): the Agent Core "never touches the OS on its own initiative" and `packages/core`/`packages/shared` must be OS-neutral. Decompress+untar+unzip is pure computation, but WRITING the extracted models to a workspace dir and READING a user-chosen archive path are FS actions. Decide whether extraction lives in the **Rust Shell** (crates `zstd`+`tar`+`zip`; fits invariant 1; models dir is Shell-owned) or in **Core** crossing the WS boundary to Rust for the FS writes. My library picks cover the TS side; the Rust crate trio is the parallel option if it lands in the Shell.
- **`.zst` is not seekable here**: no zstd seek-table frame is written, and the tar index is a member (not a byte-offset map), so member access requires decompressing the stream up to that member. Lazy reads re-stream from the top each time (the reference amortizes this with an LRU byte cache). Fine for import; a consideration for on-demand costume loading.
- **Manifest-match inconsistency in the reference**: the archive scanner (`_is_model_manifest_name`) matches only exact `model.json` (+ `*.model3.json`), while the generic importer (`_find_model_jsons`) also accepts `*.model.json`. Our clean-room reader should pick ONE rule (recommend the union: `model.json` | `*.model.json` | `*.model3.json`) and apply it consistently across archive + folder + zip paths.
- **Node Zstd is stability-1 (Experimental)** in Node 22-24. Shipping and verified working, but wrap defensively and pin a Node-version CI guard.
- **Not verified here** (out of my stream / needs other streams): the exact `untitled-pixi-live2d-engine@1.3.1` `Live2DModel.from` loader signature and whether it accepts in-memory buffers/virtual FS (arch stream); the `.mtn`/`.exp.json`/`.motion3.json` internal schemas (not needed for enumeration); `band.json` grouping (UI-only, out of scope for the format).
