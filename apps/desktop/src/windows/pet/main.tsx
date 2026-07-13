/**
 * INPUT:  the pet.html #root element + the Cubism runtime globals loaded by pet.html.
 * OUTPUT: mounts <PetStage> as the pet overlay's React root.
 * POS:    ui/windows/pet — the pet overlay window entry (its own Vite input, own Tauri capability). A disposable
 *         client: closing it never affects the Agent Core (invariant 4). Root stays transparent.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PetStage } from "./pet-stage.tsx";
import "@/styles.css";

const root = document.querySelector("#root");
if (!root) throw new Error("pet: #root not found");

createRoot(root).render(
  <StrictMode>
    <PetStage />
  </StrictMode>,
);
