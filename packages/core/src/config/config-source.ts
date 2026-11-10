/**
 * INPUT:  process env + the ConfigRepo's sparse stored rows + the knob registry
 * OUTPUT: createConfigSource({env, repo}) -> { env(), effectiveAll(), resolve(key) }
 * POS:    core/config — the ONE place precedence lives: stored > env fallback > built-in default. Loaders
 *         consume env() at boot (so a stored value takes effect at next boot); config.list renders effectiveAll()
 */
import { type ConfigApplication, type ConfigEntry, type ConfigValue } from "@taki/shared";
import type { ConfigRepo } from "../db/config-repo.ts";
import { CONFIG_KNOBS, findKnob, type Knob } from "./knob-registry.ts";

export interface ConfigSourceDeps {
  /** The process env, captured once — fallback for settings without an application-owned value. */
  env: Record<string, string | undefined>;
  repo: ConfigRepo;
  application?: (key: string) => ConfigApplication | undefined;
}

export interface ResolvedKnob {
  value: ConfigValue | null;
  origin: "env" | "stored" | "default";
}

export interface ConfigSource {
  /** The env view the loaders parse: application values overlay eligible process-environment fallbacks. */
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
  let candidate: ConfigValue = raw;
  if (knob.input.kind === "int" || knob.input.kind === "number") {
    candidate = Number(raw);
  } else if (knob.input.kind === "boolean") {
    const normalized = raw.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") candidate = true;
    else if (normalized === "false" || normalized === "0") candidate = false;
  }
  const parsed = knob.schema.safeParse(candidate);
  return parsed.success ? parsed.data : raw;
}

function toEnvText(value: ConfigValue): string {
  return typeof value === "string" ? value : String(value);
}

/** The value a reset exposes, shared with prospective writer validation before any row is removed. */
export function resolveConfigFallback(knob: Knob, env: Record<string, string | undefined>): ResolvedKnob {
  const raw = envValue(env, knob.key);
  return raw === undefined || (knob.input.kind === "boolean" && raw.trim() === "")
    ? { value: knob.default, origin: "default" }
    : { value: fromEnvText(knob, raw), origin: "env" };
}

function acceptsStoredValue(knob: Knob): boolean {
  // Bootstrap values precede storage; credentials have a separate owning store.
  return knob.apply !== "env-only" && knob.secret !== true;
}

function resolveKnob(knob: Knob, stored: ConfigValue | null | undefined, env: Record<string, string | undefined>): ResolvedKnob {
  if (acceptsStoredValue(knob) && stored !== undefined && stored !== null) return { value: stored, origin: "stored" };
  return resolveConfigFallback(knob, env);
}

export function createConfigSource(deps: ConfigSourceDeps): ConfigSource {
  const resolve = (key: string): ResolvedKnob | undefined => {
    const knob = findKnob(key);
    if (!knob) return undefined;
    return resolveKnob(knob, acceptsStoredValue(knob) ? deps.repo.get(key) : null, deps.env);
  };

  return {
    resolve,
    env() {
      const merged: Record<string, string | undefined> = { ...deps.env };
      const stored = deps.repo.all();
      for (const knob of CONFIG_KNOBS) {
        if (!acceptsStoredValue(knob)) continue;
        const value = stored.get(knob.key);
        if (value !== undefined) merged[knob.key] = toEnvText(value);
      }
      return merged;
    },
    effectiveAll() {
      const stored = deps.repo.all();
      return CONFIG_KNOBS.map((knob) => {
        const resolved = resolveKnob(knob, stored.get(knob.key), deps.env);
        const secretSet = knob.secret === true && envValue(deps.env, knob.key) !== undefined;
        return {
          key: knob.key,
          // Invariant 5: a secret's value never leaves the process on this surface, only its presence.
          value: knob.secret === true ? null : resolved.value,
          origin: resolved.origin,
          ...(deps.application ? { application: deps.application(knob.key) } : {}),
          stored: stored.has(knob.key),
          envLocked: knob.apply === "env-only" && envValue(deps.env, knob.key) !== undefined,
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
