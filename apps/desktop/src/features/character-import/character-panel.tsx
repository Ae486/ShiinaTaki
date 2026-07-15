/**
 * INPUT:  the live PetScene (for costume switching) + open/close from the caller; drives the import + costume hooks.
 * OUTPUT: <CharacterPanel> — a minimal operator affordance: import a .zip/.zst model, then switch the active
 *         character's costume from a dropdown. NOT the polished M5 roster — plumbing for #18's serving + live switch.
 * POS:    ui/features/character-import — presentational; reaches ws-client/scene ONLY through the two hooks
 *         (hook-guidelines). Sits over the transparent overlay with pointer-events enabled while open.
 */

import { useRef } from "react";
import type { PetScene } from "@/renderer/pet-scene.js";
import { useCharacterImport } from "./use-character-import.ts";
import { useCostumeSwitch } from "./use-costume-switch.ts";

interface CharacterPanelProps {
  scene: PetScene | null;
  onClose: () => void;
}

function ImportRow({ onPick, isImporting }: { onPick: (file: File) => void; isImporting: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept=".zip,.zst"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onPick(file);
          event.target.value = ""; // allow re-picking the same file after a failed import
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={isImporting}
        className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
      >
        {isImporting ? "导入中…" : "导入模型 (.zip/.zst)"}
      </button>
    </div>
  );
}

function CostumeRow({ costume }: { costume: ReturnType<typeof useCostumeSwitch> }) {
  if (costume.costumes.length === 0) return <p className="text-xs text-slate-400">尚未导入角色（开发环境使用内置模型）</p>;
  return (
    <label className="flex items-center gap-2 text-xs text-slate-600">
      服装
      <select
        value={costume.current ?? ""}
        disabled={costume.isSwitching}
        onChange={(event) => void costume.switchTo(event.target.value)}
        className="flex-1 rounded-md border border-slate-300 px-2 py-1 text-slate-800 disabled:opacity-40"
      >
        {costume.costumes.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CharacterPanel({ scene, onClose }: CharacterPanelProps) {
  const importState = useCharacterImport();
  const costume = useCostumeSwitch(scene);
  const notice = importState.error ?? costume.error;

  return (
    <div
      className="pointer-events-auto absolute right-3 top-3 flex w-64 flex-col gap-2 rounded-xl bg-white/95 p-3 text-slate-800 shadow-xl ring-1 ring-black/5"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">角色 / 服装</span>
        <button type="button" onClick={onClose} className="px-1 text-slate-400 hover:text-slate-600" aria-label="Close">
          ×
        </button>
      </div>
      <ImportRow onPick={(file) => void importState.importFile(file).then(costume.refresh)} isImporting={importState.isImporting} />
      <CostumeRow costume={costume} />
      {importState.result && <p className="text-xs text-green-700">已导入 {importState.result.characterId}（{importState.result.costumes.length} 套服装）</p>}
      {importState.warnings.length > 0 && <p className="text-xs text-amber-600">{importState.warnings.length} 条可选资源警告（加载时容错）</p>}
      {notice && <p className="text-xs text-rose-600">{notice}</p>}
    </div>
  );
}
