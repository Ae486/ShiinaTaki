/**
 * INPUT: Core SQLite, the owning Secret Catalog and committed profile references
 * OUTPUT: staged unique credentials and bounded orphan reconciliation after failed publication or restart
 * POS: core/config — owns only explicitly journaled profile secrets; provider handles retain admitted credentials
 */
import { randomUUID } from "node:crypto";
import type { ModelSlot } from "@taki/shared";
import type { Database } from "../db/sqlite.ts";
import type { StoredModelProfile } from "../db/model-profile-repo.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";

export function createModelProfileSecrets(db: Database, secrets: Pick<SecretCatalogService, "set" | "clear">) {
  const register = db.prepare("INSERT OR IGNORE INTO model_profile_secrets(secret_ref,slot,created_at) VALUES(:ref,:slot,:at)");
  const forget = db.prepare("DELETE FROM model_profile_secrets WHERE secret_ref=:ref");
  const owned = db.prepare("SELECT secret_ref FROM model_profile_secrets");
  const retire = (ref: string) => {
    try { secrets.clear(ref); forget.run({ ref }); }
    catch { /* Preserve the ownership record for a later explicit save or restart reconciliation. */ }
  };
  return {
    stage(slot: ModelSlot, value: string): string {
      const ref = `model.${slot}.${randomUUID()}`;
      register.run({ ref, slot, at: new Date().toISOString() });
      try { secrets.set(ref, value); }
      catch (cause) { retire(ref); throw cause; }
      return ref;
    },
    reconcile(profiles: readonly (StoredModelProfile | null)[]): void {
      const retained = new Set(profiles.flatMap((profile) => profile?.secretRef ? [profile.secretRef] : []));
      // Adopt only the exact reference namespace emitted by the preceding profile implementation.
      for (const ref of retained) {
        const match = /^model\.(main|utility)\.[a-f0-9-]{36}$/.exec(ref);
        if (match?.[1]) register.run({ ref, slot: match[1], at: new Date().toISOString() });
      }
      for (const row of owned.all()) if (typeof row.secret_ref === "string" && !retained.has(row.secret_ref)) retire(row.secret_ref);
    },
  };
}
