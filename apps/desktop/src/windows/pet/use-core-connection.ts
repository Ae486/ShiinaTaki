/**
 * INPUT:  the loaded PetScene (nullable while the model loads); a locally-persisted operator device identity.
 * OUTPUT: useCoreConnection(scene) — publishes only authenticated/restored Pet client generations and status to store.
 * POS:    ui/windows/pet — React adapter between the independent Pet lifecycle owner and window-local connection store.
 */

import { useEffect } from "react";
import { useOperatorConnection } from "@/hooks/use-operator-connection.js";
import type { PetScene } from "@/renderer/pet-scene.js";
import { useConnectionStore } from "@/stores/connection-store.js";
import { restorePetConnection } from "./restore-pet-connection.ts";

const DEVICE_NAME = "taki-pet";

export function useCoreConnection(scene: PetScene | null): void {
  const setClient = useConnectionStore((s) => s.setClient);
  const setStatus = useConnectionStore((s) => s.setStatus);
  const connection = useOperatorConnection({
    deviceName: DEVICE_NAME,
    lifecycleKey: scene,
    restore: (client, context) => restorePetConnection({ client, scene, context }),
  });

  useEffect(() => {
    setClient(connection.client);
  }, [connection.client, setClient]);

  useEffect(() => {
    setStatus(connection.status);
  }, [connection.status, setStatus]);

  useEffect(() => () => setClient(null), [setClient]);
}
