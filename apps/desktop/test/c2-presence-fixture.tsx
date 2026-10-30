/**
 * INPUT: isolated native fixture window and scripted operator protocol; production UI modules
 * OUTPUT: actual Home/Chat and Pet bubble/reporting lifecycles, plus explicit test-only visibility controls
 * POS: native QA only — no report injection, renderer/model assets, real Core, database or provider
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { HomeShell } from "../src/windows/home/home-shell.tsx";
import { useHomeStore } from "../src/windows/home/home-store.ts";
import { useCoreConnection } from "../src/windows/pet/use-core-connection.ts";
import { ChatBubble } from "../src/features/chat-bubble/chat-bubble.tsx";
import { useConnectionStore } from "../src/stores/connection-store.ts";
import { useInteractionStore } from "../src/stores/interaction-store.ts";
import { useSurfacePresence } from "../src/features/presence/use-surface-presence.ts";
import { CommittedExposureContext } from "../src/features/presence/committed-exposure-context.ts";
import "../src/styles.css";
import type { WsClient } from "../src/lib/ws-client.ts";

function PetSurface({ client }: { client: WsClient | null }) {
  const presence = useSurfacePresence(client, "pet");
  return <CommittedExposureContext.Provider value={presence}><ChatBubble /></CommittedExposureContext.Provider>;
}
function PetFixture() {
  useCoreConnection(null);
  const client = useConnectionStore((state) => state.client);
  const [mounted, setMounted] = useState(true);
  return <div className="relative h-full bg-surface-sunken">
    <button data-fixture-open onClick={() => useInteractionStore.getState().setBubbleOpen(true)}>打开测试气泡</button>
    <button data-fixture-toggle onClick={() => setMounted((value) => !value)}>切换测试挂载</button>
    {mounted && <PetSurface client={client} />}
  </div>;
}

const root = document.querySelector("#root");
if (!root) throw new Error("Missing native fixture root");
useHomeStore.getState().navigate("chat");
createRoot(root).render(<StrictMode>{new URLSearchParams(location.search).get("window") === "pet" ? <PetFixture /> : <HomeShell />}</StrictMode>);
