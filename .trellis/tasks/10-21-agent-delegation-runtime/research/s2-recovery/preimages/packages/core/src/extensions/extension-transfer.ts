/**
 * INPUT:  sealed targetHostId, advertised transfer capability id, payload, and canonical Host route
 * OUTPUT: routeExtensionTransfer() -> fail-closed validation or the existing governed route result
 * POS:    core/extensions — cross-Host transfer adapter; it adds no filesystem path or mutation authority
 */
import type { HostCatalogStore } from "../hosts/host-catalog.ts";

type CapabilityRoute = (request: { capabilityId: string; input: unknown; targetHostId: string }) => Promise<unknown>;

export interface ExtensionTransferRequest {
  targetHostId: string;
  transferCapabilityId: string;
  input: unknown;
}

export async function routeExtensionTransfer(
  deps: { catalogs: HostCatalogStore; route: CapabilityRoute },
  request: ExtensionTransferRequest,
): Promise<unknown> {
  const catalog = deps.catalogs.get(request.targetHostId);
  if (!catalog || catalog.readiness !== "ready") {
    return { ok: false, code: "TRANSFER_HOST_UNAVAILABLE", message: "the target Host is unavailable" };
  }
  const advertised = catalog.workspaces.some((workspace) =>
    workspace.transferCapabilityIds.includes(request.transferCapabilityId));
  if (!advertised) {
    return { ok: false, code: "TRANSFER_NOT_ADVERTISED", message: "the target Host did not advertise this transfer capability" };
  }
  if (!catalog.capabilities.some((capability) => capability.capabilityId === request.transferCapabilityId)) {
    return { ok: false, code: "TRANSFER_CAPABILITY_MISSING", message: "the advertised transfer capability is not executable" };
  }
  return deps.route({
    capabilityId: request.transferCapabilityId,
    input: request.input,
    targetHostId: request.targetHostId,
  });
}
