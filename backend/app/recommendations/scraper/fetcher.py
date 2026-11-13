"""Polite HTTP fetcher: policy-checked, rate-limited, retried, circuit-broken, and fully logged."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass

import httpx

from app.recommendations.scraper.policy import USER_AGENT, AccessDenied, AccessPolicy


@dataclass
class FetchResult:
    url: str
    status: int
    text: str
    elapsed_ms: float
    waited_s: float
    from_cache: bool = False


class CircuitOpen(Exception):
    pass


class PoliteFetcher:
    def __init__(self, policy: AccessPolicy, log: Callable[[dict], None] | None = None, client: httpx.Client | None = None,
                 max_retries: int = 2, breaker_threshold: int = 3, sleep: Callable[[float], None] = time.sleep, max_backoff_s: float = 600.0):
        self.policy = policy
        self.log = log or (lambda _e: None)
        self.client = client or httpx.Client(timeout=httpx.Timeout(20.0, connect=10.0), follow_redirects=False,
                                             headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xml;q=0.9"})
        self.max_retries = max_retries
        self.breaker_threshold = breaker_threshold
        self._consecutive_blocks = 0
        self.sleep = sleep
        self.max_backoff_s = max_backoff_s

    def _backoff_seconds(self, retry_after: str | None) -> float:
        """Honour Retry-After (seconds or HTTP date); otherwise exponential: 30 s, 60 s, 120 s … (capped)."""
        if retry_after:
            try:
                return min(self.max_backoff_s, max(0.0, float(retry_after)))
            except ValueError:
                from email.utils import parsedate_to_datetime

                try:
                    return min(self.max_backoff_s, max(0.0, parsedate_to_datetime(retry_after).timestamp() - time.time()))
                except (TypeError, ValueError):
                    pass
        return min(self.max_backoff_s, 30.0 * 2 ** (self._consecutive_blocks - 1))

    def ensure_robots(self) -> None:
        if not self.policy.robots_fresh():
            def fetch_text(url):
                self.policy.wait_turn()
                t0 = time.perf_counter()
                r = self.client.get(url)
                self.log({"url": url, "kind": "robots", "status": r.status_code, "outcome": "ok" if r.status_code < 400 else "http_error",
                          "elapsed_ms": (time.perf_counter() - t0) * 1000, "bytes": len(r.content)})
                return r.status_code, r.text
            self.policy.load_robots(fetch_text)

    def get(self, url: str, kind: str) -> FetchResult:
        if self._consecutive_blocks >= self.breaker_threshold:
            raise CircuitOpen("stopped after repeated 403/429 responses — the site may be rate-limiting us")
        self.ensure_robots()
        try:
            self.policy.check(url)
        except AccessDenied as exc:
            self.log({"url": url, "kind": kind, "status": None, "outcome": "denied_by_policy", "error": exc.reason})
            raise
        attempt = 0
        while True:
            waited = self.policy.wait_turn()
            t0 = time.perf_counter()
            try:
                r = self.client.get(url)
            except httpx.HTTPError as exc:
                ms = (time.perf_counter() - t0) * 1000
                self.log({"url": url, "kind": kind, "status": None, "outcome": "network_error", "error": f"{type(exc).__name__}: {exc}", "elapsed_ms": ms})
                if attempt >= self.max_retries:
                    raise
                attempt += 1
                time.sleep(2 ** attempt)
                continue
            ms = (time.perf_counter() - t0) * 1000
            if r.status_code in (403, 429):
                self._consecutive_blocks += 1
                retry_after = r.headers.get("retry-after")
                self.log({"url": url, "kind": kind, "status": r.status_code, "outcome": "rate_limited" if r.status_code == 429 else "forbidden",
                          "error": f"retry-after={retry_after}", "elapsed_ms": ms})
                # Never try to get around a block. Stop entirely once the breaker opens; otherwise slow down for the
                # rest of the run (double the spacing, up to 30 s) and wait out Retry-After before the next request.
                if self._consecutive_blocks >= self.breaker_threshold:
                    raise CircuitOpen(f"HTTP {r.status_code} from retailer (after {self._consecutive_blocks} consecutive blocks)")
                self.policy.min_interval_s = min(30.0, max(5.0, self.policy.min_interval_s * 2))
                wait = self._backoff_seconds(retry_after)
                self.log({"url": url, "kind": "backoff", "status": r.status_code, "outcome": "backing_off",
                          "error": f"sleeping {wait:.0f}s; request spacing now {self.policy.min_interval_s:.0f}s"})
                self.sleep(wait)
                raise httpx.HTTPStatusError(f"HTTP {r.status_code}", request=r.request, response=r)
            if r.status_code >= 500 and attempt < self.max_retries:
                self.log({"url": url, "kind": kind, "status": r.status_code, "outcome": "server_error_retry", "elapsed_ms": ms})
                attempt += 1
                time.sleep(2 ** attempt)
                continue
            self._consecutive_blocks = 0
            outcome = "ok" if r.status_code == 200 else ("redirect_not_followed" if 300 <= r.status_code < 400 else "http_error")
            self.log({"url": url, "kind": kind, "status": r.status_code, "outcome": outcome, "elapsed_ms": ms, "bytes": len(r.content), "waited_s": waited})
            return FetchResult(url, r.status_code, r.text, ms, waited)
