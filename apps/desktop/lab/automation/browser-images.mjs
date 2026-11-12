/**
 * INPUT:  PNG screenshots produced by the browser driver and the installed Playwright PNG decoder.
 * OUTPUT: nonblank/moving pixel measurements and a labeled comparison image built from the actual captures.
 * POS:    experimental / lab - not in production path; generated model images stay in local ignored output.
 */
/* global document, Image */

import { createRequire } from "node:module";
import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const { PNG } = createRequire(resolve(process.env.TAKI_LAB_PLAYWRIGHT_MODULE))("./lib/utilsBundle.js");

export async function inspectPixels(output, label) {
  const first = PNG.sync.read(await readFile(resolve(output, `${label}-model.png`)));
  const second = PNG.sync.read(await readFile(resolve(output, `${label}-model-next.png`)));
  if (first.width !== second.width || first.height !== second.height) throw new Error("canvas dimensions changed between captures");
  let foreground = 0;
  let changed = 0;
  let sampled = 0;
  for (let index = 0; index < first.data.length; index += 16) {
    const backgroundDifference = [0, 1, 2].reduce((sum, channel) => sum + Math.abs(first.data[index + channel] - first.data[channel]), 0);
    const frameDifference = [0, 1, 2].reduce((sum, channel) => sum + Math.abs(first.data[index + channel] - second.data[index + channel]), 0);
    if (backgroundDifference > 24) foreground += 1;
    if (frameDifference > 12) changed += 1;
    sampled += 1;
  }
  return { width: first.width, height: first.height, foregroundRatio: foreground / sampled, changedRatio: changed / sampled };
}

export async function createContactSheet(browser, output, variant = "composition") {
  const labels = variant === "reset" ? [
    ["expression-only", "Expression applied"],
    ["after-reset", "After Reset"],
    ["reset-set", "Same expression applied again"],
  ] : [
    ["motion-only", "Motion only"],
    ["expression-then-unfiltered", "Expression + unfiltered motion"],
    ["filtered-then-expression", "Expression + filtered motion"],
  ];
  const rows = [];
  for (const costume of ["arbeit", "live_01"]) {
    const cells = [];
    for (const [suffix, label] of labels) {
      try {
        const bytes = await readFile(resolve(output, `${costume}-${suffix}-model.png`));
        cells.push({ label, data: `data:image/png;base64,${bytes.toString("base64")}` });
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (cells.length === labels.length) rows.push({ costume, cells });
  }
  if (!rows.length) return;
  const page = await browser.newPage();
  try {
    const data = await page.evaluate(drawContactSheet, rows);
    const file = variant === "reset" ? "reset-comparison.png" : "comparison.png";
    await writeFile(resolve(output, file), Buffer.from(data.split(",")[1], "base64"));
  } finally {
    await page.close();
  }
}

async function drawContactSheet(rows) {
  const canvas = document.createElement("canvas");
  canvas.width = 1248;
  canvas.height = rows.length * 560;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f4f5f7";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [rowIndex, row] of rows.entries()) {
    const top = rowIndex * 560;
    ctx.fillStyle = "#15191f";
    ctx.font = "bold 22px Arial";
    ctx.fillText(`taki/${row.costume}`, 20, top + 30);
    for (const [column, cell] of row.cells.entries()) {
      const image = new Image();
      image.src = cell.data;
      await image.decode();
      const left = 16 + column * 412;
      ctx.fillStyle = "#15191f";
      ctx.font = "17px Arial";
      ctx.fillText(cell.label, left, top + 60);
      const cropTop = row.costume === "live_01" ? 0.06 : 0.13;
      ctx.drawImage(image, image.width * 0.25, image.height * cropTop, image.width * 0.5, image.height * 0.6, left, top + 76, 392, 444);
    }
    ctx.font = "14px Arial";
    ctx.fillStyle = "#434b57";
    ctx.fillText("Actual browser captures; pose phase and breathing can differ. JSON contains frame-level parameter evidence.", 20, top + 548);
  }
  return canvas.toDataURL("image/png");
}
