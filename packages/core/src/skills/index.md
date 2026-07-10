# core/skills/
- skill-scanner.ts — boot discovery of <root>/<name>/SKILL.md; validate name+description; {skills, invalid} (never throws)
- skills-state.ts — skills-state.json enable/disable persistence (default-enabled); skill dirs stay pristine
- skills-loader.ts — renderList() for system context + lazy load(name) of the body (NOT_FOUND/DISABLED/IO_ERROR)
- load-skill-tool.ts — the load_skill meta-tool; thin over the loader; execute never throws
