"""Roda o match Alemanha x UEA para todos os pesquisadores com ORCID no banco.

Uso:
    python3 etl/run_germany_match.py
    python3 etl/run_germany_match.py --limit 10
"""
from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
from germany_match import GENERIC_KEYWORDS_STOPLIST, GermanyMatcher, compute_matches_for_researcher

YEARS_BACK = 5
TOP_KEYWORDS_PER_RESEARCHER = 8
TOP_MATCHES_PER_RESEARCHER = 8


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--from-year", type=int, default=date.today().year - YEARS_BACK)
    args = ap.parse_args()

    conn = db.connect()
    matcher = GermanyMatcher()

    researchers = db.get_researchers_with_orcid(conn)
    if args.limit:
        researchers = researchers[: args.limit]
    print(f"[GERBRAS-DE] {len(researchers)} pesquisadores com ORCID a processar")

    total_matches = 0
    for i, (researcher_id, nome, orcid) in enumerate(researchers, 1):
        keywords = db.get_top_keywords(
            conn, researcher_id, limit=TOP_KEYWORDS_PER_RESEARCHER,
            stoplist=GENERIC_KEYWORDS_STOPLIST,
        )
        print(f"[{i}/{len(researchers)}] {nome}", end="")
        if not keywords:
            print(" -> sem keywords específicas, pulado")
            db.replace_international_matches(conn, researcher_id, [], country="Alemanha")
            conn.commit()
            continue

        matches = compute_matches_for_researcher(
            matcher, orcid, keywords, args.from_year, top_n=TOP_MATCHES_PER_RESEARCHER
        )
        db.replace_international_matches(conn, researcher_id, matches, country="Alemanha")
        conn.commit()
        total_matches += len(matches)
        print(f" -> {len(matches)} pesquisadores alemães candidatos")

    print()
    print("========== RESUMO ==========")
    print(f"Pesquisadores UEA processados : {len(researchers)}")
    print(f"Matches gravados (total)      : {total_matches}")
    print(f"Banco de dados                : {db.DB_PATH}")

    conn.close()


if __name__ == "__main__":
    main()
