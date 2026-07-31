# core/media/
- attachment-gc.ts — the store's retention POLICY (what expires and when: raw bytes only, the description memory is permanent); the boot-sweep + 6h schedule and its count-only log line come from scheduler/sweep-runner
- attachment-store.ts — content-addressed (sha256) attachment R/W under the Workspace; save/read/sweepExpired/usage/clear; read confined by a strict whole-ref regex (decision 8); the DB never holds bytes
- directory-size.ts — best-effort recursive byte total of a directory (media.usage memory-text footprint, D27); missing dir → 0
