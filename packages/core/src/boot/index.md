# core/boot/
- core-bootstrap.ts — bootstrapCore(env): opens the DB on the env-only data root, builds the config plane (repo/source/writer/subscriptions), then parses every loader against the RESOLVED env (env > stored > default) and constructs the model slots; returns the composition root's config+storage phase in one object
- hindsight-setup-boot.ts — composes the inactive B3 Hindsight setup service and operator methods without boot network/provider calls
