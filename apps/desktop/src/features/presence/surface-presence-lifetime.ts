/**
 * INPUT: one physical WsClient, its surface and local render-owner attach/detach events
 * OUTPUT: one socket-lifetime source, preserving identity/input age across React probes and remounts
 * POS: ui/presence — detach ends display evidence; only socket/page retirement ends the Core source
 */
import type { PresenceReportParams } from "@taki/shared";
import type { PresenceMethods } from "@/lib/ws-client-presence.js";
import { createSurfacePresence, type SurfacePresence } from "./surface-presence.ts";

type PresenceClient = PresenceMethods & { onClose(callback: () => void): void };
interface Binding { surface: PresenceReportParams["surface"]; source: SurfacePresence; owners: number }
const bindings = new WeakMap<PresenceClient, Binding>();

export function retainSurfacePresence(client: PresenceClient, surface: PresenceReportParams["surface"]) {
  let binding = bindings.get(client);
  if (!binding) {
    binding = { surface, source: createSurfacePresence({ client, surface }), owners: 0 };
    bindings.set(client, binding);
    const source = binding.source;
    client.onClose(() => source.dispose());
  }
  if (binding.surface !== surface) throw new Error("One operator connection cannot own several presence surfaces");
  binding.owners += 1;
  const current = binding;
  let released = false;
  return { source: binding.source, release() {
    if (released) return;
    released = true; current.owners -= 1;
    // A real detach ends exposure immediately. StrictMode can reattach this same source without a tombstone.
    if (current.owners === 0) current.source.setActive(false);
  } };
}
