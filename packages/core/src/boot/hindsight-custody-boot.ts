/**
 * INPUT:  Core data identity/config, Catalog owner and authenticated Host routing dependencies
 * OUTPUT: one C1 custody owner and an operator-only preparation method; no installation or Native effects
 * POS:    core/boot — reads explicit registration under the Core data root; the Host verifies its OS trust
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  HINDSIGHT_CUSTODY_CAPABILITY, HINDSIGHT_CUSTODY_METHODS, HINDSIGHT_SECRET_REFS,
  HindsightCustodyParamsSchema, HindsightCustodyResultSchema,
  type HindsightCredentialSlot, type HindsightFixedSelection,
} from "@taki/shared/hindsight-custody";
import { HindsightHostRegistrationSchema } from "@taki/shared/hindsight-installation";
import { routeCapability, type CapabilityRouteDeps } from "../capabilities/route-capability.ts";
import type { ConfigSource } from "../config/config-source.ts";
import { resolveHindsightConfig } from "../config/hindsight-config.ts";
import { createHindsightCustodyOwner, type HindsightCustodyCurrent } from "../memory/hindsight/hindsight-custody-owner.ts";
import type { SecretCatalogService } from "../secrets/secret-catalog-service.ts";
import type { MethodRegistry } from "../server/method-registry.ts";

export interface HindsightCustodyBootDeps {
  dataDir: string;
  coreHostId: string;
  secrets: SecretCatalogService;
  config: ConfigSource;
  methods: MethodRegistry;
  route: CapabilityRouteDeps;
}

export function composeHindsightCustody(deps: HindsightCustodyBootDeps) {
  const owner = createHindsightCustodyOwner({
    coreHostId: deps.coreHostId, catalog: deps.secrets,
    current: () => currentRegistration(deps),
    route: (request, interactive) => routeCapability({ ...deps.route, interactive }, request),
    isCurrent: (control, authorization) => {
      const host = deps.route.registry.findHost(control.targetHostId);
      const catalog = deps.route.catalogs.get(control.targetHostId);
      const policy = deps.route.governance.hostDispatchPolicy(HINDSIGHT_CUSTODY_CAPABILITY);
      return !!host && deps.route.registry.isCurrentHost(host)
        && catalog?.connectionGeneration === control.connectionGeneration
        && catalog.catalogGeneration === control.catalogGeneration
        && catalog.capabilities.some((entry) => entry.capabilityId === HINDSIGHT_CUSTODY_CAPABILITY)
        && policy.policyGeneration === control.policyGeneration
        && JSON.stringify(policy.projection) === JSON.stringify(control.governanceProjection)
        && deps.route.approval.approvalGeneration() === (authorization?.approvalGeneration ?? control.approvalGeneration);
    },
  });
  deps.methods.register({
    method: HINDSIGHT_CUSTODY_METHODS.prepare, roles: ["operator"], paramsSchema: HindsightCustodyParamsSchema,
    handler: async (_params, context) => {
      const { status } = await owner.prepare({ connection: context.connection });
      return HindsightCustodyResultSchema.parse(status); // The accepted handle never crosses WS.
    },
  });
  return owner;
}

function currentRegistration(deps: HindsightCustodyBootDeps): HindsightCustodyCurrent | null {
  try {
    const registration = HindsightHostRegistrationSchema.parse(JSON.parse(
      readFileSync(join(deps.dataDir, "hindsight-host", "installation.json"), "utf8"),
    ));
    if (registration.coreHostId !== deps.coreHostId || registration.catalogStoreId !== deps.coreHostId
      || resolve(registration.coreDataDirectory) !== resolve(deps.dataDir)) return null;
    const config = resolveHindsightConfig(deps.config);
    if (config.state !== "ready") return null;
    return {
      registration,
      configurationDigest: createHash("sha256").update(JSON.stringify(config.projection)).digest("hex"),
      selection: fixedSelection(deps.secrets),
    };
  } catch {
    return null; // Absence or an incompatible registration affects only managed custody, never existing-instance setup.
  }
}

function fixedSelection(catalog: SecretCatalogService): HindsightFixedSelection {
  return (Object.keys(HINDSIGHT_SECRET_REFS) as HindsightCredentialSlot[]).map((slot) => {
    if (slot === "connectionApiKey" || slot === "defaultModelApiKey" || catalog.presence(HINDSIGHT_SECRET_REFS[slot]).present) {
      return { slot, source: "catalog" };
    }
    if (slot === "retainModelApiKey" || slot === "reflectModelApiKey" || slot === "consolidationModelApiKey") {
      return { slot, source: "inherit-default" };
    }
    return { slot, source: "unused" };
  });
}
