/**
 * INPUT:  the home.html #root element + the `?page=` boot query param.
 * OUTPUT: mounts <HomeShell> as the home window's React root, on the requested page.
 * POS:    ui/windows/home — the home window entry (its own Vite input + Tauri capability). A disposable client:
 *         closing it drops its WS; the Agent Core is unaffected (invariant 4).
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HomeShell } from "./home-shell.tsx";
import { pageFromSearch } from "./boot-page.ts";
import { useHomeStore } from "./home-store.ts";
import "@/styles.css";

const root = document.querySelector("#root");
if (!root) throw new Error("home: #root not found");

useHomeStore.getState().navigate(pageFromSearch(window.location.search));

createRoot(root).render(
  <StrictMode>
    <HomeShell />
  </StrictMode>,
);
