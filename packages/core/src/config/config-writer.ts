/**
 * INPUT:  a knob key + a JSON-primitive value (or null to reset), from an operator surface
 * OUTPUT: createConfigWriter({env, repo, onChanged}) -> { set } returning ok | a typed refusal
 * POS:    core/config — the settings store's ONLY write path (invariant 2 single writer). Fail-closed: an unknown
 *         key, a schema-rejected value, an env-shadowed knob, a bootstrap knob and a secret each refuse DISTINCTLY
 *         and leave the store untouched; secrets belong to the credential manager (invariant 5)
 */
import type { ConfigChanged, ConfigRefusalReason, ConfigValue } from "@taki/shared";
import type { ConfigRepo } from "../db/config-repo.ts";
import { createConfigSource } from "./config-source.ts";
import { findKnob, type KnobApply } from "./knob-registry.ts";
import { validateTimingConfigChange } from "./timing-config-validation.ts";

export interface ConfigWriteInput {
  key: string;
  /** null deletes the stored row, handing the knob back to env/default. */
  value: ConfigValue | null;
}

export type ConfigWriteOutcome =
  | { ok: true; key: string; value: ConfigValue | null; apply: KnobApply }
  | { ok: false; reason: ConfigRefusalReason; message: string };

export interface ConfigWriterDeps {
  env: Record<string, string | undefined>;
  repo: ConfigRepo;
  /** Fired only after a successful write — the config.changed fan-out. */
  onChanged?: (change: ConfigChanged) => void;
}

function refuse(reason: ConfigRefusalReason, message: string): ConfigWriteOutcome {
  return { ok: false, reason, message };
}

export function createConfigWriter(deps: ConfigWriterDeps) {
  const source = createConfigSource({ env: deps.env, repo: deps.repo });
  return {
    set({ key, value }: ConfigWriteInput): ConfigWriteOutcome {
      const knob = findKnob(key);
      if (!knob) return refuse("unknown-key", `unknown config key ${key}`);
      if (knob.secret === true) {
        return refuse("secret", `${key} is a secret; it lives in the OS credential store, not the config table`);
      }
      if (knob.apply === "env-only") return refuse("env-only", `${key} is a bootstrap value and can only be set via env`);
      const fromEnv = deps.env[key];
      if (fromEnv !== undefined && fromEnv.length > 0) {
        return refuse("env-locked", `${key} is set in the environment, which shadows any stored value`);
      }

      let accepted = value;
      if (value !== null) {
        const parsed = knob.schema.safeParse(value);
        if (!parsed.success) return refuse("invalid-value", `${key}: ${parsed.error.issues[0]?.message ?? "invalid value"}`);
        accepted = parsed.data;
      }
      const timingIssue = validateTimingConfigChange(source, { key, value: accepted });
      if (timingIssue) return refuse("invalid-value", `${key}: timing policy is inconsistent (${timingIssue})`);

      if (accepted === null) {
        deps.repo.delete(key);
      } else {
        deps.repo.upsert(key, accepted);
      }
      deps.onChanged?.({ key, value: accepted });
      return { ok: true, key, value: accepted, apply: knob.apply };
    },
  };
}

export type ConfigWriter = ReturnType<typeof createConfigWriter>;
