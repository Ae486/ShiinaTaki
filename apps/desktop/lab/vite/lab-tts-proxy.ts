/**
 * INPUT:  TAKI_LAB_TTS_LOCAL_TARGET and dev-server requests for the two lab TTS endpoints.
 * OUTPUT: fixed-origin proxy entries plus public target metadata; no credential storage or arbitrary forwarding.
 * POS:    experimental / lab — not in production path; only active under vite serve.
 */

import type { Plugin, ProxyOptions } from "vite";

export function labTtsTargets(env: Record<string, string | undefined>): { fishBaseUrl: string; localBaseUrl: string } {
  const local = new URL(env.TAKI_LAB_TTS_LOCAL_TARGET ?? "http://127.0.0.1:9880");
  if (!["http:", "https:"].includes(local.protocol) || local.username || local.password || local.search || local.hash) {
    throw new Error("TAKI_LAB_TTS_LOCAL_TARGET must be an HTTP(S) URL without embedded credentials, query or fragment");
  }
  return { fishBaseUrl: "https://api.fish.audio", localBaseUrl: local.href.replace(/\/+$/u, "") };
}

export function labTtsProxy(env: Record<string, string | undefined>): Record<string, ProxyOptions> {
  const targets = labTtsTargets(env);
  const local = new URL(targets.localBaseUrl);
  const basePath = local.pathname.replace(/\/+$/u, "");
  const localPath = basePath.endsWith("/v1") ? `${basePath}/audio/speech` : `${basePath}/v1/audio/speech`;
  return {
    "^/lab-tts/fish/v1/tts$": { target: targets.fishBaseUrl, changeOrigin: true, rewrite: (path) => path.slice("/lab-tts/fish".length) },
    [`^/lab-tts/local${escapeRegex(localPath)}$`]: { target: local.origin, changeOrigin: true, rewrite: (path) => path.slice("/lab-tts/local".length) },
  };
}

export function devLabTtsConfig(): Plugin {
  return {
    name: "taki-lab-tts-config", apply: "serve",
    configureServer(server) {
      const targets = labTtsTargets(process.env);
      server.middlewares.use((req, res, next) => {
        if (req.url !== "/lab-tts/config") return next();
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(targets));
      });
    },
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
