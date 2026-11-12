# core/workspace/
- workspace-paths.ts — realpath confinement plus optional retired-subtree denial after canonical memory activation
- read-file-tool.ts — trusted non-serialized known-file material sidecar on successful unchanged results; core-side agent tool: confined UTF-8 read → { ok, path, content, bytes, truncated } (256 KiB cap)
- write-file-tool.ts — core-side agent tool: confined UTF-8 write (mkdir parents) → { ok:true, path, bytes } (1 MiB cap)
- fs-error.ts — errno-name extraction so model-facing IO errors never carry an absolute path
