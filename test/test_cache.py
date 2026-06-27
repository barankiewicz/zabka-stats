import pytest
from unittest.mock import MagicMock, patch
import json
import backend.cache as bc

@pytest.fixture(autouse=True)
def mock_redis():
    with patch("backend.cache.cache") as mock_r:
        yield mock_r

def test_get_cache_hits(mock_redis):
    mock_redis.get.return_value = json.dumps({"test": "data"})
    result = bc.get_cache("some_key")
    assert result == {"test": "data"}
    mock_redis.get.assert_called_once_with("some_key")

def test_get_cache_miss(mock_redis):
    mock_redis.get.return_value = None
    result = bc.get_cache("some_key")
    assert result is None

def test_get_cache_exception(mock_redis):
    mock_redis.get.side_effect = Exception("Connection lost")
    result = bc.get_cache("some_key")
    assert result is None

def test_set_cache(mock_redis):
    bc.set_cache("some_key", {"a": 1}, ttl=500)
    mock_redis.setex.assert_called_once_with("some_key", 500, json.dumps({"a": 1}))

def test_clear_cache(mock_redis):
    # Mock scan behavior: first call returns cursor=1, keys=['k1'], second call returns cursor=0, keys=[]
    mock_redis.scan.side_effect = [
        (1, ["k1"]),
        (0, [])
    ]
    bc.clear_cache("pattern*")
    mock_redis.scan.assert_any_call(0, match="pattern*", count=100)
    mock_redis.delete.assert_called_once_with("k1")

@pytest.mark.anyio
async def test_cached_decorator(mock_redis):
    mock_redis.get.return_value = None  # Cache miss first
    call_count = 0

    @bc.cached(ttl=120)
    async def my_async_func(x, y=10):
        nonlocal call_count
        call_count += 1
        return {"result": x + y}

    # First invocation
    res = await my_async_func(5, y=15)
    assert res == {"result": 20}
    assert call_count == 1
    
    # Verify Redis set was called
    expected_key_data = {"args": [5], "kwargs": {"y": 15}}
    expected_key = f"my_async_func:{json.dumps(expected_key_data, sort_keys=True)}"
    mock_redis.setex.assert_called_once_with(expected_key, 120, json.dumps({"result": 20}))

    # Mock cache hit for subsequent calls
    mock_redis.get.return_value = json.dumps({"result": 20})
    res2 = await my_async_func(5, y=15)
    assert res2 == {"result": 20}
    assert call_count == 1  # Not incremented due to cache hit
