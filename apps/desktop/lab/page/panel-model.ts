/**
 * INPUT:  the /lab-characters/ listing (fetched here) + PanelDeps; scene.onModel for post-load facts.
 * OUTPUT: mountPanelModel(deps): character <select> -> costume <select> (generation badge), Load button, and after a
 *         load the "N refs pruned" badge plus a facts summary.
 * POS:    experimental / lab — not in production path; the only panel that starts a load.
 */

import { type CatalogEntry, CATALOG_PREFIX, parseCatalog } from "../scene/character-catalog.ts";
import type { ModelContext } from "../scene/lab-scene.ts";
import { badge, button, note, type PanelDeps, row, section, select, setOptions } from "./controls.ts";

export function mountPanelModel({ host, scene, log }: PanelDeps): void {
  const root = section(host, "Model");
  let catalog: CatalogEntry[] = [];
  let picked: CatalogEntry | undefined;

  const costumeSelect = select([], (value) => {
    picked = catalog.find((e) => e.characterId === characterSelect.value && e.costume === value);
  });
  const characterSelect = select([], (characterId) => {
    const costumes = catalog.filter((e) => e.characterId === characterId);
    setOptions(costumeSelect, costumes.map(costumeOption));
    costumeSelect.value = (costumes.find((e) => e.isDefault) ?? costumes[0])?.costume ?? "";
    picked = costumes.find((e) => e.costume === costumeSelect.value);
  });
  const status = badge("loading catalog…");
  const facts = note(root);

  row(root, "character", characterSelect);
  row(root, "costume", costumeSelect);
  row(
    root,
    "",
    button("Load", () => {
      if (picked !== undefined) void load(picked);
    }),
    status,
  );

  const load = async (entry: CatalogEntry): Promise<void> => {
    status.textContent = `loading ${entry.characterId}/${entry.costume}…`;
    try {
      const ctx = await scene.load(entry);
      status.textContent = `${ctx.prunedRefs} refs pruned`;
      log(`loaded ${entry.characterId}/${entry.costume} [${ctx.facts.generation}] pruned=${ctx.prunedRefs}`);
    } catch (err) {
      status.textContent = "load failed";
      log(`load failed ${entry.characterId}/${entry.costume}: ${String(err)}`);
    }
  };

  scene.onModel((ctx) => {
    facts.textContent = summarize(ctx);
  });

  void fetchCatalog().then((entries) => {
    catalog = entries;
    const ids = [...new Set(entries.map((e) => e.characterId))];
    setOptions(characterSelect, ids);
    characterSelect.dispatchEvent(new Event("change"));
    status.textContent = `${entries.length} costumes / ${ids.length} characters`;
    log(`catalog: ${entries.length} costumes across ${ids.length} characters`);
  });
}

async function fetchCatalog(): Promise<CatalogEntry[]> {
  const response = await fetch(`${CATALOG_PREFIX}/`);
  if (!response.ok) throw new Error(`catalog fetch failed: ${response.status}`);
  return parseCatalog(await response.json());
}

function costumeOption(entry: CatalogEntry): { value: string; label: string } {
  const gen = entry.generation === "cubism2" ? "C2" : "C3";
  return { value: entry.costume, label: `${entry.costume} [${gen}]${entry.isDefault ? " *" : ""}` };
}

function summarize({ facts }: ModelContext): string {
  const groups = Object.entries(facts.motionGroups)
    .map(([g, n]) => `${g}(${n})`)
    .join(" ");
  return [
    `generation: ${facts.generation}`,
    `motion groups: ${groups || "(none)"}`,
    `expressions: ${facts.expressions.join(", ") || "(none)"}`,
    `lipSyncIds: ${facts.lipSyncIds.join(", ")}`,
    `param ids: ${facts.paramIds === null ? "n/a (Cubism 2 has no enumeration)" : facts.paramIds.length}`,
  ].join("\n");
}
