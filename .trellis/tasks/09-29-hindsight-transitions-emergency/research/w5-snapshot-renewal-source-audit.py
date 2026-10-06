"""New repair inventory; predecessor source manifests are read-only inputs."""
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
NATIVE = Path('H:/hindsight')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read(name):
    return json.loads((HERE / name).read_text(encoding='utf-8'))

w4 = read('w4-checker-source-hashes.json')
w5 = read('w5-checker-source-hashes.json')
prior = read('w5-prior-source-baseline.json')
core = {row['path']: row['checkedSha256'] for row in w4['files']}
core.update({path: row['sha256'] for path, row in w5['core'].items()})
allowed = {
    '.trellis/spec/backend/memory-transition-healthy-drivers.md',
    'packages/core/src/memory/transitions/index.md',
    'packages/core/src/memory/transitions/transition-healthy-candidate.ts',
    'packages/core/src/memory/transitions/transition-healthy-source.test.ts',
}
added = {
    'packages/core/src/memory/transitions/transition-unused-inventory.ts',
    'packages/core/src/memory/transitions/transition-healthy-snapshot-recovery.test.ts',
}
current = {path: digest(ROOT / path) for path in core}
changed = {path for path in core if core[path] != current[path]}
assert changed == allowed, {'unexpected': sorted(changed - allowed), 'missing': sorted(allowed - changed)}
native = dict(prior['roots']['H:/hindsight'])
native.update({path: row['sha256'] for path, row in w5['native'].items()})
assert all(digest(NATIVE / path) == expected for path, expected in native.items())
preserved = dict(w4['preservedManifests'])
preserved.update(w5['preservedManifests'])
preserved['w5-checker-source-hashes.json'] = '79158adcc4369135c69c8e4a0fb1d8651a30cc7f4ba9712580bee23df785679d'
assert all(digest(HERE / path) == expected for path, expected in preserved.items())
owned = {}
for path in sorted(allowed | added):
    raw = (ROOT / path).read_bytes()
    assert not raw.startswith(b'\xef\xbb\xbf'), path
    decoded = raw.decode('utf-8')
    assert all(line == line.rstrip() for line in decoded.splitlines()), path
    if path.endswith('.ts') and not path.endswith('.test.ts'):
        assert all(tag in '\n'.join(decoded.splitlines()[:6]) for tag in ['INPUT:', 'OUTPUT:', 'POS:']), path
    if '/transitions/' in path and path.endswith('.ts') and not path.endswith('.test.ts'):
        assert Path(path).name in (ROOT / 'packages/core/src/memory/transitions/index.md').read_text(encoding='utf-8'), path
    owned[path] = {'sha256': digest(ROOT / path), 'beforeSha256': core.get(path), 'bytes': len(raw)}
report = {
    'meaning': 'Repair-only overlay after immutable W4/W5 independent inventories; no acceptance inference.',
    'coreRoot': str(ROOT), 'nativeRoot': str(NATIVE), 'preservedManifests': preserved,
    'ownedRepairFiles': owned, 'existingCorePathsVerified': len(core), 'changedExistingPaths': sorted(changed),
    'addedPaths': sorted(added), 'unchangedNativePathsVerified': len(native), 'unexpectedChanges': [],
    'encodingHeaderIndexIssues': [], 'nativeModelRequestsByRepair': 0,
}
(HERE / 'w5-snapshot-renewal-source-hashes.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'ownedRepairFiles': len(owned), 'existingCorePathsVerified': len(core),
    'changedExistingPaths': len(changed), 'addedPaths': len(added), 'unchangedNativePathsVerified': len(native),
    'preservedManifests': len(preserved), 'inventorySha256': digest(HERE / 'w5-snapshot-renewal-source-hashes.json')}))
