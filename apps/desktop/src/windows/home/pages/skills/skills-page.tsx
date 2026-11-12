/**
 * INPUT:  current-generation Skill state, file picks, selected package and disclosure demand.
 * OUTPUT: retained master/detail lifecycle page with independent list and inspection error states.
 * POS:    Home Skills presentation — explicit actions only; the controller owns read scopes, mutations and inspections.
 */
import { useRef, useState, type ReactNode, type RefObject } from "react";
import type { SkillPackageView } from "@taki/shared";
import { ActionButton } from "../../action-button.tsx";
import { ExtensionConvergenceStrip, useExtensionConvergence } from "../../extension-convergence.tsx";
import { ReadObservationNotice } from "../../read-observation-notice.tsx";
import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { PageCard } from "../../page-card.tsx";
import { MasterDetail } from "@/components/ui/master-detail.js";
import { EmptyState } from "@/components/ui/empty-state.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { readDirectorySource, readZipSource, snapshotFileList } from "./skill-import-files.ts";
import { useSkills } from "./use-skills.ts";
import { SkillCard } from "./skill-card.tsx";
import { SkillList } from "./skills-list.tsx";

export function SkillsPage() {
  const skills = useSkills();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const replaceId = useRef<string | undefined>(undefined);
  const zipRef = useRef<HTMLInputElement>(null);
  const directoryRef = useRef<HTMLInputElement>(null);
  const busy = skills.state.pending !== null;
  const pick = (kind: "zip" | "directory", packageId?: string) => {
    replaceId.current = packageId;
    setFileError(null);
    (kind === "zip" ? zipRef : directoryRef).current?.click();
  };
  const submit = async (source: Awaited<ReturnType<typeof readZipSource>>) => {
    const rows = skills.state.packages;
    const replacing = replaceId.current ? rows?.find((row) => row.packageId === replaceId.current) : undefined;
    await skills.controller.importPackage({
      source,
      ...(replacing ? { replacePackageId: replacing.packageId, expectedConfigRevision: replacing.configRevision } : {}),
    });
  };
  const convergence = useExtensionConvergence("skills", skillConvergenceKey(skills.state.packages));
  return (
    <>
      <PageHeader title="Skills" hint="导入标准 SKILL.md 技能包；通过验证并启用后即可供助手使用，无需重启。" busy={busy || skills.state.kind === "loading"} />
      <ExtensionConvergenceStrip state={convergence.state} onRefresh={convergence.refresh} connectionReady={convergence.connectionReady} />
      <ReadObservationNotice observation={skills.state.observation} onRefresh={() => skills.controller.refresh()} disabled={!skills.connectionReady} />
      <SkillsBody input={{
        skills, selectedId, setSelectedId, confirmRemove, setConfirmRemove, fileError, busy,
        zipRef, directoryRef,
        pick, onZip: async (file) => { try { await submit(await readZipSource(file)); } catch (error) { setFileError(readable(error)); } },
        onDirectory: async (files) => { try { await submit(await readDirectorySource(files)); } catch (error) { setFileError(readable(error)); } },
      }} />
    </>
  );
}

/** Batch-4 L2: the detail-pane target — the operator's selection, else the first row; null when no list is shown. */
export function resolveSelectedRow(rows: SkillPackageView[] | null, selectedId: string | null): SkillPackageView | null {
  if (rows === null || rows.length === 0) return null;
  return rows.find((row) => row.packageId === selectedId) ?? rows[0]!;
}

interface SkillsBodyInput {
  skills: ReturnType<typeof useSkills>;
  selectedId: string | null;
  setSelectedId(id: string | null): void;
  confirmRemove: string | null;
  setConfirmRemove(id: string | null): void;
  fileError: string | null;
  busy: boolean;
  zipRef: RefObject<HTMLInputElement | null>;
  directoryRef: RefObject<HTMLInputElement | null>;
  pick(kind: "zip" | "directory", packageId?: string): void;
  onZip(file: File): Promise<void>;
  onDirectory(files: File[]): Promise<void>;
}

function SkillsBody({ input }: { input: SkillsBodyInput }) {
  const { skills } = input;
  const rows = skills.state.packages;
  const selected = resolveSelectedRow(rows, input.selectedId);
  const failedListRead = skills.state.kind === "failure";
  return (
    <PageBody>
      {skills.status.kind === "reconnecting" && <PageAlert>正在重新连接，暂时无法更改技能；未确认的操作不会自动重试，恢复后请核对结果并按需手动重试。</PageAlert>}
      {(skills.state.readError || skills.state.message || input.fileError) && (
        <PageAlert action={failedListRead ? { label: "重试", onClick: () => void skills.controller.refresh() } : undefined}>
          Skill 操作失败：{input.fileError ?? skills.state.readError ?? skills.state.message}
        </PageAlert>
      )}
      <Pickers input={input} />
      <Toolbar input={input} />
      {skills.state.kind === "loading" && rows === null && <Skeleton lines={4} />}
      {skills.state.kind === "idle" && rows === null && <p className="text-xs text-text-secondary">等待连接以读取技能列表。</p>}
      {rows?.length === 0 && <EmptySkillState />}
      {rows !== null && rows.length > 0 && selected !== null && (
        <SkillsMasterDetail
          rows={rows}
          selectedId={selected.packageId}
          onSelect={(packageId) => { input.setSelectedId(packageId); skills.controller.select(packageId); }}
          detailElement={<SelectedSkillCard selected={selected} input={input} />}
        />
      )}
    </PageBody>
  );
}

/** The L2 two-pane layout (shared MasterDetail primitive): list left, detail right; stacks under a narrow container. */
function SkillsMasterDetail(input: { rows: SkillPackageView[]; selectedId: string | null; onSelect(packageId: string): void; detailElement: ReactNode }) {
  return (
    <MasterDetail
      list={<SkillList rows={input.rows} selectedId={input.selectedId} onSelect={input.onSelect} />}
      detail={input.detailElement}
    />
  );
}

/** Import stays toolbar-level (校验并协调 / 导入目录 / 导入 ZIP). */
function Toolbar({ input }: { input: SkillsBodyInput }) {
  const disabled = !input.skills.connectionReady || input.busy;
  return (
    <div className="flex justify-end gap-2">
      <ActionButton disabled={disabled} onClick={() => void input.skills.controller.reconcile()}>校验并协调</ActionButton>
      <ActionButton disabled={!input.skills.connectionReady} onClick={() => void input.skills.controller.refresh()}>刷新列表</ActionButton>
      <ActionButton disabled={disabled} onClick={() => input.pick("directory")}>导入目录</ActionButton>
      <ActionButton tone="primary" disabled={disabled} onClick={() => input.pick("zip")}>导入 ZIP</ActionButton>
    </div>
  );
}

function SelectedSkillCard({ selected, input }: { selected: SkillPackageView; input: SkillsBodyInput }) {
  const { skills } = input;
  return (
    <SkillCard
      row={selected}
      disabled={!skills.connectionReady || input.busy}
      confirming={input.confirmRemove === selected.packageId}
      inspected={skills.state.inspected?.package.packageId === selected.packageId ? skills.state.inspected : null}
      inspection={{ open: skills.state.inspectOpen, pending: skills.state.inspectPending === selected.packageId,
        stale: skills.state.inspectStale, error: skills.state.inspectError }}
      actions={{
        inspect: () => void skills.controller.inspect(selected.packageId),
        setInspectionOpen: (open) => skills.controller.setInspectionOpen(open),
        toggle: () => void skills.controller.setEnabled(selected),
        replaceDirectory: () => input.pick("directory", selected.packageId),
        replaceZip: () => input.pick("zip", selected.packageId),
        askRemove: () => input.setConfirmRemove(selected.packageId),
        cancelRemove: () => input.setConfirmRemove(null),
        remove: () => { input.setConfirmRemove(null); void skills.controller.remove(selected); },
      }}
    />
  );
}

function EmptySkillState() {
  return (
    <PageCard title="尚未安装 Skill">
      <EmptyState title="尚未安装 Skill" hint="选择包含 SKILL.md 的目录或 ZIP 开始导入。" />
    </PageCard>
  );
}

function Pickers({ input }: { input: SkillsBodyInput }) {
  const { onZip, onDirectory } = input;
  return (
    <>
      <input ref={input.zipRef} hidden type="file" accept=".zip,application/zip" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void onZip(file); }} />
      <input
        ref={input.directoryRef}
        hidden
        type="file"
        multiple
        {...({ webkitdirectory: "" } as Record<string, string>)}
        onChange={(event) => { const files = snapshotFileList(event.target.files); event.target.value = ""; if (files.length) void onDirectory(files); }}
      />
    </>
  );
}

function skillConvergenceKey(rows: SkillPackageView[] | null): string | null {
  return rows?.map((row) => [row.packageId, row.configRevision, row.catalogGeneration ?? 0, row.runtimeState].join(":")).join("|") ?? null;
}

function readable(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
