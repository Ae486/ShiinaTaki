/**
 * INPUT:  none (page root); reads the costume list and drives import + switching through its hooks.
 * OUTPUT: <CostumePage> — the costume surface migrated out of the retired pet-side CharacterPanel: import a model
 *         archive, then pick a costume. The row being switched shows its own indicator + Cancel, a failed switch says
 *         why and leaves the highlight where it was, and a failed list refresh keeps the last good list on screen.
 * POS:    ui/windows/home/pages/costume — presentational; a pick is COMMANDED to the pet window, which owns the scene
 *         and reports back what actually happened.
 */

import { useRef } from "react";
import { useCharacterImport, type CharacterImport } from "@/features/character-import/use-character-import.js";
import { ActionButton } from "../../action-button.tsx";
import { PageCard } from "../../page-card.tsx";
import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { useHomeClient } from "../../home-client-context.ts";
import { CostumeRow } from "./costume-row.tsx";
import { useCostumePage, type CostumePageView } from "./use-costume-page.ts";

function ImportRow({
  onPick,
  isImporting,
  connectionReady,
}: {
  onPick: (file: File) => void;
  isImporting: boolean;
  connectionReady: boolean;
}) {
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
      <ActionButton
        tone="primary"
        onClick={() => inputRef.current?.click()}
        disabled={!connectionReady || isImporting}
      >
        {isImporting ? "导入中…" : "导入模型 (.zip/.zst)"}
      </ActionButton>
    </>
  );
}

function CostumeList({ costume }: { costume: CostumePageView }) {
  if (costume.loading) return <p className="text-xs text-slate-400">载入中…</p>;
  if (costume.view.rows.length === 0) return <p className="text-xs text-slate-400">尚未导入角色（开发环境使用内置模型）</p>;
  return (
    <div className="flex flex-col gap-0.5">
      {costume.view.rows.map((row) => (
        <CostumeRow
          key={row.id}
          row={row}
          current={row.id === costume.selected}
          pending={row.id === costume.pending}
          onSelect={() => void costume.select(row.id)}
          onCancel={costume.cancel}
        />
      ))}
    </div>
  );
}

function ImportFeedback({ state }: { state: CharacterImport }) {
  return (
    <>
      {state.result && (
        <p className="mt-2 text-xs text-emerald-700">
          已导入 {state.result.characterId}（{state.result.costumes.length} 套服装）
        </p>
      )}
      {state.warnings.length > 0 && (
        <p className="mt-1 text-xs text-amber-600">{state.warnings.length} 条可选资源警告（加载时容错）</p>
      )}
    </>
  );
}

export function CostumePage() {
  const { client } = useHomeClient();
  const costume = useCostumePage();
  const importState = useCharacterImport(costume.connectionReady ? client : null);
  const error = costume.error ?? importState.error;

  return (
    <>
      <PageHeader
        title="换装"
        hint="导入模型包后挑选服装；切换在宠物窗口执行，关闭宠物窗口时无法切换。"
        busy={costume.refreshing}
      />
      <PageBody>
        {error && <PageAlert>{error}</PageAlert>}
        {costume.listError && <PageAlert>服装列表读取失败（下方为上次结果）：{costume.listError}</PageAlert>}

        <PageCard title="导入模型">
          <ImportRow
            onPick={(file) => void importState.importFile(file).then(costume.refresh)}
            isImporting={importState.isImporting}
            connectionReady={costume.connectionReady}
          />
          <ImportFeedback state={importState} />
        </PageCard>

        <PageCard
          title="服装"
          action={
            <ActionButton
              onClick={() => void costume.refresh()}
              disabled={!costume.connectionReady || costume.refreshing}
            >
              刷新列表
            </ActionButton>
          }
        >
          <CostumeList costume={costume} />
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
