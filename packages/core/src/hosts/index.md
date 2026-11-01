# core/hosts/
- host-identity.ts — strict immutable Core Host UUID at `<dataDir>/host-identity.json`; synced sibling staging plus atomic create-only hard-link publication
- host-catalog.ts — atomic live Host catalog store; Core-derived availability, explicit ownership and bounded invalidation only after accepted set or matching deletion
- host-context.ts — complete frozen Run Host snapshot and compact fenced model view retaining exact routing, resources, readiness and truncation
- host-generation-retirement.ts — synchronous per-generation catalog and pending-work retirement binder
