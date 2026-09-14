# Avatar Presentation: Vocabulary, Tools, and Optimization Directions

> Created 2026-09-02 from a code-level review of the avatar path plus a full scan of the **147 imported costumes**
> across 8 characters in `<data-root>/workspace/characters` (measured on the owner's machine at
> `C:\Users\55473\.takiagent\workspace\characters`).
>
> **Owner ruling (2026-09-02, this session): keep the tool-call design.** The optimization work builds on the
> existing `avatar_set_expression` / `avatar_play_motion` contract. AgentAtelierR (a Flutter + Spine prototype under
> `references/`, internally `LLMAtelier` / `ryza_chat_mvp`) is a source of *presentation ideas only* — its
> single-character inline-tag approach is not an architecture to copy, because TakiAgent must survive character and
> costume switching that the prototype never faces.
>
> Scope: the expression/motion vocabulary, how it reaches the model, and the two avatar tools. TTS, lip-sync, and
> speech timing remain governed by `TTS-INTERFACE.md`; §6 records what our engine and assets actually support, and §7 lists one item there for re-appraisal.
>
> Verify every file:line against the live tree before implementing.

Priorities: **P1** = the model cannot do the right thing even in principle (information is absent or drowned);
**P2** = the model can, but the prompt biases it against doing so; **P3** = polish.

---

## 1. Measured vocabulary reality

The imported BanG Dream assets use **three distinct naming systems**. Any vocabulary work must handle all three,
because a single character mixes them across costumes (taki: 18 / 3 / 6).

| System | Costumes | Distinct vocabularies | Format | Size (motions / expressions) |
| --- | --- | --- | --- | --- |
| **A — Cubism 2 standalone** | 92 (63%) | 30 | `<root><NN>`, `<root>_<left\|right><NN>` | 26–43 / 9–30 |
| **B — Cubism 2 shared library** | 16 (11%) | **1** | `<character>_<root><NN>` | **397 / 216** |
| **C — Cubism 3** | 39 (26%) | 9 | `mtn_<root><NN>_<C\|L\|R>`, `exp_<root><NN>` | 50–66 / 19–36 |

Per character: anon 17/3/8, mana 1/0/1, rana 15/3/2, sakiko 4/0/6, soyo 15/3/5, taki 18/3/6, tomorin 16/4/5,
uika 6/0/6.

### 1.1 System A — standalone Cubism 2

Example (`taki/arbeit/model.json`, 43 motions / 30 expressions):

```
ando01 angry01..04 bye01..02 cry01..02 idle01 kandou01 kime01
nf01..05 nf_left01 nf_right01 nnf01..05 nnf_left01 nnf_right01
pui01 sad01..03 serious01..02 shame01..02 sigh01..02
smile01..04 surprised01..02 thinking01
```

Roots across all 92 costumes (31): `ando angry bow bye cry default eeto gacha gattsu idle jaan kandou kime maskoff
mitore nf niya nnf nod odoodo pui sad scared serious shame sigh sing smile surprised thinking wink`.

Two sub-variants: bare names (taki, most characters) and character-prefixed names (mana: `mana_angry01`). A parser
must accept both.

**Expressions and motions share the same names** here — the 30 expression names are a subset of the 43 motion names.
The same holds structurally in system C (`mtn_smile01_C` pairs with `exp_smile01`). See §4.4.

### 1.2 System B — shared cross-character library

16 costumes (taki: `casual`, `casual-2023`, `school_winter`) reference `../_mtn_emp/<character>/<name>.mtn`, a
library shared across **11 character prefixes**: `anon mana mutsumi nyamu rana sakiko soyo taki tomori uika umiri`
(three of which — mutsumi, nyamu, umiri — have no imported model in the current workspace).

All 16 costumes expose an **identical** 397-motion / 216-expression vocabulary. For a taki costume, only ~39 motions
carry the `taki_` prefix; **the other ~358 belong to other characters.** They are playable (same parameter skeleton),
so this is a genuine capability, not a bug — but today they reach the model as undifferentiated noise.

Roots (27): system A's set plus `eeto gattsu jaan mitore niya nod odoodo sing wink`, minus a few.
10 names use an event-numbered form (`anon_e235_gacha01`, `taki_e240_gacha01`) that needs its own parser branch.

### 1.3 System C — Cubism 3

Roots (39): `amazed angry blush bsmile bye check confrict cry denial dispair grinning haruhikage heart idle join
kime look maskoff nervous nod note pain pale question sad salk sdeprecate serious shadow shy sing smile smirk sneer
spin surprised thinking upset wink`.

15 motion roots are common to all 8 characters; only 8 are character-specific (`confrict` taki, `haruhikage` soyo,
`join` anon/tomorin, `maskoff` sakiko/uika, `nervous` tomorin/uika, `note` tomorin, `sing` uika, `wink` anon/soyo).
Parser coverage is 100% — zero unparsed names across all 39 costumes.

`C`/`L`/`R` are three separate `.motion3.json` files and encode **direction/stage position** (owner confirmation:
only `C` is needed for the pet use case).

### 1.4 The stable core

Roots present in **all three systems**: `angry bye cry idle kime sad serious smile surprised thinking` — 10 words.
This is the set a prompt can rely on regardless of which character or costume is worn.

### 1.5 Roots that are not self-explanatory

Most names are readable English (`smile01`, `angry03`, `sad02`). About 15 are not, and need a one-line gloss:

- Japanese romaji (systems A/B): `ando` (relieved), `kandou` (moved/touched), `pui` (sulk, turn away), `shame`
  (embarrassed), `sigh`, `niya` (smirk), `odoodo` (nervous/timid), `mitore` (entranced), `jaan` (ta-da entrance),
  `gattsu` (guts pose), `eeto` (thinking filler "umm")
- System C: `kime` (strike a pose), `sdeprecate` (self-deprecating), `salk` (sulk), `confrict` (likely a misspelling
  of "conflict"), `haruhikage` (a proper noun, soyo story-specific)
- **`nf` / `nnf` — meaning unknown.** These are the largest group in system A (14 of 43 motions: `nf01..05`,
  `nnf01..05`, plus `_left`/`_right` variants) and also present in system B. The `.mtn` files contain only parameter
  curves (`PARAM_EYE_R_OPEN` etc.) with no semantic annotation, so the meaning cannot be recovered from the assets.
  **Requires playback observation** — see §7.

---

## 2. What the current design gets right

These are load-bearing and must survive any optimization.

| Design | File | Why it is right |
| --- | --- | --- |
| Vocabulary read from the live model, not a config file | `apps/desktop/src/renderer/live2d/model-vocabulary.ts:15-22` | A per-model config would drift from the assets; the manifest is the only truth |
| Dynamic `z.enum` over the live names | `packages/core/src/avatar/vocab-name-schema.ts:12-14` | A stale name from a previous costume becomes **structurally invalid**, not merely discouraged; the SDK returns a readable tool error instead of crashing |
| Costume-change detection edge cases | `packages/core/src/avatar/avatar-vocabulary.ts:81-93` | First turn only snapshots the baseline (a boot dev→imported promotion is not a costume change); `undefined` never clobbers a known id; A→B→C→A with no turns does not misfire |
| Fire-and-forget with structured degradation | `set-expression-tool.ts:28-38`, `play-motion-tool.ts:34-44` | `execute` never throws; a presentation failure cannot take down the turn |
| Second validation at the renderer + drift self-heal | `apps/desktop/src/renderer/live2d/avatar-commands.ts` | Core and UI each defend independently |
| `presentationTailStop` with a `spoke` guard | `packages/core/src/avatar/presentation-stop.ts:18-24` | Stops filler after a presentation-only step, but a tool-only step with no prior text does **not** stop — express-first-then-talk still works |

For contrast, AgentAtelierR has none of this: an unresolvable tag is silently dropped, and after a costume change the
model can keep emitting names that no longer exist with no feedback path.

**Conclusion: the architecture is sound. The problems are in the presentation layer.**

---

## 3. The real problems, ranked

### P1-1 — Variants are indistinguishable (prompt wording cannot fix this)

What is the difference between `smile01`, `smile02`, `smile03`, `smile04`? The information exists only in the
animation data — not in the name, not in any metadata. The model is given four options and no basis to choose.

The only fix is to stop asking: collapse variants to one semantic choice and let the application pick a variant.
This also buys free variety (the same intent does not replay the same clip).

### P1-2 — System B floods the model with other characters' motions

16 costumes present 397 motions + 216 expressions, ~90% of which belong to other characters. This is a data-shape
problem; no amount of prompt wording helps.

### P1-3 — `C`/`L`/`R` is a blind choice

Direction is a stage-position concept the model has no basis to decide, and only `C` is wanted. It should not be
visible to the model at all.

### P2-1 — `USAGE_RULES` is entirely suppressive

`packages/core/src/avatar/avatar-vocabulary.ts:42-49` ships six rules, all of the form "do not": do not send a
separate message, do not follow up because the tool ran, do not reply to yourself, do only real work first, use only
listed names. **None of them says when presentation is expected.** This is the most direct cause of the observed
"lazy invocation" (the model often replies without any expression or motion).

Compare AgentAtelierR, where presentation is not a tool at all but a mandatory output format — the model cannot
speak without emitting a tag, so "forgetting" is structurally impossible.

### P2-2 — About 15 roots are not self-explanatory

See §1.5. A gloss table fixes this; it is prompt-layer only.

### P2-3 — `priority` / `loop` are engine knobs exposed to the model

`play-motion-tool.ts:28-32` (registered as the D40 strict-ready exemption). The model must decide two playback
parameters every call with no basis for either. This also widens the surface for malformed calls (see §7, D69).

### P3-1 — `click-presets.ts` degrades across naming systems (already happening)

The `TSUNDERE` preset (`apps/desktop/src/renderer/live2d/click-presets.ts:14-22`) was written against system A
vocabulary. Resolved through `emotion-resolver.ts:10-20` against the same character in two costumes:

| Region | Tag | `taki/arbeit` (A) | `taki/arbeit_ring_01` (C) |
| --- | --- | --- | --- |
| head | angry | `angry01` | `exp_angry01` |
| upper_body_left | pui | `pui01` | `exp_angry01` (collision) |
| upper_body_center | shame | `shame01` | **null — no reaction** |
| upper_body_right | serious | `serious01` | `exp_serious01` |
| lower_body_left | sigh | `sigh01` | `exp_serious01` (collision) |
| lower_body_center | shame | `shame01` | **null — no reaction** |
| lower_body_right | pui | `pui01` | `exp_angry01` (collision) |
| **Distinct reactions** | | **5** | **3 + 2 dead zones** |

System C has no `pui`/`shame`/`sigh` roots, and `SYNONYMS` keys on `shy` (with `shame` only as a *value*), so the
tag `shame` resolves to nothing. Unrelated to the main line, but it is a live instance of exactly the
switch-and-silently-degrade failure this document exists to prevent.

> Note: the `emotion-resolver.ts:8-9` comment ("taki's arbeit has pui/shame/serious") is **correct** — it describes
> the system A costume `arbeit`, not the system C costume `arbeit_ring_01`.

---

## 4. Optimization directions

Four independent strengths. Each is usable on its own; **strengths 1–2 are pure presentation-layer changes** that
touch neither the tool contract, the enum, the validation chain, nor costume detection.

### 4.1 Strength 1 — Filter only (P1-2, half of P1-3)

Keep real names in the prompt; shorten the list.

- System C: expose only `_C` variants (66 → ~22 motions)
- System B: expose only the active character's prefix (397 → ~39 motions)
- Non-matching vocabularies fall through unfiltered — today's exact behavior

Change site: a filter between `avatar-vocabulary.ts`'s `set()` and `render()`/`get()`. Risk: near zero.

### 4.2 Strength 2 — Filter + grouped rendering with glosses (P2-2, mitigates P1-1)

The model still emits real names, but sees them grouped by semantic root, with a gloss for the ~15 opaque roots:

```
Motions (use the exact name):
  smile: mtn_smile01_C, mtn_smile02_C
  nod (agree / acknowledge): mtn_nod01_C, mtn_nod02_C
  denial (disagree / refuse): mtn_denial01_C
  kime (strike a confident pose): mtn_kime01_C
```

Change site: still `render()` only, plus a root-parser module and a ~15-row gloss table. The gloss table is
**global and grows with new roots, not with new costumes** — 147 costumes today share ~56 roots total.

Parser branches required for 100% coverage (measured):

```
1. ^(?:mtn|exp)_(root)(\d+)(?:_([CLR]))?$                 system C   (39/39 costumes, 0 unparsed)
2. ^(charPrefix)_e(\d+)_(root)(\d+)$                      system B event form (10 names)
3. ^(charPrefix)_(root)(?:_(left|right))?(\d*)$           system B + mana-style A
4. ^(root)(?:_(left|right))?(\d*)$                        system A bare
5. otherwise → the name is its own root (pass through)
```

`charPrefix` must be an explicit enumeration; otherwise branch 3 mis-splits `nf_left01` into char=`nf`.
Branch 5 guarantees an unknown convention (a non-BanG-Dream import) still works — it degrades to today's behavior.

Expected prompt reduction: system A 43+30 → ~17 semantic groups; system B 397+216 → ~20; system C 66+33 → ~16.

### 4.3 Strength 3 — Collapse (P1-1, P1-3 fully) — *decide after measuring strength 2*

The model emits a root (`smile`); the application expands it to a concrete name. Requires changing
`vocab-name-schema.ts` and the expansion/validation path in `avatar-commands.ts`. Medium risk: it touches the
validation chain. **Recommended only if strength 2 leaves observable mis-selection** — under grouped rendering the
residual choice (`mtn_smile01_C` vs `mtn_smile02_C`) is harmless because both are correct.

### 4.4 Optional — one semantic word driving both channels

Because expressions and motions are name-paired in all three systems (§1.1), a single semantic choice could set the
expression and play the motion together. Benefit: eliminates expression/motion mismatch (AgentAtelierR's prompt
explicitly warns against "comforting while laughing"). Cost: loses independent control (e.g. a wry smile while
saying something serious). A middle path is to pair by default and keep an optional override parameter.

### 4.5 Independent of vocabulary work

- **Add a positive rule to `USAGE_RULES`** (P2-1). A few lines; the most direct lever on lazy invocation.
- **Retire `priority`/`loop` from the model-facing schema** (P2-3), collapsing D40's exemption and making
  `avatar_play_motion` single-parameter like `avatar_set_expression`.
- **Fix `click-presets.ts` cross-system degradation** (P3-1) — independent of the main line.

### 4.6 Suggested sequencing

1. Strength 1 + `USAGE_RULES` positive rule (smallest change, addresses P1-2 and P2-1)
2. Strength 2 (P2-2, mitigates P1-1)
3. Measure. Only then decide on strength 3 and §4.4.
4. D69 investigation runs **independently** — see §7.

Testing note: the 147 real costume vocabularies in the workspace are the natural fixture set for the parser and the
filter. Both are pure functions, so coverage can be asserted directly (target: 100% parse, 0 fallthrough on
BanG Dream assets; graceful fallthrough on a synthetic non-conforming manifest).

---

## 5. AgentAtelierR — the presentation lessons

Studied at `references/AgentAtelierR-main` (Flutter/Dart + `spine_flutter`, 17 files / 7,693 lines, 1 test file).
Reference material only; per repository policy, patterns are studied and never copied. Its agent runtime is far
below TakiAgent's and is not the subject here. **Its presentation layer is where it is ahead**, and since TakiAgent's
TTS exists only as a contract (`TTS-INTERFACE.md`), it also supplies the direction for that work.

Live2D and Spine differ, so nothing below is a port; each item is an *idea* with a note on how it lands on Live2D.

### 5.1 The performance architecture: one skeleton, many independent layers

The single most transferable idea. Its Spine animation state is organised as **independent tracks that compose**
(`chat_screen.dart:212-390`):

| Track | Layer | Lifetime |
| --- | --- | --- |
| 0 | idle pose (loop) | continuous, swapped every 9–16 s |
| 1 | one-shot reaction (tap, semantic fallback) | until complete, then `addEmptyAnimation` fades out |
| 2–10 | motion-group overlays (arm/torso gestures, up to two blended per group) | until the longest completes |
| 11 | eyes | held; rotated every 1.5–3.1 s while speaking; blink overrides for ~100 ms |
| 12 | eyebrows | held |
| 13 | mouth (static) **or** lip-sync scrub (time-scaled to 0, position driven by audio) | held / per playback |
| 14, 15 | blush, tears (off-clip then on-clip, 120 ms mix) | per expression |

A gesture, an expression change, a blink, and lip-sync are **four different tracks that never clear each other**.
Idle keeps looping underneath a gesture; a blink overwrites only the eye track for 100 ms and restores.

**Live2D counterpart.** Cubism has a single motion queue with priorities, not free-form tracks — but the same
separation is available: motions own body parameters, **expressions are a separate additive layer**
(`ParamEyeLOpen`, `ParamMouthForm`, blush/tear parameters), and individual parameters can be written directly each
frame. So "gesture + expression + blink + mouth" is realisable as motion-queue + expression-layer + per-frame
parameter writes. The point to carry over is the *design discipline*: presentation concerns must not share one
state slot. Today TakiAgent has two: a motion and an expression.

### 5.2 Expressions have a lifetime

`_scheduleExpressionRelax` (`chat_screen.dart:429-436`): 4.6 s after speech ends, the face returns to neutral —
unless speaking or a tap reaction is active.

**TakiAgent today:** `avatar-commands.ts:32` sets an expression and it stays **forever**. A `cry` set three turns ago
is still on the face while the character says something cheerful, until the model happens to set another. The model
is being made responsible for *undoing* its own expression, which it never does (it only reasons about the current
reply). This is a direct, cheap fix: a relax timer in the renderer, reset on every new expression command, suppressed
while speaking or reacting. Zero Core change.

### 5.3 Ambient motion: never still, never spamming

While idle, `_scheduleMicroMotion` (`chat_screen.dart:570-609`) fires every 3.8–7.4 s (1.8–3.8 s while speaking)
and plays an "ambient" gesture chosen by `selectCharacterAmbientMotionGroup` (`character_appearance.dart:259-311`):

1. **Compatibility filter** — must support the current pose; must not be one of the last 5 played; must not be a
   large posture change while speaking
2. **Mood weighting** — candidates weighted for the current expression (`smile` favours upbeat gestures, `sad`
   favours small ones); weight divided by variant count so a gesture with many variants is not over-picked
3. **Exploration** — 20 % of the time ignore the weights and pick uniformly, so the mood bias never becomes a rut
4. **Suppression** — skipped if a semantic (LLM-chosen) action played within the last 2.3 s

Plus the idle pose itself rotates every 9–16 s among a pool, excluding the current one.

**TakiAgent today:** `idle-motion.ts` rotates the idle pool every 4–12 s. That is item 1's pool without the recency
memory, and none of items 2–4. In particular there is **no mood coupling**: the idle scheduler does not know what
expression is currently set. The recency window (5) and the exploration floor (20 %) are the two cheap upgrades; mood
weighting needs a "current expression" signal the renderer already has but does not consult.

### 5.4 Speaking is a state, with its own behaviours

`_startSpeakingAnimation` / `_stopSpeakingAnimation` (`chat_screen.dart:392-427`) turn speech into a mode that
switches on four sub-behaviours, all of which stop when speech ends:

- **Micro-expression rotation** — every 1.5–3.1 s the eye/eyebrow pair swaps to another variant *of the same
  expression* (`_rotateFacialDetail`, `chat_screen.dart:504-529`): a happy face has three "happy" eye/brow
  combinations and cycles among them. The face is never a frozen mask.
- **Blinking** — every 1.7–3.5 s a closed-eye clip plays for 95–140 ms at 1.15× speed, then the eye restores
  (`chat_screen.dart:540-568`). Only while speaking — the idle pose presumably has its own.
- **Procedural head/body sway** (`_applySpeakingHeadMotion`, `chat_screen.dart:438-481`): applied per frame on top
  of everything else. Three summed sinusoids at different frequencies (0.82 / 0.29 / 0.11 Hz) produce nod and sway;
  amplitude is modulated by the **current speech energy** (loud syllable → bigger nod) and by a slow 0.24 Hz phrase
  envelope so the motion breathes. Written directly to head/neck/upper-body/lower-body bone rotations with
  decreasing gains down the chain (1.0 / 0.45 / 0.12 / 0.05).
- **Faster ambient cadence** — the ambient timer shortens while speaking (§5.3).

**Live2D counterpart.** The sway maps directly onto `ParamAngleX/Y/Z` and `ParamBodyAngleX/Z` written per frame,
with amplitude from the lip-sync energy. Blink is `ParamEyeLOpen/ROpen`. Micro-expression rotation has no direct
analogue (Live2D expressions are whole-face presets) but the numbered variants (`exp_smile01..05`) *are* that
rotation pool — swap among same-root variants on a timer while speaking. **TakiAgent has no speaking state at
all today**, so none of this exists; it arrives with TTS (#31).

### 5.5 Lip-sync: amplitude envelope with forced closures

`audio_envelope.dart` (204 lines, pure, no framework dependency). From WAV PCM:

1. 20 ms RMS frames (handles 8/16/24/32-bit int and 32-bit float, mono or multi-channel)
2. Normalise with the **95th percentile as peak and 12th percentile as noise floor**, then `^0.72` to compress
   dynamics — so quiet voices and loud voices produce the same mouth range
3. Fast-attack / slow-release smoothing (factor 0.68 rising, 0.30 falling)
4. **Forced closures**: after 120–240 ms of open mouth, find the local dip and force it to 0 for 60 ms

Step 4 is the hard-won part. Pure amplitude mapping leaves the mouth permanently ajar, because speech energy rarely
reaches zero between syllables; real speech has consonant closures. Playback then maps energy → mouth-open with a
dead zone below 0.08 and a `^0.78` curve capped at 0.48 (`chat_screen.dart:483-493`).

**Live2D counterpart.** `ParamMouthOpenY` per frame from `envelope.valueAt(playbackPosition)`. The engine's native
lip-sync (`TTS-INTERFACE.md:34`) should be tested first — if it is plain amplitude, the closure pass still needs
adding. The algorithm is ~150 lines of TS and unit-testable against synthetic PCM.

**No-audio fallback** (`chat_screen.dart:441-452`): when TTS is off or failed, a synthetic 5.2 Hz mouth cycle with a
28 % closure phase, plus a text-length-estimated duration (55 ms/char, clamped 0.9–4.2 s) for the speaking state.
The character still visibly "talks" the text.

### 5.6 Segmented performance: one reply, several beats

The prompt (`app_controller.dart:450`) requires a new speaker line **whenever emotion or intent changes**, each line
carrying its own expression and action tag. Playback (`chat_screen.dart:861-900`) then runs per segment:

- synthesize segment N+1 **while N plays** (one-ahead pipelining)
- before each segment: apply *its* expression, play *its* action, start speaking state with *its* envelope
- generation counter + completer for cancellation (a new user message cancels playback mid-segment)
- temp audio deleted per segment; on any failure, degrade to text + fake mouth and notify without blocking

A three-sentence reply therefore performs three beats instead of one. This is the single biggest expressiveness
gap versus TakiAgent's whole-reply model, and the reason `TTS-INTERFACE.md:40` is listed for re-appraisal in §7.

### 5.7 Tap reactions with voice

`tap_reaction.dart` + `_reactToTap` (`chat_screen.dart:670-724`):

- Hit-testing uses the skeleton's **bounding-box attachments** (`BB_head`, `BB_arm_L`, ...) with point-in-polygon;
  on overlap the **smallest** polygon wins (a hand over the torso resolves to the hand)
- Each part has one or more reaction animations, picked at random
- Each reaction has **three voice variants** (`voiceAsset(variant)`), one played at random — the same poke does not
  sound the same twice
- Voice is suppressed while a reply is in progress; the reaction animation is not
- Reaction locks the face (`_tapReactionActive`) for 1.35 s, then restores the prior expression

**TakiAgent today** (`click-reactions.ts`, `click-regions.ts`): a 7-cell grid over the model's bounding rectangle,
one tag per cell, no voice, no reaction lock. The grid is a reasonable substitute for polygons (Live2D hit areas
are rectangles anyway — Cubism 2 manifests carry `hit_areas_custom`, which `click-regions.ts` does not read). The
voice-variant idea is the one worth taking: it is exactly the "signature pre-recorded clips" already planned in
`TTS-INTERFACE.md:44`, applied to touch instead of speech.

### 5.8 Mood as a bridge between turns

Weak implementation, correct shape. `_moodFromText` (`app_controller.dart:802-813`) is keyword regex; the 4-level
mood plus a relationship counter persist across turns and feed **three consumers**: the prompt tail
("当前角色状态：开心。关系点数：42"), the idle pose choice on send (`_applyMoodAnimation`, `chat_screen.dart:821-833`),
and the TTS emotion fallback (`fishEmotionForMood`, `chat_segments.dart:63-68`).

TakiAgent's emotion capsule is a static placeholder (D9; `memory/assembler.ts:21`). The thing to borrow is the
**closed loop with multiple consumers**, not the regex — D9 already prescribes the injection path.

### 5.9 Small things that add up

- **Costume-change sound effect** (`_playSkinChangeEffect`) — a swap is an event, not a silent reload
- **Time-of-day scene + ambient soundscape** (`soundscape_controller.dart`): day/night ambient loop, optional BGM,
  scene backdrop by hour — a desktop pet has no backdrop, but a time-aware ambient layer is cheap
- **Reaction lock precedence**: tap > speech > ambient. Every scheduler checks `_tapReactionActive` before firing,
  so a poke is never overridden by a scheduled gesture 200 ms later
- **Generation counters everywhere** (`_motionGeneration`, `_speechPlaybackGeneration`, `_motionLoadGeneration`):
  every async completion checks it still belongs to the current epoch, so a costume switch mid-speech or a rapid
  double-send cannot resurrect stale state — the same discipline as `idle-motion.ts`'s `isStale`

### 5.10 Does not transfer

- *Inline tags as the presentation channel.* It works there because there is exactly one character with two fixed
  poses. It would forfeit the dynamic enum, costume-change detection, drift self-heal, and audit consistency —
  precisely the properties that make character/costume switching safe here. (Owner ruling, see the preamble.)
- *A hand-written per-pose mapping table.* Its animation names (`grp_fg_106`, `motion_oneshot_D_010_active`) are
  semantically opaque, so a table is unavoidable. Ours are not, so a parser replaces the table.
- *Everything else*: keyword-regex mood detection, a single rewritten text blob as long-term memory, all state in
  one 891-line controller over key-value storage, DuckDuckGo HTML scraping (TakiAgent uses Tavily MCP per D60), and
  a 2,816-line screen class mixing UI, orchestration, TTS, and networking.

### 5.11 Summary: gap and cost

| Lesson | TakiAgent today | Gap | Cost | Depends on TTS? |
| --- | --- | --- | --- | --- |
| 5.2 Expression relax timer | set-and-forget | expressions never fade | tiny, renderer-only | no |
| 5.3 Ambient recency + exploration | random idle pool | can repeat; no mood link | small, renderer-only | no |
| 5.3 Mood-weighted ambient | — | idle ignores expression | small, needs current-expression signal | no |
| 5.7 Tap voice variants | grid + tag, no voice | silent pokes | small, needs clip library (`TTS-INTERFACE.md:44`) | no |
| 5.7 Reaction lock | none | scheduled gesture can override a poke | small | no |
| 5.9 Costume-swap SFX | silent | — | trivial | no |
| 5.5 Lip-sync envelope + closures | contract only | — | ~150 lines pure TS | **yes** |
| 5.4 Speaking state (blink, sway, micro-expr) | none | — | medium, per-frame param writes | **yes** |
| 5.5 No-audio fake mouth | — | — | small | with speaking state |
| 5.6 Segmented beats | whole-reply | one beat per reply | medium; re-appraise `TTS-INTERFACE.md:40` | **yes** |
| 5.8 Mood loop | static capsule (D9) | no cross-turn affect | medium; D9 path | no |
| 5.1 Layered composition | motion + expression | blink/sway/mouth would collide | design discipline for 5.4 | — |

The first six rows are **available now, without TTS, renderer-only** — they are the cheapest expressiveness the
project can buy. The TTS-dependent rows define what #31 should build beyond the wire contract.

---

## 6. Engine and asset feasibility for §5.1 and §5.4

§5 describes Spine behaviour. This section records what was **measured in our own assets and installed engine**
about reproducing the two structural lessons — layered composition (§5.1) and a speaking state (§5.4). Engine
API references below come from the installed typings of `untitled-pixi-live2d-engine`. The Phase 2 lab browser run
on 2026-09-07 additionally verified expression/motion composition on `taki/arbeit` and `taki/live_01` against engine
1.3.1; the source-only premise that an unfiltered motion necessarily destroys an expression was disproved. Speech
and the later overlay experiments remain separate acceptance work. Detailed evidence and reproduction commands
live in `.trellis/tasks/09-03-avatar-presentation-lab/research/phase2-browser-findings-2026-09-07.md`.

### 6.1 Motions write the face, but expression update order matters

Cubism 2 (`taki/arbeit`, 43 `.mtn` files): each motion writes **64 distinct parameters, 63 of them present in every
single motion** — including the entire face (`PARAM_BROW_*`, `PARAM_EYE_*`, `PARAM_MOUTH_*`, `PARAM_CHEEK*`,
`PARAM_TEAR`). Cubism 3 (`taki/live_01`): every motion carries **105 parameter curves**, likewise covering eyes,
brows and mouth.

The expression-declared unions are much smaller: 22 ids in Cubism 2 and 69 in Cubism 3. Shared ids are relevant to
composition, but they do not by themselves prove which layer wins. Primary and parallel motion updates run before
the expression update, and `config.preserveExpressionOnMotion` defaults to true.

**Measured correction (2026-09-07):** the installed legacy expression implementation parses the declared add/mult
and normalizes `def`, but applies every entry with `setParamFloat(id, val * weight)`. Thus C2 expressions effectively
SET their parameters. With `smile01` active, unfiltered `angry02` writes brow form -1 and eye form down to -1, but the
final values remain the smile's +0.5 and +1. Both command orders preserve the visible smile. With filtering, the
motion's face output becomes the retained base while the final smile is still the same. The previous prediction
that the brow would add -1 + 0.5 was incorrect.

C3 `exp_smile01` also survives the tested unfiltered `mtn_angry02_C`: the motion writes `Paramsmile01 = 0`, then the
expression adds 1. Its brow form likewise ends at 0.3. A yes in both cases is a valid observation, not an operator
mistake. Filtering must additionally be assessed from actual cached curves and pre-expression motion output.

Mouth is contended too: all motions write `PARAM_MOUTH_OPEN_Y`, measured as constant `0.00` across every sampled
motion — harmless-looking, but "writes 0" and "does not write" differ once a lip-sync layer exists.

### 6.2 The engine already provides the equivalent of Spine tracks

| API | Location | Role |
| --- | --- | --- |
| `parallelMotion(motionList)` | `index.d.ts:4497` | start several motions concurrently |
| `ParallelMotionStartOptions.ignoreParamIds?: string[]` | `index.d.ts:747-753` | **a motion relinquishes control of the listed parameters** |
| `extendParallelMotionManager(count)` | `index.d.ts:3321-3324` | add parallel channels |
| `parallelMotionManager: ParallelMotionManager[]` | `index.d.ts:3154` | the channel array |

`ignoreParamIds` is the functional equivalent of AgentAtelierR's `OccupancyLetters`: the prototype declares occupancy
in the asset, we declare relinquishment at the call site. The proposed layering:

| Layer | Mechanism | Relinquishes |
| --- | --- | --- |
| Body motion | primary motionManager | the face parameter set |
| Expression | expressionManager (already an independent layer) | — (writes only the face) |
| Blink, lip-sync, speaking sway | per-frame parameter writes | — |

The face set to relinquish does not need a hand-written list: **it is exactly the parameter set declared by the
costume's expression files**, readable at load time (22 ids for Cubism 2, 69 for Cubism 3 in the sampled costumes).

### 6.3 Per-frame parameter writing is available, with the right hook

```
setParameterValueById(id, value, weight?)        index.d.ts:2106
addParameterValueById(id, value, weight?)        index.d.ts:2120   // additive — what sway needs
multiplyParameterValueById(id, value, weight?)   index.d.ts:2161
```

`InternalModel` emits `beforeMotionUpdate` / `afterMotionUpdate` / `beforeModelUpdate` (`index.d.ts:3758-3770`).
Writing in `afterMotionUpdate` lands **after the motion has applied its curves and before the model renders** — the
same position as AgentAtelierR's `_applySpeakingHeadMotion`, which mutates bone rotations then calls
`updateWorldTransform`.

`addParameterValueById` is a better fit than the prototype's approach: the motion's own `ParamAngleX` curve keeps
playing and the sway is summed on top, instead of read-modify-write.

The parameters sway needs are present in both generations (`ParamAngleX/Y/Z`, `ParamBodyAngleX/Y/Z`, `ParamBreath`),
and the assets exercise them at usable amplitude — measured Cubism 2 range for `PARAM_ANGLE_Y` reaches −22°..+17°.

### 6.4 Native speech and mouth movement

```
speak(sound, { volume, expression, resetExpression, onFinish, onError })   index.d.ts:4538
stopSpeaking()                                                            index.d.ts:4547
mouthSync(): number                                                       index.d.ts:3560
SoundManager.analyze(analyser): number                                    index.d.ts:3948
SoundManager.analysers: AnalyserNode[]                                    index.d.ts:3917
```

Lip-sync is built in: `speak()` accepts a URL or base64 audio, drives a WebAudio `AnalyserNode`, and `mouthSync()`
returns the per-frame mouth value. This is why `TTS-INTERFACE.md:34` chose this engine. `speak`'s `expression` +
`resetExpression` options also implement a subset of the expression-relax behaviour of §5.2 for the speaking case.

**Installed 1.3.1 correction (2026-09-08).** `SoundManager.analyze()` computes RMS, converts it to decibels,
normalizes against the analyser's configured decibel range, and rounds to tenths. Both model generations apply
gain (default 1.5), power 1.15, a positive-only floor of 0.1 and cap of 1, then an additive weight (default 0.4).
Zero input remains zero. A quiet but positive signal has a minimum computed contribution of 0.04; this alone
does not prove that every utterance leaves the mouth ajar. Actual final parameters can also include motion,
expression and physics writes and must be observed separately.

The native path does not implement the prototype's percentile normalization or inserted closures. The lab first
measures native playback and natural pauses on real speech; any custom envelope is a later owner decision.
The analyser uses its own decoded-buffer source alongside the audible player. `speak()` resolving true confirms
initialization, while `currentAudio.isPlaying` and a running AudioContext establish browser playback state.
Browser-observed start times do not measure the physical speaker's output latency.

**Native lab result (2026-09-08):** both `taki/arbeit` and `taki/live_01` played real local system-voice speech,
returned to mouth value 0 during pauses, and passed replay/Stop/Resume/replacement checks. On this fixture the
default gain 1.5 capped about 81-86% of positive analyser samples; native gain 1.0 reduced that to about 1-2%.
This supports evaluating the existing gain/weight controls before proposing a custom driver, not a universal
gain preset. The default remains unchanged and actual Fish/target-voice acceptance is pending. See the task's
[`Phase 4 evidence`](../.trellis/tasks/09-03-avatar-presentation-lab/research/phase4-native-speech-findings-2026-09-08.md)
for raw measurements, browser coverage and limitations.

Two paths, to be decided by measurement: (a) ship the engine's own lip-sync and judge it on short utterances;
(b) bypass it — play the audio, precompute the envelope, write `ParamMouthOpenY` in `afterMotionUpdate` (~150 lines
of pure TS, unit-testable against synthetic PCM). Testing (a) first also validates the engine-selection assumption
recorded in `TTS-INTERFACE.md:34`.

The other three speaking sub-behaviours map cleanly:

**Owner scope (2026-09-08):** existing native blink and sway are sufficient for this experiment. The mapping below
is historical design context, not a request for replacement overlays. Expression relax belongs to the future mood
system and should restore the mood preset's presentation after a transient expression, not enforce a fixed neutral reset.

| §5.4 behaviour | TakiAgent mechanism | Difficulty |
| --- | --- | --- |
| Blink | `setParameterValueById('ParamEyeLOpen'/'ParamEyeROpen', 0)` on a timer | easy |
| Head/body sway | `addParameterValueById` on the angle/body parameters per frame | easy |
| Micro-expression rotation | switch among same-root numbered variants (`exp_smile01`↔`02`↔`03`) | easy — reuses §4's root grouping |
| Faster ambient cadence while speaking | interval change in `idle-motion.ts` | easy |

### 6.5 Incidental finding: semantic emotion parameters (Cubism 3 only)

Cubism 3 expressions drive named emotion channels alongside the geometric ones: `ParamEmo1`..`ParamEmo6`,
`Paramsmile01`/`02`, `Paramangry`/`2`/`3`, `Paramcry`/`2`, `Paramsad`, `Paramserious`, `Paramkime`, `Parampale`,
`Paramdistress`, `Paramsurprised_01`, plus per-emotion eyebrow channels (`Param_smile_eyebrows`, ...). `exp_smile01`
sets `Paramsmile01 = 1` and `ParamEmo1 = 1` with everything else at 0.

If these behave as continuous intensity channels, emotion could be **blended and interpolated** rather than switched
between discrete presets — something AgentAtelierR cannot do at all. Their full visual semantics remain unverified.
The installed parser only recognizes literal `"Add"`, `"Multiply"`, and `"Overwrite"`; the imported numeric `Blend`
values 1 and 2 therefore both use the additive fallback. In the browser, `exp_smile01` adds eye-open 1 to the motion's
eye-open value and reaches the model's 1.5 limit. Numeric 2 must not be interpreted as an effective multiplier.
System A/B costumes have no equivalent emotion channels, so any use must degrade.

### 6.6 Verdict and the gating experiment

| Capability | Feasible | Depends on | Risk |
| --- | --- | --- | --- |
| Layered composition (§5.1) | **Positive on the two tested costumes** | `ignoreParamIds`, expression update order, and hook position | later overlays still need their own verification |
| Speaking state (§5.4) | **Yes** | per-frame parameter writes | none — parameters confirmed present |
| Lip-sync (§5.5) | **Yes, engine-native** | `speak()` / `mouthSync()` | forced closures need custom work |
| Expression surviving a motion | **Observed with and without face filtering** | C2 effective set / C3 effective blend and authored motion values | one parameter alone cannot certify the whole face |

No track bookkeeping is needed — primary motion, expression layer, and a per-frame hook cover what the prototype
spends 16 Spine tracks on, with `ignoreParamIds` drawing the boundary.

**Gating experiment:** play a body motion with the face parameter set passed as `ignoreParamIds`, set an unrelated
expression, and confirm its relevant final face values and visible appearance remain stable during active motion.
The 2026-09-07 browser verification establishes a positive result for the tested smile combinations. It does not
require the unfiltered control to fail, and it does not establish that filtering is necessary for these expressions.
The C2 motion cache changed from 64 to 44 curves when 20 non-eye-open face ids were excluded; the smile stayed the
same in either case. In C3, the 69-id request removes the 51 matching curves (105 becomes 54); the other 18 ids have
no curve in the tested motion. The accepted automated matrix covers 45 scenarios and 4,102 sampled frames with
no browser exceptions, including Reset/Set, cancellation, shared cache, three parallel channels, and looping.
Scope, screenshots, and targeted rerun provenance are in the task's browser findings report.

The lab must distinguish successful expression application from a request and idle reference from active-motion
evidence. Engine `resetExpression()` temporarily applies the default while retaining `currentExpression`, so a
subsequent same-name Set can return false unless the caller restores it explicitly. Native C2 `_startMotion` also
ignores its loop argument; the lab owns replay and cancellation for that generation. These are compatibility facts,
not reasons to force an expected no/yes result. A genuine repeatable failure of the filtered composition would still
trigger the mutually exclusive scheduling fallback; that is not what this reproduction observed.

---

## 7. Open questions and items for the registry

Not registered in `deferred-decisions.md` by this document — they need an owner ruling first.

1. **`nf` / `nnf` meaning (blocks complete glossing).** 14 of 43 motions in system A, also present in system B.
   Unrecoverable from the assets (§1.5). Needs playback observation. Until then they pass through branch 5 as their
   own roots — usable, but the model has no gloss for the largest motion family in system A.

2. **System B: filter to the active character, or expose all 11?** Filtering (~39 motions) favors persona
   consistency and a clean prompt; exposing all (397) lets taki perform other characters' signature motions
   (`jaan`, `gattsu`). Recommendation: filter by default, revisit if the extra range is wanted — the character's own
   39 motions already exceed system A's 43-motion costumes in variety.

3. **§4.4 pairing:** one semantic word driving both expression and motion, or keep them independent?

4. **D69 (`deferred-decisions.md:97`) remains open and independent.** The vocabulary work will *reduce* the malformed
   -call surface (smaller choice space, fewer parameters) but cannot be assumed to fix it. If the root cause is that
   `presentationTailStop` ends the loop before the model reads the tool error and corrects, that is unrelated to the
   vocabulary. D69's requirement — layered reproduction before any fix — stands unchanged.

5. **D40 (`deferred-decisions.md:109`)** can be collapsed rather than deferred if §4.5 removes `priority`/`loop`
   from the model-facing schema. Worth confirming when that change is scheduled.

6. **`TTS-INTERFACE.md:40` — whole-reply granularity, for re-appraisal, not reversal.** The 2026-07-14 ruling
   rejected sentence segmentation on latency grounds (who splits / mid-word cuts / inter-segment timbre jumps;
   replies are short, synthesis is 1–2 s). AgentAtelierR segments for a *different* reason: each segment carries its
   own expression and motion, so one reply performs several beats instead of one (§5.6). Its split points are
   model-chosen semantic boundaries (its prompt requires a new speaker line when emotion or intent changes), which
   sidesteps two of the three original objections — "who splits" and "mid-word cuts". **Timbre jump remains a real
   risk and is untested here.** Recorded so the trade-off is re-weighed with the presentation benefit included when
   #31 lands; the existing ruling stands until then.

7. **Expression relax timeout (§5.2) — value and ownership.** AgentAtelierR uses 4.6 s after speech ends. Without a
   speaking state, TakiAgent's timer would start at the expression command itself. Needs a ruling on duration (a
   pet that returns to neutral too fast looks indifferent; too slow looks stuck) and on whether the relax target is
   "neutral" or the character's mood-derived resting face once §5.8 exists. Renderer-only; no Core change.

8. **Pre-TTS presentation batch (§5.11, first six rows) — schedule or fold into #31?** These are renderer-only and
   independent of TTS. Doing them first gives the character visible life before any audio work and de-risks the
   layered-composition discipline (§5.1) that #31 will need. Recommendation: schedule as its own small task ahead of
   #31 — **gated on the §6.6 experiment**.

9. **§6.6 gating experiment — run before scheduling anything in §4.5 or §8 above.** `ignoreParamIds` and
   `parallelMotion` are read from the installed typings only; their runtime behaviour in this engine fork is
   unverified. Every layered-presentation item depends on a motion being able to relinquish the face parameters.
   A negative result forces mutually exclusive expression-and-motion scheduling and invalidates the §5.11 cost
   column, so this is a prerequisite, not a task step.

10. **Lip-sync path (§6.4) — engine-native or custom envelope?** Decide by measuring the engine's own `speak()` /
    `mouthSync()` on real utterances before committing ~150 lines of envelope code. This also tests the
    engine-selection assumption recorded in `TTS-INTERFACE.md:34`. Belongs to #31.

11. **Semantic emotion parameters (§6.5) — verify and decide whether to use.** Cubism 3 costumes expose named
    emotion channels that could give continuous emotional intensity instead of discrete preset switching. Needs
    verification of their semantics and of the numeric `Blend` encoding. System A/B costumes lack them entirely, so
    any use must degrade cleanly — which argues for treating it as an enhancement layer, never a base mechanism.
