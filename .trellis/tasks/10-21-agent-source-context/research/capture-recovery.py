from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parents[4]
destination = Path(__file__).parent / 's5-s6-recovery'
if root.as_posix().lower() != 'h:/takiagent-worktrees/t4':
    raise RuntimeError('wrong worktree')
names = {
    'agents': ['turn-mapping', 'conversation-store', 'context-reduction', 'replay-folds', 'compaction-pass', 'compaction-coordinator', 'base-prompt', 'untrusted-fence', 'source-context', 'source-interpretation'],
    'memory': ['canonical-ingestion-source', 'canonical-ingestion-model', 'canonical-ingestion-plan', 'canonical-local-ingestion-batch', 'write-convention', 'tidy-pass', 'image-description-writer'],
    'db': ['canonical-ingestion-source-repo', 'hindsight-ingestion-source-repo', 'primary-memory-source-read', 'primary-source-row'],
    'memory/hindsight': ['hindsight-policy-curator-prompt', 'hindsight-ingestion-request'],
    'initiative': ['initiative-context-builder'],
    'initiative/patterns': ['pattern-source'],
    'initiative/intentions': ['intention-source'],
    'capabilities': ['screenshot-describe'],
    'co-watching': ['child-adapter', 'runtime', 'runtime-model', 'runtime-types', 'runtime-source', 'task-workspace'],
}
paths = set()
for folder, stems in names.items():
    paths.add(f'packages/core/src/{folder}/index.md')
    for stem in stems:
        for suffix in ('.ts', '.test.ts'):
            paths.add(f'packages/core/src/{folder}/{stem}{suffix}')
paths.update(['packages/shared/src/co-watching-schema.ts', 'packages/shared/src/co-watching-schema.test.ts'])
manifest = []
for relative in sorted(paths):
    path = root / relative
    saved = destination / 'preimages' / relative
    item = {'path': relative, 'exists': path.exists()}
    if path.exists():
        data = path.read_bytes()
        item['sha256'] = hashlib.sha256(data).hexdigest()
        saved.parent.mkdir(parents=True, exist_ok=True)
        if saved.exists() and saved.read_bytes() != data:
            raise RuntimeError(f'preimage already exists: {relative}')
        saved.write_bytes(data)
    manifest.append(item)
destination.mkdir(parents=True, exist_ok=True)
(destination / 'preimages.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
s4 = json.loads((Path(__file__).parent / 's4/changed-files.json').read_text(encoding='utf-8'))
audit = [{'path': item['path'], 'matchesS4': hashlib.sha256((root / item['path']).read_bytes()).hexdigest() == item['afterSha256']} for item in s4]
(destination / 's4-hash-audit.json').write_text(json.dumps(audit, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'preimages': len(manifest), 's4Matched': sum(item['matchesS4'] for item in audit), 's4Changed': [item['path'] for item in audit if not item['matchesS4']]}))
