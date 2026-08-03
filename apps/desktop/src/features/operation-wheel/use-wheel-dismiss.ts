/**
 * INPUT:  a ref to the wheel container plus the closer, from the wheel component.
 * OUTPUT: the dismissal listeners (outside pointerdown / Escape / window blur), attached for the component's lifetime
 *         — i.e. only while the wheel is mounted.
 * POS:    ui/features/operation-wheel — the React lifecycle wrapper around the framework-free installWheelDismiss;
 *         hook owns the window access so the component stays presentational.
 */

import { useEffect, type RefObject } from "react";
import { installWheelDismiss } from "./wheel-dismiss.ts";

export function useWheelDismiss(container: RefObject<HTMLElement | null>, close: () => void): void {
  useEffect(() => {
    return installWheelDismiss({
      target: window,
      close,
      isInsideWheel: (target) => target instanceof Node && container.current?.contains(target) === true,
    });
  }, [container, close]);
}
