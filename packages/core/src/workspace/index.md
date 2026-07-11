# core/workspace/
- workspace-paths.ts — the path-escape SECURITY CORE: realpath-based confinement of a relative path to the Workspace root
- read-file-tool.ts — core-side agent tool: confined UTF-8 read → { ok, path, content, bytes, truncated } (256 KiB cap)
- write-file-tool.ts — core-side agent tool: confined UTF-8 write (mkdir parents) → { ok:true, path, bytes } (1 MiB cap)
- fs-error.ts — errno-name extraction so model-facing IO errors never carry an absolute path
