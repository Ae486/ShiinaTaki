/**
 * INPUT:  this file's repo location + optional TAKI_E2E_REAL_ENV_FILE or <repo>/.env.local provider credentials
 * OUTPUT: CORE_DIR / TAKI_NODE_BIN paths + dummyProviderEnv() / realProviderEnv() builders
 * POS:    e2e/fixture — the single place the harness knows the repo layout; test scope only
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const CORE_DIR = join(REPO_ROOT, "packages", "core");

export const TAKI_NODE_BIN = join(
  REPO_ROOT,
  "apps",
  "desktop",
  "src-tauri",
  "target",
  "debug",
  process.platform === "win32" ? "taki-node.exe" : "taki-node",
);

const PROVIDER_KEYS = ["TAKI_PROVIDER_BASE_URL", "TAKI_PROVIDER_API_KEY", "TAKI_PROVIDER_MODEL"] as const;

function envLocal(): Record<string, string | undefined> {
  const path = process.env.TAKI_E2E_REAL_ENV_FILE
    ? resolve(process.env.TAKI_E2E_REAL_ENV_FILE)
    : join(REPO_ROOT, ".env.local");
  if (!existsSync(path)) return {};
  return parseEnv(readFileSync(path, "utf8"));
}

/** Real provider env from .env.local, or null when any key is missing — L2 (real-LLM) tests skip then. */
export function realProviderEnv(): Record<string, string> | null {
  const parsed = envLocal();
  const env: Record<string, string> = {};
  for (const key of PROVIDER_KEYS) {
    const value = parsed[key];
    if (!value) return null;
    env[key] = value;
  }
  return env;
}

/** Parseable but never-called provider config for no-LLM scenarios (core boot is fatal-fast without one). */
export function dummyProviderEnv(): Record<string, string> {
  return {
    TAKI_PROVIDER_BASE_URL: "http://127.0.0.1:9/v1",
    TAKI_PROVIDER_API_KEY: "e2e-dummy-key",
    TAKI_PROVIDER_MODEL: "e2e-dummy-model",
  };
}
