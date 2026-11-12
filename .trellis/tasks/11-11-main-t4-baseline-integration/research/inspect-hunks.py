"""Print specific unresolved hunks with explicit UTF-8 and bounded selection."""
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

path = Path(sys.argv[1])
blocks = re.findall(r"^<<<<<<<[^\n]*\n(.*?)^=======\n(.*?)^>>>>>>>[^\n]*\n", path.read_text(encoding="utf-8"), re.MULTILINE | re.DOTALL)
selected = {int(part) for part in sys.argv[2].split(",")} if len(sys.argv) > 2 else set(range(1, len(blocks) + 1))
for number, (ours, theirs) in enumerate(blocks, 1):
    if number in selected:
        print(f"HUNK {number}\nOURS:\n{ours}\nTHEIRS:\n{theirs}")
