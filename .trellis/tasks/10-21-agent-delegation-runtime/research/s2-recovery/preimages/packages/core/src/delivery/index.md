# core/delivery/

- delivery-coordinator.ts — same-Attempt holds/resumes, bounded waits, exact-Run pending retirement, synchronous final source/gate/content checks and factual post-commit transport outcomes
- prepared-publication-source.ts — immutable accepted-source/candidate views with source-sidecar equality, separate output authorization and gate-before-edit confirmation
- prepared-publication.ts — reference-only prepared-text/source publication through existing Run/Delivery/Character-lane owners, exact child retirement and scoped Stop
