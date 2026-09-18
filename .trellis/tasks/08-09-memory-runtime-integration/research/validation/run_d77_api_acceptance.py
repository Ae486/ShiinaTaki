"""Run the approved API comparison through the existing owned-process supervisor."""

from __future__ import annotations

import sys
from pathlib import Path

from d77_siliconflow_api import HELPERS, ROOT
from d77_api_runtime_environment import (
    extended_guard,
    model_environment,
    observe_siliconflow,
)
from prepare_d77_owner_acceptance import require_plain

sys.path.insert(0, str(HELPERS))
import run_real_hindsight as supervisor  # noqa: E402


def owned_root(value: str) -> Path:
    root = Path(value).absolute()
    if root != ROOT or not (root / "preparation-result.json").is_file():
        raise RuntimeError("D77_API_ACCEPTANCE_ROOT_REFUSED")
    require_plain(root)
    if not (root / "validation.sqlite").is_file():
        raise RuntimeError("D77_API_ACCEPTANCE_COPY_MISSING")
    return root


def configure_supervisor(consumer: str = "d77-api-acceptance.ts") -> None:
    if consumer not in ("d77-api-acceptance.ts", "d77-b6-closeout.ts"):
        raise RuntimeError("D77_API_CONSUMER_REFUSED")
    directory = ROOT / (
        "consumer-entry" if consumer == "d77-api-acceptance.ts" else "b6-closeout-entry"
    )
    directory.mkdir(exist_ok=True)
    shim = directory / "current-cutover-real-data.ts"
    value = f'import "{Path(__file__).with_name(consumer).as_uri()}";\n'
    if shim.exists() and shim.read_text(encoding="utf-8") != value:
        raise RuntimeError("D77_API_CONSUMER_CHANGED")
    if not shim.exists():
        shim.write_text(value, encoding="utf-8")
    original_clean = supervisor.clean_environment
    original_observer = supervisor.observe_model_calls

    def clean_environment(root: Path) -> dict[str, str]:
        environment = original_clean(root)
        if root == ROOT:
            environment["TAKI_D77_ACCEPTANCE_ROOT"] = str(ROOT)
        return environment

    def observe(root: Path) -> None:
        original_observer(root)
        observe_siliconflow(root)

    supervisor.owned_root = owned_root
    supervisor.SCRIPT_DIR = directory
    supervisor.__file__ = str(Path(__file__).resolve())
    supervisor.model_environment = model_environment
    supervisor.clean_environment = clean_environment
    supervisor.install_guard = extended_guard
    supervisor.observe_model_calls = observe


def main() -> int:
    configure_supervisor()
    return supervisor.main()


if __name__ == "__main__":
    raise SystemExit(main())
