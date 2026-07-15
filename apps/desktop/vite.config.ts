import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, normalize, extname } from "node:path";

// Dev-only: serves the git-ignored extracted taki models (repo models/extracted/taki) to the Live2D spike page at
// /spike-assets/*. Keeps copyrighted assets out of public/ and out of any production build. Spike scaffolding (#13).
const SPIKE_ASSET_PREFIX = "/spike-assets/";
const SPIKE_ASSET_ROOT = fileURLToPath(new URL("../../models/extracted/taki", import.meta.url));
const MIME: Record<string, string> = { ".json": "application/json", ".png": "image/png" };

function spikeAssets(): Plugin {
  return {
    name: "taki-spike-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith(SPIKE_ASSET_PREFIX)) return next();
        const rel = decodeURIComponent(req.url.slice(SPIKE_ASSET_PREFIX.length).split("?")[0] ?? "");
        const file = normalize(join(SPIKE_ASSET_ROOT, rel));
        if (!file.startsWith(SPIKE_ASSET_ROOT) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          return res.end("spike asset not found");
        }
        res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
  };
}

// Tauri expects a fixed port and no clearing of the screen on error.
export default defineConfig({
  plugins: [react(), tailwindcss(), spikeAssets()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        pet: fileURLToPath(new URL("./pet.html", import.meta.url)),
        chat: fileURLToPath(new URL("./chat.html", import.meta.url)),
        spike: fileURLToPath(new URL("./spike.html", import.meta.url)),
      },
    },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Rust build output churns and Windows exclusively locks the .dll while cargo writes it; watching
    // src-tauri makes Vite's file watcher crash with EBUSY. The Rust side has its own watcher (tauri dev).
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
