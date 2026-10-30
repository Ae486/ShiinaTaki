"""Compare S1 source against its captured dirty-working-tree preimages without modifying source."""
from pathlib import Path
import difflib
import hashlib
import json
import subprocess

root = Path.cwd().resolve()
expected = Path('H:/TakiAgent-worktrees/t4').resolve()
if root != expected:
    raise SystemExit('wrong worktree')
evidence = root / '.trellis/tasks/10-21-agent-delegation-runtime/research/s1'
manifest = json.loads((evidence / 'preimages.json').read_text(encoding='utf-8'))
known_new = [
    'packages/shared/src/subagent-schema.test.ts',
    'packages/core/src/db/subagent-repo.test.ts',
    'packages/core/src/db/migrations/056-subagent-conversations.test.ts',
]
known = {item['path'] for item in manifest}
manifest += [dict(path=path, existed=False, sha256=None) for path in known_new if path not in known]
changed = []
patch = []
whitespace = []
for item in manifest:
    path = item['path']
    before_path = evidence / 'preimages' / path
    before = before_path.read_bytes() if item['existed'] else b''
    if item['existed'] and hashlib.sha256(before).hexdigest() != item['sha256']:
        raise SystemExit(f'preimage hash mismatch: {path}')
    after = (root / path).read_bytes()
    if before == after:
        continue
    text = after.decode('utf-8')
    if text.startswith('\ufeff'):
        whitespace.append(f'{path}: BOM')
    whitespace += [f'{path}:{i}: trailing whitespace' for i, line in enumerate(text.splitlines(), 1) if line.rstrip() != line]
    changed.append(dict(path=path, status='modified' if item['existed'] else 'added',
                        beforeSha256=item['sha256'], afterSha256=hashlib.sha256(after).hexdigest()))
    patch.extend(difflib.unified_diff(before.decode('utf-8').splitlines(), text.splitlines(),
                                     fromfile=f'working-preimage/{path}', tofile=f'current/{path}', lineterm=''))
(evidence / 's1-working-baseline.diff').write_text('\n'.join(patch)+'\n', encoding='utf-8', newline='\n')
(evidence / 'changed-files.json').write_text(json.dumps(changed, indent=2)+'\n', encoding='utf-8', newline='\n')
check = subprocess.run(['git', 'diff', '--check', '--', *[item['path'] for item in changed]], capture_output=True, text=True)
result = dict(changedFiles=len(changed), utf8NoBom=not any('BOM' in row for row in whitespace),
              whitespaceProblems=whitespace, gitDiffCheckExit=check.returncode, gitDiffCheckOutput=check.stdout+check.stderr)
(evidence / 'diff-check.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8', newline='\n')
print(json.dumps(result))
raise SystemExit(0 if not whitespace and check.returncode == 0 else 1)
