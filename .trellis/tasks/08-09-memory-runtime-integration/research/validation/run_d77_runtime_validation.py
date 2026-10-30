"""Run the D77 native/SQLite integration through the existing owned PG and HTTP guards."""

from __future__ import annotations

import hashlib
import runpy
import sys
from pathlib import Path


def main() -> int:
    root = Path(__file__).resolve().parent.parents[4]
    harness_path = root / ".trellis/tasks/09-07-hindsight-recovery-evidence/research/validation/run_isolated_hindsight.py"
    cache = root / ".trellis/.runtime/b6-continuation-20260911/tokenizer-cache"
    asset = cache / "9b5ad71b2ce5302211f9c61530b329a4922fc6a4"
    expected = "223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7"
    if not asset.is_file() or hashlib.sha256(asset.read_bytes()).hexdigest() != expected:
        raise RuntimeError("The prevalidated owned BPE fixture asset is missing or changed")
    harness = runpy.run_path(str(harness_path))
    clean = harness["clean_environment"]

    def environment() -> dict[str, str]:
        value = clean()
        value["TIKTOKEN_CACHE_DIR"] = str(cache)
        return value

    harness["main"].__globals__["clean_environment"] = environment
    selectors = sys.argv[1:] or ["tests/native_results/test_d77_runtime_consumer.py", "-q", "--tb=short"]
    sys.argv = [str(harness_path), "--allow-http-fixture", "--", *selectors]
    return harness["main"]()


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
