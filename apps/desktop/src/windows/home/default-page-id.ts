/**
 * INPUT:  none — the Home window's stable boot-page decision.
 * OUTPUT: DEFAULT_PAGE_ID, the dependency-leaf value shared by navigation consumers.
 * POS:    ui/windows/home — leaf contract; kept separate from the component registry so Pet and Home stores cannot
 *         form a runtime import cycle while resolving the default page.
 */

export const DEFAULT_PAGE_ID = "chat" as const;
