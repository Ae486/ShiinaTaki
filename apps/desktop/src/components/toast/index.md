# components/toast/
The ONE reusable transient-notice surface (D34): floating, zero layout height, hover-pauses, outside-click dismisses.
- toast-store.ts — per-window toast queue (zustand) + pushToast entry for non-React code
- toast-host.tsx — the fixed overlay stack: auto-dismiss timer, hover pause, outside-click dismiss-all, selectable text
