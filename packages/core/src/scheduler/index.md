# core/scheduler/
- sweep-runner.ts — the shared retention-arm shape (boot sweep + unref'd 6h interval + one count-only log line); consumed by the attachment GC, the ambient-frame GC and the memory retention sweeper. Not the croner scheduler (D5): these are internal housekeeping timers, not user-visible schedules
