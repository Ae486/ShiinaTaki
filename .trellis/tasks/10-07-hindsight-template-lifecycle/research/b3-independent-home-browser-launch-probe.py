"""Isolate the installed browser launch from Core, Vite and application navigation."""

from __future__ import annotations

import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import traceback

ROOT = Path(__file__).resolve().parents[4]
BROWSERS = {
    "full": Path("G:/AppDataMove/ms-playwright/chromium-1181/chrome-win/chrome.exe"),
    "headless-shell": Path("G:/AppDataMove/ms-playwright/chromium_headless_shell-1181/chrome-win/headless_shell.exe"),
}


def main() -> int:
    name = sys.argv[1]
    executable = BROWSERS[name]
    temporary_root = Path(os.environ["TEMP"]).resolve()
    owned_parent = (ROOT / ".trellis/.runtime/b3-independent-home").resolve()
    if not temporary_root.is_relative_to(owned_parent):
        raise ValueError("The diagnostic requires the independent Home runner's owned temporary root")
    # Playwright logs launch, exit and profile cleanup while retaining its normal arguments and protocol.
    os.environ["DEBUG"] = "pw:browser"
    from playwright.sync_api import sync_playwright

    print(json.dumps({
        "probe": name,
        "executable": str(executable),
        "executableSha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
        "probeSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "playwrightVersion": importlib.metadata.version("playwright"),
        "temporaryRoot": str(temporary_root),
        "networkNavigation": False,
    }), flush=True)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=str(executable), headless=True, timeout=15_000)
            try:
                page = browser.new_page()
                page.set_content("<!doctype html><title>Owned launch probe</title><button>Ready</button>")
                assert page.get_by_role("button", name="Ready", exact=True).is_visible()
                print(json.dumps({"verdict": "BROWSER_LAUNCH_PASS", "browserVersion": browser.version}), flush=True)
            finally:
                browser.close()
        return 0
    except Exception:
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
