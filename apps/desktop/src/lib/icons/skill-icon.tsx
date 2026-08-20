/**
 * INPUT: optional caller-owned size/colour className
 * OUTPUT: <SkillIcon> — a compact instruction sheet with a spark mark
 * POS:    ui/lib/icons glyph used by the Home Skill lifecycle navigation row
 */
import { Glyph, type IconProps } from "./glyph.tsx";
export function SkillIcon({ className }: IconProps) { return <Glyph className={className}><path d="M6 3h8l4 4v14H6Z" /><path d="M14 3v5h5M9 12h6M9 16h4" /><path d="m4 9 .7 1.3L6 11l-1.3.7L4 13l-.7-1.3L2 11l1.3-.7Z" /></Glyph>; }
