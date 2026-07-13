// INPUT:  network access to the two proprietary Live2D runtime CDNs (Cubism Modern core + Cubism 2.1 legacy).
// OUTPUT: apps/desktop/public/vendor/live2d/{live2dcubismcore.min.js,live2d.min.js} — git-ignored, loaded as <script> globals.
// POS:    experimental / spike tooling — not in production path; the shipped app vendors runtimes via the Tauri layer (#14).
//         These files are license-restricted: never commit, never hotlink at runtime, never bundle into a release build.

import { mkdir, writeFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "apps", "desktop", "public", "vendor", "live2d");

// Cubism Modern core (Cubism 3/4/5) — official Live2D CDN, the source the Cubism SDK tutorials point to.
// Cubism 2.1 legacy — official distribution ended 2019-09-04; the dylanNew mirror is the surviving source.
const RUNTIMES = [
  {
    name: "live2dcubismcore.min.js",
    url: "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js",
  },
  {
    name: "live2d.min.js",
    url: "https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js",
  },
];

async function download({ name, url }) {
  const dest = join(OUT_DIR, name);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.byteLength < 1024) throw new Error(`suspiciously small payload for ${name}: ${body.byteLength} bytes`);
  await writeFile(dest, body);
  const size = (await stat(dest)).size;
  console.log(`  ${name}: ${size} bytes <- ${url}`);
}

await mkdir(OUT_DIR, { recursive: true });
console.log(`Vendoring Live2D runtimes into ${OUT_DIR}`);
for (const runtime of RUNTIMES) await download(runtime);
console.log("Done. Reminder: these are proprietary — git-ignored, never committed or bundled.");
