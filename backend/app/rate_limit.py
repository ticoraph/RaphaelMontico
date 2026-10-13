"""In-memory sliding-window rate limiting, used as FastAPI route dependencies.

State lives in the process: with several App Runner instances each one enforces its
own limits (so the effective ceiling is limit x instances). That's an accepted
trade-off for a small portfolio API; the global bucket is the cost safety net.
"""

import math
import time
from collections import deque
from collections.abc import Awaitable, Callable

from fastapi import HTTPException, Request

from app.config import get_settings

_MINUTE = 60
_HOUR = 3600
_MAX_TRACKED_KEYS = 10_000

# key -> timestamps (monotonic) of recent accepted requests.
_hits: dict[str, deque[float]] = {}


def reset() -> None:
    """Forget all counters (tests)."""
    _hits.clear()


def client_ip(request: Request) -> str:
    """The caller's IP, trusting only the proxies we actually run behind.

    `X-Forwarded-For` is appended to by each proxy, so its left side is whatever the
    client chose to send. We read the entry added by our own outermost proxy:
    `TRUSTED_PROXY_HOPS` entries from the right (0 = no proxy, ignore the header).
    """
    hops = get_settings().trusted_proxy_hops
    forwarded = [
        part.strip()
        for part in request.headers.get("x-forwarded-for", "").split(",")
        if part.strip()
    ]
    if hops > 0 and len(forwarded) >= hops:
        return forwarded[-hops]
    return request.client.host if request.client else "unknown"


def _purge(now: float) -> None:
    stale = [key for key, hits in _hits.items() if not hits or now - hits[-1] > _HOUR]
    for key in stale:
        del _hits[key]


def _hit(key: str, windows: list[tuple[int, int]], now: float) -> int | None:
    """Records a request unless a window is full. Returns the seconds to wait when
    the request is over the limit, else None."""
    if len(_hits) > _MAX_TRACKED_KEYS:
        _purge(now)

    hits = _hits.setdefault(key, deque())
    longest = max(seconds for _, seconds in windows)
    while hits and now - hits[0] > longest:
        hits.popleft()

    for max_requests, seconds in windows:
        recent = [t for t in hits if now - t <= seconds]
        if len(recent) >= max_requests:
            return max(1, math.ceil(seconds - (now - recent[0])))

    hits.append(now)
    return None


def rate_limited(
    bucket: str,
    *,
    per_minute: str,
    per_hour: str | None = None,
    global_per_hour: str | None = None,
) -> Callable[[Request], Awaitable[None]]:
    """Builds a dependency enforcing per-IP limits, plus an optional all-callers hourly
    cap. Arguments are *names* of Settings fields, read on each call."""

    async def dependency(request: Request) -> None:
        settings = get_settings()
        now = time.monotonic()

        windows = [(getattr(settings, per_minute), _MINUTE)]
        if per_hour:
            windows.append((getattr(settings, per_hour), _HOUR))
        retry_after = _hit(f"{bucket}:{client_ip(request)}", windows, now)

        if retry_after is None and global_per_hour:
            cap = getattr(settings, global_per_hour)
            retry_after = _hit(f"{bucket}:*", [(cap, _HOUR)], now)

        if retry_after is not None:
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Please try again later.",
                headers={"Retry-After": str(retry_after)},
            )

    return dependency


limit_chat = rate_limited(
    "chat",
    per_minute="chat_rate_limit_per_minute",
    per_hour="chat_rate_limit_per_hour",
    global_per_hour="chat_global_limit_per_hour",
)
limit_search = rate_limited(
    "search",
    per_minute="search_rate_limit_per_minute",
    per_hour="search_rate_limit_per_hour",
)
limit_index_status = rate_limited("index-status", per_minute="index_status_rate_limit_per_minute")
