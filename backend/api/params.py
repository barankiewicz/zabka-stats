"""Shared query-parameter validation and clamping for the API routers.

Two jobs here:

- validate_month: reject anything that is not YYYY-MM. An unvalidated month
  string flows straight into a Redis cache key (arbitrary strings inflate the
  keyspace) and into a strftime() comparison that forces a full scan on the
  locations table. Bounding it to the expected shape kills both.
- validate_year / clamp_limit / clamp_offset: keep numeric params inside sane
  bounds so a caller cannot ask for limit=100000000 or year=999999 and make the
  backend do pointless work.
"""

import re

from litestar.exceptions import HTTPException

_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")

# Widest range that can plausibly appear in this dataset. Zabka's first store
# opened in 1998; the upper bound leaves generous headroom without letting a
# nonsense year through.
_YEAR_MIN = 1990
_YEAR_MAX = 2100


def validate_month(month: str | None) -> str | None:
    """Return the month unchanged if it is YYYY-MM (or None), else raise 400."""
    if month is None:
        return None
    if not _MONTH_RE.match(month):
        raise HTTPException(status_code=400, detail="month must be in YYYY-MM format")
    return month


def validate_year(year: int | None) -> int | None:
    """Return the year unchanged if it falls in a sane range (or None), else 400."""
    if year is None:
        return None
    if year < _YEAR_MIN or year > _YEAR_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"year must be between {_YEAR_MIN} and {_YEAR_MAX}",
        )
    return year


def clamp_limit(limit: int, max_limit: int = 1000) -> int:
    """Clamp a pagination limit to [1, max_limit]."""
    return max(1, min(limit, max_limit))


def clamp_offset(offset: int) -> int:
    """Clamp a pagination offset to [0, inf)."""
    return max(0, offset)
