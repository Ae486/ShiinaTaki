"""Stdio-only process entry; no server bind, provider setup or native startup."""

import argparse
from pathlib import Path
import sys

from .config import BridgeConfig
from .contracts import BridgeError
from .openbili_config import OpenBiliConfig
from .openbili_contracts import OpenBiliError
from .server import create_server


def main():
    parser = argparse.ArgumentParser(description="Independent native media MCP bridge (stdio only)")
    parser.add_argument("--config", type=Path, required=True, help="Operator-owned non-secret bridge configuration")
    parser.add_argument("--openbili-config", type=Path,
        help="Optional independent OpenBili origin and token-environment reference (no secret values)")
    args = parser.parse_args()
    openbili = None
    if args.openbili_config is not None:
        try:
            openbili = OpenBiliConfig.from_file(args.openbili_config)
        except OpenBiliError:
            print("Optional OpenBili configuration is unavailable; its tools will report not configured", file=sys.stderr)
    try:
        config = BridgeConfig.from_file(args.config)
        server = create_server(config, openbili_config=openbili, enable_openbili=args.openbili_config is not None)
    except (BridgeError, OSError, ImportError):
        print("Bridge configuration or required SDK is unavailable", file=sys.stderr)
        raise SystemExit(2)
    server.run(transport="stdio")


if __name__ == "__main__":
    main()
