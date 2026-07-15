/**
 * INPUT:  the chat.html #root element.
 * OUTPUT: mounts <ChatWindow> as the chat window's React root.
 * POS:    ui/windows/chat — the on-demand chat window entry (its own Vite input + Tauri capability). A disposable
 *         client: closing the window drops its own WS; the Agent Core is unaffected (invariant 4). Opaque root.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatWindow } from "./chat-window.tsx";
import "@/styles.css";

const root = document.querySelector("#root");
if (!root) throw new Error("chat: #root not found");

createRoot(root).render(
  <StrictMode>
    <ChatWindow />
  </StrictMode>,
);
