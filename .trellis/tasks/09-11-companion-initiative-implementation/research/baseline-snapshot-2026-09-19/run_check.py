"""Record the exact command, output, duration and exit code of T4-only checks."""
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path('H:/TakiAgent-worktrees/t4').resolve()
assert Path.cwd().resolve() == ROOT
label, *command = sys.argv[1:]
started = datetime.now(timezone.utc).isoformat()
clock = time.monotonic()
logs = HERE / 'logs'
logs.mkdir(exist_ok=True)
effective = [command[0] + '.cmd', *command[1:]] if os.name == 'nt' and command[0] == 'pnpm' else command
result = subprocess.run(effective, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=ROOT)
elapsed = round(time.monotonic() - clock, 3)
output = result.stdout.decode('utf-8', errors='replace')
(logs / f'{label}.log').write_text(output, encoding='utf-8')
record = {'label': label, 'command': command, 'cwd': str(ROOT), 'startedAt': started, 'seconds': elapsed, 'exitCode': result.returncode,
          'log': f'logs/{label}.log'}
(HERE / f'check-{label}.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps(record, indent=2))
print('\n'.join(output.splitlines()[-55:]))
sys.exit(result.returncode)
