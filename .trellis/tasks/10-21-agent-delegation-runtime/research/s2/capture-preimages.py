from pathlib import Path
import hashlib
import json
import shutil
import sys

root = Path('H:/TakiAgent-worktrees/t4').resolve()
evidence = root / '.trellis/tasks/10-21-agent-delegation-runtime/research/s2'
manifest_path = evidence / 'preimages.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else []
known = {entry['path'] for entry in manifest}
for relative in sys.argv[1:]:
    if relative in known:
        continue
    source = (root / relative).resolve()
    source.relative_to(root)
    entry = {'path': relative, 'existed': source.exists()}
    if source.exists():
        entry['sha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
        target = evidence / 'preimages' / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    manifest.append(entry)
evidence.mkdir(parents=True, exist_ok=True)
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(f'{len(manifest)} preimages recorded')
