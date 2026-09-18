"""Run D77 acceptance through the previously verified owned-process supervisor."""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

from prepare_d77_owner_acceptance import HELPERS, ROOT, require_plain

sys.path.insert(0, str(HELPERS))
import run_real_hindsight as supervisor  # noqa: E402


def owned_root(value: str) -> Path:
    path = Path(value).absolute()
    if path != ROOT or not (path / "preparation-result.json").is_file():
        raise RuntimeError("D77_ACCEPTANCE_ROOT_REFUSED")
    require_plain(path)
    if not (path / "validation.sqlite").is_file():
        raise RuntimeError("D77_ACCEPTANCE_COPY_MISSING")
    return path


def main() -> int:
    # Adapt only the owned directory and consumer entry. The established Job,
    # cancellation, privacy, observer and exact-PG shutdown implementations run
    # unchanged. The private shim contains a file URL, never credentials/data.
    directory = ROOT / "consumer-entry"
    directory.mkdir(exist_ok=True)
    entry = Path(__file__).with_name("d77-owner-acceptance.ts").as_uri()
    shim = directory / "current-cutover-real-data.ts"
    value = f'import "{entry}";\n'
    if shim.exists() and shim.read_text(encoding="utf-8") != value:
        raise RuntimeError("D77_ACCEPTANCE_CONSUMER_CHANGED")
    if not shim.exists():
        shim.write_text(value, encoding="utf-8")
    supervisor.owned_root = owned_root
    supervisor.SCRIPT_DIR = directory
    supervisor.__file__ = str(Path(__file__).resolve())
    original_environment = supervisor.model_environment

    def model_environment(root: Path) -> dict[str, str]:
        environment = original_environment(root)
        cache = ROOT.parents[1] / "b6-continuation-20260911/tokenizer-cache"
        asset = cache / "9b5ad71b2ce5302211f9c61530b329a4922fc6a4"
        if (
            hashlib.sha256(asset.read_bytes()).hexdigest()
            != "223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7"
        ):
            raise RuntimeError("D77_ACCEPTANCE_TOKENIZER_ASSET_CHANGED")
        environment["TIKTOKEN_CACHE_DIR"] = str(cache)
        return environment

    supervisor.model_environment = model_environment
    return supervisor.main()


if __name__ == "__main__":
    raise SystemExit(main())
