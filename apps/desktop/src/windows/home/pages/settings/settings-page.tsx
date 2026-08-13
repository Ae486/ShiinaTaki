/**
 * INPUT:  none (page root); reads Core permission policy and every generic knob through focused hooks.
 * OUTPUT: <SettingsPage> — permission governance first, followed by config.list metadata in server order.
 * POS:    ui/windows/home/pages/settings — the Settings composition root; neither section owns durable authority.
 */

import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { useConfig } from "./use-config.ts";
import { KnobField } from "./knob-field.tsx";
import { PermissionSection } from "./permission-section.tsx";

export function SettingsPage() {
  const { entries, connectionReady, error, refreshing, notices, save } = useConfig();

  return (
    <>
      <PageHeader title="设置" hint="值优先级：环境变量 > 面板存储 > 内置默认；每项都注明生效方式。" busy={refreshing} />
      <PageBody>
        <PermissionSection />
        {error && <PageAlert>读取配置失败：{error}</PageAlert>}
        {entries.length === 0 && !error && <p className="text-xs text-slate-400">载入中…</p>}
        {entries.length > 0 && (
          <div className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {entries.map((entry) => (
              <KnobField
                key={entry.key}
                entry={entry}
                connectionReady={connectionReady}
                notice={notices[entry.key]}
                onSave={(key, value) => void save(key, value)}
              />
            ))}
          </div>
        )}
      </PageBody>
    </>
  );
}
