/**
 * INPUT:  none (page root); reads Core permission policy and every generic knob through focused hooks.
 * OUTPUT: <SettingsPage> — permission governance first, then the knob list regrouped client-side (U7) into
 *         权限与审批/模型与上下文/感知与隐私/存储与缓存/高级 sections with a key/description search box.
 * POS:    ui/windows/home/pages/settings — the Settings composition root; grouping/filtering live in config-groups.ts
 *         (pure), Core order inside a group is preserved, and no knob is removed or hidden. Loading rides the shared
 *         Skeleton and the failed list read carries a retry (batch-2 U5).
 */

import { useMemo, useState } from "react";
import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { Field, FIELD_CONTROL } from "@/components/ui/field.js";
import { EmptyState } from "@/components/ui/empty-state.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { useConfig } from "./use-config.ts";
import { KnobField } from "./knob-field.tsx";
import { PermissionSection } from "./permission-section.tsx";
import { ApprovalDecisionsSection } from "./approval-decisions-section.tsx";
import { configLabelOf, filterConfigEntries, groupConfigEntries } from "./config-groups.ts";

export function SettingsPage() {
  const { entries, connectionReady, error, refreshing, notices, save, refresh } = useConfig();
  const [query, setQuery] = useState("");
  const groups = useMemo(() => groupConfigEntries(filterConfigEntries(entries, query)), [entries, query]);

  return (
    <>
      <PageHeader title="设置" hint="值优先级：环境变量 > 面板存储 > 内置默认；每项都注明生效方式。" busy={refreshing} />
      <PageBody>
        <PermissionSection />
        <ApprovalDecisionsSection />
        {error && <PageAlert action={{ label: "重试", onClick: () => void refresh() }}>读取配置失败：{error}</PageAlert>}
        {entries.length === 0 && !error && <Skeleton lines={6} />}
        {entries.length > 0 && (
          <>
            <Field label="搜索配置项（按键名、中文名称或说明过滤）">
              <input
                className={FIELD_CONTROL}
                value={query}
                placeholder="例如：模型 / AMBIENT / 截屏"
                onChange={(event) => setQuery(event.target.value)}
              />
            </Field>
            {groups.map(({ group, entries: groupEntries }) => (
              <KnobGroup
                key={group.id}
                label={group.label}
                hint={group.hint}
                groupEntries={groupEntries}
                connectionReady={connectionReady}
                notices={notices}
                onSave={save}
              />
            ))}
            {groups.length === 0 && <EmptyState title="没有匹配的配置项" hint="换一个关键词，或清空搜索框查看全部配置。" />}
          </>
        )}
      </PageBody>
    </>
  );
}

interface KnobGroupProps {
  label: string;
  hint: string;
  groupEntries: ReturnType<typeof groupConfigEntries>[number]["entries"];
  connectionReady: boolean;
  notices: ReturnType<typeof useConfig>["notices"];
  onSave: ReturnType<typeof useConfig>["save"];
}

/** One group header (Chinese + one-line explanation) and its card of knob rows in server order. */
function KnobGroup({ label, hint, groupEntries, connectionReady, notices, onSave }: KnobGroupProps) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-sm font-semibold text-text-strong">{label}</h2>
        <p className="mt-0.5 text-xs leading-snug text-text-secondary">{hint}</p>
      </div>
      <div className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        {groupEntries.map((entry) => (
          <KnobField
            key={entry.key}
            entry={entry}
            chineseLabel={configLabelOf(entry.key) ?? undefined}
            connectionReady={connectionReady}
            notice={notices[entry.key]}
            onSave={onSave}
          />
        ))}
      </div>
    </section>
  );
}
