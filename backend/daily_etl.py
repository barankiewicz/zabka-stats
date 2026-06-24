"""
Dzienny ETL Żabki - cienki entrypoint.

Logika przeniesiona do pakietu backend/etl (fetch/tabular/load w io, geometria w
geo, po jednej klasie wzbogacenia na zrodlo w sources, orkiestracja w pipeline).
Ten plik zostaje punktem wejscia: reeksportuje run i wystawia CLI, zeby
'python -m backend.daily_etl' oraz 'from backend.daily_etl import run' dzialaly
jak wczesniej.

Pobiera surowy JSON ze sklepami, zamienia go na forme tabelaryczna, wzbogaca
geokodami (województwo, powiat, miasto, ulica), dolicza najdalszy punkt Polski
od jakiejkolwiek Żabki, wrzuca wszystko do DuckDB i przeładowuje cache Redis.

Wzbogacenie geograficzne (ENRICHMENT.md): zabytki NID, parki/otuliny GDOŚ,
ekonomia powiatu GUS BDL, najblizszy sasiad (lokalnie) i wysokosc GUGiK NMT.
Kroki sieciowe sa best-effort - gdy zrodla brak, kolumna zostaje pusta.

Uruchomienie:
  python -m backend.daily_etl                 # pelny przebieg (bez wysokosci)
  python -m backend.daily_etl --no-geocode    # pomin geokodowanie (szybki test)
  python -m backend.daily_etl --limit 500     # geokoduj tylko N sklepow (test)
  python -m backend.daily_etl --skip-parks --skip-gus  # bez wzbogacen sieciowych
  python -m backend.daily_etl --elevation     # dolacz wysokosc GUGiK (13k+ zapytan, cache)

Zrodla statyczne (pobierz raz do data/input/): parki_gdos.geojson (GDOŚ).
Sciezki/URL-e nadpisywalne env-em (PARKS_*).
Klucz GUS_BDL_KEY podnosi limit BDL ze 10 do 100 zapytan/min.

Cron (raz dziennie o 3:00):
  0 3 * * * cd /home/alice/zabka-dashboard && python -m backend.daily_etl >> logs/etl.log 2>&1
"""

import os
import sys
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.etl.pipeline import run   # reeksport: from backend.daily_etl import run

__all__ = ["run", "main"]


def main():
    ap = argparse.ArgumentParser(description="Dzienny ETL Żabki")
    ap.add_argument("--no-geocode", action="store_true", help="pomin geokodowanie")
    ap.add_argument("--limit", type=int, help="geokoduj tylko N nowych sklepow (test)")
    ap.add_argument("--fallback", help="lokalny JSON gdy pobieranie zawiedzie")
    ap.add_argument("--skip-parks", action="store_true", help="pomin parki/otuliny GDOŚ")
    ap.add_argument("--skip-gus", action="store_true", help="pomin ekonomie GUS BDL")
    ap.add_argument("--elevation", action="store_true",
                    help="dolacz wysokosc GUGiK NMT (13k+ zapytan, cache lokalny)")
    ap.add_argument("--skip-amphibians", action="store_true",
                    help="pomin populacje plazow (GBIF)")
    ap.add_argument("--skip-paczkomaty", action="store_true",
                    help="pomin paczkomaty InPost (osobna encja)")
    args = ap.parse_args()
    run(no_geocode=args.no_geocode, limit=args.limit,
        fallback=args.fallback,
        skip_parks=args.skip_parks,
        skip_gus=args.skip_gus, elevation=args.elevation,
        skip_amphibians=args.skip_amphibians, skip_paczkomaty=args.skip_paczkomaty)


if __name__ == "__main__":
    main()
