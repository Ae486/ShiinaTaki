"""Run one native `hindsight-admin` command for the restore drill under the same loopback-only egress guard as the API.

INPUT:  argv after the script name (the admin command and its options), env TAKI_SMOKE_ALLOWED_PORTS /
        TAKI_SMOKE_EGRESS_LOG and the ordinary HINDSIGHT_API_* settings supplied by the harness (PYTHON_DOTENV_DISABLED=1)
OUTPUT: the unmodified native admin CLI (hindsight_api.admin.cli.main) exit status; refused egress lands in the egress log
POS:    09-25-hindsight-backup-restore W6 drill only; never imported by product code
"""

from __future__ import annotations

import sys

from native_launcher import install_guard


def main() -> None:
    sys.modules["winloop"] = None  # type: ignore[assignment]
    install_guard()
    from hindsight_api.admin.cli import main as admin_main

    sys.argv = ["hindsight-admin", *sys.argv[1:]]
    admin_main()


if __name__ == "__main__":
    main()
