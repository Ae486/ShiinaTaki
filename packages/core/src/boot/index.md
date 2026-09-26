# core/boot/
- core-bootstrap.ts — bootstrapCore(env): opens the DB on the env-only data root, builds the config plane (repo/source/writer/subscriptions), then parses every loader against the RESOLVED env (env > stored > default) and constructs the model slots; returns the composition root's config+storage phase in one object
- hindsight-setup-boot.ts — composes the inactive B3 Hindsight setup service (refusing validate/setup/disable while an activation row is open) and operator methods without boot network/provider calls
- hindsight-activation-boot.ts — composes the Stage 2b activation service over the production client factory, the live connection fingerprint and the composition binding seams; no boot network call
- hindsight-lifecycle-boot.ts — composes the Stage 2c lifecycle service (bank.provision / connection.revalidate producer) over the production client factory, the operations view, the Hindsight binding snapshot and the replace seam; no boot network call
- hindsight-backup-boot.ts — composes the Stage 3 backup.capture producer over the `<dataDir>/backups/` store, Secret Catalog custody and the native route (unavailable until W5); no boot filesystem or network effect
