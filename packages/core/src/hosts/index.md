# core/hosts/
- host-identity.ts — strict immutable Core Host UUID at `<dataDir>/host-identity.json`; synced sibling staging plus atomic create-only hard-link publication
- host-catalog.ts — atomic live Host catalog store; Core-derived availability + explicit capability ownership
- host-context.ts — bounded Run Host projection with untrusted-data fencing and fixed Core routing/transfer rules
- host-generation-retirement.ts — synchronous per-generation catalog and pending-work retirement binder
