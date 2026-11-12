/**
 * INPUT: isolated native fixture shell with redirected local WebSocket and production Home modules.
 * OUTPUT: actual Home UI for Pattern authoring/review and a passive secondary test window.
 * POS: native QA only; no provider, model assets or production profile is used.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HomeShell } from "../src/windows/home/home-shell.tsx";
import "../src/styles.css";

const root = document.querySelector("#root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<StrictMode>{new URLSearchParams(location.search).get("window") === "pet"
  ? <p>主动互动界面隔离测试</p> : <HomeShell />}</StrictMode>);
