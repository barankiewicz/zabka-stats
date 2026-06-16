"""
Redis caching wrapper.
Uses UNIX socket for speed & security.
"""

import redis
import json
import os
from functools import wraps

# Connect via UNIX socket
REDIS_SOCKET = os.getenv(
    "REDIS_SOCKET",
    "/usr/local/redis/sockets/server441858.sock"
)

try:
    cache = redis.Redis(unix_socket_path=REDIS_SOCKET, decode_responses=True)
    cache.ping()
    print(" Redis connected via socket")
except Exception as e:
    print(f"  Redis not available: {e}")
    cache = None

def get_cache(key: str):
    """Get value from cache."""
    if not cache:
        return None
    try:
        val = cache.get(key)
        return json.loads(val) if val else None
    except:
        return None

def set_cache(key: str, value, ttl: int = 3600):
    """Set value in cache with TTL (seconds)."""
    if not cache:
        return
    try:
        cache.setex(key, ttl, json.dumps(value))
    except:
        pass

def clear_cache(pattern: str = "*"):
    """Clear cache entries matching pattern."""
    if not cache:
        return
    try:
        keys = cache.keys(pattern)
        if keys:
            cache.delete(*keys)
    except:
        pass

def cached(ttl: int = 3600):
    """Decorator to cache function results."""
    def decorator(func):
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            # Build cache key
            key = f"{func.__name__}:{json.dumps({**kwargs})}"

            # Try cache
            cached_val = get_cache(key)
            if cached_val is not None:
                return cached_val

            # Execute function
            result = await func(*args, **kwargs)

            # Cache result
            set_cache(key, result, ttl)
            return result

        return async_wrapper
    return decorator
