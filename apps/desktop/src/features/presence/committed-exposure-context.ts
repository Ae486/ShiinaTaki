/**
 * INPUT: the rendering surface's current connection-bound presence owner
 * OUTPUT: local context for committed text reporters beneath the existing surface tree
 * POS: ui/presence — internal binding only; no device or source identity is rendered
 */
import { createContext } from "react";
import type { SurfacePresence } from "./surface-presence.ts";
export const CommittedExposureContext = createContext<SurfacePresence | null>(null);
