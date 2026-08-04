/**
 * INPUT:  none (page root); reads the costume list and drives import + switching through its hooks.
 * OUTPUT: <CostumePage> — the costume surface migrated out of the retired pet-side CharacterPanel: import a model
 *         archive, then pick a costume (degraded rows badge their missing motions; unrenderable rows sit disabled
 *         under the import notice).
 * POS:    ui/windows/home/pages/costume — presentational; a pick is COMMANDED to the pet window, which owns the scene.
 */

import { useRef } from "react";
import { useCharacterImport } from "@/features/character-import/use-character-import.js";
import { ActionButton } from "../../action-button.tsx";
import { Badge } from "../../badge.tsx";
import { PageCard } from "../../page-card.tsx";
import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { useHomeClient } from "../../home-client-context.ts";
import { useCostumePage } from "./use-costume-page.ts";
import type { CostumeRowView } from "./costume-view.ts";

function ImportRow({ onPick, isImporting }: { onPick: (file: File) => void; isImporting: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
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
      <ActionButton tone="primary" onClick={() => inputRef.current?.click()} disabled={isImporting}>
        {isImporting ? "导入中…" : "导入模型 (.zip/.zst)"}
      </ActionButton>
    </>
  );
}

function CostumeRow({ row, current, onSelect }: { row: CostumeRowView; current: boolean; onSelect: () => void }) {
  const tone = current ? "bg-rose-50 text-rose-700 ring-1 ring-rose-200/70" : "text-slate-600 hover:bg-slate-50";
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!row.renderable}
      aria-current={current ? "true" : undefined}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${tone} disabled:opacity-40`}
    >
      <span className="truncate font-medium">{row.id}</span>
      {row.badge && <Badge tone="warn">{row.badge}</Badge>}
    </button>
  );
}

export function CostumePage() {
  const { client } = useHomeClient();
  const costume = useCostumePage();
  const importState = useCharacterImport(client);
  const current = costume.selected ?? costume.view.current;
  const error = costume.error ?? importState.error;

  return (
    <>
      <PageHeader title="换装" hint="导入模型包后挑选服装；切换在宠物窗口执行，关闭宠物窗口时无法切换。" />
      <PageBody>
        {error && <PageAlert>{error}</PageAlert>}

        <PageCard title="导入模型">
          <ImportRow onPick={(file) => void importState.importFile(file).then(costume.refresh)} isImporting={importState.isImporting} />
          {importState.result && (
            <p className="mt-2 text-xs text-emerald-700">
              已导入 {importState.result.characterId}（{importState.result.costumes.length} 套服装）
            </p>
          )}
          {importState.warnings.length > 0 && (
            <p className="mt-1 text-xs text-amber-600">{importState.warnings.length} 条可选资源警告（加载时容错）</p>
          )}
        </PageCard>

        <PageCard title="服装">
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
            <p className="mt-3 text-[11px] leading-snug text-amber-600">
              ⚠ 需导入其他角色包可解锁/补全动作：{costume.view.missingPacks.join("、")}
            </p>
          )}
        </PageCard>
      </PageBody>
    </>
  );
}
