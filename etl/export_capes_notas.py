"""
Exporta as notas CAPES (Avaliação Quadrienal 2021-2024) dos PPGs da UEA para
data/capes_notas.json, consumido pelo painel "Programas (PPG)" do dashboard.

Fonte: DATA BASE UEA/NOTAS PPG/Conceitos PPGs - UEA.xlsx
Layout da planilha: uma linha por PPG traz o conceito CAPES; linhas seguintes
sem "PROGRAMA DE PÓS-GRADUAÇÃO" preenchido são cursos adicionais (ex.:
Doutorado) do mesmo PPG e herdam seu conceito.

O código de cada PPG (campo "codigo") é o texto após o último " - " no nome
do programa (a sigla), com alguns ajustes manuais (CODE_OVERRIDES) para bater
exatamente com o valor gravado em researchers[].programas no dashboard.json —
esse valor vem do Lattes e nem sempre é a sigla oficial completa.
"""
import json
from pathlib import Path

import openpyxl

XLSX_PATH = Path(
    "/Users/macbookpro/Documents/POSDOC - MAC/PROJETOS DASHBOARDS/DATA BASE UEA/"
    "NOTAS PPG/Conceitos PPGs - UEA.xlsx"
)
OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "capes_notas.json"

# sigla extraída da planilha -> código usado em researchers[].programas
CODE_OVERRIDES = {
    "PPG PMBqBM": "PMBqBM",
    "PPG CLIAMB": "CLIAMB",
    "Rede PROFÁGUA": "PROFÁGUA",
    "Rede PROFNIT": "PROFNIT",
}


def clean(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def main():
    wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)
    ws = wb["Planilha1"]
    rows = list(ws.iter_rows(min_row=3, values_only=True))  # pula título + cabeçalho

    programas = []
    current = None

    for row in rows:
        uni, ord_ppg, nome_ppg, ord_curso, curso, nivel, modalidade, situacao, conceito = (
            clean(c) for c in row[:9]
        )
        if nome_ppg:
            sigla = nome_ppg.rsplit(" - ", 1)[-1].strip()
            codigo = CODE_OVERRIDES.get(sigla, sigla)
            current = {
                "codigo": codigo,
                "sigla": sigla,
                "nome": nome_ppg,
                "uniVinculo": uni,
                "conceito": conceito,
                "cursos": [],
            }
            programas.append(current)
        if current is None:
            continue  # linha fora de um PPG (não deveria ocorrer)
        current["cursos"].append({
            "curso": curso,
            "nivel": nivel,
            "modalidade": modalidade,
            "situacao": situacao,
        })

    niveis = sorted({c["nivel"] for p in programas for c in p["cursos"] if c["nivel"]})
    modalidades = sorted({c["modalidade"] for p in programas for c in p["cursos"] if c["modalidade"]})
    situacoes = sorted({c["situacao"] for p in programas for c in p["cursos"] if c["situacao"]})
    conceitos = sorted({p["conceito"] for p in programas if p["conceito"] is not None}, key=lambda v: str(v))

    out = {
        "programas": programas,
        "opcoes": {
            "niveis": niveis,
            "modalidades": modalidades,
            "situacoes": situacoes,
            "conceitos": conceitos,
        },
    }

    OUT_PATH.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK: {len(programas)} PPGs -> {OUT_PATH}")


if __name__ == "__main__":
    main()
