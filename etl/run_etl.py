"""Orquestrador do ETL: PDFs Lattes -> banco SQLite local (gerbras.db).

Uso:
    python3 etl/run_etl.py
    python3 etl/run_etl.py --limit 10          # roda só com 10 currículos (teste)
    python3 etl/run_etl.py --skip-geocode       # não geocodifica (mais rápido)
    python3 etl/run_etl.py --skip-openalex      # não consulta OpenAlex
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
from geocode import Geocoder
from lattes_parser import parse_lattes_pdf
from openalex_enrich import OpenAlexEnricher

DEFAULT_DATA_DIR = Path(
    "/Users/macbookpro/Documents/POSDOC - MAC/DATA BASE UEA"
)
REPORT_PATH = Path(__file__).resolve().parent.parent / "output" / "etl_report.json"
YEARS_BACK = 5


def discover_pdfs(data_dir: Path) -> list[Path]:
    pdfs = [
        p for p in sorted(data_dir.rglob("*.pdf"))
        if "reunidos" not in p.name.lower() and "/PPGs/" not in str(p)
    ]
    return pdfs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--skip-geocode", action="store_true")
    ap.add_argument("--skip-openalex", action="store_true")
    ap.add_argument("--from-year", type=int, default=date.today().year - YEARS_BACK)
    args = ap.parse_args()

    pdfs = discover_pdfs(args.data_dir)
    if args.limit:
        pdfs = pdfs[: args.limit]
    print(f"[ETL] {len(pdfs)} currículos a processar (a partir de {args.from_year})")

    conn = db.connect()
    geocoder = Geocoder() if not args.skip_geocode else None
    enricher = OpenAlexEnricher() if not args.skip_openalex else None

    report: list[dict] = []
    n_orcid = n_enriched = n_pubs_total = 0

    for i, pdf_path in enumerate(pdfs, 1):
        programa = pdf_path.parent.name
        r = parse_lattes_pdf(pdf_path, programa=programa)
        print(f"[{i}/{len(pdfs)}] {r.nome or pdf_path.name}", end="")

        if geocoder and r.cidade:
            r.latitude, r.longitude = geocoder.geocode(r.cidade, r.uf, r.pais)

        researcher_id = db.upsert_researcher(conn, r)
        db.replace_research_areas(conn, researcher_id, r.areas)

        publications = []
        keyword_counts: Counter = Counter()
        if enricher and r.orcid:
            n_orcid += 1
            try:
                publications = enricher.get_publications(r.orcid, args.from_year)
            except Exception as e:
                r.avisos.append(f"falha OpenAlex: {e}")
                publications = []
            for p in publications:
                keyword_counts.update(p.keywords)
            db.set_enriquecido(conn, researcher_id, value=True)
            n_enriched += 1
            n_pubs_total += len(publications)
            print(f" -> {len(publications)} publicações ({len(keyword_counts)} keywords)")
        else:
            db.set_enriquecido(conn, researcher_id, value=False)
            print(" -> sem ORCID, não enriquecido")

        db.replace_publications(conn, researcher_id, publications)
        db.replace_keywords(conn, researcher_id, dict(keyword_counts))
        conn.commit()

        report.append({
            "arquivo": pdf_path.name,
            "programa": programa,
            "nome": r.nome,
            "orcid": r.orcid,
            "avisos": r.avisos,
            "n_publicacoes": len(publications),
        })

    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print()
    print("========== RESUMO ==========")
    print(f"Pesquisadores processados : {len(pdfs)}")
    print(f"Com ORCID                 : {n_orcid}")
    print(f"Enriquecidos via OpenAlex : {n_enriched}")
    print(f"Publicações (últimos {YEARS_BACK} anos) : {n_pubs_total}")
    print(f"Banco de dados            : {db.DB_PATH}")
    print(f"Relatório de avisos       : {REPORT_PATH}")

    conn.close()


if __name__ == "__main__":
    main()
