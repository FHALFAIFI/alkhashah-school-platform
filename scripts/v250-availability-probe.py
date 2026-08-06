#!/usr/bin/env python3
"""Sample production availability across the container swap, to measure real interruption.

Polls /api/health at ~0.25 s resolution and records, per sample, the monotonic offset, the
HTTP status (or the transport error) and the reported version. The version field is what makes
the swap visible in the trace: the last 2.4.1 sample and the first 2.5.0 sample bracket the
downtime exactly.

Usage: python3 scripts/v250-availability-probe.py <seconds> <outfile>
"""
import json
import sys
import time
import urllib.error
import urllib.request

URL = "http://127.0.0.1:3080/api/health"
INTERVAL = 0.25


def main() -> None:
    duration = float(sys.argv[1]) if len(sys.argv) > 1 else 120.0
    outfile = sys.argv[2] if len(sys.argv) > 2 else "availability.log"
    start = time.monotonic()
    with open(outfile, "w", encoding="utf-8") as fh:
        while time.monotonic() - start < duration:
            offset = time.monotonic() - start
            try:
                with urllib.request.urlopen(URL, timeout=2) as resp:
                    body = json.loads(resp.read().decode("utf-8"))
                line = f"{offset:8.3f} UP   {resp.status} version={body.get('version')} db={body.get('db')}"
            except urllib.error.HTTPError as exc:
                line = f"{offset:8.3f} DOWN http-{exc.code}"
            except Exception as exc:  # connection refused / reset / timeout
                line = f"{offset:8.3f} DOWN {type(exc).__name__}: {exc}"
            fh.write(line + "\n")
            fh.flush()
            time.sleep(INTERVAL)


if __name__ == "__main__":
    main()
