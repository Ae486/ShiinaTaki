# core/skills/
- skill-scanner.ts — boot discovery of <root>/<name>/SKILL.md; validate name+description and bind a SHA-256 content revision; {skills, invalid}
- skills-state.ts — skills-state.json enable/disable persistence (default-enabled); skill dirs stay pristine
- skills-loader.ts — renderList() for system context + lazy load(name) of the body and trusted name/content-revision lookup (NOT_FOUND/DISABLED/IO_ERROR)
- load-skill-tool.ts — governed explicit-auto load_skill meta-tool; loaded Markdown guides procedure but grants no underlying action
