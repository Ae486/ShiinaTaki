/**
 * INPUT:  the WS MethodRegistry + the config source / writer / subscription registry
 * OUTPUT: registerConfigMethods(registry, deps) — registers config reads, writes and subscriptions
 * POS:    core/server/methods — the settings surface's single registration seam (invariant 7, perception-methods
 *         precedent): one call from the composition root, so adding a config method never grows main.ts
 */
import type { ConfigSource } from "../../config/config-source.ts";
import type { ConfigSubscriptions } from "../../config/config-subscriptions.ts";
import type { ConfigWriter } from "../../config/config-writer.ts";
import type { Logger } from "../../logging/logger.ts";
import type { MethodRegistry } from "../method-registry.ts";
import { configListMethod } from "./config-list.ts";
import { configModelCapabilitiesMethod } from "./config-model-capabilities.ts";
import { configSetMethod } from "./config-set.ts";
import { configSubscribeMethod } from "./config-subscribe.ts";

export interface ConfigMethodDeps {
  source: ConfigSource;
  writer: ConfigWriter;
  subscriptions: ConfigSubscriptions;
  logger: Logger;
  activeModel?: () => { baseUrl: string; modelId: string } | undefined;
}

export function registerConfigMethods(registry: MethodRegistry, deps: ConfigMethodDeps): void {
  registry.register(configListMethod(deps.source));
  registry.register(configModelCapabilitiesMethod(deps.source, deps.activeModel));
  registry.register(configSetMethod({ writer: deps.writer, logger: deps.logger }));
  registry.register(configSubscribeMethod(deps.subscriptions));
}
