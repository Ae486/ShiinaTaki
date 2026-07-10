# Research: frontmatter subset, token budget estimator, filename/slug hygiene

- **Query**: Zero-dep YAML-frontmatter parse/serialize for MEMORY-DESIGN's flat field set; token estimation without a tokenizer dep; safe `NNNN-slug.md` naming for CJK content
- **Scope**: design + empirical (probe output pasted trimmed; scripts under `research/tmp/`, deleted) + external refs
- **Date**: 2026-07-10
- **Field set** (MEMORY-DESIGN `docs/MEMORY-DESIGN.md:58`): `id`, `layer`, `importance: 1-10`, `disclosure` (free text), `created` (ISO), `status: active|archived`, optional `emotional_weight`, optional `expires` — **flat scalars only**.

## 1. Hand-rolled frontmatter subset — RECOMMENDED over the `yaml` dep

### Grammar (what we accept)

- Line 1 exactly `---`; closing line exactly `---`; body = everything after.
- Between fences: `key: value` lines only (blank lines skipped). Key regex `^[a-z][a-z0-9_]*$`. Duplicate keys rejected.
- Values are scalars. **Serializer** (writes only ever come from it): strings **always** `JSON.stringify`'d (one rule handles `:`/quotes/backslashes/leading-trailing spaces; CJK+emoji stay raw — JSON.stringify does not escape non-ASCII); numbers/booleans bare; `undefined` fields omitted; **newlines in values rejected at write time** (throw). **Parser**: value starting with `"` -> `JSON.parse`; bare `true|false` -> boolean; `/^-?\d+(\.\d+)?$/` -> number; anything else -> trimmed literal string (tolerant path for hand-edited files — files are user-editable truth). Zod-validate the parsed record afterwards (schema per field set above); a file failing zod is a reported reconciliation error, never a crash.

### What the subset REJECTS (by design, documented)

Nested maps/lists, multiline scalars (`|`, `>`), anchors/aliases/tags, flow collections, comments (a `#` is literal content — CJK text may contain it), newlines inside values, duplicate keys, non-`key: value` lines. YAML 1.1 footguns (unquoted `no` -> false, timestamp auto-typing) are structurally impossible: our serializer quotes every string, and bare values only ever parse as bool/number/literal.

### Empirical round-trip proof (probe, 20/20 PASS)

15 adversarial round-trips — each serialized then parsed back `===`:

```
PASS colon_space: "约定: 周五 19:00 看电影"        PASS quotes: "she said \"记住这个\" ok"
PASS backslash: "C:\\Users\\taki \\n not-a-newline" PASS leading_trailing_spaces: "  两边有空格  "
PASS cjk_emoji: "吃了豚骨拉面🍜 超好吃🎉"           PASS hash_comment_lookalike: "#不是注释 # 也不是"
PASS yaml_specials: "- [not, a, list] {not: a, map} | > & * ! % @ `"
PASS fence_lookalike: "---"                          PASS numeric_string: "0042" (stays string)
PASS empty_string: ""                                PASS iso_created: "2026-07-10T09:30:00.000Z"
PASS importance_int: 9   PASS emotional_weight_float: 0.75   PASS truncatable_bool: false   PASS plain CJK
```

5 rejection cases PASS (newline value, nested object, colon-less line, duplicate key, missing fence). Full realistic record (all 7 fields + CJK body `答应周五一起看电影 🎬`) round-tripped exactly; body preserved byte-for-byte. Hand-edited unquoted CJK value (`disclosure: 拉面相关的时候`) parses to the expected string.

### vs the `yaml` package

`yaml@2.9.0`: ISC, zero deps, **685,953 bytes unpacked** (`npm view yaml dist.unpackedSize`; https://github.com/eemeli/yaml). It would parse anything users hand-write — but full-YAML generality is exactly what we then have to *reject* (nested structures fail our zod schema anyway), and it adds an interpretation layer between file bytes and index (plus a hard dep constraint: HARD CONSTRAINT says no new deps without a proven safety hole). **No safety hole found in the subset**: parse side is regex + `JSON.parse` (no eval, no type coercion surprises); worst hand-edit outcome is a zod error surfaced by reconciliation. **Recommendation: hand-rolled subset** (~60 lines with serializer), covered by the probe's cases as unit tests. Bonus: our output is simultaneously valid YAML (JSON strings are valid YAML double-quoted scalars), so Obsidian/editors still render the frontmatter.

## 2. Token-budget estimator (no tokenizer dep)

Budgets are **soft** (~800 pinned / ~600 retrieved, MEMORY-DESIGN §Context assembly) — an estimator only needs to be monotone and roughly right; erring high truncates a little early (safe direction).

- Survey: no builtin tokenizer exists in Node. `Intl.Segmenter` IS available (Node 24 full-ICU; verified — grapheme mode counts `🍜👨‍👩‍👧‍👦` as 2 graphemes) but segments graphemes/words, not BPE tokens — not needed. Heuristics: OpenAI "1 token ≈ 4 chars of English" (https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them); DeepSeek official: "1 English character ≈ 0.3 token; 1 Chinese character ≈ 0.6 token" (https://api-docs.deepseek.com/quick_start/token_usage).
- **Recommended two-regime estimator** (mirrors the task's suggestion; conservative across providers since the endpoint is user-configurable):

```ts
const CJK_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/gu; // kana, CJK ext-A, unified, compat, halfwidth kana
export function estimateTokens(text: string): number {
  const cjk = (text.match(CJK_RE) ?? []).length;
  return cjk + Math.ceil((text.length - cjk) / 4);
}
```

Probe outputs: pure zh 17 chars -> 17; pure en 61 chars -> 16 (≈ chars/4); mixed CJK+ASCII+emoji 37 chars -> 19. Calibration notes: vs DeepSeek's own ratios this overestimates CJK ~1.67x (0.6/char actual) — fine for soft budgets; vs cl100k-family (OpenAI-compatible endpoints) 1/char CJK is approximately right (some chars are 2 tokens — a mild underestimate, still within soft-budget tolerance). Emoji fall in the /4 bucket (underestimate; rare in memory text — immaterial, noted). Keep the regime constants in one module so calibration against real `usage` numbers (already returned by every provider response) is a two-line tweak later. No real-usage comparison run (no live provider call in this probe — optional per task).

## 3. Filename/slug hygiene (`NNNN-slug.md`)

### Slugifier (CJK kept, no transliteration dep)

Files are user-browsed truth — readable CJK slugs are the point; pinyin transliteration would need a dep (rejected). Rules:

1. NFC-normalize; take the first ~N chars of source text.
2. Keep `[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]`; every other run (spaces, punctuation, emoji, Windows-forbidden `<>:"/\|?*`, controls) -> single `-`.
3. Collapse `-` runs, trim leading/trailing `-`, lowercase ASCII, cap at ~40 code points, fallback `"entry"` when empty (e.g. all-emoji content).

Windows specifics: forbidden chars are `<>:"/\|?*` + codes 0-31; reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`, case-insensitive, even with extension) are moot because the filename **always starts with the `NNNN-` digit prefix**; trailing dot/space (stripped by Win32) impossible — name ends in `.md` and slug is `-`-trimmed.

### NNNN allocation + atomicity

- Counter is per-directory: scan for `^(\d{4})-` prefixes, `max + 1`, zero-pad 4. NNNN is the uniqueness carrier; the slug is cosmetic. If the composed name exists (races shouldn't happen — single-writer core), bump NNNN and retry.
- Atomic write: existing repo pattern — write `${path}.tmp`, then `renameSync(tmp, path)` (`packages/core/src/devices/paired-device-store.ts:65-70`); same-volume rename, works on Windows including overwrite. Memory store should reuse it verbatim (write file first, then index upsert, then event log — per MEMORY-DESIGN write path).

### Path containment (id/layer/characterId must never escape the memory root)

Primary rule: **tool input never carries a path.** Layer ids come from the registry (zod-validated `MemoryLayerDefinition`, closed set); `characterId` from validated config; `id` is store-allocated. `memory_archive(id)` resolves id -> file via the store's own index (DB lookup), so an LLM-supplied id that doesn't exist is a miss, not a traversal. Defense-in-depth for any joined component:

```ts
const IdSchema = z.string().regex(/^\d{4}-[^/\\<>:"|?* -.]{1,60}$/); // no separators, no dots -> no ".."
const resolved = path.resolve(memoryRoot, ...segments);
if (resolved !== memoryRoot && !resolved.startsWith(memoryRoot + path.sep)) throw new Error("path escapes memory root");
```

(`startsWith(root + sep)` after `resolve` is the standard containment check; the zod regex already makes traversal unexpressible — belt and braces. Note the id regex bans `.` entirely, which also excludes `..`; the `.md` extension is appended by the store, never part of the id.)

## Caveats / Not Found

- The tolerant unquoted-string parse path means a hand-edited value with intentional leading spaces needs quotes — acceptable; document in a README line inside `workspace/memory/` if desired.
- Estimator not compared against a live DeepSeek `usage` response in this probe (optional per task); the calibration hook (constants in one module) covers it.
- Slug cap of 40 + workspace depth keeps paths far below the legacy 260-char MAX_PATH; not empirically stress-tested (Node on Win11 handles long paths anyway).
