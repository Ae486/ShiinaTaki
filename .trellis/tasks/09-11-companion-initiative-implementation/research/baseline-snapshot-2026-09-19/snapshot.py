"""Frozen-object integration preparation and guarded working-tree application.

This task-local helper never writes a Git index, ref, or another worktree. Payload
contains byte-exact preimages; the small manifest retains provenance for review.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('H:/TakiAgent-worktrees/t4').resolve()
MAIN = Path('H:/TakiAgent').resolve()
HERE = Path(__file__).resolve().parent
PAYLOAD = HERE / 'payload'
MANIFEST = HERE / 'manifest.json'
SOURCE = '516e151ad1cbd298d07b95e7b4460833e55442f6'
BASE = 'c3f8bc4d0c061f67ac998cac0cd1b95a3e91f7fb'
HEAD = '06a8090118a45a8c4f06472be4917108f93aea44'


def git(*args: str, root: Path = ROOT) -> bytes:
    return subprocess.check_output(['git', '-C', str(root), *args])


def digest(data: bytes | None) -> str | None:
    return hashlib.sha256(data).hexdigest() if data is not None else None


def read(path: Path) -> bytes | None:
    return path.read_bytes() if path.is_file() else None


def put(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def save(data: dict) -> None:
    MANIFEST.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def files(root: Path) -> list[str]:
    return sorted(set(git('ls-files', '-z', '--cached', '--others', '--exclude-standard', root=root).decode().split('\0')) - {''})


def fingerprint(root: Path) -> dict:
    index = Path(git('rev-parse', '--git-path', 'index', root=root).decode().strip())
    if not index.is_absolute():
        index = root / index
    return {
        'head': git('rev-parse', 'HEAD', root=root).decode().strip(),
        'indexSha256': digest(read(index)),
        'status': git('status', '--porcelain=v1', '-uall', root=root).decode(),
        'files': {p: digest(read(root / p)) for p in files(root) if not str(root / p).startswith(str(HERE))},
    }


def blob_map(commit: str) -> dict[str, str]:
    result = {}
    for row in git('ls-tree', '-r', '-z', commit).split(b'\0'):
        if row:
            meta, path = row.split(b'\t', 1)
            mode, kind, oid = meta.split()
            if kind == b'blob':
                result[path.decode()] = oid.decode()
    return result


def blobs(oids: set[str]) -> dict[str, bytes]:
    ordered = sorted(oids)
    output = subprocess.check_output(['git', '-C', str(ROOT), 'cat-file', '--batch'], input=('\n'.join(ordered) + '\n').encode())
    result = {}
    offset = 0
    for oid in ordered:
        newline = output.index(b'\n', offset)
        size = int(output[offset:newline].split()[2])
        result[oid] = output[newline + 1:newline + 1 + size]
        offset = newline + 2 + size
    return result


def prepare() -> None:
    if MANIFEST.exists():
        raise RuntimeError('Refusing to replace existing preimages/manifest')
    assert git('rev-parse', 'HEAD').decode().strip() == HEAD
    assert git('merge-base', HEAD, SOURCE).decode().strip() == BASE
    paths = git('diff', '--name-only', '-z', BASE, SOURCE).decode().split('\0')[:-1]
    source_map, base_map = blob_map(SOURCE), blob_map(BASE)
    object_bytes = blobs({m[p] for m in (source_map, base_map) for p in paths if p in m})
    manifest = {'capturedAt': datetime.now(timezone.utc).isoformat(), 'source': SOURCE, 'base': BASE, 't4Head': HEAD,
                't4': fingerprint(ROOT), 'main': fingerprint(MAIN), 'entries': []}
    # Retain dirty and colliding untracked files independently of whether they
    # receive an incoming patch; ignored user data never enters this list.
    dirty = set(git('diff', '--name-only', '-z').decode().split('\0'))
    dirty.update(git('ls-files', '--others', '--exclude-standard', '-z').decode().split('\0'))
    for p in dirty - {''}:
        if not str(ROOT / p).startswith(str(HERE)):
            data = read(ROOT / p)
            if data is not None:
                put(PAYLOAD / 'dirty-preimages' / p, data)
    for p in paths:
        incoming = object_bytes[source_map[p]]
        ancestor = object_bytes[base_map[p]] if p in base_map else b''
        current = read(ROOT / p)
        for kind, data in [('incoming', incoming), ('base', ancestor), ('preimages', current)]:
            if data is not None:
                put(PAYLOAD / kind / p, data)
        entry = {'path': p, 'sourceBlob': source_map[p], 'baseBlob': base_map.get(p),
                 'sourceSha256': digest(incoming), 'baseSha256': digest(ancestor),
                 'preimageSha256': digest(current), 'originallyDirty': p in dirty}
        if p.endswith('/task.json') or p.startswith('.trellis/.current-task'):
            entry['state'] = 'protected-task-metadata'
        else:
            ours = (current or b'').replace(b'\r\n', b'\n')
            theirs = incoming.replace(b'\r\n', b'\n')
            common = ancestor.replace(b'\r\n', b'\n')
            if ours == theirs or theirs == common:
                merged, status = current or b'', 0
            elif ours == common or current is None:
                merged, status = theirs, 0
            else:
                for kind, data in [('ours', ours), ('theirs', theirs), ('common', common)]:
                    put(PAYLOAD / 'merge-input' / kind, data)
                result = subprocess.run(['git', 'merge-file', '-p', '--diff3', '-L', 'T4-current', '-L', 'common-base', '-L', 'pinned-main',
                                         str(PAYLOAD / 'merge-input/ours'), str(PAYLOAD / 'merge-input/common'), str(PAYLOAD / 'merge-input/theirs')], capture_output=True)
                if result.returncode < 0 or result.returncode > 127:
                    raise RuntimeError(f'Merge error {p}: {result.stderr.decode()}')
                merged, status = result.stdout, result.returncode
            put(PAYLOAD / 'candidates' / p, merged)
            entry['state'] = 'conflict' if status else 'ready'
            entry['candidateSha256'] = digest(merged)
        manifest['entries'].append(entry)
    save(manifest)
    print(json.dumps({'incoming': len(paths), 'states': {s: sum(e['state'] == s for e in manifest['entries']) for s in {e['state'] for e in manifest['entries']}},
                      'conflicts': [e['path'] for e in manifest['entries'] if e['state'] == 'conflict']}, indent=2))


def apply(selected: list[str]) -> None:
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    changed, concurrent = [], []
    for entry in manifest['entries']:
        p = entry['path']
        if selected and p not in selected:
            continue
        if entry['state'] not in ('ready', 'resolved'):
            continue
        current = read(ROOT / p)
        if digest(current) != entry['preimageSha256']:
            concurrent.append(p)
            continue
        candidate = (PAYLOAD / 'candidates' / p).read_bytes()
        if b'<<<<<<< T4-current' in candidate or b'>>>>>>> pinned-main' in candidate:
            raise RuntimeError(f'Conflict markers remain: {p}')
        if candidate != current:
            put(ROOT / p, candidate)
            changed.append(p)
        entry['state'] = 'applied' if candidate != current else 'unchanged'
        entry['appliedSha256'] = digest(candidate)
    save(manifest)
    print(json.dumps({'written': len(changed), 'concurrentRefusals': concurrent}, indent=2))


def verify() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    reports = {}
    for label, root in [('t4', ROOT), ('main', MAIN)]:
        before, after = manifest[label], fingerprint(root)
        reports[label] = {'headUnchanged': before['head'] == after['head'], 'indexUnchanged': before['indexSha256'] == after['indexSha256'],
                          'changedOriginalPaths': [p for p, h in before['files'].items() if h != after['files'].get(p)],
                          'newPaths': sorted(set(after['files']) - set(before['files']))}
    (HERE / 'preservation-check.json').write_text(json.dumps(reports, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: {**v, 'changedOriginalPaths': len(v['changedOriginalPaths']), 'newPaths': len(v['newPaths'])} for k, v in reports.items()}, indent=2))


if __name__ == '__main__':
    assert Path.cwd().resolve() == ROOT, 'T4 cwd required'
    {'prepare': prepare, 'apply': lambda: apply(sys.argv[2:]), 'verify': verify}[sys.argv[1]]()
