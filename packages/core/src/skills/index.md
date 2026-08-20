# core/skills/
- skill-scanner.ts / skills-state.ts / skills-loader.ts — legacy seed compatibility and the Agent-facing metadata/instruction loader
- skill-package-types.ts / skill-package-repo.ts — durable lifecycle domain rows and optimistic SQLite repository
- skill-package-source.ts / skill-package-store.ts — bounded source enumeration, validation, hashing, quarantine, and immutable publication
- skill-catalog-manager.ts — process-local catalog generations, leased reads, tamper exclusion, and retired-root collection
- skill-lifecycle-service.ts — serialized operator lifecycle orchestration and reconcile
- skill-boot.ts — composition seam and read-only one-time legacy seed
- load-skill-tool.ts / read-skill-resource-tool.ts — governed instruction and confined UTF-8 support-resource tools
