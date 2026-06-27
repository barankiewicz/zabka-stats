"""
Redis caching wrapper.
Uses UNIX socket for speed & security.
"""

import json
import logging
import os
from functools import wraps
from typing import Any

import redis

logger = logging.getLogger(__name__)

REDIS_SOCKET = os.getenv(
    "REDIS_SOCKET",
    "/usr/local/redis/sockets/server441858.sock"
)

try:
    cache = redis.Redis(
        unix_socket_path=REDIS_SOCKET,
        decode_responses=True,
        socket_timeout=5,
        socket_connect_timeout=5,
    )
    cache.ping()
    print(" Redis connected via socket")
except Exception as e:
    print(f"  Redis not available: {e}")
    cache = None


def get_cache(key: str) -> Any | None:
    if not cache:
        return None
    try:
        val = cache.get(key)
        return json.loads(val) if val else None
    except Exception as e:
        logger.warning("Redis get error for key %r: %s", key, e)
        return None


def set_cache(key: str, value: Any, ttl: int = 3600) -> None:
    if not cache:
        return
    try:
        cache.setex(key, ttl, json.dumps(value))
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


def cached(ttl: int = 3600):
    """Decorator to cache function results."""
    def decorator(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            # Serialize serializable positional arguments and sorted keyword arguments
            args_serializable = [arg for arg in args if isinstance(arg, (int, float, str, bool, type(None)))]
            key_data = {
                "args": args_serializable,
                "kwargs": {k: v for k, v in sorted(kwargs.items())}
            }
            key = f"{func.__name__}:{json.dumps(key_data, sort_keys=True)}"
            cached_val = get_cache(key)
            if cached_val is not None:
                return cached_val
            result = await func(*args, **kwargs)
            set_cache(key, result, ttl)
            return result
        return async_wrapper
    return decorator
