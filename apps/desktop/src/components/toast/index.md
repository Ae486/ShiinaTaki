# components/toast/
The ONE reusable transient-notice surface (D34): floating, zero layout height, hover-pauses, click pauses for good,
Escape clears, outside-click dismisses, stack capped at 4 (A4).
- toast-store.ts — per-window toast queue (zustand) + pushToast entry for non-React code + the MAX_TOASTS stacking cap
- toast-host.tsx — the fixed overlay stack: role=status/aria-live, auto-dismiss timer, labelled close button, hover/click pause, Escape + outside-click dismiss-all, selectable text
