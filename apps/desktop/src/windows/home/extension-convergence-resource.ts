/**
 * INPUT:  one physical Home client and the visibility of its MCP/Skills strip consumers.
 * OUTPUT: a shared extension.status read owner with per-consumer delivery and bounded invalidation.
 * POS:    Home extension resource — one ephemeral owner per client; hidden copies neither fetch nor republish.
 */
import {
  createExtensionConvergenceController, type ExtensionConvergenceClient, type ExtensionConvergenceState,
} from "./extension-convergence-controller.ts";

type Listener = (state: ExtensionConvergenceState) => void;
const resources = new WeakMap<ExtensionConvergenceClient, ReturnType<typeof createExtensionResource>>();

export function extensionResource(client: ExtensionConvergenceClient) {
  let resource = resources.get(client);
  if (!resource) {
    resource = createExtensionResource(client);
    resources.set(client, resource);
  }
  return resource;
}

export function createExtensionResource(client: ExtensionConvergenceClient) {
  let state: ExtensionConvergenceState = { kind: "idle", previous: null, observation: "idle" };
  const listeners = new Map<Listener, boolean>();
  const controller = createExtensionConvergenceController((next) => {
    state = next;
    for (const [listener, visible] of listeners) if (visible) listener(next);
  });
  const updateVisibility = () => controller.setVisible([...listeners.values()].some(Boolean));
  controller.setVisible(false);
  return {
    observe(listener: Listener) {
      // A resource can be allocated by an abandoned React render. Bind only an effect-owned consumer,
      // and detach the channel when the last one leaves; an unobserved gap requires a later baseline.
      if (listeners.size === 0) controller.replace(client);
      listeners.set(listener, false);
      return () => {
        listeners.delete(listener);
        updateVisibility();
        if (listeners.size === 0) controller.replace(null);
      };
    },
    setVisible(listener: Listener, visible: boolean) {
      if (!listeners.has(listener)) return;
      listeners.set(listener, visible);
      if (visible) listener(state);
      updateVisibility();
    },
    refresh: () => controller.refresh(),
    invalidate: () => controller.invalidate(),
    invalidateLegacy: () => controller.invalidateLegacy(),
  };
}
