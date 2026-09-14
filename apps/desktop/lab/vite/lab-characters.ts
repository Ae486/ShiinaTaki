/**
 * INPUT:  TAKI_LAB_CHARACTERS_ROOT (else ~/.takiagent/workspace/characters) + dev-server requests under /lab-characters.
 * OUTPUT: devLabCharacters() — a serve-only Vite Plugin: JSON character listing at the bare prefix, raw costume files
 *         below it; resolveCharactersRoot / listCharacters / resolveFile / mimeForPath exported pure for tests.
 * POS:    experimental / lab — not in production path; node-side, imported ONLY by apps/desktop/vite.config.ts.
 *         Deliberately duplicates the spikeAssets middleware shape instead of refactoring it: the copy leaves with the lab.
 */

import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { extname, join, normalize, sep } from "node:path";
import type { Plugin } from "vite";

const PREFIX = "/lab-characters";
const MIME: Record<string, string> = {
  ".json": "application/json",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

export interface LabCharacterEntry {
  id: string;
  /** The costume directory's raw character.json — parsed here, shaped by the browser-side catalog. */
  character: unknown;
}

export interface LabCharacterListing {
  root: string;
  characters: LabCharacterEntry[];
}

export function resolveCharactersRoot(env: Record<string, string | undefined>): string {
  return env.TAKI_LAB_CHARACTERS_ROOT ?? join(homedir(), ".takiagent", "workspace", "characters");
}

/** Every immediate subdirectory holding a readable character.json, name-sorted so the picker order is stable. */
export function listCharacters(root: string): LabCharacterListing {
  if (!existsSync(root)) return { root, characters: [] };
  const characters: LabCharacterEntry[] = [];
  for (const name of readdirSync(root).sort()) {
    const manifest = join(root, name, "character.json");
    if (!existsSync(manifest) || !statSync(manifest).isFile()) continue;
    const character = readManifest(manifest);
    if (character !== null) characters.push({ id: name, character });
  }
  return { root, characters };
}

export function mimeForPath(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** null = refuse: the ref escaped the characters root, or names no regular file. */
export function resolveFile(root: string, rel: string): string | null {
  const base = normalize(root);
  const file = normalize(join(base, rel));
  // The separator suffix stops a sibling directory (…/characters-evil) from passing a bare prefix test.
  if (!file.startsWith(base.endsWith(sep) ? base : base + sep)) return null;
  if (!existsSync(file) || !statSync(file).isFile()) return null;
  return file;
}

export function devLabCharacters(): Plugin {
  return {
    name: "taki-lab-characters",
    apply: "serve",
    configureServer(server) {
      const root = resolveCharactersRoot(process.env);
      server.middlewares.use((req, res, next) => {
        if (!handleLabRequest(root, req, res)) next();
      });
    },
  };
}

// false = not ours, let the next middleware have it.
function handleLabRequest(root: string, req: IncomingMessage, res: ServerResponse): boolean {
  const path = (req.url ?? "").split("?")[0] ?? "";
  if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
  const rel = decodePath(path.slice(PREFIX.length + 1));
  if (rel === "") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(listCharacters(root)));
    return true;
  }
  const file = rel === null ? null : resolveFile(root, rel);
  if (file === null) {
    res.statusCode = 404;
    res.end("lab character asset not found");
    return true;
  }
  res.setHeader("Content-Type", mimeForPath(file));
  createReadStream(file).pipe(res);
  return true;
}

// null = undecodable (a stray %); a malformed escape must 404, never throw out of the middleware.
function decodePath(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function readManifest(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch (err) {
    console.warn(`[lab-characters] skipping unreadable manifest ${file}: ${String(err)}`);
    return null;
  }
}
