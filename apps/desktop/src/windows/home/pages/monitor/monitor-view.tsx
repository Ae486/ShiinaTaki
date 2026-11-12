/**
 * INPUT:  typed semantic Inspector sections and optional usage from an exactly associated loaded request
 * OUTPUT: conditional Chinese tabs and independently closable semantic sections, without a technical fallback
 * POS:    ui/monitor — DSH Inspector presentation adaptation; see third-party-notices.md (DeepSeek MIT)
 */
import { useId, useState, type KeyboardEvent } from "react";
import type { TrajectoryInspector } from "@taki/shared";
import type { TrajectoryRecord } from "./trajectory-records.ts";
import { inspectorSections } from "./trajectory-inspector-model.ts";
import css from "./monitor-inspector.module.css";

type Section = NonNullable<TrajectoryInspector["sections"]>[number];
const SECTION_LABELS: Record<Section["key"], string> = {
  event: "概览", model: "模型与耗时", tool: "工具与耗时", usage: "用量", context: "上下文",
  governance: "治理与审批", recovery: "重试与恢复",
};

export function InspectorFields({ inspector, record }: { inspector: TrajectoryInspector; record?: TrajectoryRecord }) {
  const sections = inspectorSections(inspector, record);
  const [tab, setTab] = useState<Section["key"] | "all">("all");
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const id = useId();
  const visible = tab === "all" ? sections : sections.filter((section) => section.key === tab);
  const toggle = (key: string) => setClosed((current) => {
    const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next;
  });
  return <div className={css.fields}>
    <div className={css.tabs} role="tablist" aria-label="记录详情" onKeyDown={moveTabFocus}>
      <button type="button" role="tab" aria-selected={tab === "all"} tabIndex={tab === "all" ? 0 : -1}
        aria-controls={id} onClick={() => setTab("all")}>概览</button>
      {sections.filter((section) => section.key !== "event").map((section) => <button key={section.key}
        type="button" role="tab" aria-selected={tab === section.key} tabIndex={tab === section.key ? 0 : -1} aria-controls={id}
        onClick={() => setTab(section.key)}>{SECTION_LABELS[section.key]}</button>)}
    </div>
    <div className={css.body} id={id} role="tabpanel" tabIndex={0} aria-label={tab === "all" ? "概览" : SECTION_LABELS[tab]}>
      {visible.map((section) => <InspectorSection key={section.key} section={section}
        open={!closed.has(section.key)} toggle={() => toggle(section.key)} />)}
      {sections.length === 0 && <p className={css.pending}>没有可展示的语义详情。</p>}
    </div>
  </div>;
}

function moveTabFocus(event: KeyboardEvent<HTMLDivElement>): void {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='tab']")];
  const current = tabs.findIndex((tab) => tab === event.target);
  if (current < 0 || tabs.length === 0) return;
  event.preventDefault();
  const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
    : (current + (event.key === "ArrowLeft" ? -1 : 1) + tabs.length) % tabs.length;
  tabs[index]?.focus({ preventScroll: true });
  tabs[index]?.click();
}

function InspectorSection({ section, open, toggle }: { section: Section; open: boolean; toggle(): void }) {
  const id = useId();
  return <section className={css.section}>
    <button type="button" className={css.sectionButton} aria-expanded={open} aria-controls={id} onClick={toggle}>
      <span aria-hidden="true">{open ? "▾" : "▸"}</span>{SECTION_LABELS[section.key]}
    </button>
    <div className={css.sectionBody} data-open={open} inert={!open} aria-hidden={!open} id={id}>
      <div className={css.sectionInner}><dl className={css.overview}>
        {section.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}
      </dl></div>
    </div>
  </section>;
}
