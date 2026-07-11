import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// Tauri expects a fixed port and no clearing of the screen on error.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
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
