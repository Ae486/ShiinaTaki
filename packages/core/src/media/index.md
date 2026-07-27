# core/media/
- attachment-gc.ts — the store's retention arm: a boot sweep + a 6h unref'd interval expiring raw bytes only (the description memory is permanent); extracted from main.ts, not the croner scheduler (D5)
- attachment-store.ts — content-addressed (sha256) attachment R/W under the Workspace; save/read/sweepExpired/usage/clear; read confined by a strict whole-ref regex (decision 8); the DB never holds bytes
- directory-size.ts — best-effort recursive byte total of a directory (media.usage memory-text footprint, D27); missing dir → 0
