# Operator Config Store Contract

> The config store is the Core-owned settings plane used by the home window and CLI operator surfaces. It is a
> sparse operator overlay, not a copy of the process environment and never a secret store. Secret presence currently
> comes from the Core's bootstrap environment; the required durable target remains the OS credential backend.

## 1. Scope / Trigger

Use this contract when adding an operator-visible Core knob, changing how a stored setting reaches a subsystem, or
adding a `config.*` consumer. The load order and provenance are part of the product contract: an application-saved
value wins, the process environment supplements missing application values, and the built-in default is last.

The D59/D61 timing family is the first fully live cross-layer consumer: Shared owns its complete schema, Core validates
both individual values and policy relationships, and every desktop connection owner keeps only an in-memory last-good
projection.

This is infrastructure and a cross-layer protocol. Changes must keep the database, Core resolver/writer, shared zod
schemas, operator methods, and UI apply-state wording aligned.

## 2. Signatures

`config.modelCapabilities({}) -> ModelCapabilitiesResult` is an operator-only, non-mutating metadata read.
Its `declared` catalog variant may include `metadata` with nullable `displayName`, `providerName`,
`canonicalModelId`, `logoUrl`, `reasoning`, `inputModalities`, `outputModalities`, `contextLimit` and `outputLimit`.
Older declarations without this optional object remain valid. The original configured/endpoint model ID is retained.

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

type TimingPolicy = {
  reconnectBaseMs: number;
  reconnectCapMs: number;
  reconnectStabilityResetMs: number;
  openAuthMs: number;
  interactiveRpcMs: number;
  longRpcMs: number;
  chatAckMs: number;
  petCostumeTotalMs: number;
  rendererLoadMs: number;
  homeResultMs: number;
};
```

All config request methods are operator-only and Core-local. There is no Rust mirror because the Shell does not
participate.

`config.modelCapabilities {}` is an independent read, defined in `model-capability-schema.ts`. Its result includes
the active Main binding and a SHA-256 identity of `JSON.stringify([effectiveBaseURL, modelOrNull])`, `apply: "live"`,
separate installed compatible-adapter support and a `declared | unknown | unavailable` catalog projection.
The standalone compatibility reader without an active-binding port retains its conservative restart label.

## 3. Contracts

- `knob-registry.ts` is the single vocabulary for environment keys, stored keys, validation, defaults, input hints,
  apply class, descriptions, and secret classification. Adding a visible knob means adding one registry row.
- Ordinary scalar precedence is `stored row > explicit non-empty env > built-in default`. Presence is explicit:
  stored `false`, schema-valid `0`, and valid empty strings win. Invalid stored primitives remain visible rather than
  silently taking an environment fallback. The table stays sparse: never seed defaults or environment values into it.
- `ConfigSource.env()` overlays eligible stored values into the environment view consumed by boot loaders. It must
  override ordinary environment fallbacks, but never an `env-only` knob or a secret. `resolve()` also ignores stray
  stored bootstrap/secret rows; ordinary config storage cannot become authoritative for those values.
- `config.list` returns every registry row with its effective value and provenance (`stored`, `envLocked`, `default`,
  `apply`). Secret rows always expose `value: null`, `default: null`, and presence through `secretSet` only.
  Ordinary settings remain editable even when their current source is the environment. `envLocked` stays in the wire
  shape for compatibility and is true only for an explicitly environment-set bootstrap knob. One list uses one
  `ConfigRepo.all()` snapshot without per-row database reads.
- `config.set { value: null }` deletes the stored row. It is a reset to environment/default, not a stored JSON null.
  Validate the actual exposed fallback before mutation, including scalar and cross-field checks; do not substitute
  the registry default when the environment supplies a value. `resolveConfigFallback` shares this rule with loaders.
  An invalid reset preserves the previous row and publishes nothing; a successful reset still publishes `value:null`.
  Boolean environment input accepts only true/1/false/0 (case-insensitive, surrounding whitespace ignored); blank
  means unset, matching the existing privacy/trust loaders. Unknown text remains invalid rather than becoming false.
- A successful set or reset publishes one `config.changed` notification. A refused write publishes nothing. Socket
  close removes the subscriber through `ctx.onClose`.
- `apply` identifies a supported runtime consumer; `application` reports its actual boundary and outcome.
  The 83 ordinary rows are live; data root remains bootstrap-only. New Run/operation capture, component replacement
  and maintenance are distinct from immediate application. Backend inapplicability and selected-Hindsight reservations
  override the generic label. See [Live Configuration](./live-configuration.md).
- The ten D59/D61 timing rows come from `TIMING_CONFIG_KEYS` and `TIMING_POLICY_DEVELOPMENT_DEFAULTS` in
  `@taki/shared`; Core and Desktop must not hand-declare duplicate keys/defaults. They are `live` because authenticated
  desktop clients observe `config.changed`, reread the full effective policy, and apply it to later operations.
- A timing write/reset is validated prospectively against the complete effective policy before store mutation. Required
  relationships are `reconnectBaseMs <= reconnectCapMs` and
  `rendererLoadMs < petCostumeTotalMs < homeResultMs`.
- A desktop timing refresh is atomic and last-good: one invalid/missing field rejects the whole candidate. The Core
  store remains authoritative; the desktop fallback exists only so open/auth/reconnect can operate while Core is down.
- Values never enter config log lines. Logging may include only the key, refusal reason, reset flag, and apply class.
- Model capabilities read only non-secret effective MAIN model/base URL keys. Public metadata requests use the fixed
  `https://models.dev/api.json` URL with no credentials or configured endpoint input. Exact catalog API/model matching
  and documented official endpoint mappings are allowed; arbitrary relays, unlisted model aliases and missing fields remain
  unknown. A recognized model name never establishes the identity of a custom endpoint.
- The catalog has one shared in-memory pending read and cached projection: a 5-second fetch/body timeout, 16 MiB body
  bound, one-hour successful TTL and one-minute failed TTL. These bounded resource defaults limit Settings latency and
  memory; expiration never schedules a read. No retry queue, generation probe, durable capability table or dependency
  is introduced. Metadata failure never gates native image transport or overwrites configured context windows.
- Catalog tool calling/image input are independent `boolean | null` declarations. Compatible-adapter transport support
  is separate evidence; provider-native web search is unsupported by this adapter. Application search tools have their
  own availability. Never report native-search absence as a claim that a model has no internet capability.
- Expanded metadata comes from the same maintained catalog: model/provider names and explicit `canonical_model_id`
  are not inferred from similar names or family strings. Absent or invalid optional metadata remains null. The declared
  context/output limits never overwrite runtime settings, calibration or historical usage. Do not introduce local
  per-model alias registries, another agent runtime or a second accounting dependency for display metadata.
- Provider logos use the fixed `https://models.dev/logos/{encodedProviderId}.svg` route. Shared validates that source;
  Settings uses a plain image and local generic fallback, never injected SVG markup. Packaged CSP grants only the
  models.dev image origin. Unknown/custom routes keep their original configured ID and generic icon. Current Settings
  declarations must not be attached to historical Monitor records lacking proven serving-endpoint identity.
- Settings reads are scoped to the physical Home client and actual configured model/base URL, visibility-gated and
  refreshed by configuration identity changes or deliberate demand. Compare the returned safe identity before display;
  old success/failure cannot reattach to a changed model or client. Display declared source and unknown/unavailable
  states concisely, alongside the existing restart application guidance.

## 4. Validation & Error Matrix

Every `config.set` refusal uses app error code `CONFIG_REFUSED` and a machine-readable `error.data.reason`.
The legacy `env-locked` reason remains protocol-compatible but is not emitted for ordinary application saves.

| Condition | Reason / behavior | Store and push |
|-----------|-------------------|----------------|
| Key is absent from the registry | `unknown-key` | unchanged; no push |
| Primitive fails the row's zod schema | `invalid-value` | unchanged; no push |
| Non-empty process env supplies an ordinary key | Application write/reset is allowed after validation | ordinary sparse write/delete and push |
| Row is classified `secret` | `secret` | unchanged; no push |
| Row is classified `env-only` | `env-only` | unchanged; no push |
| Params contain an object/array or an empty key | shared schema rejects before the handler | unchanged; no push |
| Stored TEXT is not JSON or decodes to a composite | repository throws at the DB boundary | boot/read fails visibly |
| One timing value is valid alone but makes the full policy inconsistent | `invalid-value` with the cross-field issue | unchanged; no push |
| Valid primitive or reset | return `status: "ok"` with apply class | upsert/delete; one push |

The supplementary `config.modelCapabilities` read never writes or publishes a config change:

| Condition | Read result |
| --- | --- |
| MAIN model/base URL missing | `catalog: { status: "unknown", reason: "unconfigured" }`; no catalog fetch |
| Endpoint or exact model cannot be matched | `unknown` with `endpoint` or `model`; no name-based inference |
| Exact model matches, tool or input declaration omitted | `declared` with the individual value `null`; explicit false remains false |
| Two known endpoint IDs share explicit canonical ID | Preserve both configured IDs; project the common catalog relationship |
| Optional expanded field missing/invalid, or provider logo fails | Individual field remains null; local icon fallback; model use and statistics remain available |
| Public fetch/body timeout, network/HTTP error, oversized body or invalid catalog | `catalog: { status: "unavailable" }`; no raw diagnostic, retry loop or model call |
| Model/base URL changes during lookup | Result retains its captured configured identity; UI rejects mismatched/retired responses |
| Non-operator connection | Role gate returns `FORBIDDEN` before the read handler |

## 5. Good / Base / Bad Cases

- Good: the operator stores `TAKI_MAX_STEPS=12` while the environment says `7`; `config.list` reports the stored value
  and the next boot's loader receives `"12"` through `ConfigSource.env()`.
- Base: `TAKI_MAX_STEPS` has only an environment value; the panel can replace it with an application-owned setting.
- Base: reset sends `value: null`; the row is deleted, subscribers receive `{ key, value: null }`, and resolution
  falls back to environment/default.
- Base: lowering `homeResultMs` to or below `petCostumeTotalMs` is refused atomically even though the submitted value is
  a positive integer; no inconsistent transient policy is published.
- Base: resetting reconnect base would expose an environment duration above the active cap; refuse before deletion
  even when the built-in default would have been safe. A valid environment reset is not refused because of that default.
- Bad: copy all environment/default values into the table on first boot. Removing an environment override can then
  reveal a stale seed that the operator never chose.
- Bad: store API keys in `config`. This surface reports presence only; moving secret input from bootstrap env to the
  required OS credential backend is separate integration work, not permission to use this table.
- Good: exact OpenAI endpoint/model matches a dated models.dev entry; Settings labels tool/image support as catalog
  declarations and labels native search as unavailable through the current connection adapter.
- Good: two catalog-known DeepSeek aliases share canonical identity while the original configuration and usage names
  remain untouched. Bad: use a catalog lookup to decide whether already-correlated request usage is valid.
- Base: an operator uses the same model name through an unidentified relay; both declared abilities stay unknown.
- Bad: infer provider-native search from `tool_call: true`, reject native image requests when the catalog is offline,
  or show a previous endpoint's declaration after the configured base URL changes.

## 6. Tests Required

- `013-config.test.ts`: table creation, idempotent migration set, primary-key uniqueness, STRICT TEXT enforcement.
- `config-repo.test.ts`: primitive round-trip, sparse miss, upsert/delete, full map, corrupt JSON/composite throws.
- `knob-registry.test.ts`: exact unique key set, defaults validate, input metadata validates, secrets/env-only pinned.
- `config-source.test.ts`: application-first precedence, explicit false/zero/empty values, invalid stored input,
  bootstrap/secret exclusions, full masked list, and one storage snapshot without per-row reads.
- `config-writer.test.ts`: success, reset to actual environment/default, four current refusal reasons, and no mutation/push on refusal.
- `config-writer.test.ts` and `config-source.test.ts`: timing cross-field write/reset validation over effective
  stored/env/default precedence, including valid and invalid environment-backed resets.
- `config-methods.test.ts`: operator-only methods, masked list, successful changed pushes, close cleanup, app-error data.
- `timing-policy-schema.test.ts`: exact timing key set, development defaults, projection, and all three relationships.
- A boot-path test must prove stored values reach their real loader and runtime tests must prove later application.
- Model metadata tests cover the public provider/model shape, exact identity, arbitrary proxy/alias, explicit false,
  absent fields, network/schema/body/timeout failure, bounded cache demand, captured configuration changes and secret-free
  fetch/results. Settings tests cover safe identity mismatch, old-response retirement, hidden demand and source/activation
  wording. Public catalog parsing is metadata evidence; actual user-endpoint model acceptance remains separate validation.
- Expanded metadata checks cover explicit aliases, old declarations, optional malformed fields, original-ID display,
  provider/generic icons and image error recovery. Real-browser evidence checks image loading against packaged CSP,
  disclosure details, narrow layout and configuration changes against the actual active binding.

## 7. Wrong vs Correct

```typescript
// Wrong: the UI becomes a second authority and can store a value the Core does not validate.
localStorage.setItem(key, String(value));

// Correct: the Core registry validates and owns the sparse row; the UI renders the returned apply class.
await client.configSet({ key, value });
```

```typescript
// Wrong: validate a reset against a default that the environment will replace after deletion.
validateChange({ key, value: value ?? knob.default });

// Correct: the source owns fallback resolution; deletion still publishes null rather than persisting the fallback.
validateChange({ key, value: value ?? resolveConfigFallback(knob, env).value });
```

```typescript
// Wrong: a familiar model name proves neither this relay nor native web search support.
return { imageInput: model.startsWith("gpt-"), nativeWebSearch: catalog.tool_call };

// Correct: expose independent declaration/adapter evidence and keep unrecognized routes unknown.
return { configured: activeIdentity, apply: "live", adapter, catalog: exactMatch ?? { status: "unknown", reason: "endpoint" } };
```
