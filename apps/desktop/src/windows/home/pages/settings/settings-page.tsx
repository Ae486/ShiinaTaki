/**
 * INPUT:  none (page root); reads Core permission policy and every generic knob through focused hooks.
 * OUTPUT: <SettingsPage> — permission governance first, followed by config.list metadata in server order.
 * POS:    ui/windows/home/pages/settings — the Settings composition root; neither section owns durable authority.
 *         Loading rides the shared Skeleton and the failed list read carries a retry (batch-2 U5).
 */

import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { Skeleton } from "@/components/ui/skeleton.js";
import { useConfig } from "./use-config.ts";
import { KnobField } from "./knob-field.tsx";
import { PermissionSection } from "./permission-section.tsx";
import { ApprovalDecisionsSection } from "./approval-decisions-section.tsx";

export function SettingsPage() {
  const { entries, connectionReady, error, refreshing, notices, save, refresh } = useConfig();

  return (
    <>
      <PageHeader title="设置" hint="值优先级：环境变量 > 面板存储 > 内置默认；每项都注明生效方式。" busy={refreshing} />
      <PageBody>
        <PermissionSection />
        <ApprovalDecisionsSection />
        {error && <PageAlert action={{ label: "重试", onClick: () => void refresh() }}>读取配置失败：{error}</PageAlert>}
        {entries.length === 0 && !error && <Skeleton lines={6} />}
        {entries.length > 0 && (
          <div className="mt-4 divide-y divide-border-subtle overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
            {entries.map((entry) => (
              <KnobField
                key={entry.key}
                entry={entry}
                connectionReady={connectionReady}
                notice={notices[entry.key]}
                onSave={save}
              />
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
