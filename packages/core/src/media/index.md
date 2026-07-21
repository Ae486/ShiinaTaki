# core/media/
- attachment-store.ts — content-addressed (sha256) attachment R/W under the Workspace; save/read/sweepExpired/usage/clear; read confined by a strict whole-ref regex (decision 8); the DB never holds bytes
- directory-size.ts — best-effort recursive byte total of a directory (media.usage memory-text footprint, D27); missing dir → 0
