/**
 * INPUT:  a chosen model archive and the calling window's authenticated operator client.
 * OUTPUT: guarded import actions, retained resource warnings/errors and once-only floating outcomes.
 * POS:    Character import React seam; the local controller owns attempts, Core owns imported state.
 */

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import type { CharacterImportResult } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { dismissToastGroup, pushToast } from "@/components/toast/toast-store.js";
import { createCharacterImportController, initialCharacterImport } from "./character-import-controller.ts";

const REPLACE_KEY = "character-import";

export interface CharacterImport {
  isImporting: boolean;
  result: CharacterImportResult | null;
  warnings: string[];
  error: string | null;
  importFile: (file: File) => Promise<void>;
}

export function useCharacterImport(client: WsClient | null): CharacterImport {
  const [state, setState] = useState(initialCharacterImport);
  const controller = useMemo(() => createCharacterImportController({
    changed: setState,
    started: () => dismissToastGroup(REPLACE_KEY),
    succeeded: (result, eventKey) => pushToast(`导入成功（${result.costumes.length} 套服装）`, "success", { eventKey, replaceKey: REPLACE_KEY }),
    failed: (eventKey) => pushToast("模型导入未完成，请查看错误说明。", "error", { eventKey, replaceKey: REPLACE_KEY }),
  }), []);
  useLayoutEffect(() => controller.replace(client), [controller, client]);
  useEffect(() => () => controller.dispose(), [controller]);
  return { ...state, warnings: state.result?.warnings ?? [], importFile: controller.importFile };
}
