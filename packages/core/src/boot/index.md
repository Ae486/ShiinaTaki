# core/boot/
- core-bootstrap.ts — bootstrapCore(env): opens the env-only data root, resolves application settings over environment fallback/defaults, and validates optional models/features independently so the basic configuration plane remains available
- hindsight-setup-boot.ts — inactive B3 setup and operator methods without boot network/provider calls; validate/setup/disable refuse while an activation row is open
- hindsight-custody-boot.ts — external registration/current configuration admission plus the authenticated Host route; operator-only status keeps accepted custody handles inside Core.
- hindsight-deployment-boot.ts — composes durable C2 admission/observation and registers operator methods plus the current authenticated Node checkpoint.
- hindsight-activation-boot.ts — composes the Stage 2b activation service over the production client factory, the live connection fingerprint and the composition binding seams; no boot network call
- hindsight-lifecycle-boot.ts — composes the Stage 2c lifecycle service (bank.provision / connection.revalidate producer) over the production client factory, the operations view, the Hindsight binding snapshot and the replace seam; no boot network call
- hindsight-backup-boot.ts — composes the Stage 3 backup producer (capture/admit/verify) over the `<dataDir>/backups/` store, Secret Catalog custody and credential read-back, and the production native route over the live Hindsight connection (TAKI-HS-013 endpoint); no boot filesystem or network effect
- memory-transition-boot.ts — composed healthy/offline producers with explicit full readiness and current-only status observations; no boot dispatch

- hindsight-configuration-boot.ts — one optional observation owner; operator status captures observed selection in one read transaction, while network observation keeps independent before/after captures
- hindsight-template-boot.ts — template producer and separate operator status facade; status selection and bound identity share one read transaction, original producer verification remains independent
- feature-configuration.ts — independent optional-policy validation with explicit unavailable observations and non-dispatch construction defaults
