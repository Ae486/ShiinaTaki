"""Run bounded B6 closeout against the existing owned copy and model allowlist."""

from pathlib import Path

import run_d77_api_acceptance as baseline


def main() -> int:
    baseline.configure_supervisor("d77-b6-closeout.ts")
    baseline.supervisor.__file__ = str(Path(__file__).resolve())
    return baseline.supervisor.main()


if __name__ == "__main__":
    raise SystemExit(main())
