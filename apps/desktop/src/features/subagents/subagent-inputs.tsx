/**
 * INPUT: accepted addressed inputs and exact per-model-intent consumption receipts
 * OUTPUT: sender/task/material display with explicit queued versus included status
 * POS: ui/subagents — receipt presentation; inclusion never claims provider receipt or understanding
 */
import type { SubagentInput } from "@taki/shared";

export function SubagentInputs({ inputs }: { inputs: SubagentInput[] }) {
  return <section className="space-y-3" aria-label="工作输入与接收状态">
    <h3 className="text-sm font-semibold text-text-body">工作输入</h3>
    {inputs.map((input) => <article key={input.inputId} className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-secondary">
        <span>{input.sender.kind === "user" ? "你" : input.sender.kind === "parent" ? "主助手" : "系统"}
          {input.kind === "work" ? " · 任务" : input.kind === "continue" ? " · 明确继续" : " · 补充输入"}</span>
        <span>{input.consumed ? "已纳入模型请求意图" : "已接收 · 等待纳入"}</span>
      </div>
      {input.direction && <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-text-strong">{input.direction}</p>}
      {input.materials.map((material) => <details key={material.key} className="mt-2 text-xs">
        <summary className="cursor-pointer text-text-secondary">材料 · {material.source?.label ?? material.key}</summary>
        {material.source && <p className="mt-1 break-words text-text-secondary">{[material.source.speaker, material.source.time, material.source.reference].filter(Boolean).join(" · ")}</p>}
        <p className="mt-1 whitespace-pre-wrap break-words text-text-body">{material.text}</p>
      </details>)}
      {input.consumed && <p className="mt-2 text-xs text-text-faint">已记录第 {input.consumed.step + 1} 步请求意图，不代表模型已理解。</p>}
    </article>)}
  </section>;
}
