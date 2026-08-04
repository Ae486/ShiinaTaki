/**
 * INPUT:  none (page root); reads every knob through useConfig.
 * OUTPUT: <SettingsPage> — the knob list rendered from config.list metadata, in the server's order.
 * POS:    ui/windows/home/pages/settings — the R13 knobs surface. Presentational + one hook; it never derives a knob's
 *         shape or ordering client-side (the core's registry is the single source).
 */

import { useConfig } from "./use-config.ts";
import { KnobField } from "./knob-field.tsx";

export function SettingsPage() {
  const { entries, error, notices, save } = useConfig();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-slate-200 bg-white px-4 py-2.5">
        <h1 className="text-sm font-semibold text-slate-700">设置</h1>
        <p className="text-[11px] text-slate-500">值优先级：环境变量 &gt; 面板存储 &gt; 内置默认；每项都注明生效方式。</p>
      </header>
      {error && <p className="bg-rose-50 px-4 py-2 text-xs text-rose-700">读取配置失败：{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto bg-white">
        {entries.length === 0 && !error && <p className="px-4 py-6 text-xs text-slate-400">载入中…</p>}
        {entries.map((entry) => (
          <KnobField key={entry.key} entry={entry} notice={notices[entry.key]} onSave={(key, value) => void save(key, value)} />
        ))}
      </div>
    </div>
  );
}
