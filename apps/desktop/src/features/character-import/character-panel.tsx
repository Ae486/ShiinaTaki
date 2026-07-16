/**
 * INPUT:  the live PetScene (for costume switching) + open/close from the caller; drives the import + costume hooks.
 * OUTPUT: <CharacterPanel> — a minimal operator affordance: import a .zip/.zst model, then switch the active
 *         character's costume from a list (degraded rows badge their missing-motion count; unrenderable rows sit
 *         disabled under an "import <owners>" notice). NOT the polished M5 roster — plumbing for #18.
 * POS:    ui/features/character-import — presentational; reaches ws-client/scene ONLY through the two hooks
 *         (hook-guidelines). Sits over the transparent overlay with pointer-events enabled while open.
 */

import { useRef } from "react";
import type { CostumeAvailability } from "@taki/shared";
import type { PetScene } from "@/renderer/pet-scene.js";
import { useCharacterImport } from "./use-character-import.ts";
import { useCostumeSwitch, type CostumeSwitch } from "./use-costume-switch.ts";

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

function badgeFor(meta: CostumeAvailability | undefined): string | null {
  return meta && meta.missingMotions > 0 ? `⚠ 缺 ${meta.missingMotions} 动作` : null;
}

function CostumeRow(props: { id: string; badge: string | null; isCurrent: boolean; disabled: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onSelect}
      disabled={props.disabled}
      className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs ${
        props.isCurrent ? "bg-slate-800 text-white" : "text-slate-700 hover:bg-slate-100"
      } disabled:opacity-40`}
    >
      <span className="truncate">{props.id}</span>
      {props.badge && <span className="ml-2 shrink-0 text-amber-600">{props.badge}</span>}
    </button>
  );
}

// Renderable costumes stay selectable (degraded ones badge their missing count — graceful degrade, not a lock);
// only costumes that cannot render at all are disabled, sorted to the bottom under the import-packs notice.
function CostumeList({ costume }: { costume: CostumeSwitch }) {
  if (costume.costumes.length === 0) return <p className="text-xs text-slate-400">尚未导入角色（开发环境使用内置模型）</p>;
  const locked = costume.costumes.filter((id) => costume.availability[id]?.renderable === false);
  const selectable = costume.costumes.filter((id) => !locked.includes(id));
  return (
    <div className="flex max-h-48 flex-col gap-0.5 overflow-y-auto">
      {selectable.map((id) => (
        <CostumeRow
          key={id}
          id={id}
          badge={badgeFor(costume.availability[id])}
          isCurrent={costume.current === id}
          disabled={costume.isSwitching}
          onSelect={() => void costume.switchTo(id)}
        />
      ))}
      {costume.missingPacksUnion.length > 0 && (
        <p className="mt-1 text-[11px] leading-snug text-amber-600">
          ⚠ 需导入其他角色包可解锁/补全动作：{costume.missingPacksUnion.join("、")}
        </p>
      )}
      {locked.map((id) => (
        <CostumeRow key={id} id={id} badge={null} isCurrent={false} disabled onSelect={() => undefined} />
      ))}
    </div>
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
      <CostumeList costume={costume} />
      {importState.result && <p className="text-xs text-green-700">已导入 {importState.result.characterId}（{importState.result.costumes.length} 套服装）</p>}
      {importState.warnings.length > 0 && <p className="text-xs text-amber-600">{importState.warnings.length} 条可选资源警告（加载时容错）</p>}
      {notice && <p className="text-xs text-rose-600">{notice}</p>}
    </div>
  );
}
