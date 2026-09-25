# core/memory/hindsight-backup/
Stage 3 backup primitives under a committed Hindsight authority. Operator-only: no agent tool reaches them; Core writes
only below `<dataDir>/backups/`.
- hindsight-backup-store.ts — the artifact store: `<backupId>.partial/` staging, Core copy with removal on failure, sha256/bytes, re-hash then manifest then rename on seal, quarantine of leftover partials, listing of sealed schema-valid manifests only, owner-only modes where the OS has them
- hindsight-backup-pair.ts — the pure pair verifier (lineage, Bank set and native Bank ids, generations, replica/application cursors, terminal-operation receipt scope and membership; native superset accepted) and the shared operation-list digest
- hindsight-backup-fixtures.ts — test support (not in the production path): manifest, native proof and Core Bank builders
