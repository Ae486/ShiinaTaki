# core/media/
- attachment-gc.ts — raw-byte retention sweep; historical conversation/description records are preserved; boot-sweep + 6h schedule and count-only log come from scheduler/sweep-runner
- attachment-store.ts — content-addressed attachment R/W; confined refs and live TTL checks make expired reads truthful before GC without refreshing lifetime; durable records never hold bytes
- directory-size.ts — best-effort recursive byte total of a directory (media.usage memory-text footprint, D27); missing dir → 0
