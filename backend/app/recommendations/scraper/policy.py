"""Access policy for the retailer connector. Every request goes through ``AccessPolicy.check``.

Layers, all of which must allow a URL:
1. Kill switch: ``CATALOG_CRAWL_ENABLED`` (default true) — set false to disable all automated access.
2. Allowed host + path prefixes we decided are appropriate (product pages, the public sitemap).
3. Hard-blocked paths regardless of robots.txt (APIs that returned 401, ajax endpoints, account/cart).
4. The live robots.txt for our User-Agent (fetched and cached; if it cannot be fetched, we do NOT crawl).
Rate limiting: one request at a time, >= max(min_interval, robots crawl-delay) seconds apart.
"""

from __future__ import annotations

import os
import threading
import time
import urllib.robotparser
from dataclasses import dataclass, field
from urllib.parse import urlparse

USER_AGENT = "AIHealthMirrorCatalogBot/0.2 (+https://github.com/EliasGhizUSFCA/HealthyHelper; portfolio project; product catalog only)"

ALLOWED_HOST = "www.ecosmetics.com"
ALLOWED_PREFIXES = ("/product/", "/wp-sitemap.xml", "/wp-sitemap-posts-product-", "/robots.txt")
BLOCKED_SUBSTRINGS = ("/wp-json/", "admin-ajax", "wc-ajax", "/wp-admin", "/my-account", "/cart", "/checkout", "/wp-login")


class AccessDenied(Exception):
    def __init__(self, url: str, reason: str):
        super().__init__(f"{reason}: {url}")
        self.url, self.reason = url, reason


@dataclass
class AccessPolicy:
    enabled: bool = field(default_factory=lambda: os.getenv("CATALOG_CRAWL_ENABLED", "true").lower() in {"1", "true", "yes"})
    min_interval_s: float = field(default_factory=lambda: float(os.getenv("CATALOG_MIN_INTERVAL_S", "2.0")))
    robots_ttl_s: float = 6 * 3600
    _robots: urllib.robotparser.RobotFileParser | None = None
    _robots_at: float = 0.0
    _robots_error: str | None = None
    _last_request: float = 0.0
    _lock: threading.Lock = field(default_factory=threading.Lock)

    # ------------------------------------------------------------------ robots
    def load_robots(self, fetch_text) -> None:
        """``fetch_text(url) -> (status, text)``; injected so tests can supply robots.txt content."""
        try:
            status, text = fetch_text(f"https://{ALLOWED_HOST}/robots.txt")
        except Exception as exc:  # noqa: BLE001
            self._robots, self._robots_error = None, f"robots.txt fetch failed: {exc}"
            return
        if status >= 400 and status != 404:
            self._robots, self._robots_error = None, f"robots.txt returned HTTP {status}"
            return
        rp = urllib.robotparser.RobotFileParser()
        rp.parse(text.splitlines() if status == 200 else [])
        self._robots, self._robots_at, self._robots_error = rp, time.time(), None

    def robots_fresh(self) -> bool:
        return self._robots is not None and time.time() - self._robots_at < self.robots_ttl_s

    def crawl_delay(self) -> float:
        d = self._robots.crawl_delay(USER_AGENT) if self._robots else None
        return max(self.min_interval_s, float(d or 0))

    # ------------------------------------------------------------------ checks
    def check(self, url: str) -> None:
        if not self.enabled:
            raise AccessDenied(url, "crawling disabled (CATALOG_CRAWL_ENABLED=false)")
        u = urlparse(url)
        if u.scheme != "https" or u.netloc != ALLOWED_HOST:
            raise AccessDenied(url, "host not allowed")
        path = u.path + (("?" + u.query) if u.query else "")
        if any(b in path for b in BLOCKED_SUBSTRINGS):
            raise AccessDenied(url, "path blocked by connector policy")
        if not any(u.path.startswith(p) for p in ALLOWED_PREFIXES):
            raise AccessDenied(url, "path outside the connector's permitted scope")
        if u.path == "/robots.txt":
            return
        if self._robots is None:
            raise AccessDenied(url, self._robots_error or "robots.txt not loaded")
        if not self._robots.can_fetch(USER_AGENT, url):
            raise AccessDenied(url, "disallowed by robots.txt")

    def wait_turn(self) -> float:
        """Block until we may send the next request; returns seconds waited."""
        with self._lock:
            now = time.monotonic()
            wait = max(0.0, self._last_request + self.crawl_delay() - now)
            if wait:
                time.sleep(wait)
            self._last_request = time.monotonic()
            return wait

    def describe(self) -> dict:
        return {
            "enabled": self.enabled, "host": ALLOWED_HOST, "user_agent": USER_AGENT, "allowed_prefixes": list(ALLOWED_PREFIXES),
            "blocked": list(BLOCKED_SUBSTRINGS), "min_interval_s": self.crawl_delay() if self._robots else self.min_interval_s,
            "robots_loaded": self._robots is not None, "robots_error": self._robots_error,
            "review": "docs/data-sources/ecosmetics.md",
        }
