/**
 * INPUT: one restored surface client, route activity and trusted own-document events
 * OUTPUT: independent presence owner with source renewal, native fencing and explicit cleanup
 * POS: ui/presence — shared Home/Chat/Pet hook; no input buffering across connection replacement
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { PresenceReportParams } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import type { SurfacePresence } from "./surface-presence.ts";
import { retainSurfacePresence } from "./surface-presence-lifetime.ts";
import { observeOwnWindow } from "./own-window-visibility.ts";

function bindInput(source: SurfacePresence) {
  const pointer = (event: PointerEvent) => source.input(event.pointerType === "touch" ? "touch" : "pointer", event.isTrusted);
  const keyboard = (event: KeyboardEvent) => source.input("keyboard", event.isTrusted && !event.repeat);
  const wheel = (event: WheelEvent) => source.input("pointer", event.isTrusted);
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("keydown", keyboard, true);
  document.addEventListener("wheel", wheel, { capture: true, passive: true });
  return () => {
    document.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("keydown", keyboard, true);
    document.removeEventListener("wheel", wheel, true);
  };
}

export function useSurfacePresence(client: WsClient | null, surface: PresenceReportParams["surface"], active = true) {
  const [binding, setBinding] = useState<{ client: WsClient; surface: string; source: SurfacePresence } | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const source = binding?.client === client && binding?.surface === surface ? binding.source : null;
  useLayoutEffect(() => {
    if (!client) return;
    const lifetime = retainSurfacePresence(client, surface);
    const source = lifetime.source;
    source.setWindow({ visible: false, focused: false });
    source.setActive(activeRef.current);
    source.start();
    setBinding({ client, surface, source });
    const visibility = observeOwnWindow({ changed: source.setWindow, checking: source.beginWindowRefresh, document, window });
    const unbind = bindInput(source);
    source.setInputTracking(true);
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const renew = async () => {
      await visibility.refresh();
      if (disposed) return;
      source.renew(); timer = setTimeout(() => void renew(), 15_000);
    };
    timer = setTimeout(() => void renew(), 15_000);
    const detach = () => {
      if (disposed) return;
      disposed = true; clearTimeout(timer); visibility.dispose(); unbind(); source.setInputTracking(false); lifetime.release();
    };
    const retire = () => { source.dispose(); detach(); };
    client.onClose(retire);
    window.addEventListener("pagehide", retire);
    return () => { detach(); window.removeEventListener("pagehide", retire); };
  }, [client, surface]);
  useLayoutEffect(() => { source?.setActive(active); }, [source, active]);
  return source;
}
