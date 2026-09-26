# core/memory/hindsight-backup/
Stage 3 backup primitives under a committed Hindsight authority. Operator-only: no agent tool reaches them; Core writes
only below `<dataDir>/backups/`.
- hindsight-backup-store.ts — the artifact store: `<backupId>.partial/` staging, Core copy with removal on failure, sha256/bytes, re-hash then manifest then rename on seal, quarantine of leftover partials, listing of sealed schema-valid manifests only, owner-only modes where the OS has them
- hindsight-backup-pair.ts — the pure pair verifier (lineage, Bank set and native Bank ids, generations, replica/application cursors, terminal-operation receipt scope and membership; native superset accepted) and the shared operation-list digest
- hindsight-backup-fixtures.ts — test support (not in the production path): manifest, native proof and Core Bank builders
- hindsight-backup-identity.ts — capture step 3: authority, per-Bank replica/application checkpoints, terminal-operation ids and migration head in one SQLite transaction (lower bounds the native side must meet)
- hindsight-backup-receipts.ts — the test-pinned Core terminal write kind -> native receipt table map (ruling 3) and the reader that lists native-confirmed Pending and completed D77 job ids of the current lineage/generation
- hindsight-backup-route.ts — the native snapshot seam (request -> native proof + native-host artifact reference) and the unavailable production route until W5
- hindsight-backup-custody.ts — presence-only custody record of every Hindsight secret ref plus the connection marker; no value or envelope leaves the catalog
- hindsight-backup-service.ts — the backup.capture producer: quiesce -> scheduler stop -> identity read -> Core backupTo -> native snapshot (deadline-raced) -> pair check -> seal, always releasing and restarting; closed failure codes, no listed artifact on failure
- hindsight-backup-route-fixtures.ts — test support (not in the production path): programmable in-memory native route double with an inter-capture hook and failure injection
