# Operator Config Store Contract

> The config store is the Core-owned settings plane used by the home window and CLI operator surfaces. It is a
> sparse operator overlay, not a copy of the process environment and never a secret store. Secret presence currently
> comes from the Core's bootstrap environment; the required durable target remains the OS credential backend.

## 1. Scope / Trigger

Use this contract when adding an operator-visible Core knob, changing how a stored setting reaches a subsystem, or
adding a `config.*` consumer. The load order and provenance are part of the product contract: an explicit process
environment value wins, an operator value applies when the environment is silent, and the built-in default is last.

This is infrastructure and a cross-layer protocol. Changes must keep the database, Core resolver/writer, shared zod
schemas, operator methods, and UI apply-state wording aligned.

## 2. Signatures

Migration 013 owns the sparse table:

```sql
CREATE TABLE config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
```

`value` is JSON text encoding exactly one primitive: `string | number | boolean`.

```typescript
const CONFIG_METHODS = {
  list: "config.list",
  set: "config.set",
  subscribe: "config.subscribe",
  changed: "config.changed",
} as const;

type ConfigApply = "env-only" | "restart" | "live";
type ConfigValue = string | number | boolean;

type ConfigSetParams = { key: string; value: ConfigValue | null };
type ConfigSetResult = {
  status: "ok";
  key: string;
  value: ConfigValue | null;
  apply: ConfigApply;
};

type ConfigChanged = { key: string; value: ConfigValue | null };
```

All three request methods are operator-only and Core-local. There is no Rust mirror because the Shell does not
participate.

## 3. Contracts

- `knob-registry.ts` is the single vocabulary for environment keys, stored keys, validation, defaults, input hints,
  apply class, descriptions, and secret classification. Adding a visible knob means adding one registry row.
- Effective precedence is `explicit non-empty env > stored row > built-in default`. The table stays sparse: never
  seed defaults or environment values into it.
- `ConfigSource.env()` overlays eligible stored values into the environment view consumed by boot loaders. It must
  never override an explicit environment value, an `env-only` knob, or a secret.
- `config.list` returns every registry row with its effective value and provenance (`stored`, `envLocked`, `default`,
  `apply`). Secret rows always expose `value: null`, `default: null`, and presence through `secretSet` only.
- `config.set { value: null }` deletes the stored row. It is a reset to environment/default, not a stored JSON null.
- A successful set or reset publishes one `config.changed` notification. A refused write publishes nothing. Socket
  close removes the subscriber through `ctx.onClose`.
- `apply` is truthful operator guidance. `restart` means the row is durable now and loaders consume it on the next
  Core boot. Mark a knob `live` only after its production consumption site re-reads per use.
- Values never enter config log lines. Logging may include only the key, refusal reason, reset flag, and apply class.

## 4. Validation & Error Matrix

Every refusal uses app error code `CONFIG_REFUSED` and a machine-readable `error.data.reason`.

| Condition | Reason / behavior | Store and push |
|-----------|-------------------|----------------|
| Key is absent from the registry | `unknown-key` | unchanged; no push |
| Primitive fails the row's zod schema | `invalid-value` | unchanged; no push |
| Non-empty process env owns the key | `env-locked` | unchanged; no push |
| Row is classified `secret` | `secret` | unchanged; no push |
| Row is classified `env-only` | `env-only` | unchanged; no push |
| Params contain an object/array or an empty key | shared schema rejects before the handler | unchanged; no push |
| Stored TEXT is not JSON or decodes to a composite | repository throws at the DB boundary | boot/read fails visibly |
| Valid primitive or reset | return `status: "ok"` with apply class | upsert/delete; one push |

## 5. Good / Base / Bad Cases

- Good: the operator stores `TAKI_MAX_STEPS=12`; the environment is silent; `config.list` reports the stored value
  and the next boot's loader receives `"12"` through `ConfigSource.env()`.
- Base: `TAKI_MAX_STEPS` is explicitly present in the process environment; the panel shows it env-locked and a set is
  refused without writing a shadow row.
- Base: reset sends `value: null`; the row is deleted, subscribers receive `{ key, value: null }`, and resolution
  falls back to environment/default.
- Bad: copy all environment/default values into the table on first boot. Removing an environment override can then
  reveal a stale seed that the operator never chose.
- Bad: store API keys in `config`. This surface reports presence only; moving secret input from bootstrap env to the
  required OS credential backend is separate integration work, not permission to use this table.

## 6. Tests Required

- `013-config.test.ts`: table creation, idempotent migration set, primary-key uniqueness, STRICT TEXT enforcement.
- `config-repo.test.ts`: primitive round-trip, sparse miss, upsert/delete, full map, corrupt JSON/composite throws.
- `knob-registry.test.ts`: exact unique key set, defaults validate, input metadata validates, secrets/env-only pinned.
- `config-source.test.ts`: all precedence orders, empty env handling, env-only/secret exclusions, full masked list.
- `config-writer.test.ts`: success, reset, all five refusal reasons, no mutation/no push on refusal.
- `config-methods.test.ts`: operator-only methods, masked list, successful changed pushes, close cleanup, app-error data.
- A boot-path test must prove at least one stored restart knob reaches its real loader when the environment is absent.

## 7. Wrong vs Correct

```typescript
// Wrong: the UI becomes a second authority and can store a value the Core does not validate.
localStorage.setItem(key, String(value));

// Correct: the Core registry validates and owns the sparse row; the UI renders the returned apply class.
await client.configSet({ key, value });
```

```typescript
// Wrong: an environment-owned write appears successful but can never take effect.
repo.upsert(key, value);

// Correct: refuse before mutation and tell the operator why.
if (env[key] !== undefined && env[key]!.length > 0) {
  return { ok: false, reason: "env-locked", message: "..." };
}
```
