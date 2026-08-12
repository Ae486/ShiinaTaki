# core/hosts/
- host-identity.ts — strict immutable Core Host UUID at `<dataDir>/host-identity.json`; synced sibling staging plus atomic create-only hard-link publication
- host-catalog.ts — atomic live Host catalog store; Core-derived availability + explicit capability ownership
- host-context.ts — immutable control-only Host snapshot and renderer seam for future Run assembly
- host-generation-retirement.ts — synchronous per-generation catalog and pending-work retirement binder
