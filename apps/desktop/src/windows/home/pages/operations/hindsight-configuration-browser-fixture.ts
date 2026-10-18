/**
 * INPUT:  synthetic configuration transport and disposable loopback operator connections
 * OUTPUT: authenticated Core WS fixture for Home integration tests, with explicit cleanup
 * POS:    ui testing support — not in the production path; no installed Native or model calls
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHARACTER_METHODS, CharacterListParamsSchema } from "@taki/shared";
import { configurationObservationFixture } from "../../../../../../../packages/core/src/testing/hindsight-configuration-fixture.ts";
import { createMethodRegistry } from "../../../../../../../packages/core/src/server/method-registry.ts";
import { registerHindsightConfigurationMethods } from "../../../../../../../packages/core/src/server/methods/hindsight-configuration-methods.ts";
import { connectMethod } from "../../../../../../../packages/core/src/server/methods/connect.ts";
import { createConnectionRegistry } from "../../../../../../../packages/core/src/server/connection-registry.ts";
import { createDeviceRegistry } from "../../../../../../../packages/core/src/devices/device-registry.ts";
import { createPairedDeviceStore } from "../../../../../../../packages/core/src/devices/paired-device-store.ts";
import { startWsServer } from "../../../../../../../packages/core/src/server/ws-server.ts";
import { createLogger } from "../../../../../../../packages/core/src/logging/logger.ts";

export async function configurationBrowserFixture() {
  const dir = await mkdtemp(join(tmpdir(), "taki-configuration-home-"));
  const native = configurationObservationFixture();
  const registry = createMethodRegistry();
  const connections = createConnectionRegistry();
  registerHindsightConfigurationMethods(registry, native.service);
  registry.register({ method: CHARACTER_METHODS.list, roles: ["operator"], paramsSchema: CharacterListParamsSchema, handler: () => ({
    characters: [{ characterId: "taki", costumes: ["default"], defaultCostume: "default", settingsFilesByCostume: {}, source: "zip" }],
  }) });
  registry.register(connectMethod({ deviceRegistry: createDeviceRegistry({ store: createPairedDeviceStore(join(dir, "devices.json")) }),
    connectionRegistry: connections, trustLoopbackOperator: true, onPairingCode: () => undefined, onAutoTrust: () => undefined }));
  try {
    const server = await startWsServer({ host: "127.0.0.1", port: 0, registry, connectionRegistry: connections, logger: createLogger("fatal") });
    return { native, url: `ws://127.0.0.1:${server.port}`, close: async () => {
      await server.close(); native.service.dispose(); await rm(dir, { recursive: true, force: true });
    } };
  } catch (cause) {
    native.service.dispose(); await rm(dir, { recursive: true, force: true }); throw cause;
  }
}
