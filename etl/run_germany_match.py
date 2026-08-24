"""Roda o match Alemanha x UEA para todos os pesquisadores com ORCID no banco.

Duas fases:
  1. Para cada pesquisador: busca candidatos no OpenAlex (aquisição, sem ML).
  2. UMA chamada em lote a MATCHING/rerank.py --batch, que carrega o modelo
     Sentence-BERT uma única vez e rankeia todos os pesquisadores de uma vez
     (rankear um-a-um levaria ~10s/pesquisador x 135 pesquisadores).

Uso:
    python3 etl/run_germany_match.py
    python3 etl/run_germany_match.py --limit 10
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
from germany_match import GENERIC_KEYWORDS_STOPLIST, GermanyMatcher, aggregate_candidates_for_researcher

YEARS_BACK = 5
TOP_KEYWORDS_PER_RESEARCHER = 8
TOP_MATCHES_PER_RESEARCHER = 8


def _raiz_projetos_dashboards(inicio: Path) -> Path:
    for p in [inicio, *inicio.parents]:
        if (p / "MATCHING").is_dir() and (p / "PADRONIZAÇAO").is_dir():
            return p
    raise RuntimeError("Raiz PROJETOS DASHBOARDS (com MATCHING/ e PADRONIZAÇAO/) não encontrada")


def rerank_semantico_em_lote(pesquisadores: list[dict], top_n: int) -> list[list[dict]]:
    """Rankeia os candidatos de TODOS os pesquisadores numa única chamada ao
    venv de MATCHING/ (só ele tem torch/sentence-transformers instalados) —
    substitui a antiga lógica de contagem de keywords-em-comum."""
    if not pesquisadores:
        return []
    raiz = _raiz_projetos_dashboards(Path(__file__).resolve())
    matching_python = raiz / "MATCHING" / ".venv" / "bin" / "python"
    rerank_script = raiz / "MATCHING" / "rerank.py"

    with tempfile.TemporaryDirectory() as tmp:
        entrada_path = Path(tmp) / "entrada.json"
        entrada_path.write_text(json.dumps(pesquisadores, ensure_ascii=False), encoding="utf-8")
        proc = subprocess.run(
            [str(matching_python), str(rerank_script), "--batch", str(entrada_path), str(top_n)],
            capture_output=True, text=True, check=True,
        )
    return json.loads(proc.stdout)


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

    fila: list[dict] = []
    for i, (researcher_id, nome, orcid) in enumerate(researchers, 1):
        keywords = db.get_top_keywords(
            conn, researcher_id, limit=TOP_KEYWORDS_PER_RESEARCHER,
            stoplist=GENERIC_KEYWORDS_STOPLIST,
        )
        if not keywords:
            print(f"[{i}/{len(researchers)}] {nome} -> sem keywords específicas, pulado")
            db.replace_international_matches(conn, researcher_id, [], country="Alemanha")
            conn.commit()
            continue

        candidatos = aggregate_candidates_for_researcher(matcher, orcid, keywords, args.from_year)
        print(f"[{i}/{len(researchers)}] {nome} -> {len(candidatos)} candidatos brutos")
        fila.append({
            "researcher_id": researcher_id, "nome": nome,
            "keywords": keywords, "candidatos": candidatos,
        })

    print(f"\nRankeando {len(fila)} pesquisadores via Sentence-BERT (MATCHING/rerank.py --batch)...")
    ranqueados = rerank_semantico_em_lote(
        [{"keywords": p["keywords"], "candidatos": p["candidatos"]} for p in fila],
        TOP_MATCHES_PER_RESEARCHER,
    )

    total_matches = 0
    for p, matches in zip(fila, ranqueados):
        db.replace_international_matches(conn, p["researcher_id"], matches, country="Alemanha")
        conn.commit()
        total_matches += len(matches)
        print(f"  {p['nome']} -> {len(matches)} pesquisadores alemães candidatos")

    print()
    print("========== RESUMO ==========")
    print(f"Pesquisadores UEA processados : {len(researchers)}")
    print(f"Matches gravados (total)      : {total_matches}")
    print(f"Banco de dados                : {db.DB_PATH}")

    conn.close()


if __name__ == "__main__":
    main()
