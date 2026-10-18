# core/boot/
- core-bootstrap.ts — bootstrapCore(env): opens the DB on the env-only data root, builds the config plane (repo/source/writer/subscriptions), then parses every loader against the RESOLVED env (env > stored > default) and constructs the model slots; returns the composition root's config+storage phase in one object
- hindsight-setup-boot.ts — composes the inactive B3 Hindsight setup service (refusing validate/setup/disable while an activation row is open) and operator methods without boot network/provider calls
- hindsight-custody-boot.ts — external registration/current configuration admission plus the authenticated Host route; operator-only status keeps accepted custody handles inside Core.
- hindsight-deployment-boot.ts — composes durable C2 admission/observation and registers operator methods plus the current authenticated Node checkpoint.
- hindsight-activation-boot.ts — composes the Stage 2b activation service over the production client factory, the live connection fingerprint and the composition binding seams; no boot network call
- hindsight-lifecycle-boot.ts — composes the Stage 2c lifecycle service (bank.provision / connection.revalidate producer) over the production client factory, the operations view, the Hindsight binding snapshot and the replace seam; no boot network call
- hindsight-backup-boot.ts — composes the Stage 3 backup producer (capture/admit/verify) over the `<dataDir>/backups/` store, Secret Catalog custody and credential read-back, and the production native route over the live Hindsight connection (TAKI-HS-013 endpoint); no boot filesystem or network effect
- memory-transition-boot.ts — composed healthy/offline producers and read-only operator overview, full independent readiness and boot-primed status observer; no boot dispatch.

- hindsight-configuration-boot.ts — registers one read-only optional observation owner without boot network calls
- hindsight-template-boot.ts — composes the template operation/preview owner and operator read methods over runtime retirement/replacement; construction never probes or writes Native
