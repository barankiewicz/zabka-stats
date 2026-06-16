"""Pakiet ETL Żabki: pobieranie, tabularyzacja, wzbogacenia i ladowanie do DuckDB.

Wzbogacenia to po jednej klasie Enricher na zrodlo (etl/sources). Orkiestracje
robi pipeline.run; cienki entrypoint backend/daily_etl reeksportuje go i dodaje
argparse, zeby 'python -m backend.daily_etl' dzialalo bez zmian.
"""

from backend.etl.pipeline import run

__all__ = ["run"]
