# core/skills/
- Request attribution — catalog header stays builtin guidance; package listing/body/resource content carries Skill origin independently of tool activation
- skill-scanner.ts / skills-state.ts / skills-loader.ts — legacy seed compatibility and the Agent-facing metadata/instruction loader
- skill-package-types.ts / skill-package-repo.ts — durable lifecycle rows and optimistic SQLite writes; optional commit observation precedes fallible projection read-back
- skill-package-source.ts / skill-package-store.ts — bounded source enumeration, validation, hashing, quarantine, and immutable publication
- skill-catalog-manager.ts — process-local catalog generations, leased reads, tamper exclusion, and retired-root collection
- skill-lifecycle-service.ts — serialized operator lifecycle/reconcile; observes durable list commits separately from coherent catalog publication, including rejected and surviving partial commits
- skill-boot.ts — observed lifecycle composition and read-only one-time legacy seed before initial catalog publication
- load-skill-tool.ts / read-skill-resource-tool.ts — governed instruction and confined UTF-8 support-resource tools
- skill-tool-model-output.ts — model-only revision omission while raw Skill loads retain exact next-step disclosure/currentness authority
