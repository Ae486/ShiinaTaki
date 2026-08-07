# Batch 1 design — config store (core-only)

Contract for implement/check. Parent: prd.md (owner-ratified) + research/rs-panel-scoping.md §7/§8.

## Semantics (refines the prd's "seed on first boot" — same observable behavior, cleaner)

- The `config` table stores ONLY operator-set values (sparse). Effective value at read time =
  **env (if explicitly set) > stored (if present) > built-in default**. No seeding pass: a sparse
  resolve gives identical behavior and cannot go stale when an env var is later removed. Record
  this as D1 (design refinement within the ratified semantics).
- Knob classes (registry `apply` field): `env-only` (bootstrap knobs the store cannot govern —
  TAKI_DATA_DIR at minimum; panel shows locked), `restart` (v1 default for everything),
  `live` (NONE in v1 unless the getter conversion is genuinely trivial — implementer may upgrade
  individual knobs ONLY when the consumption site already re-reads per use; otherwise leave
  restart. The registry row is the one-line upgrade path later).
- Secrets (`*_API_KEY`): NEVER stored in the table; config.list reports set/not-set only;
  config.set on a secret key is a structured refusal. (Credential-manager write path is NOT this
  batch.)
- Env-locked: config.set on a knob whose env var is explicitly set = structured refusal
  (`ENV_LOCKED` app error) — never a silent store-write that env then shadows.
- Reset: `config.set {key, value: null}` deletes the stored row (fall back to env/default).

## Components

1. Migration 013 `config` (STRICT): `key TEXT PRIMARY KEY, value TEXT NOT NULL (JSON), updated_at
   TEXT NOT NULL` — follow 012's file+test pattern; register in index-list.
2. `db/config-repo.ts` (+test): get/all/upsert/delete, strict parse at the row boundary (JSON.parse
   + registry-schema validation on read; corrupt row = throw, repo-boundary discipline).
3. `config/knob-registry.ts` (+test): declarative rows for the 30 knobs from the research table —
   `{key, schema (zod), default, apply, secret?, input ({kind: "boolean"|"int"|"number"|"string"|
   "enum", ...hints}), description}`. One row per knob; the registry is the SINGLE source config.list
   renders from. Test pins: count + exact key set vs the research table, no duplicates, every
   default passes its own schema.
4. `config/config-source.ts` (+test): `resolve(key)` implementing the precedence above +
   `effectiveAll()`; consumed by loaders and by config.list.
5. **Boot rewire**: config loaders currently run once at module scope from env (main.ts:92-103
   area). Convert to explicit post-DB-open loading through config-source so STORED values take
   effect at next boot (this is what makes "restart to apply" true). TAKI_DATA_DIR (and anything
   else needed before DB open — verify: log bootstrap? WS bind happens after DB, port CAN come from
   store) stays env-only. **main.ts is at 298/300 counted — extract FIRST** (composition-root
   config/bootstrap block into its own module, the batch-4/6 extraction precedent) before adding
   any line.
6. `@taki/shared`: `CONFIG_METHODS {list, set, subscribe}` + zod param/result schemas (values =
   JSON primitives; list rows carry key/value/stored/envLocked/default/apply/secret-set/input/
   description). No Rust mirror (operator↔core only).
7. Server methods (pattern: memory-tidy.ts factory; subscription: avatar-subscribe.ts):
   `config.list` (operator) / `config.set` (operator; validate via registry schema, fail-closed,
   structured refusals for unknown key / env-locked / secret / env-only) / `config.subscribe` →
   `config.changed {key, value}` push on every successful set. Register in main.ts (~381).
8. Logging: counts/keys only — VALUES never enter log lines (values may be user-ish; keys are safe).

## TDD rows

1 migration 013 up + idempotent re-open; 2 repo round-trip + corrupt-row throw; 3 registry
completeness vs research table (30 keys, secrets flagged, env-only flagged); 4 precedence
env>stored>default (all three orders); 5 set persists + changed push received by subscriber;
6 set refusals: unknown key / bad value (zod) / env-locked / secret — each a distinct structured
error, store untouched; 7 reset (null) deletes row + falls back; 8 boot rewire: with env ABSENT and
a stored value present, the consuming subsystem boots with the stored value (pick one cheap
observable, e.g. WS port or a memory knob surfaced in config state); 9 secrets masked in list
(set/not-set, never the value); 10 config.list values match effectiveAll.

## Gates

pnpm -r typecheck / -w lint / -r test (baselines core 1101 / shared 199 / desktop 143 / cli 32 —
core+shared grow, others byte-stable). Boot smoke: temp TAKI_DATA_DIR, applied **[1..13]**, ws
listening, clean kill. Frozen: apps/desktop, e2e, apps/cli (verification via --call is the
LEADER'S step), all agents/memory internals except the load-path seams the rewire must touch.
