# components/toast/
The ONE reusable transient-notice surface (D34): floating, zero layout height, six-second unheld expiry, pointer/focus
pause, deliberate pointer/keyboard hold, Escape/outside dismissal and the four-item A4 cap.
- toast-store.ts — compatible pushToast entry, weak event-identity consumption and operation/target replacement in a bounded window-local queue
- toast-host.tsx — fixed polite live-region stack and Escape/outside dismiss-all listeners
- toast-card.tsx — selectable notification card, success/warn/error/info tones, labelled close and pointer/keyboard reading protection
- toast-lifetime.ts — remaining-time presentation deadline with independent hover/focus pauses, deliberate hold and Effect cleanup
