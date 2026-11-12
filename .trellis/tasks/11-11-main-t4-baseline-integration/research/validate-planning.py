"""Check authored planning artifacts without staging or changing source."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
authored = [root / name for name in ["prd.md", "design.md", "implement.md", "implement.jsonl", "check.jsonl"]]
for path in authored:
    raw = path.read_bytes()
    assert not raw.startswith(b"\xef\xbb\xbf"), f"BOM: {path}"
    content = raw.decode("utf-8")
    assert content.endswith("\n"), f"Missing EOF newline: {path}"
    assert all(line == line.rstrip() for line in content.splitlines()), f"Trailing whitespace: {path}"
for name in ["implement.jsonl", "check.jsonl"]:
    entries = [json.loads(line) for line in (root / name).read_text(encoding="utf-8").splitlines()]
    assert entries and len({entry["file"] for entry in entries}) == len(entries), name
    for entry in entries:
        assert Path(entry["file"]).is_file(), f"Missing curated source: {entry['file']}"
print("Planning artifacts: UTF-8/no-BOM, EOF/whitespace, unique existing curated sources PASS")
