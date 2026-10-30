/**
 * INPUT: databases through the existing initiative delivery migration
 * OUTPUT: durable Core-wide model-opportunity reservations and first-intent charges
 * POS: core/db/migrations — additive accounting subordinate to canonical Run identity
 */
import type { Migration } from "../migration-runner.ts";

export const initiativeModelOpportunitiesMigration050: Migration = { version: 50, sql: `
CREATE TABLE initiative_model_opportunities (
 opportunity_key TEXT PRIMARY KEY,
 run_id TEXT UNIQUE REFERENCES runs(run_id),
 state TEXT NOT NULL CHECK(state IN ('reserved','charged','released')),
 reserved_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 charged_at TEXT,
 CHECK((state='charged' AND charged_at IS NOT NULL AND run_id IS NOT NULL)
   OR (state IN ('reserved','released') AND charged_at IS NULL))
) STRICT;
CREATE INDEX initiative_model_charges ON initiative_model_opportunities(charged_at) WHERE charged_at IS NOT NULL;
CREATE INDEX initiative_model_reservations ON initiative_model_opportunities(expires_at) WHERE state='reserved';
` };
