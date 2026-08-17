"""Parser de CVs Lattes (PDF) para um dicionário estruturado.

Usa `pdftotext -layout` (poppler) para extrair o texto preservando a ordem
das colunas do currículo, depois aplica heurísticas de regex sobre as
seções "Identificação" e "Endereço Profissional".
"""
from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

STREET_PREFIXES = (
    "av.", "av ", "avenida", "rua", "r.", "estrada", "alameda", "rodovia",
    "rod.", "travessa", "praça", "praca", "quadra", "km ", "br-", "br ",
    "conjunto", "condomínio", "condominio",
)

CEP_LINE_RE = re.compile(
    r"^\s*\d{4,5}-?\d{3}\s*-\s*([^,\n]+?)\s*,\s*([A-Z]{2})?\s*-\s*([^\n]+?)\s*$",
    re.MULTILINE,
)

ORCID_RE = re.compile(
    r"orcid\.org/\s*(\d{4})\s*-\s*(\d{4})\s*-\s*(\d{4})\s*-\s*(\d{3}[\dXx])"
)
LATTES_TOP_RE = re.compile(r"lattes\.cnpq\.br/(\d+)")

AREAS_NEXT_HEADERS = [
    r"\n\s*Idiomas\b", r"\n\s*Prêmios e títulos", r"\n\s*Formação [Cc]omplementar",
    r"\n\s*Produções\b", r"\n\s*Projetos de pesquisa", r"\n\s*Atuação Profissional",
    r"\n\s*Bancas\b", r"\n\s*Orientações\b", r"\n\s*Revisor de",
]


@dataclass
class Researcher:
    nome: str | None = None
    lattes_id: str | None = None
    orcid: str | None = None
    universidade: str | None = None
    cidade: str | None = None
    uf: str | None = None
    pais: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    programa: str | None = None
    arquivo_origem: str | None = None
    areas: list[dict] = field(default_factory=list)
    avisos: list[str] = field(default_factory=list)


def extract_text(pdf_path: Path) -> str:
    result = subprocess.run(
        ["pdftotext", "-layout", str(pdf_path), "-"],
        capture_output=True, text=True, check=True,
    )
    return result.stdout


def _section(text: str, start_pat: str, end_pats: list[str]) -> str | None:
    start_m = re.search(start_pat, text)
    if not start_m:
        return None
    tail = text[start_m.end():]
    end_positions = [m.start() for pat in end_pats
                      for m in [re.search(pat, tail)] if m]
    end = min(end_positions) if end_positions else len(tail)
    return tail[:end]


def _parse_nome(text: str) -> str | None:
    block = _section(text, r"Identificação", [r"Nome em citaç"])
    if not block:
        return None
    m = re.search(r"Nome\s*\n+\s*(.+)", block)
    if m:
        return m.group(1).strip()
    return None


def _parse_lattes_id(text: str) -> str | None:
    m = LATTES_TOP_RE.search(text)
    return m.group(1) if m else None


def _parse_orcid(text: str) -> str | None:
    m = ORCID_RE.search(text)
    if not m:
        return None
    return "-".join(m.groups()).upper()


def _parse_pais_nacionalidade(text: str) -> str | None:
    m = re.search(r"País de\s*\n?\s*Nacionalidade\s*\n+\s*(.+)", text)
    return m.group(1).strip() if m else None


def _parse_endereco_profissional(text: str) -> tuple[str | None, str | None, str | None, str | None]:
    """Retorna (universidade, cidade, uf, pais) a partir do bloco de endereço profissional."""
    m = re.search(r"Endereço[^\n]*\n\s*Profissional", text)
    if not m:
        return None, None, None, None
    block = text[m.end():]
    end_m = re.search(r"\n\s*Formação acadêmica", block)
    if end_m:
        block = block[:end_m.start()]
    else:
        end_m = re.search(r"\n\s*\n\s*\n", block)
        if end_m:
            block = block[:end_m.start()]

    cep_m = CEP_LINE_RE.search(block)
    cidade = uf = pais = None
    pre_cep_text = block
    if cep_m:
        cidade = cep_m.group(1).strip() if cep_m.group(1) else None
        uf = cep_m.group(2).strip() if cep_m.group(2) else None
        pais = cep_m.group(3).strip() if cep_m.group(3) else None
        if pais:
            pais = pais.split(" - ")[0].strip()
        pre_cep_text = block[:cep_m.start()]

    lines = [ln.strip() for ln in pre_cep_text.splitlines() if ln.strip()]
    uni_lines: list[str] = []
    for ln in lines:
        low = ln.lower()
        if low.startswith(STREET_PREFIXES) or re.match(r"^\d", ln):
            break
        uni_lines.append(ln)
    universidade = " ".join(uni_lines).strip()
    universidade = re.sub(r"\s+", " ", universidade).rstrip(",. ")
    if not universidade:
        universidade = None
    return universidade, cidade, uf, pais


def _parse_area_entry(entry_text: str) -> dict | None:
    """Divide 'Ciências Biológicas / Área: Ecologia / Subárea: Ecologia Aplicada.'
    em {grande_area, area, subarea, especialidade}."""
    grande_area = area = subarea = especialidade = None

    parts = re.split(r"/\s*[ÁA]rea:\s*", entry_text, maxsplit=1)
    grande_area = parts[0].strip().rstrip(". ").strip() or None
    rest = parts[1] if len(parts) == 2 else ""

    parts = re.split(r"/\s*Sub[áa]rea:\s*", rest, maxsplit=1)
    area = parts[0].strip().rstrip(". ").strip() or None
    rest = parts[1] if len(parts) == 2 else ""

    parts = re.split(r"/\s*Especialidade:\s*", rest, maxsplit=1)
    subarea = parts[0].strip().rstrip(". ").strip() or None
    especialidade = parts[1].strip().rstrip(". ").strip() or None if len(parts) == 2 else None

    if not grande_area:
        return None
    return {
        "grande_area": grande_area, "area": area,
        "subarea": subarea, "especialidade": especialidade,
    }


def _parse_areas_atuacao(text: str) -> list[dict]:
    m = re.search(r"Áreas de atuação", text)
    if not m:
        return []
    block = text[m.end():]
    end_positions = [em.start() for pat in AREAS_NEXT_HEADERS
                      for em in [re.search(pat, block)] if em]
    if end_positions:
        block = block[:min(end_positions)]

    normalized = re.sub(r"\s+", " ", block).strip()
    raw_entries = re.split(r"Grande\s*[áÁ]rea:\s*", normalized)[1:]

    areas: list[dict] = []
    for raw in raw_entries:
        raw = re.sub(r"\d+\.\s*$", "", raw).strip()
        parsed = _parse_area_entry(raw)
        if parsed:
            areas.append(parsed)
    return areas


def parse_lattes_pdf(pdf_path: Path, programa: str) -> Researcher:
    text = extract_text(pdf_path)
    r = Researcher(programa=programa, arquivo_origem=pdf_path.name)

    r.nome = _parse_nome(text)
    r.lattes_id = _parse_lattes_id(text)
    r.orcid = _parse_orcid(text)

    universidade, cidade, uf, pais_endereco = _parse_endereco_profissional(text)
    r.universidade = universidade
    r.cidade = cidade
    r.uf = uf

    pais_nacionalidade = _parse_pais_nacionalidade(text)
    r.pais = pais_endereco or pais_nacionalidade

    r.areas = _parse_areas_atuacao(text)

    if not r.nome:
        r.avisos.append("nome não encontrado")
    if not r.orcid:
        r.avisos.append("sem ORCID")
    if not r.cidade:
        r.avisos.append("cidade não encontrada")
    if not r.universidade:
        r.avisos.append("universidade não encontrada")

    return r
