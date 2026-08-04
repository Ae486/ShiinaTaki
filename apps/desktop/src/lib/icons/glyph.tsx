/**
 * INPUT:  an optional className from the caller plus the glyph's own path children.
 * OUTPUT: <Glyph> — the shared 24x24 stroke-svg frame every icon draws inside, plus IconProps/IconComponent.
 * POS:    ui/lib/icons — the one place the svg attributes live, so a glyph file is nothing but its artwork and the
 *         registries can type an icon slot without knowing which glyph fills it.
 */

import type { ComponentType, ReactNode } from "react";

export interface IconProps {
  className?: string;
}

/** The slot type the page/wheel registries declare: colour and size come from the caller's className. */
export type IconComponent = ComponentType<IconProps>;

export function Glyph({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}
