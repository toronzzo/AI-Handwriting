"""Wait out DeepSeek peak windows for non-urgent batch jobs.

Peak is 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday (2x price).
``./bin/offpeak.sh`` prints the current window.
``./bin/offpeak.sh --wait -- <command>`` sleeps until off-peak, then runs the command.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import datetime

from agent_drive.deepseek import is_peak, next_offpeak, now_utc, rate_window


def wait_until_offpeak(now=None, sleep=None) -> None:
    """Block while DeepSeek peak pricing is in effect. Returns immediately off-peak."""
    clock = now or now_utc
    pause = sleep or time.sleep
    while is_peak(clock()):
        nxt = next_offpeak(clock())
        delay = (nxt - clock()).total_seconds()
        if delay <= 0:
            delay = 1
        print(
            f"DeepSeek peak until {nxt.strftime('%Y-%m-%dT%H:%M:%SZ')}. Waiting {delay:.0f}s.",
            file=sys.stderr,
        )
        pause(delay)


def status_line(moment: datetime | None = None) -> str:
    moment = moment or now_utc()
    window = rate_window(moment)
    if window == "off-peak":
        return f"{moment.strftime('%Y-%m-%dT%H:%M:%SZ')} off-peak (1x). DeepSeek cache-hit input is 50x cheaper than a miss."
    nxt = next_offpeak(moment)
    return (
        f"{moment.strftime('%Y-%m-%dT%H:%M:%SZ')} peak (2x) until {nxt.strftime('%Y-%m-%dT%H:%M:%SZ')}. "
        "Weekday peak is 01:00-04:00 and 06:00-10:00 UTC."
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Show DeepSeek peak status, or wait until off-peak.")
    parser.add_argument("--wait", action="store_true", help="Sleep until off-peak, then run the command.")
    parser.add_argument("cmd", nargs="*", help="Command to run after the wait. Use -- before the command.")
    args = parser.parse_args(argv)
    command = list(args.cmd)
    if command[:1] == ["--"]:
        command = command[1:]
    print(status_line(), file=sys.stderr)
    if args.wait:
        wait_until_offpeak()
    if not command:
        return 0
    os.execvp(command[0], command)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
