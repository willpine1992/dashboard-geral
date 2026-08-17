"""Enriquecimento via OpenAlex: publicações + keywords dos últimos N anos, por ORCID."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path

OPENALEX_URL = "https://api.openalex.org/works"
CONTACT_EMAIL = "oticapinheiro.admin@gmail.com"
API_KEY = "e20KHEj9oLRTjzBsp4QFI9"
CACHE_PATH = Path(__file__).resolve().parent.parent / "cache" / "openalex_cache.json"
REQUEST_DELAY_S = 0.2


@dataclass
class Publication:
    doi: str | None
    titulo: str
    ano: int | None
    periodico: str | None
    openalex_id: str | None
    keywords: list[str]


class OpenAlexEnricher:
    def __init__(self, cache_path: Path = CACHE_PATH):
        self.cache_path = cache_path
        self._cache: dict[str, list[dict]] = {}
        if self.cache_path.exists():
            self._cache = json.loads(self.cache_path.read_text(encoding="utf-8"))

    def _save(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(
            json.dumps(self._cache, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def get_publications(self, orcid: str, from_year: int) -> list[Publication]:
        cache_key = f"{orcid}|{from_year}"
        if cache_key in self._cache:
            return [self._dict_to_pub(d) for d in self._cache[cache_key]]

        raw_results = self._fetch_all(orcid, from_year)
        self._cache[cache_key] = raw_results
        self._save()
        return [self._dict_to_pub(d) for d in raw_results]

    @staticmethod
    def _dict_to_pub(d: dict) -> Publication:
        return Publication(
            doi=d.get("doi"), titulo=d.get("titulo", ""), ano=d.get("ano"),
            periodico=d.get("periodico"), openalex_id=d.get("openalex_id"),
            keywords=d.get("keywords", []),
        )

    def _fetch_all(self, orcid: str, from_year: int) -> list[dict]:
        results: list[dict] = []
        cursor = "*"
        select_fields = "id,doi,title,publication_year,primary_location,keywords"
        while cursor:
            params = {
                "filter": f"author.orcid:{orcid},from_publication_date:{from_year}-01-01",
                "per-page": "200",
                "cursor": cursor,
                "select": select_fields,
                "mailto": CONTACT_EMAIL,
                "api_key": API_KEY,
            }
            url = f"{OPENALEX_URL}?{urllib.parse.urlencode(params)}"
            try:
                with urllib.request.urlopen(url, timeout=15) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
            except (urllib.error.URLError, TimeoutError, ValueError):
                break
            time.sleep(REQUEST_DELAY_S)

            for w in data.get("results", []):
                doi = w.get("doi")
                if doi:
                    doi = doi.replace("https://doi.org/", "")
                source = (w.get("primary_location") or {}).get("source") or {}
                results.append({
                    "doi": doi,
                    "titulo": w.get("title") or "",
                    "ano": w.get("publication_year"),
                    "periodico": source.get("display_name"),
                    "openalex_id": w.get("id"),
                    "keywords": [kw["display_name"] for kw in w.get("keywords", [])],
                })

            cursor = (data.get("meta") or {}).get("next_cursor")
            if not data.get("results"):
                break
        return results
