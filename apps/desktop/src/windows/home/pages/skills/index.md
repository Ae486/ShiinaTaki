# Home Skills
- skills-page.tsx — master-detail lifecycle presentation (L2, shared components/ui/master-detail): package list pane + detail pane (stacking in narrow containers), import kept toolbar-level, extension convergence, and inspect/enable/replace/reconcile/confirmed-removal states; loading/empty ride Skeleton/EmptyState and the failed list read carries a retry
- skill-labels.ts — U3 presentation vocabulary: Chinese lifecycle/runtime state, scan verdict, source kind and trust labels + badge tones, raw-string fallback for unknown values; opaque package ids/hashes never render here
- skills-list.tsx — the master list pane: one SelectionTile row per package (display name + runtime badge + one-line description fact), aria-current selection
- skill-card.tsx — the detail-pane card (U3): display name + runtime/scan badges, 来源/状态 facts, a collapsed 技术详情 disclosure (Owner/哈希/修订/Catalog 代次 via CopyableRow), validated metadata + bounded relative-file inventory once inspected, and 检查/启停/替换/移除 actions
- skills-controller.ts / use-skills.ts — current-client-generation state, synchronous mutation lock, late-result suppression, and no replay/cache
- skill-import-files.ts — FileList snapshotting and bounded sequential browser reads before Shared payload construction
