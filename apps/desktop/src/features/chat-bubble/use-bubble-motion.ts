/**
 * INPUT:  actual reduced-motion preference and document visibility
 * OUTPUT: whether a visible Pet transcript may use CSS motion
 * POS:    ui/chat-bubble — event-driven motion preference; no timer, polling or synthetic loading phase
 */
import { useEffect, useState } from "react";

function motionAllowed(): boolean {
  return typeof window !== "undefined" && !document.hidden && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useBubbleMotion(): boolean {
  const [allowed, setAllowed] = useState(motionAllowed);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setAllowed(!document.hidden && !query.matches);
    query.addEventListener("change", changed);
    document.addEventListener("visibilitychange", changed);
    return () => { query.removeEventListener("change", changed); document.removeEventListener("visibilitychange", changed); };
  }, []);
  return allowed;
}
