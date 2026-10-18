/**
 * INPUT:  visible Operations page and authenticated Home client
 * OUTPUT: current-generation Character choices for a configuration scope selector
 * POS:    ui/windows/home/pages/operations — roster read only, independent from observation evidence
 */
import { useEffect, useState } from "react";
import { useHomeClient } from "../../home-client-context.ts";
import { usePageVisible } from "../../page-visibility-store.ts";

export function useConfigurationCharacters() {
  const { client, status } = useHomeClient();
  const visible = usePageVisible("operations");
  const ready = visible && status.kind === "connected" ? client : null;
  const [characters, setCharacters] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    setCharacters([]);
    setFailed(false);
    if (ready) void ready.listCharacters().then((result) => {
      if (current) setCharacters(result.characters.map((character) => character.characterId));
    }).catch(() => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [ready, revision]);
  return { characters, failed, retry: () => setRevision((value) => value + 1) };
}
