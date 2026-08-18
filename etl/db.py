"""Schema SQLite e helpers de upsert para o banco de pesquisadores GERBRAS."""
from __future__ import annotations

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "output" / "gerbras.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS researchers (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    nome                    TEXT NOT NULL,
    lattes_id               TEXT UNIQUE,
    orcid                   TEXT,
    universidade            TEXT,
    cidade                  TEXT,
    uf                      TEXT,
    pais                    TEXT,
    latitude                REAL,
    longitude               REAL,
    programa                TEXT,
    arquivo_origem          TEXT,
    enriquecido_openalex    INTEGER NOT NULL DEFAULT 0,
    avisos                  TEXT,
    atualizado_em           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS publications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    researcher_id   INTEGER NOT NULL REFERENCES researchers(id) ON DELETE CASCADE,
    doi             TEXT,
    titulo          TEXT NOT NULL,
    ano             INTEGER,
    periodico       TEXT,
    openalex_id     TEXT,
    UNIQUE(researcher_id, openalex_id)
);

CREATE TABLE IF NOT EXISTS keywords (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    researcher_id   INTEGER NOT NULL REFERENCES researchers(id) ON DELETE CASCADE,
    keyword         TEXT NOT NULL,
    frequencia      INTEGER NOT NULL DEFAULT 1,
    UNIQUE(researcher_id, keyword)
);

CREATE TABLE IF NOT EXISTS research_areas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    researcher_id   INTEGER NOT NULL REFERENCES researchers(id) ON DELETE CASCADE,
    programa        TEXT,
    grande_area     TEXT NOT NULL,
    area            TEXT,
    subarea         TEXT,
    especialidade   TEXT,
    UNIQUE(researcher_id, grande_area, area, subarea, especialidade)
);

CREATE TABLE IF NOT EXISTS international_matches (
    id                          INTEGER PRIMARY KEY AUTOINCREMENT,
    researcher_id               INTEGER NOT NULL REFERENCES researchers(id) ON DELETE CASCADE,
    foreign_author_name         TEXT NOT NULL,
    foreign_author_orcid        TEXT,
    foreign_author_openalex_id  TEXT,
    foreign_institution         TEXT,
    foreign_country             TEXT NOT NULL,
    matched_keywords            TEXT NOT NULL,
    score                       INTEGER NOT NULL,
    sample_work_title           TEXT,
    sample_work_doi             TEXT,
    atualizado_em                TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(researcher_id, foreign_author_openalex_id)
);

CREATE INDEX IF NOT EXISTS idx_researchers_orcid ON researchers(orcid);
CREATE INDEX IF NOT EXISTS idx_publications_doi ON publications(doi);
CREATE INDEX IF NOT EXISTS idx_keywords_keyword ON keywords(keyword);
CREATE INDEX IF NOT EXISTS idx_intl_matches_researcher ON international_matches(researcher_id);
CREATE INDEX IF NOT EXISTS idx_research_areas_researcher ON research_areas(researcher_id);
CREATE INDEX IF NOT EXISTS idx_research_areas_grande_area ON research_areas(grande_area);
CREATE INDEX IF NOT EXISTS idx_research_areas_area ON research_areas(area);
CREATE INDEX IF NOT EXISTS idx_research_areas_programa ON research_areas(programa);
"""


def connect(db_path: Path = DB_PATH) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.executescript(SCHEMA)
    return conn


def upsert_researcher(conn: sqlite3.Connection, r) -> int:
    avisos = "; ".join(r.avisos) if r.avisos else None
    cur = conn.execute(
        "SELECT id, programa FROM researchers WHERE lattes_id = ?", (r.lattes_id,)
    )
    row = cur.fetchone()
    if row:
        researcher_id, programa_existente = row
        programas = (programa_existente or "").split(", ") if programa_existente else []
        if r.programa and r.programa not in programas:
            programas.append(r.programa)
        programa_final = ", ".join(p for p in programas if p)
        conn.execute(
            """UPDATE researchers SET nome=?, orcid=?, universidade=?, cidade=?, uf=?,
               pais=?, latitude=?, longitude=?, programa=?, arquivo_origem=?, avisos=?,
               atualizado_em=datetime('now')
               WHERE id=?""",
            (r.nome, r.orcid, r.universidade, r.cidade, r.uf, r.pais,
             r.latitude, r.longitude, programa_final, r.arquivo_origem, avisos, researcher_id),
        )
    else:
        cur = conn.execute(
            """INSERT INTO researchers (nome, lattes_id, orcid, universidade, cidade, uf,
               pais, latitude, longitude, programa, arquivo_origem, avisos)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (r.nome, r.lattes_id, r.orcid, r.universidade, r.cidade, r.uf, r.pais,
             r.latitude, r.longitude, r.programa, r.arquivo_origem, avisos),
        )
        researcher_id = cur.lastrowid
    return researcher_id


def set_enriquecido(conn: sqlite3.Connection, researcher_id: int, value: bool) -> None:
    conn.execute(
        "UPDATE researchers SET enriquecido_openalex=? WHERE id=?",
        (1 if value else 0, researcher_id),
    )


def replace_publications(conn: sqlite3.Connection, researcher_id: int, publications) -> None:
    conn.execute("DELETE FROM publications WHERE researcher_id=?", (researcher_id,))
    conn.executemany(
        """INSERT OR IGNORE INTO publications (researcher_id, doi, titulo, ano, periodico, openalex_id)
           VALUES (?,?,?,?,?,?)""",
        [(researcher_id, p.doi, p.titulo, p.ano, p.periodico, p.openalex_id) for p in publications],
    )


def replace_keywords(conn: sqlite3.Connection, researcher_id: int, keyword_counts: dict[str, int]) -> None:
    conn.execute("DELETE FROM keywords WHERE researcher_id=?", (researcher_id,))
    conn.executemany(
        "INSERT OR IGNORE INTO keywords (researcher_id, keyword, frequencia) VALUES (?,?,?)",
        [(researcher_id, kw, freq) for kw, freq in keyword_counts.items()],
    )


def get_programa(conn: sqlite3.Connection, researcher_id: int) -> str | None:
    cur = conn.execute("SELECT programa FROM researchers WHERE id=?", (researcher_id,))
    row = cur.fetchone()
    return row[0] if row else None


def replace_research_areas(conn: sqlite3.Connection, researcher_id: int, areas: list[dict]) -> None:
    programa = get_programa(conn, researcher_id)
    conn.execute("DELETE FROM research_areas WHERE researcher_id=?", (researcher_id,))
    conn.executemany(
        """INSERT OR IGNORE INTO research_areas
           (researcher_id, programa, grande_area, area, subarea, especialidade)
           VALUES (?,?,?,?,?,?)""",
        [
            (researcher_id, programa, a["grande_area"], a["area"], a["subarea"], a["especialidade"])
            for a in areas
        ],
    )


def get_researchers_with_orcid(conn: sqlite3.Connection) -> list[tuple[int, str, str]]:
    cur = conn.execute("SELECT id, nome, orcid FROM researchers WHERE orcid IS NOT NULL")
    return cur.fetchall()


def get_top_keywords(conn: sqlite3.Connection, researcher_id: int, limit: int, stoplist: set[str]) -> list[str]:
    cur = conn.execute(
        "SELECT keyword FROM keywords WHERE researcher_id=? ORDER BY frequencia DESC",
        (researcher_id,),
    )
    result = []
    for (kw,) in cur.fetchall():
        if kw.lower() in stoplist:
            continue
        result.append(kw)
        if len(result) >= limit:
            break
    return result


def replace_international_matches(
    conn: sqlite3.Connection, researcher_id: int, matches: list[dict],
    country: str | None = None, institution: str | None = None,
) -> None:
    """Substitui os matches internacionais de um pesquisador.

    Se `country` for informado, apaga só os matches daquele país antes de
    inserir (permite múltiplos pipelines de país, ex. Alemanha e Gana,
    conviverem na mesma tabela sem um apagar os matches do outro). Sem
    `country`, mantém o comportamento antigo de apagar tudo — usar só quando
    não houver mais de um país na tabela.

    Se `institution` também for informado, apaga só os matches daquela
    instituição específica dentro do país — necessário quando um país tem
    mais de uma instituição-alvo (ex.: África do Sul = University of
    Johannesburg + Stellenbosch University), senão rodar o matcher de uma
    apaga os matches da outra por engano.
    """
    if institution:
        conn.execute(
            "DELETE FROM international_matches WHERE researcher_id=? AND foreign_country=? AND foreign_institution=?",
            (researcher_id, country, institution),
        )
    elif country:
        conn.execute(
            "DELETE FROM international_matches WHERE researcher_id=? AND foreign_country=?",
            (researcher_id, country),
        )
    else:
        conn.execute("DELETE FROM international_matches WHERE researcher_id=?", (researcher_id,))
    conn.executemany(
        """INSERT OR IGNORE INTO international_matches
           (researcher_id, foreign_author_name, foreign_author_orcid, foreign_author_openalex_id,
            foreign_institution, foreign_country, matched_keywords, score,
            sample_work_title, sample_work_doi)
           VALUES (?,?,?,?,?,?,?,?,?,?)""",
        [
            (researcher_id, m["nome"], m["orcid"], m["openalex_id"], m["instituicao"],
             m["pais"], ", ".join(sorted(m["keywords"])), len(m["keywords"]),
             m["sample_title"], m["sample_doi"])
            for m in matches
        ],
    )
