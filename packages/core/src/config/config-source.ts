/**
 * INPUT:  process env + the ConfigRepo's sparse stored rows + the knob registry
 * OUTPUT: createConfigSource({env, repo}) -> { env(), effectiveAll(), resolve(key) }
 * POS:    core/config — the ONE place precedence lives: env (explicitly set) > stored > built-in default. Loaders
 *         consume env() at boot (so a stored value takes effect at next boot); config.list renders effectiveAll()
 */
import { type ConfigEntry, type ConfigValue } from "@taki/shared";
import type { ConfigRepo } from "../db/config-repo.ts";
import { CONFIG_KNOBS, findKnob, type Knob } from "./knob-registry.ts";

export interface ConfigSourceDeps {
  /** The process env, captured once — an env var set at launch outranks anything the panel stored. */
  env: Record<string, string | undefined>;
  repo: ConfigRepo;
}

export interface ResolvedKnob {
  value: ConfigValue | null;
  origin: "env" | "stored" | "default";
}

export interface ConfigSource {
  /** The env view the loaders parse: process env with stored values filled in where env is silent. */
  env(): Record<string, string | undefined>;
  /**
   * UNMASKED internal view (a secret's real value comes back) — for loaders/tests only. Any operator-facing
   * surface must render effectiveAll(), where masking lives; never wire resolve() to a WS response.
   */
  resolve(key: string): ResolvedKnob | undefined;
  /** Every knob with its effective value + provenance — the config.list payload. */
  effectiveAll(): ConfigEntry[];
}

/** An empty string is "not configured" everywhere in the loaders; treat it the same here. */
function envValue(env: Record<string, string | undefined>, key: string): string | undefined {
  const raw = env[key];
  return raw !== undefined && raw.length > 0 ? raw : undefined;
}

/**
 * Env arrives as text; the panel speaks JSON primitives. Coerce by the knob's declared kind so config.list shows
 * `8974` rather than `"8974"`. A value the schema rejects is surfaced verbatim — the operator must SEE the bad
 * value the boot will fail on, not a laundered one.
 */
function fromEnvText(knob: Knob, raw: string): ConfigValue {
  const candidate =
    knob.input.kind === "int" || knob.input.kind === "number"
      ? Number(raw)
      : knob.input.kind === "boolean"
        ? raw.trim().toLowerCase() === "true" || raw.trim() === "1"
        : raw;
  const parsed = knob.schema.safeParse(candidate);
  return parsed.success ? parsed.data : raw;
}

function toEnvText(value: ConfigValue): string {
  return typeof value === "string" ? value : String(value);
}

export function createConfigSource(deps: ConfigSourceDeps): ConfigSource {
  const isEnvLocked = (knob: Knob): boolean => envValue(deps.env, knob.key) !== undefined;

  const resolve = (key: string): ResolvedKnob | undefined => {
    const knob = findKnob(key);
    if (!knob) return undefined;
    const raw = envValue(deps.env, key);
    if (raw !== undefined) return { value: fromEnvText(knob, raw), origin: "env" };
    // env-only knobs are read before the store exists; a stray row must never look authoritative.
    const stored = knob.apply === "env-only" ? null : deps.repo.get(key);
    if (stored !== null) return { value: stored, origin: "stored" };
    return { value: knob.default, origin: "default" };
  };

  return {
    resolve,
    env() {
      const merged: Record<string, string | undefined> = { ...deps.env };
      const stored = deps.repo.all();
      for (const knob of CONFIG_KNOBS) {
        if (knob.apply === "env-only" || knob.secret || isEnvLocked(knob)) continue;
        const value = stored.get(knob.key);
        if (value !== undefined) merged[knob.key] = toEnvText(value);
      }
      return merged;
    },
    effectiveAll() {
      const stored = deps.repo.all();
      return CONFIG_KNOBS.map((knob) => {
        const resolved = resolve(knob.key);
        const secretSet = knob.secret === true && envValue(deps.env, knob.key) !== undefined;
        return {
          key: knob.key,
          // Invariant 5: a secret's value never leaves the process on this surface, only its presence.
          value: knob.secret === true ? null : (resolved?.value ?? null),
          stored: stored.has(knob.key),
          envLocked: isEnvLocked(knob),
          default: knob.secret === true ? null : knob.default,
          apply: knob.apply,
          secret: knob.secret === true,
          secretSet,
          input: knob.input,
          description: knob.description,
        };
      });
    },
  };
}
