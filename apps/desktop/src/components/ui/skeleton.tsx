/**
 * INPUT:  a line count for the text-stub shape, or block mode (+ className) for layout stubs.
 * OUTPUT: <Skeleton> — the ONE loading placeholder: animate-pulse bars (no shimmer system; design §5).
 * POS:    ui/components — shared primitive (batch-2 C4/U5). Replaces the bare "载入中…" lines where a
 *         layout stub helps; the image-attachment shimmer block is a block consumer.
 */

export interface SkeletonProps {
  lines?: number;
  block?: boolean;
  className?: string;
}

const BAR = "animate-pulse rounded bg-surface-sunken";

export function Skeleton({ lines = 3, block, className }: SkeletonProps) {
  // Block mode carries no default size — the caller sizes the stub (e.g. the image shimmer block).
  if (block) return <div className={`${BAR} ${className ?? ""}`} />;
  return (
    <div className={`flex flex-col gap-2 ${className ?? ""}`}>
      {Array.from({ length: lines }, (_, index) => (
        // The trailing bar reads shorter, hinting "text of unknown length" rather than a rigid grid.
        <div key={index} className={`${BAR} h-3 ${index === lines - 1 ? "w-[62%]" : "w-full"}`} />
      ))}
    </div>
  );
}
