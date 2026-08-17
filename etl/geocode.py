"""Geocoding de cidade/UF/país via Nominatim (OpenStreetMap), com cache local."""
from __future__ import annotations

import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "GERBRAS-ETL/1.0 (uso academico local; contato: oticapinheiro.admin@gmail.com)"
MIN_INTERVAL_S = 1.1  # política de uso do Nominatim: máx. 1 req/s

CACHE_PATH = Path(__file__).resolve().parent.parent / "cache" / "geocode_cache.json"


class Geocoder:
    def __init__(self, cache_path: Path = CACHE_PATH):
        self.cache_path = cache_path
        self._cache: dict[str, dict | None] = {}
        self._last_request_ts = 0.0
        if self.cache_path.exists():
            self._cache = json.loads(self.cache_path.read_text(encoding="utf-8"))

    def _save(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(
            json.dumps(self._cache, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    @staticmethod
    def _make_query(cidade: str | None, uf: str | None, pais: str | None) -> str | None:
        if not cidade:
            return None
        parts = [cidade]
        if uf:
            parts.append(uf)
        if pais:
            parts.append(pais)
        return ", ".join(parts)

    def geocode(self, cidade: str | None, uf: str | None, pais: str | None) -> tuple[float | None, float | None]:
        query = self._make_query(cidade, uf, pais)
        if not query:
            return None, None

        key = query.lower().strip()
        if key in self._cache:
            entry = self._cache[key]
            return (entry["lat"], entry["lon"]) if entry else (None, None)

        elapsed = time.monotonic() - self._last_request_ts
        if elapsed < MIN_INTERVAL_S:
            time.sleep(MIN_INTERVAL_S - elapsed)

        lat, lon = self._fetch(query)
        self._last_request_ts = time.monotonic()

        self._cache[key] = {"lat": lat, "lon": lon} if lat is not None else None
        self._save()
        return lat, lon

    @staticmethod
    def _fetch(query: str) -> tuple[float | None, float | None]:
        params = {"q": query, "format": "json", "limit": "1"}
        url = f"{NOMINATIM_URL}?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception:
            return None, None
        if not data:
            return None, None
        return float(data[0]["lat"]), float(data[0]["lon"])
