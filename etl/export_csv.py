"""Exporta todas as tabelas do gerbras.db para CSV com colunas separadas por '|'.

Uso:
    python3 etl/export_csv.py
    python3 etl/export_csv.py --out-dir "/caminho/para/pasta"
"""
from __future__ import annotations

import argparse
import csv
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import db

DEFAULT_OUT_DIR = Path(__file__).resolve().parent.parent.parent / "EXPORTS_CSV"

TABLES = ["researchers", "publications", "keywords", "research_areas", "international_matches"]


def export_table(conn: sqlite3.Connection, table: str, out_dir: Path) -> int:
    cur = conn.execute(f"SELECT * FROM {table}")
    columns = [d[0] for d in cur.description]
    out_path = out_dir / f"{table}.csv"
    n = 0
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f, delimiter="|", quoting=csv.QUOTE_MINIMAL)
        writer.writerow(columns)
        for row in cur:
            writer.writerow(row)
            n += 1
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    args = ap.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    conn = db.connect()

    for table in TABLES:
        n = export_table(conn, table, args.out_dir)
        print(f"{table}.csv -> {n} linhas")

    conn.close()
    print(f"\nExportado para: {args.out_dir}")


if __name__ == "__main__":
    main()
