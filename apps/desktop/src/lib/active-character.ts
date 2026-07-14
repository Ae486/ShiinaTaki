/**
 * INPUT:  none (compile-time constant).
 * OUTPUT: ACTIVE_CHARACTER_ID — the character the pet window converses as / whose model it loads.
 * POS:    ui/lib — single source for the pet window's active character (data, not hardcoded into logic; invariant 7).
 *         #16 fixes it to taki (the loaded arbeit model); the M5 #24 soul-swap panel makes it user-selectable (D22).
 */

export const ACTIVE_CHARACTER_ID = "taki";
