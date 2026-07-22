from __future__ import annotations

import sys
import time
from typing import TextIO


class ProgressReporter:
    """Prints workflow stages and a simple live progress line."""

    def __init__(self, stream: TextIO = sys.stdout):
        self.stream = stream
        self._active = False
        self.started_at = time.monotonic()

    def step(self, message: str) -> None:
        self._clear_line()
        elapsed = time.monotonic() - self.started_at
        print(f"[{elapsed:6.1f}s] {message}", file=self.stream, flush=True)

    def progress(self, current: int, total: int, label: str) -> None:
        total = max(total, 1)
        current = min(max(current, 0), total)
        percent = (current / total) * 100
        filled = int(percent // 5)
        bar = "#" * filled + "-" * (20 - filled)
        elapsed = time.monotonic() - self.started_at
        line = f"\r[{elapsed:6.1f}s] {label}: [{bar}] {current}/{total} ({percent:5.1f}%)"
        print(line, end="", file=self.stream, flush=True)
        self._active = True
        if current >= total:
            print(file=self.stream, flush=True)
            self._active = False

    def note(self, message: str) -> None:
        self._clear_line()
        elapsed = time.monotonic() - self.started_at
        print(f"[{elapsed:6.1f}s] {message}", file=self.stream, flush=True)

    def _clear_line(self) -> None:
        if self._active:
            print(file=self.stream, flush=True)
            self._active = False
