import time


def now_ms() -> float:
    """Wall-clock epoch milliseconds (comparable with browser timeOrigin + performance.now())."""
    return time.time() * 1000.0


def perf_ms() -> float:
    return time.perf_counter() * 1000.0
