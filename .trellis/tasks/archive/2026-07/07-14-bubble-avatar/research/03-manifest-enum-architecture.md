# Research: Manifest → Tool-Enum Architecture (Topic 3 — the subtle design point)

- **Query**: The avatar tool param values must come from the loaded model's manifest (no hardcoded names). Core runs the LLM; Pet UI owns the model. How does the Core learn taki's motions/expressions?
- **Scope**: internal + installed engine types + model manifests
- **Date**: 2026-07-14

## Findings

### Files Found

| File Path | Description |
|---|---|
| `apps/desktop/src/renderer/live2d/load-taki-model.ts` | Loads the model; hardcoded dev route to the `arbeit` costume |
| `apps/desktop/src/renderer/live2d/idle-behavior.ts` | **Already reads manifest definitions** off the loaded model |
| `models/extracted/taki/arbeit/model.json` | Cubism 2 manifest (the costume loaded today) |
| `models/extracted/taki/live_01/adv_live2d_taki_005_live_01.model3.json` | Cubism 3 manifest (different vocab) |
| `node_modules/.../untitled-pixi-live2d-engine/types/index.d.ts` | Engine types: `MotionManager` / `ExpressionManager` |
| `packages/core/src/skills/skills-loader.ts` (via `main.ts:218`) | The `instructionsExtra` injection precedent to mirror |

### Where the names live (verified against installed engine types)

`Live2DModel.internalModel.motionManager` exposes (`index.d.ts:3373-3406`):
- `definitions: Partial<Record<string, MotionSpec[]>>` (`:3384`) — **keyed by motion group name**.
- `groups: { idle: string }` (`:3390`) — the special idle-group alias.
- `expressionManager?: ExpressionManager` (`:3406`), whose `definitions: ExpressionSpec[]`
  (`:3793`) each carry a name field.

The repo **already uses this access path** — `idle-behavior.ts:15`:
```ts
const group = model.internalModel.motionManager.groups.idle;
const hasGroup = Boolean(group) && Boolean(model.internalModel.motionManager.definitions[group]?.length);
```
So extracting names post-load is proven:
```ts
const motions = Object.keys(model.internalModel.motionManager.definitions);
const expressions = (model.internalModel.motionManager.expressionManager?.definitions ?? [])
  .map((d) => d.name ?? d.Name);   // Cubism 2 uses `name`, Cubism 3 uses `Name`
```

### The two costumes have DIFFERENT vocabularies (proves hardcoding is wrong)

`arbeit` (Cubism 2, `model.json`) — the costume `load-taki-model.ts:14` loads today:
- **Motion groups** (keys of `motions`): `ando01`, `angry01..04`, `bye01/02`, `cry01/02`,
  `idle01`, `kandou01`, `kime01`, `nf01..05`+`nf_left/right01`, `nnf01..05`+variants, `pui01`,
  `sad01..03`, `serious01/02`, `shame01/02`, `sigh01/02`, `smile01..04`, `surprised01/02`,
  `thinking01`.
- **Expressions** (`name` field): `default`, `ando01`, `angry01..04`, `bye01/02`, `cry01/02`,
  `idle01`, `kandou01`, `kime01`, `pui01`, `sad01..03`, `serious01/02`, `shame01/02`, `sigh01/02`,
  `smile01..04`, `surprised01/02`, `thinking01`.

`live_01` (Cubism 3, `.model3.json`):
- **Motion groups**: `mtn_angry01_C/L/R`, `mtn_bye01_*`, `mtn_check01_*`, `mtn_confrict01_*`,
  `mtn_cry01_*`, `mtn_denial01..03_*`, `mtn_idle01_*`, `mtn_kime01_*`, `mtn_look01_*`,
  `mtn_nod01/02_*`, `mtn_question01_*`, `mtn_sad01_*`, `mtn_serious01_*`, `mtn_smile01/02_*`,
  `mtn_surprised01_*`, `mtn_thinking01_*` (each with `_C`/`_L`/`_R` directional variants).
- **Expressions** (`Name` field): `exp_smile01..05`, `exp_bsmile01/02`, `exp_angry01..03`,
  `exp_sad01/02`, `exp_shy01..04`, `exp_cry01..04`, `exp_idle01..03`, `exp_serious01/02`,
  `exp_amazed01/02`, `exp_surprised01/02`, `exp_shadow01`, `exp_pale01/02`, `exp_kime01`.

Different naming schemes and different sets → a hardcoded enum on the Core would break on
soul-swap / costume-swap. The names MUST come from whichever model the Pet UI has loaded.

### The architectural tension

- The **model is loaded in the Pet UI** (frontend renderer). `definitions` only exist there,
  after load.
- The **tool enum is needed in the Core** (backend) where the LLM runs.
- Core tools are built **once at boot** (`main.ts`), `extraTools` is a fixed `ToolSet`
  (`chat-agent.ts:35,64`). The model may not be loaded yet, and can change at runtime (soul-swap,
  M5 #24). A `z.enum` frozen at boot cannot track the live model.
- Invariant 8: the Core is OS-neutral and must not own model assets (`models/` is git-ignored;
  production models load via the Tauri asset protocol, #18). The Core reading manifest files is
  out.

### Options + tradeoffs

**Option A — free-string param + reported vocab injected into the prompt (RECOMMENDED).**
- Tool `inputSchema: z.object({ name: z.string() })` (no baked enum).
- Pet UI reports `{ motions, expressions }` to the Core on model load via a new `avatar.report`
  method (`AvatarReportParamsSchema`, below).
- Core stores a per-character vocabulary and injects the valid names into the turn instructions
  through `instructionsExtra` — the **exact** seam the skills list already uses
  (`main.ts:218` `instructionsExtra: () => skillsLoader.renderList()`, appended in
  `chat-agent.ts:141`).
- Pet UI validates each incoming `avatar.command.name` against its live `definitions` and
  **degrades gracefully** (log + no-op) on unknown; the tool `execute` always returns `{ ok: true }`.
- **Pros**: Core stays model-agnostic (invariant 8); tools boot-stable; soul-swap just re-reports;
  reuses a proven pattern; no per-turn schema rebuild; empty/absent model is harmless (empty list).
- **Cons**: the LLM *could* emit an off-list name — mitigated because the names are in the prompt
  and the Pet UI degrades cleanly. (This is the same "soft contract" the skills list already runs.)

**Option B — dynamic `z.enum` rebuilt from the reported vocab.**
- Pet UI reports names → Core rebuilds the avatar tool per-turn with `z.enum(names)`.
- **Cons**: needs a per-turn tool factory threaded with the mutable vocab (today only
  `memory.createTools` is per-turn); `z.enum` requires ≥1 value, so an unloaded/closed Pet UI
  breaks tool construction unless specially guarded; more moving parts for a guarantee the prompt
  already gives softly. Higher risk, marginal benefit.

**Option C — Core reads the manifest file directly.** Rejected: violates invariant 8 (Core owns
no model assets; they are Pet-UI/Tauri-asset-protocol territory).

**Recommendation: Option A**, with B noted as a future hardening if off-list calls prove common.

### The `avatar.report` schema (pairs with Topic 2)

```ts
export const AvatarReportParamsSchema = z.object({
  characterId: z.string().min(1),
  motions: z.array(z.string()),     // Object.keys(motionManager.definitions)
  expressions: z.array(z.string()), // expressionManager.definitions.map(d => d.name ?? d.Name)
});
export const AvatarReportResultSchema = z.object({ status: z.literal("ok") });
```
Core side: `avatar-report.ts` method (role `["operator"]`) writes into a
`packages/core/src/avatar/avatar-vocabulary.ts` per-character store; `instructionsExtra` renders
it, e.g. *"Avatar expressions you may set: … ; motions you may play: …"*.

### Practical note — taki's CURRENT vocab is tsundere-friendly

Because `load-taki-model.ts:14` loads `arbeit`, taki ships with `serious01/02`, `shame01/02`
(embarrassed/defensive), `pui01` (turning away in a huff), `angry01..04`, `sigh01/02`,
`thinking01`, plus `smile01..04` — a good match for the persona's "哈？/吵死了/……" register and for
the click-region tsundere preset (Topic 6).

## Caveats / Not Found

- The `ExpressionSpec` field is `name` (Cubism 2) vs `Name` (Cubism 3) — the extractor must read
  `d.name ?? d.Name`. Confirmed from the two manifests; the engine's `ExpressionSpec` generic is
  version-specific (`Cubism2Spec.Expression` / `CubismSpec.Expression`, `index.d.ts:4997,6119`).
- Directional Cubism 3 motions (`_C/_L/_R`) mean `live_01` would report ~57 motion groups; a
  future costume switch should probably collapse `_C/_L/_R` to a base tag — out of scope for #16
  (taki uses `arbeit` today), but worth a note for the vocab renderer.
