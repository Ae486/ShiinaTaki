"""Replay the reviewed pure audit while preserving its immutable prior output."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parent
    original = root / "w5-trigger-uuid-source-audit.py"
    manifest = json.loads(
        (root / "w5-trigger-uuid-source-manifest.json").read_text(encoding="utf-8")
    )
    expected = next(
        item
        for item in manifest["files"]
        if Path(item["path"]).resolve() == original.resolve()
    )
    raw = original.read_bytes()
    assert (
        len(raw) == expected["bytes"]
        and hashlib.sha256(raw).hexdigest() == expected["sha256"]
    )
    source = raw.decode("utf-8")
    old_output = '"w5-trigger-uuid-source-audit.json"'
    assert source.count(old_output) == 1
    # The existing audit only evaluates captured SQL and mock Alembic config.
    # Redirect its single evidence write; never invoke run_reviewed/clone code.
    source = source.replace(old_output, '"w5-candidate-combined-source-audit.json"')
    os.environ["PYTHON_DOTENV_DISABLED"] = "1"
    exec(
        compile(source, str(original), "exec"),
        {"__file__": str(original), "__name__": "__main__"},
    )


if __name__ == "__main__":
    main()
