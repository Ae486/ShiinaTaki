/**
 * INPUT:  costume/import hooks and the Home client; Pet result events govern switching.
 * OUTPUT: <CostumePage> — import outcome/count and resource warnings, plus result-driven costume selection.
 * POS:    ui/windows/home/pages/costume — presentation only; import and switching stay hook-owned.
 *         The Pet owns the scene; failed list refreshes retain the last good list with retry.
 */

import { useRef } from "react";
import { useCharacterImport, type CharacterImport } from "@/features/character-import/use-character-import.js";
import { ActionButton } from "../../action-button.tsx";
import { PageCard } from "../../page-card.tsx";
import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { EmptyState } from "@/components/ui/empty-state.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { Skeleton } from "@/components/ui/skeleton.js";
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
  if (costume.loading) return <Skeleton lines={4} />;
  if (!costume.hasSnapshot) return costume.listError ? null : <p className="text-xs text-text-secondary">等待连接以读取服装列表。</p>;
  if (costume.view.rows.length === 0) return <EmptyState title="尚未导入角色" hint="开发环境使用内置模型。" />;
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
        <div className="mt-2">
          <FeedbackLine tone="ok">导入成功（{state.result.costumes.length} 套服装）</FeedbackLine>
        </div>
      )}
      {state.warnings.length > 0 && (
        <div className="mt-1">
          <FeedbackLine tone="warn">{state.warnings.length} 条可选资源警告（加载时容错）</FeedbackLine>
        </div>
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
        {costume.listError && (
          <PageAlert action={{ label: "重试", onClick: () => void costume.refresh() }}>
            服装列表读取失败{costume.hasSnapshot ? "（下方为上次结果）" : ""}：{costume.listError}
          </PageAlert>
        )}

        <PageCard title="导入模型">
          <ImportRow
            onPick={(file) => void importState.importFile(file).then(costume.invalidate)}
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
            <div className="mt-3">
              <FeedbackLine tone="warn">需导入其他角色包可解锁/补全动作：{costume.view.missingPacks.join("、")}</FeedbackLine>
            </div>
          )}
        </PageCard>
      </PageBody>
    </>
  );
}
