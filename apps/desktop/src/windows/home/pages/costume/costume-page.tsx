/**
 * INPUT:  none (page root); reads the costume list and drives import + switching through its hooks.
 * OUTPUT: <CostumePage> — the costume surface migrated out of the retired pet-side CharacterPanel: import a model
 *         archive, then pick a costume (degraded rows badge their missing motions; unrenderable rows sit disabled
 *         under the import notice).
 * POS:    ui/windows/home/pages/costume — presentational; a pick is COMMANDED to the pet window, which owns the scene.
 */

import { useRef } from "react";
import { useCharacterImport } from "@/features/character-import/use-character-import.js";
import { useHomeClient } from "../../home-client-context.ts";
import { useCostumePage } from "./use-costume-page.ts";
import type { CostumeRowView } from "./costume-view.ts";

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

function CostumeRow({ row, current, onSelect }: { row: CostumeRowView; current: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!row.renderable}
      aria-current={current ? "true" : undefined}
      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs ${
        current ? "bg-slate-800 text-white" : "text-slate-700 hover:bg-slate-100"
      } disabled:opacity-40`}
    >
      <span className="truncate">{row.id}</span>
      {row.badge && <span className="ml-2 shrink-0 text-amber-600">{row.badge}</span>}
    </button>
  );
}

export function CostumePage() {
  const { client } = useHomeClient();
  const costume = useCostumePage();
  const importState = useCharacterImport(client);
  const current = costume.selected ?? costume.view.current;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-slate-200 bg-white px-4 py-2.5">
        <h1 className="text-sm font-semibold text-slate-700">换装</h1>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        <ImportRow onPick={(file) => void importState.importFile(file).then(costume.refresh)} isImporting={importState.isImporting} />
        {importState.result && (
          <p className="text-xs text-emerald-700">
            已导入 {importState.result.characterId}（{importState.result.costumes.length} 套服装）
          </p>
        )}
        {importState.warnings.length > 0 && (
          <p className="text-xs text-amber-600">{importState.warnings.length} 条可选资源警告（加载时容错）</p>
        )}
        {costume.view.rows.length === 0 ? (
          <p className="text-xs text-slate-400">尚未导入角色（开发环境使用内置模型）</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {costume.view.rows.map((row) => (
              <CostumeRow key={row.id} row={row} current={row.id === current} onSelect={() => void costume.select(row.id)} />
            ))}
          </div>
        )}
        {costume.view.missingPacks.length > 0 && (
          <p className="text-[11px] leading-snug text-amber-600">
            ⚠ 需导入其他角色包可解锁/补全动作：{costume.view.missingPacks.join("、")}
          </p>
        )}
        <p className="text-[11px] text-slate-400">换装在宠物窗口执行；关闭宠物窗口时无法切换。</p>
        {(costume.error ?? importState.error) && <p className="text-xs text-rose-600">{costume.error ?? importState.error}</p>}
      </div>
    </div>
  );
}
