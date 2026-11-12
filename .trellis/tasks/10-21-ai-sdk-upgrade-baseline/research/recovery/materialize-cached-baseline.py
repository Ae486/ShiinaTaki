"""Copy only integrity-checked published runtime files; never install or edit the workspace graph."""
import base64
import hashlib
import json
from pathlib import Path

EVIDENCE = Path(__file__).resolve().parent
STORE = Path('G:/Roaming/pnpm-store/v10')
DESTINATION = EVIDENCE / 'abort-baseline' / 'node_modules'
PACKAGES = {
    'ai': '7.0.17',
    '@ai-sdk/openai-compatible': '3.0.5',
    '@ai-sdk/provider': '4.0.2',
    '@ai-sdk/provider-utils': '5.0.5',
    '@ai-sdk/gateway': '4.0.13',
}

records = []
for name, version in PACKAGES.items():
    index_path = next(STORE.glob(f'index/*/*-{name.replace("/", "+")}@{version}.json'))
    index = json.loads(index_path.read_text())
    assert (index['name'], index['version']) == (name, version)
    for relative, metadata in index['files'].items():
        if relative != 'package.json' and not (relative.startswith('dist/') and relative.endswith('.js')):
            continue
        expected = base64.b64decode(metadata['integrity'].split('-', 1)[1]).hex()
        cached = STORE / 'files' / expected[:2] / expected[2:]
        data = cached.read_bytes()
        assert hashlib.sha512(data).hexdigest() == expected
        destination = DESTINATION / name / relative
        assert destination.resolve().is_relative_to(DESTINATION.resolve())
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            assert destination.read_bytes() == data
        else:
            destination.write_bytes(data)
        records.append({'package': name, 'version': version, 'file': relative,
                        'integrity': metadata['integrity']})

(EVIDENCE / 'abort-baseline' / 'cached-integrity.json').write_text(
    json.dumps({'source': str(STORE), 'files': records}, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'packages': PACKAGES, 'copiedRuntimeFiles': len(records), 'network': False,
                  'install': False, 'lifecycleScripts': False}))
