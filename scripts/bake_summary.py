"""Bake the current /api/stats/summary values into the frontend build.

The dashboard hero, FAQ, methodology, and og-image copy all use {{STAT_*}}
placeholders in the HTML. At runtime they're resolved from M.summary,
populated by /api/stats/summary - but on a fast refresh the user can see
the raw {{TOKEN}} for a moment before JS swaps the placeholders out. To
kill that flash, the build pre-bakes the current values into a small
JSON file, and a Vite plugin inlines it as window.__BAKED_SUMMARY in
<head>. main.js reads it synchronously before translateDOM() runs, so
the placeholders resolve on the first pass with no visible flash.

Runtime /api/stats/summary is still fetched and overwrites M.summary on
its own (loadCore in main.js), so any data change between builds shows
up in real time once JS lands - the bake is purely a render-time
optimization, not a single source of truth.

Run automatically by `npm run build` before vite build. Safe to skip -
if the file is missing the Vite plugin warns and falls back to the
runtime-only path (with the original flash).
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.stats_compiler import compile_live_stats

OUT_PATH = Path(__file__).resolve().parent.parent / "frontend" / "baked-summary.json"


def main():
    stats = compile_live_stats()
    OUT_PATH.write_text(
        json.dumps(stats, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[bake] wrote {len(stats)} fields to {OUT_PATH}")


if __name__ == "__main__":
    main()
