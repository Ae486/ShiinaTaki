"""Create an inert, authenticated native deployment without account/model setup."""

import os
import secrets
from dataclasses import fields
from pathlib import Path

from openbiliclaw.auth_core import hash_password
from openbiliclaw.config import Config, load_config, save_config


def ensure_operator_password(config: Config, root: Path) -> bool:
    """Complete the native auth contract without exposing a generated password."""
    if not config.api.auth.enabled or config.api.auth.password_hash:
        return False
    password = secrets.token_urlsafe(24)
    path = root / "operator-password"
    path.write_text(password, encoding="utf-8")
    path.chmod(0o600)
    config.api.auth.password_hash = hash_password(password)
    return True


def bootstrap() -> None:
    root = Path(os.environ["OPENBILICLAW_PROJECT_ROOT"])
    root.mkdir(parents=True, exist_ok=True)
    for name in ("data", "logs"):
        (root / name).mkdir(exist_ok=True)
    path = root / "config.toml"
    if path.exists():
        config = load_config(path)
        # Repair only this deployment's original empty-password bootstrap;
        # native PUT /api/config otherwise rejects every unrelated edit.
        if ensure_operator_password(config, root):
            save_config(config, path)
            path.chmod(0o600)
        return
    config = Config()
    config.api.auth.enabled = True
    config.api.auth.trust_loopback = False
    config.api.auth.session_secret = secrets.token_urlsafe(32)
    ensure_operator_password(config, root)
    config.llm.instance_routing = True
    config.llm.instances = {}
    config.llm.default_chain = []
    config.scheduler.enabled = False
    config.scheduler.source_incremental_enabled = False
    config.scheduler.profile_consolidation_enabled = False
    config.scheduler.auto_update_enabled = False
    config.bilibili.auth_method = "none"
    for field in fields(config.sources):
        source = getattr(config.sources, field.name)
        if hasattr(source, "enabled"):
            source.enabled = False
    save_config(config, path)
    path.chmod(0o600)


if __name__ == "__main__":
    bootstrap()
    # Bypass docker_runtime's optional host-proxy probing. Native startup owns
    # empty storage creation and truthfully reports the missing model registry.
    os.execvp("openbiliclaw", ["openbiliclaw", "serve-api", "--host", "0.0.0.0", "--port", "8420"])
