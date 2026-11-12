"""Apply explicitly reviewed per-hunk choices; never choose whole directories."""
import hashlib
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
choices = iter(sys.argv[2].split(","))
content = path.read_text(encoding="utf-8")
pattern = re.compile(r"^<<<<<<<[^\n]*\n(.*?)^=======\n(.*?)^>>>>>>>[^\n]*\n", re.MULTILINE | re.DOTALL)
count = 0

def resolve(match):
    global count
    choice = next(choices)
    count += 1
    ours, theirs = match.groups()
    return {"ours": ours, "theirs": theirs, "union": ours + theirs,
            "union-close": ours + "    }\n\n" + theirs}[choice]

updated = pattern.sub(resolve, content)
assert next(choices, None) is None, "Too many hunk choices"
assert not re.search(r"^(<<<<<<<|=======|>>>>>>>)", updated, re.MULTILINE), "Unresolved marker"
path.write_text(updated, encoding="utf-8")
print(f"Resolved {count} reviewed hunks in {path}; preimage sha256={hashlib.sha256(content.encode()).hexdigest()}")
