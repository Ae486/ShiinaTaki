"""Compare captured source bytes immediately before each owned integration edit."""
import json
from snapshot import ROOT, HERE, MANIFEST, PAYLOAD, digest, read, put, save


def edit(path, transform):
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    entry = next((e for e in manifest['entries'] if e['path'] == path), None)
    extras = manifest.setdefault('additionalEdits', {})
    current = read(ROOT / path)
    expected = entry.get('appliedSha256', entry['preimageSha256']) if entry else extras.get(path, {}).get('appliedSha256', manifest['t4']['files'].get(path))
    if digest(current) != expected:
        raise RuntimeError(f'Concurrent change; re-evaluate before writing: {path}')
    if entry is None and path not in extras:
        if current is not None:
            put(PAYLOAD / 'preimages' / path, current)
        extras[path] = {'preimageSha256': digest(current)}
    changed = transform((current or b'').decode('utf-8').replace('\r\n', '\n')).encode('utf-8')
    if read(ROOT / path) != current:
        raise RuntimeError(f'Concurrent write during transform: {path}')
    put(ROOT / path, changed)
    target = entry if entry else extras[path]
    target['appliedSha256'] = digest(changed)
    target['semanticEdit'] = True
    save(manifest)
    print(path)


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise RuntimeError(f'Expected one match, got {source.count(old)}: {old[:100]}')
    return source.replace(old, new, 1)
