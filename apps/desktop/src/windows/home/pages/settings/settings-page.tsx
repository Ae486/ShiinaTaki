/**
 * INPUT:  none (page root); reads every knob through useConfig.
 * OUTPUT: <SettingsPage> — the knob list rendered from config.list metadata, in the server's order.
 * POS:    ui/windows/home/pages/settings — the R13 knobs surface. Presentational + one hook; it never derives a knob's
 *         shape or ordering client-side (the core's registry is the single source).
 */

import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { useConfig } from "./use-config.ts";
import { KnobField } from "./knob-field.tsx";

export function SettingsPage() {
  const { entries, error, refreshing, notices, save } = useConfig();

  return (
    <>
      <PageHeader title="设置" hint="值优先级：环境变量 > 面板存储 > 内置默认；每项都注明生效方式。" busy={refreshing} />
      <PageBody>
        {error && <PageAlert>读取配置失败：{error}</PageAlert>}
        {entries.length === 0 && !error && <p className="text-xs text-slate-400">载入中…</p>}
        {entries.length > 0 && (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            {entries.map((entry) => (
              <KnobField
                key={entry.key}
                entry={entry}
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
