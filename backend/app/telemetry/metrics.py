"""Process resource metrics without extra dependencies (psutil used if installed)."""

from __future__ import annotations

import os
import time

try:  # pragma: no cover - optional
    import psutil  # type: ignore

    _proc = psutil.Process()
except Exception:  # noqa: BLE001
    psutil = None
    _proc = None


class ResourceSampler:
    def __init__(self) -> None:
        self._last_cpu = time.process_time()
        self._last_wall = time.monotonic()
        if _proc is not None:
            _proc.cpu_percent(None)

    def sample(self) -> tuple[float | None, float | None]:
        if _proc is not None:
            return float(_proc.cpu_percent(None)), float(_proc.memory_info().rss / 1e6)
        cpu, wall = time.process_time(), time.monotonic()
        dc, dw = cpu - self._last_cpu, wall - self._last_wall
        self._last_cpu, self._last_wall = cpu, wall
        cpu_pct = (100.0 * dc / dw) if dw > 0 else None
        rss = None
        try:
            with open(f"/proc/{os.getpid()}/statm") as f:
                rss = int(f.read().split()[1]) * os.sysconf("SC_PAGE_SIZE") / 1e6
        except (OSError, ValueError, IndexError):
            pass
        return (round(cpu_pct, 1) if cpu_pct is not None else None), (round(rss, 1) if rss else None)
