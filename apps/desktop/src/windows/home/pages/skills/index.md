# Home Skills
- skills-page.tsx — master-detail lifecycle presentation (L2, shared components/ui/master-detail): package list pane + detail pane (stacking in narrow containers), import kept toolbar-level, extension convergence, and inspect/enable/replace/reconcile/confirmed-removal states; plain-language import/reconnect guidance, shared loading/empty states and retry for a failed list read
- skill-labels.ts — U3 presentation vocabulary: Chinese lifecycle/runtime state, scan verdict, source kind and trust labels + badge tones, raw-string fallback for unknown values; opaque package ids/hashes never render here
- skills-list.tsx — the master list pane: one SelectionTile row per package (display name + runtime badge + one-line description fact), aria-current selection
- skill-card.tsx — detail-pane name, description, runtime/scan badges, source/trust and lifecycle facts; collapsible inspection selects declared license, compatibility and tools plus bounded relative files, without internal bookkeeping or arbitrary metadata; inspect/toggle/replace/two-step-remove actions keep their original bindings
- skills-controller.ts — subscribed current-generation list coordination, targeted hidden dirty tracking, independent mutation settlement and package-bound explicit inspection/collapse lifetimes
- use-skills.ts — pre-paint client/visibility binding without mutation cancellation, persistence or replay
- skill-import-files.ts — FileList snapshotting and bounded sequential browser reads before Shared payload construction
