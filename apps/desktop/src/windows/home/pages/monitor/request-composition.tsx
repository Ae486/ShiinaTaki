/**
 * INPUT: one Core-measured request's category/origin counts and explicit estimate coverage.
 * OUTPUT: compact exclusive composition chart and optional count/provenance detail.
 * POS: ui/monitor — same-request estimated proportions; origins are an independent detail axis.
 */
import type { RequestComposition } from "@taki/shared";
import { compositionDisplayRows, formatCount, formatPercent } from "./request-composition-display.ts";
import css from "./request-context.module.css";

type RequestCompositionProps = { composition: RequestComposition | null };
export function RequestCompositionView({ composition }: RequestCompositionProps) {
  if (!composition) return <div className={css.compositionEmpty}>上下文组成未记录</div>;
  const rows = compositionDisplayRows(composition);
  const incomplete = composition.coverage.unestimatedParts > 0 || composition.coverage.unknownOriginUnits > 0;
  return <div className={css.composition}>
    <div className={css.compositionHeader}><span>上下文组成 · 估算比例</span>
      <span>{incomplete ? "覆盖不完整" : "内容已归类"}
        {composition.coverage.hasHeuristicMedia && " · 多模态估算精度有限"}</span>
    </div>
    <div className={css.bar} role="img" aria-label={composition.totalUnits === 0 ? "组成估算为零，比例无定义"
      : rows.map((row) => `${row.label} ${formatPercent(row.ratio)}`).join("，")}>
      {rows.filter((row) => row.units > 0).map((row) => <span key={row.key} data-category={row.key}
        className={css.segment} style={{ width: `${(row.ratio ?? 0) * 100}%` }} />)}
    </div>
    <div className={css.legend}>{rows.map((row) => <span key={row.key} className={css.legendItem}
      title={`${row.label}：${formatCount(row.units)} 估算单位`}>
      <i className={css.swatch} data-category={row.key} aria-hidden="true" />
      <span>{row.label}</span><span className={css.share}>{formatPercent(row.ratio)}</span>
    </span>)}</div>
    <details className={css.details}><summary>估算与来源说明</summary>
      <p>比例以同一请求的 {formatCount(composition.totalUnits)} 估算单位为分母，不能视为各项实际 tokens。缓存输入仍占用上下文。</p>
      {composition.coverage.unestimatedParts > 0 && <p>未计量内容 {composition.coverage.unestimatedParts} 项；比例仅覆盖已估算部分。</p>}
      {composition.coverage.hasHeuristicMedia && <p>多模态内容归入所属消息或工具交互；其用量由启发式估算。</p>}
      <CompositionOrigins composition={composition} />
      <div className={css.counts}>{rows.map((row) => <span key={row.key}>{row.label} {formatCount(row.units)}</span>)}</div>
    </details>
  </div>;
}

function CompositionOrigins({ composition }: { composition: RequestComposition }) {
  const origins = { builtin: 0, mcp: 0, skill: 0, unknown: 0 };
  for (const row of Object.values(composition.origins)) {
    for (const key of ["builtin", "mcp", "skill", "unknown"] as const) origins[key] += row[key];
  }
  return <p>独立来源维度：内置 {formatCount(origins.builtin)} · MCP {formatCount(origins.mcp)} · Skill {formatCount(origins.skill)} · 未知 {formatCount(origins.unknown)} 估算单位。来源与上方内容类别重叠，不另计入组成。</p>;
}
