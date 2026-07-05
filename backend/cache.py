"""
Redis caching wrapper.
Uses UNIX socket for speed & security.
"""

import asyncio
import inspect
import json
import logging
import os
import re
import threading
from functools import wraps
from typing import Any

import redis

logger = logging.getLogger(__name__)

REDIS_SOCKET = os.getenv(
    "REDIS_SOCKET",
    "/run/redis/redis-server.sock"
)

try:
    cache = redis.Redis(
        unix_socket_path=REDIS_SOCKET,
        decode_responses=True,
        socket_timeout=5,
        socket_connect_timeout=5,
    )
    cache.ping()
    logger.info("Redis connected via socket")
except Exception as e:
    logger.warning(f"Redis not available: {e}")
    cache = None


def _json_default(o: Any) -> Any:
    """Make handler return values JSON-serializable for the cache.

    Endpoints return Pydantic models (or lists of them); json.dumps can't encode
    those, which is why caching was silently failing. model_dump(mode="json")
    produces the same plain structure Litestar serializes on a cache miss, so the
    cached (dict) and uncached (model) responses come out byte-identical.
    """
    md = getattr(o, "model_dump", None)
    if callable(md):
        return o.model_dump(mode="json")
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serializable")


def get_cache(key: str) -> Any | None:
    if not cache:
        return None
    try:
        val = cache.get(key)
        return json.loads(val) if val else None
    except Exception as e:
        logger.warning("Redis get error for key %r: %s", key, e)
        return None


def get_cached_blob(key: str) -> str | None:
    """Fetch a pre-serialized string payload (no JSON decode). For large, already
    JSON-encoded responses we cache the string and return it verbatim, skipping
    the parse + re-encode round-trip that get_cache/set_cache would force."""
    if not cache:
        return None
    try:
        return cache.get(key)
    except Exception as e:
        logger.warning("Redis get_blob error for key %r: %s", key, e)
        return None


def set_cached_blob(key: str, blob: str | bytes, ttl: int = 3600) -> None:
    if not cache:
        return
    try:
        cache.setex(key, ttl, blob)
    except Exception as e:
        logger.warning("Redis set_blob error for key %r: %s", key, e)


def set_cache(key: str, value: Any, ttl: int = 3600) -> None:
    if not cache:
        return
    try:
        payload = json.dumps(value, default=_json_default)
    except TypeError:
        # Not cacheable (e.g. a raw Litestar Response) - skip, recompute next time.
        return
    try:
        cache.setex(key, ttl, payload)
    except Exception as e:
        logger.warning("Redis set error for key %r: %s", key, e)


def clear_cache(pattern: str = "*") -> None:
    if not cache:
        return
    try:
        cursor = 0
        while True:
            cursor, keys = cache.scan(cursor, match=pattern, count=100)
            if keys:
                cache.delete(*keys)
            if cursor == 0:
                break
    except Exception as e:
        logger.warning("Redis clear_cache error (pattern=%r): %s", pattern, e)


_locks = {}
_locks_lock = threading.Lock()

def _get_lock(key: str) -> threading.Lock:
    with _locks_lock:
        if key not in _locks:
            _locks[key] = threading.Lock()
        return _locks[key]

_async_locks = {}
_async_locks_lock = threading.Lock()

def _get_async_lock(key: str) -> asyncio.Lock:
    with _async_locks_lock:
        if key not in _async_locks:
            _async_locks[key] = asyncio.Lock()
        return _async_locks[key]


def _safe_serialize(val: Any) -> Any:
    """Recursively serializes arguments, stripping memory addresses from representations to avoid cache misses."""
    if isinstance(val, (int, float, str, bool, type(None))):
        return val
    if isinstance(val, (list, tuple, set)):
        return [_safe_serialize(x) for x in val]
    if isinstance(val, dict):
        return {str(k): _safe_serialize(v) for k, v in sorted(val.items())}
    # Strip memory addresses from representation to ensure consistent cache keys
    return f"repr:{re.sub(r' at 0x[0-9a-fA-F]+', '', repr(val))}"


def _cache_key(func, args, kwargs) -> str:
    # Safely serialize positional and keyword arguments to avoid collision and TypeError
    args_serializable = [_safe_serialize(arg) for arg in args]
    kwargs_serializable = {k: _safe_serialize(v) for k, v in sorted(kwargs.items())}

    key_data = {
        "args": args_serializable,
        "kwargs": kwargs_serializable
    }
    return f"{func.__name__}:{json.dumps(key_data, sort_keys=True)}"


def cached(ttl: int = 3600):
    """Decorator to cache function results.

    Preserves whether the wrapped function is sync or async.
    Implements per-key locking to prevent cache stampedes / race conditions.
    """
    def decorator(func):
        from litestar import Response as LitestarResponse

        if inspect.iscoroutinefunction(func):
            @wraps(func)
            async def async_wrapper(*args, **kwargs):
                key = _cache_key(func, args, kwargs)
                cached_json = get_cached_blob(key)
                if cached_json is not None:
                    return LitestarResponse(content=cached_json, media_type="application/json")
                
                async with _get_async_lock(key):
                    # Double-check under lock
                    cached_json = get_cached_blob(key)
                    if cached_json is not None:
                        return LitestarResponse(content=cached_json, media_type="application/json")
                    result = await func(*args, **kwargs)
                    set_cache(key, result, ttl)
                    return result
            return async_wrapper

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            key = _cache_key(func, args, kwargs)
            cached_json = get_cached_blob(key)
            if cached_json is not None:
                return LitestarResponse(content=cached_json, media_type="application/json")
            
            with _get_lock(key):
                # Double-check under lock
                cached_json = get_cached_blob(key)
                if cached_json is not None:
                    return LitestarResponse(content=cached_json, media_type="application/json")
                result = func(*args, **kwargs)
                set_cache(key, result, ttl)
                return result
        return sync_wrapper
    return decorator
