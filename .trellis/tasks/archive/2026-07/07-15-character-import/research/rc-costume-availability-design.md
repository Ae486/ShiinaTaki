# Costume availability + external-ref resolution (degrade-and-badge) — implementation brief

Status: user-approved design (2026-07-16). Decision: **"renderable = selectable + graceful degrade"** (BANDORI
semantics), NOT strict lock. Locked rows exist only for costumes that cannot render at all.

## Problem (user-reported defects after the sub-URL fix ac772d9)

1. Switching to `casual` / `school_summer` / `school_winter` spams asset-protocol "cannot traverse directory"
   errors and fails: their manifests reference `../_mtn_emp/<owner>/...` paths. `resourceSegments` passes `..`
   through; the asset protocol hard-rejects traversal. **No ref containing `..` may ever reach convertFileSrc.**
2. Panel error is a generic "Network error." — must become `<costume>: <real reason>` so the user's other ~3
   unexplained failures become diagnosable (they are NOT external-pool costumes; likely C3 or other causes).

## Evidence (all verified on disk / archives this session)

- Exactly **3 of 27** taki costumes have external refs (casual, school_summer, school_winter). Each references
  the same **613** external files: 397 `.mtn` motions + 216 expression `.json`. **Zero** external textures/moc —
  all 3 are fully renderable from local files.
- `_mtn_emp` is a **cross-character global pool** in the BanG Dream layout. It exists in NO archive: taki.zst,
  anon.zst, rana.zst, kasumi.zst all have 0 `_mtn_emp` members; no standalone pool package exists in models/.
- BANDORI reference (`references/BANDORI-PET-REV-main/live2d_lua_adapter.py:326` `_fix_mtn_path`): resolves an
  external ref by **basename search** under a global `models/_mtn_emp/` dir; missing → empty string → **motion
  silently skipped, costume loads anyway**. That repo doesn't ship the pool either.
- Basename-fallback coverage measured against the imported taki tree: **538/613 (88%)** of the external refs have
  a same-basename file somewhere under `characters/taki/` already.
- The remaining 75 refs (55 unique basenames) belong to pool subdirs of 10 other characters:
  sakiko 18, tomori 15, soyo 12, mana 12, anon 11, rana 2, umiri 2, mutsumi 1, nyamu 1, uika 1.
  Verified: anon.zst contains all 11 of its basenames; rana.zst contains 3. So **importing those characters'
  packs really does supply the files** — resolution must search ALL imported characters, not just the owner
  (note: pool subdir `tomori` vs archive `tomorin.zst` — owner names are hints, not ids; basename search across
  every imported character dir handles the mismatch naturally).

## Approved UX

- Costume list: renderable costumes selectable as today. A costume with unresolved motion refs still selectable,
  with a badge like `⚠ 缺 75 动作` (missing count).
- Unrenderable costumes (essential moc/texture/settings missing): visible but disabled, sorted to the bottom,
  under a notice row `⚠ 导入 <owners> 的角色包可补全/解锁` (owners = union of missing-ref owner hints).
- Auto-unlock on new import: availability is **computed on demand** in `character.costumes` (never stored), so
  the panel's refresh after an import re-derives it — no stored state to invalidate.
- Switch errors show `<costume>: <message>`.

## Design

### Core — `packages/core/src/characters/costume-availability.ts` (new)

Single new module (invariant 7: feature = module + registry entry). Responsibilities:

- `buildBasenameIndex(charactersDir): Map<basename, posixRelPathFromCharactersRoot>` — walk every imported
  character dir (skip `character.json` markers). On duplicate basenames keep the first hit BUT prefer a hit whose
  path starts with the ref's owner hint at resolve time (see below), so index maps basename → array of rel paths
  (or Map<string, string[]>). Keep it simple: `Map<string, string[]>`.
- `costumeExternalRefs(costumeDir, settingsFile): string[]` — parse the manifest (both generations; reuse the
  parsing/extraction already in `cubism-manifest.ts` — do NOT re-implement generation detection) and return every
  file/sound ref containing `..`.
- `resolveExternals(deps): CostumeResolution` where
  `CostumeResolution = { resolution: Record<ref, string | null>, missingCount: number, missingOwners: string[] }`
  - owner hint = path segment following `_mtn_emp` (if present).
  - resolve order: basename hit under `characters/<ownerHint>/` → basename hit under the costume's own character →
    any basename hit → `null`.
  - resolved value is the POSIX rel path **from the characters/ root** (e.g. `taki/arbeit/motions/angry01.mtn`).
  - `missingOwners`: unique owner hints of null-resolved refs, sorted.
- `costumeAvailability(deps): { renderable: boolean; missingMotions: number; missingPacks: string[] }` —
  `renderable` = settings file parses AND essential refs (moc/model + textures) exist inside the costume dir
  (essentials are never external in practice; an external essential ⇒ unrenderable). missingMotions =
  missingCount; missingPacks = missingOwners.

Perf note: `character.costumes` for taki parses 27 manifests + walks the character tree once — local JSON reads,
fine. Build the basename index once per request, not per costume.

### Shared — protocol (additive only)

- `CharacterCostumesResultSchema` += optional
  `availability: z.record(z.string(), z.object({ renderable: z.boolean(), missingMotions: z.number(), missingPacks: z.array(z.string()) })).optional()`.
- New method `character.costumeResolution` (`CHARACTER_METHODS.costumeResolution = "character.costumeResolution"`):
  params `{ characterId, costume }`, result `{ resolution: Record<string, string | null> }`. Per-costume,
  on-demand (a 613-entry map is too heavy to inline in every costumes call).
- Schema tests colocated as the existing ones.

### Core — server methods

- `character-costumes.ts`: compute + attach `availability` (delegating to costume-availability; handler stays thin).
- New `server/methods/character-costume-resolution.ts` (one file per method), registry entry in `main.ts` next to
  the other character methods. Unknown character/costume degrades exactly like character-costumes ("not found").

### Renderer — `apps/desktop`

- `lib/character-asset-url.ts`:
  - New pure fn `resolveResourcePath(ref, resolution): { kind: "costume" | "characters"; segments: string[] } | null`
    — `resolution[ref]` string → `{ kind: "characters", segments }` (rel to characters root); ref without `..` →
    `{ kind: "costume", segments: resourceSegments(ref) }`; anything still containing `..` (or resolution `null`)
    → `null`. **Fail-safe: `null` means the caller strips the entry; `..` never reaches convertFileSrc.**
  - `costumeAssetResolver(characterId, costume, settingsFile, resolution)` — `file` becomes
    `resolve(relPath): string | null` using the above (charactersDir = homeDir/.takiagent/workspace/characters).
    Update `CostumeSource` accordingly (`resolve` instead of `file`; callers strip on null).
- New `renderer/live2d/settings-prune.ts` (pure, node-testable): `pruneSettings(json, resolve)` operates on the
  RAW settings JSON before `createSettings`, both generations:
  - C2: for each `motions` group entry — `resolve(entry.file) === null` → drop entry; else if `entry.sound` &&
    `resolve(entry.sound) === null` → delete `sound`, keep entry. Drop `expressions[i]` whose `file` is
    unresolvable. Drop groups left empty.
  - C3: same over `FileReferences.Motions` / `FileReferences.Expressions` (`File` / `Sound` keys).
  - Returns `{ settings, prunedMotions, prunedExpressions }` (counts for a console.info diagnostic).
  - Textures/moc are NOT pruned — unresolvable essentials mean the load fails loudly (costume was marked
    unrenderable anyway; the panel should not offer it).
- `renderer/live2d/load-character-model.ts`: in `toAbsoluteSettings` — fetch JSON → `pruneSettings` →
  `createSettings` → `replaceFiles((file) => source.resolve(file) ?? file)`; the `?? file` branch is unreachable
  after pruning (defense only). Vocabulary correctness is free: pruned settings ⇒ pruned
  `motionManager.definitions` ⇒ `readVocabulary` and avatar.report never mention unavailable motions.
- `features/character-import/use-costume-switch.ts`:
  - surface `availability` from characterCostumes; expose costumes pre-sorted (renderable first) + the per-costume
    metadata + `missingPacksUnion` for the notice row.
  - `switchTo`: fetch `client.costumeResolution(...)` first, pass into `costumeAssetResolver`; guard: if
    `availability[costume]?.renderable === false` → no-op (UI disables the row anyway).
  - error message: `` `${costume}: ${message}` ``.
- `windows/pet/use-initial-costume.ts`: same resolution fetch before the initial promotion (default costume is
  self-contained today, but the code path must not regress if a future default has external refs).
- `lib/ws-client.ts`: add `costumeResolution(characterId, costume)`.
- Panel component (the consumer of useCostumeSwitch under `features/character-import/` — locate it): badge on
  degraded rows (`⚠ 缺 N 动作`), disabled bottom section + notice row per the approved mockup. Notice copy
  (zh-CN, matches existing panel language): `⚠ 需导入其他角色包可解锁/补全动作：<owners>`.

## Tests (define before coding)

- core `costume-availability.test.ts`: tmp-dir fixture with 2 fake characters; manifest with (a) local refs only,
  (b) external ref resolvable via other character (owner-hint hit), (c) external resolvable only via basename
  fallback (owner mismatch — the tomori/tomorin case), (d) external unresolvable → null + owner in missingOwners;
  renderable=false when a texture is absent.
- shared schema tests: availability field optional + new method params/result parse.
- ui `settings-prune.test.ts`: C2 + C3 shapes; sound-only miss keeps motion; empty group dropped; counts.
- ui `character-asset-url.test.ts`: extend — resolveResourcePath costume/characters/skip cases; `..` always null
  without a resolution entry.
- `pnpm -r test`, `pnpm --filter desktop exec tsc --noEmit`, core tsc, and a **core boot smoke**
  (`node packages/core/src/main.ts` starts + Ctrl-C) since main.ts registry is touched (strip-only lesson).

## Out of scope

- No importable `_mtn_emp` pool package handling (no such archive exists in the collection; basename search over
  imported characters supersedes it).
- No persistence of availability (computed on demand).
- D30 (asset locality), D31 (packer) unchanged.
