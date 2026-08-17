"""Match de pesquisadores da UEA com pesquisadores da Alemanha via OpenAlex.

Estratégia: para cada pesquisador da UEA, pega as keywords mais frequentes
(já extraídas em keywords, ver openalex_enrich.py) e busca no OpenAlex
trabalhos recentes com pelo menos um autor afiliado a instituição alemã que
usem essas mesmas keywords. Autores estrangeiros que aparecem em mais de uma
busca (matched_keywords) têm maior probabilidade de linha de pesquisa
compatível — viram candidatos a parceria/oportunidade no exterior.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

OPENALEX_URL = "https://api.openalex.org/works"
CONTACT_EMAIL = "oticapinheiro.admin@gmail.com"
API_KEY = "e20KHEj9oLRTjzBsp4QFI9"
CACHE_PATH = Path(__file__).resolve().parent.parent / "cache" / "germany_match_cache.json"
REQUEST_DELAY_S = 0.15
RESULTS_PER_KEYWORD = 8

# Termos genéricos demais (áreas/domínios amplos do OpenAlex) que não indicam
# uma linha de pesquisa específica o bastante para gerar um match útil.
GENERIC_KEYWORDS_STOPLIST = {
    "biology", "chemistry", "physics", "medicine", "geography", "ecology",
    "geology", "mathematics", "engineering", "sociology", "psychology",
    "computer science", "environmental science", "materials science",
    "genetics", "biochemistry", "political science", "economics",
    "environmental chemistry", "agronomy", "botany", "pathology",
    "immunology", "microbiology", "philosophy", "history", "art",
    "humanities", "work (physics)", "action (physics)", "context (archaeology)",
    "control (management)", "government (linguistics)", "power (physics)",
    "data collection", "field (mathematics)", "order (exchange)",
    "theology", "meaning (existential)", "state (computer science)",
    "schema (genetic algorithms)", "relation (database)", "process (computing)",
    "principal (computer security)", "perspective (graphical)", "identity (music)",
    "scope (computer science)", "subject (documents)", "set (abstract data type)",
    "logo (programming language)", "causality (physics)",
}


class GermanyMatcher:
    def __init__(self, cache_path: Path = CACHE_PATH, country_code: str = "DE"):
        self.cache_path = cache_path
        self.country_code = country_code
        self._cache: dict[str, list[dict]] = {}
        if self.cache_path.exists():
            self._cache = json.loads(self.cache_path.read_text(encoding="utf-8"))

    def _save(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(
            json.dumps(self._cache, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def candidates_for_keyword(self, keyword: str, from_year: int) -> list[dict]:
        cache_key = f"{keyword.lower()}|{self.country_code}|{from_year}"
        if cache_key in self._cache:
            return self._cache[cache_key]

        candidates = self._fetch(keyword, from_year)
        self._cache[cache_key] = candidates
        self._save()
        return candidates

    def _fetch(self, keyword: str, from_year: int) -> list[dict]:
        params = {
            "search": keyword,
            "filter": f"institutions.country_code:{self.country_code},from_publication_date:{from_year}-01-01",
            "per-page": str(RESULTS_PER_KEYWORD),
            "select": "id,doi,title,publication_year,authorships",
            "mailto": CONTACT_EMAIL,
            "api_key": API_KEY,
        }
        url = f"{OPENALEX_URL}?{urllib.parse.urlencode(params)}"
        try:
            with urllib.request.urlopen(url, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, TimeoutError, ValueError):
            return []
        time.sleep(REQUEST_DELAY_S)

        out = []
        for w in data.get("results", []):
            doi = w.get("doi")
            if doi:
                doi = doi.replace("https://doi.org/", "")
            for a in w.get("authorships", []):
                if self.country_code not in (a.get("countries") or []):
                    continue
                author = a.get("author") or {}
                orcid = author.get("orcid")
                if orcid:
                    orcid = orcid.replace("https://orcid.org/", "")
                institutions = a.get("institutions") or []
                de_institutions = [i for i in institutions if i.get("country_code") == self.country_code]
                chosen = de_institutions[0] if de_institutions else (institutions[0] if institutions else None)
                institution_name = chosen["display_name"] if chosen else None
                out.append({
                    "openalex_id": author.get("id"),
                    "nome": author.get("display_name"),
                    "orcid": orcid,
                    "instituicao": institution_name,
                    "sample_title": w.get("title"),
                    "sample_doi": doi,
                })
        return out


def compute_matches_for_researcher(
    matcher: GermanyMatcher, researcher_orcid: str, keywords: list[str],
    from_year: int, top_n: int = 8,
) -> list[dict]:
    aggregated: dict[str, dict] = {}
    first_keyword: dict[str, str] = {}
    for kw in keywords:
        for cand in matcher.candidates_for_keyword(kw, from_year):
            if not cand.get("openalex_id") or not cand.get("nome"):
                continue
            if cand.get("orcid") and cand["orcid"] == researcher_orcid:
                continue  # não contar o próprio pesquisador
            entry = aggregated.setdefault(cand["openalex_id"], {
                "openalex_id": cand["openalex_id"],
                "nome": cand["nome"],
                "orcid": cand["orcid"],
                "instituicao": cand["instituicao"],
                "pais": "Alemanha",
                "keywords": set(),
                "sample_title": cand["sample_title"],
                "sample_doi": cand["sample_doi"],
            })
            entry["keywords"].add(kw)
            first_keyword.setdefault(cand["openalex_id"], kw)

    # Candidatos com >1 linha de pesquisa em comum são o sinal mais forte —
    # sempre entram primeiro. Entre os que só batem em 1 linha, evita que a
    # keyword mais frequente/genérica (processada primeiro) monopolize as
    # vagas: distribui em round-robin entre as keywords buscadas, para que
    # cada linha específica do pesquisador tenha chance de aparecer.
    multi = [e for e in aggregated.values() if len(e["keywords"]) > 1]
    multi.sort(key=lambda e: len(e["keywords"]), reverse=True)

    single_by_kw: dict[str, list[dict]] = {kw: [] for kw in keywords}
    for e in aggregated.values():
        if len(e["keywords"]) == 1:
            single_by_kw[first_keyword[e["openalex_id"]]].append(e)

    round_robin: list[dict] = []
    while any(single_by_kw.values()):
        for kw in keywords:
            if single_by_kw[kw]:
                round_robin.append(single_by_kw[kw].pop(0))

    return (multi + round_robin)[:top_n]
