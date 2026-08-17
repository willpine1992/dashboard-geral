"""Gera os JSON consumidos pelo dashboard estático (GERBRAS Programming/docs/data/).

Produz:
  researchers.json    - pesquisadores UEA (áreas, PPG, localização, contagens)
  edges.json          - linha de pesquisa (keyword) x instituição estrangeira, por pesquisador
  institutions.json   - instituições estrangeiras distintas, geocodificadas

Uso:
    python3 etl/export_dashboard_data.py
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
from geocode import Geocoder

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

MANAUS = {"cidade": "Manaus", "uf": "AM", "pais": "Brasil", "lat": -3.1316333, "lon": -59.9825041}

# Coordenadas conhecidas p/ institutos de pesquisa alemães que o Nominatim
# não resolve pelo nome em inglês (associações "guarda-chuva", institutos
# sem tag OSM correspondente). Aproximação ao nível da cidade-sede.
MANUAL_INSTITUTION_COORDS: dict[str, tuple[float, float]] = {
    "Berlin Brandenburg Institute of Advanced Biodiversity Research": (52.5170, 13.3889),
    "Berlin Institute of Health at Charité - Universitätsmedizin Berlin": (52.5170, 13.3889),
    "Bernhard Nocht Institute for Tropical Medicine": (53.5511, 9.9937),
    "Boehringer Ingelheim (Germany)": (49.9694, 8.0656),
    "Center for Advancing Electronics Dresden": (51.0504, 13.7373),
    "Center for HIV and Hepatogastroenterology": (50.9375, 6.9603),
    "Centre for innovative process engineering": (53.0793, 8.8017),
    "Climate Analytics": (52.5170, 13.3889),
    "CureVac (Germany)": (48.5216, 9.0576),
    "Deutsches Archäologisches Institut, Zentrale": (52.5170, 13.3889),
    "Fraunhofer Institute for Solar Energy Systems": (47.9990, 7.8421),
    "Fraunhofer Institute for Telecommunications, Heinrich Hertz Institute": (52.5200, 13.4050),
    "GFZ Helmholtz Centre for Geosciences": (52.3906, 13.0645),
    "German Cancer Research Center": (49.4172, 8.6724),
    "German Center for Infection Research": (52.2872, 10.5423),
    "German Center for Lung Research": (50.5839, 8.6779),
    "German Centre for Cardiovascular Research": (52.5200, 13.4050),
    "German Institute of Food Technologies": (52.6733, 7.9601),
    "German Society of Surgery": (52.5170, 13.3889),
    "Hasso Plattner Institute": (52.3906, 13.0645),
    "Helmholtz Centre for Environmental Research": (51.3397, 12.3731),
    "Helmholtz Centre for Infection Research": (52.2872, 10.5423),
    "Hertie Institute for Clinical Brain Research": (48.5216, 9.0576),
    "Infektionsmedizinisches Centrum Hamburg": (53.5511, 9.9937),
    "Institute for New Media": (50.1109, 8.6821),
    "Kempten University of Applied Sciences": (47.7267, 10.3169),
    "Leibniz Association": (52.5170, 13.3889),
    "Leibniz Centre for Agricultural Landscape Research": (52.5167, 14.1333),
    "Leibniz Institute for Baltic Sea Research Warnemünde": (54.1810, 12.0894),
    "Leibniz Institute for Tropospheric Research": (51.3397, 12.3731),
    "Max Planck Institute for Biogeochemistry": (50.9279, 11.5892),
    "Max Planck Institute for Chemical Energy Conversion": (51.4059, 6.8628),
    "Max Planck Institute for Meteorology": (53.5570, 9.9880),
    "Max Planck Institute for the Science of Human History": (50.9279, 11.5892),
    "Max Planck Institute of Biophysics": (50.1109, 8.6821),
    "Max Planck Institute of Molecular Plant Physiology": (52.4009, 12.9704),
    "Merck KGaA, Darmstadt (Germany)": (49.8728, 8.6512),
    "NewClimate Institute": (50.9375, 6.9603),
    "Philipps University of Marburg": (50.8090, 8.7685),
    "Research Institute for Sustainability at GFZ": (52.3906, 13.0645),
    "RheinMain University of Applied Sciences": (50.0782, 8.2398),
    "TH Köln - University of Applied Sciences": (50.9375, 6.9603),
    "Teva Pharmaceuticals (Germany)": (48.4011, 9.9876),
    "University Hospital Bonn": (50.7226, 7.1006),
    "University Hospital Carl Gustav Carus": (51.0400, 13.7500),
    "University Hospital Leipzig": (51.3300, 12.3800),
    "University Hospital Münster": (51.9636, 7.6041),
    "University of Applied Sciences Mainz": (49.9929, 8.2473),
    "University of Bamberg": (49.8988, 10.9028),
    "University of Göttingen": (51.5413, 9.9158),
    "University of Lübeck": (53.8655, 10.6866),
    "University of Siegen": (50.9106, 8.0169),
    "University of Wuppertal": (51.2465, 7.1500),
}

GERMANY_CENTER = (51.1657, 10.4515)

# Fallback de último recurso por país, só usado quando o Nominatim não
# resolve o nome da instituição nem bate com nenhuma dica manual abaixo.
# Adicionar uma entrada aqui para cada país novo que entrar no cruzamento
# (Angola, Argélia, Moçambique, ...), senão a instituição cai sem coordenada.
COUNTRY_CENTER_FALLBACK: dict[str, tuple[float, float]] = {
    "Alemanha": GERMANY_CENTER,
    "Gana": (7.9465, -1.0232),
    "África do Sul": (-28.8166, 24.9916),
    "Argélia": (28.0339, 1.6596),
    "Moçambique": (-18.6657, 35.5296),
}

# Cidades citadas em nomes de instituição — fallback quando o Nominatim
# e o mapa manual acima não resolvem.
GERMAN_CITY_HINTS: dict[str, tuple[float, float]] = {
    "jena": (50.9279, 11.5892), "erlangen": (49.5897, 11.0040),
    "göttingen": (51.5413, 9.9158), "goettingen": (51.5413, 9.9158),
    "marburg": (50.8090, 8.7685), "bonn": (50.7226, 7.1006),
    "bamberg": (49.8988, 10.9028), "lübeck": (53.8655, 10.6866),
    "luebeck": (53.8655, 10.6866), "siegen": (50.9106, 8.0169),
    "wuppertal": (51.2465, 7.1500), "darmstadt": (49.8728, 8.6512),
    "dresden": (51.0504, 13.7373), "leipzig": (51.3397, 12.3731),
    "münster": (51.9636, 7.6041), "muenster": (51.9636, 7.6041),
    "mainz": (49.9929, 8.2473), "hamburg": (53.5511, 9.9937),
    "berlin": (52.5170, 13.3889), "köln": (50.9375, 6.9603),
    "koeln": (50.9375, 6.9603), "cologne": (50.9375, 6.9603),
    "potsdam": (52.3906, 13.0645), "tübingen": (48.5216, 9.0576),
    "tuebingen": (48.5216, 9.0576),
}


def resolve_institution_coords(inst: str, country: str, geocoder: Geocoder) -> tuple[float | None, float | None]:
    lat, lon = geocoder.geocode(inst, None, country)
    if lat is not None:
        return lat, lon
    # dicas manuais abaixo foram curadas só para instituições alemãs que o
    # Nominatim não resolve (institutos "guarda-chuva" sem tag OSM própria)
    if country == "Alemanha":
        if inst in MANUAL_INSTITUTION_COORDS:
            return MANUAL_INSTITUTION_COORDS[inst]
        low = inst.lower()
        for city, coords in GERMAN_CITY_HINTS.items():
            if city in low:
                return coords
    return COUNTRY_CENTER_FALLBACK.get(country, (None, None))


def export_researchers(conn) -> dict[int, dict]:
    rows = conn.execute(
        """SELECT id, nome, orcid, universidade, cidade, uf, pais, latitude, longitude, programa
           FROM researchers"""
    ).fetchall()

    areas_by_researcher: dict[int, list[dict]] = defaultdict(list)
    for rid, grande_area, area, subarea, especialidade in conn.execute(
        "SELECT researcher_id, grande_area, area, subarea, especialidade FROM research_areas"
    ):
        areas_by_researcher[rid].append({
            "grande_area": grande_area, "area": area,
            "subarea": subarea, "especialidade": especialidade,
        })

    n_pubs = dict(conn.execute(
        "SELECT researcher_id, COUNT(*) FROM publications GROUP BY researcher_id"
    ).fetchall())
    n_matches = dict(conn.execute(
        "SELECT researcher_id, COUNT(*) FROM international_matches GROUP BY researcher_id"
    ).fetchall())

    researchers = {}
    out = []
    for rid, nome, orcid, universidade, cidade, uf, pais, lat, lon, programa in rows:
        areas = areas_by_researcher.get(rid, [])
        rec = {
            "id": rid,
            "nome": nome,
            "orcid": orcid,
            "universidade": universidade,
            "cidade": cidade,
            "uf": uf,
            "pais": pais,
            "lat": lat,
            "lon": lon,
            "programas": [p.strip() for p in (programa or "").split(",") if p.strip()],
            "grande_areas": sorted({a["grande_area"] for a in areas if a["grande_area"]}),
            "areas": sorted({a["area"] for a in areas if a["area"]}),
            "n_publicacoes": n_pubs.get(rid, 0),
            "n_matches": n_matches.get(rid, 0),
        }
        out.append(rec)
        researchers[rid] = rec
    return out, researchers


def export_edges(conn) -> list[dict]:
    rows = conn.execute(
        """SELECT researcher_id, foreign_author_name, foreign_author_orcid, foreign_author_openalex_id,
                  foreign_institution, foreign_country, matched_keywords, score,
                  sample_work_title, sample_work_doi
           FROM international_matches"""
    ).fetchall()

    edges = []
    for rid, f_name, f_orcid, f_oaid, f_inst, f_country, matched_kw, score, sample_title, sample_doi in rows:
        keywords = [k.strip() for k in (matched_kw or "").split(",") if k.strip()]
        for kw in keywords:
            edges.append({
                "researcher_id": rid,
                "keyword": kw,
                "foreign_author_name": f_name,
                "foreign_author_orcid": f_orcid,
                "foreign_author_openalex_id": f_oaid,
                "foreign_institution": f_inst,
                "foreign_country": f_country,
                "sample_work_title": sample_title,
                "sample_work_doi": sample_doi,
            })
    return edges


def export_institutions(conn, geocoder: Geocoder) -> list[dict]:
    rows = conn.execute(
        """SELECT foreign_institution, foreign_country, COUNT(*) n_matches,
                  COUNT(DISTINCT researcher_id) n_researchers
           FROM international_matches
           WHERE foreign_institution IS NOT NULL
           GROUP BY foreign_institution, foreign_country"""
    ).fetchall()

    out = []
    for inst, country, n_matches, n_researchers in rows:
        lat, lon = resolve_institution_coords(inst, country, geocoder)
        out.append({
            "instituicao": inst, "pais": country,
            "lat": lat, "lon": lon,
            "n_matches": n_matches, "n_researchers": n_researchers,
        })
    return out


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = db.connect()
    geocoder = Geocoder()

    researchers, _ = export_researchers(conn)
    edges = export_edges(conn)
    institutions = export_institutions(conn, geocoder)

    dashboard = {
        "researchers": researchers,
        "edges": edges,
        "institutions": institutions,
        "manaus": MANAUS,
    }
    (DATA_DIR / "dashboard.json").write_text(
        json.dumps(dashboard, ensure_ascii=False, indent=None), encoding="utf-8"
    )

    print(f"dashboard.json -> {len(researchers)} pesquisadores, {len(edges)} arestas, "
          f"{len(institutions)} instituições estrangeiras")
    print(f"pasta de saída: {DATA_DIR}")

    conn.close()


if __name__ == "__main__":
    main()
