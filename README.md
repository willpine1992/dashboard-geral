# GERBRAS · Parcerias Internacionais UEA

Dashboard interativo que cruza os pesquisadores da **Universidade do Estado
do Amazonas (UEA)** com potenciais parceiros de pesquisa no exterior, a
partir dos currículos Lattes, ORCID e das publicações indexadas no OpenAlex.
O cruzamento é genérico por país (coluna `foreign_country`), então múltiplos
países convivem na mesma base sem conflito — hoje a Alemanha está completa e
Gana em andamento (ver [Status por país](#status-por-país)).

**🔗 Site publicado:** https://willpine1992.github.io/dashboard-geral/

## O que tem no dashboard

| Página | Conteúdo |
|---|---|
| **Painel** (`docs/index.html`) | Filtros em cascata (Grande Área → Área → PPG → linha de pesquisa → professor), gráfico Sankey linha de pesquisa × instituição estrangeira, nuvem de palavras das instituições, mapa do país estrangeiro, ranking de linhas de pesquisa e de pesquisadores estrangeiros |
| **Mapa de Fluxo** (`docs/flowmap.html`) | Globo 3D arrastável/zoom com arcos de Manaus até cada instituição estrangeira; clicar num arco mostra o detalhe e permite voltar ao painel já filtrado |
| **Perfil do pesquisador** (`docs/professor.html`) | Ao clicar num pesquisador estrangeiro: dados pessoais, linhas de pesquisa em comum, professores da UEA conectados, dados da instituição (com mini-mapa e info ao vivo via OpenAlex) e lista de publicações reais (ORCID) |

Todo o site é **estático** (HTML/CSS/JS + um único JSON de dados, sem
backend) e roda inteiramente no navegador — publicado via GitHub Pages a
partir deste repositório.

## Estrutura do repositório

Este repositório é autocontido: ETL, dados e site publicado vivem todos
dentro de `DASHBOARD 2/`, sem depender de nenhuma pasta fora daqui.

```
DASHBOARD 2/
├── docs/                     # o dashboard publicado (GitHub Pages)
│   ├── index.html            # Página 1 — Painel
│   ├── flowmap.html          # Página 2 — Mapa de Fluxo
│   ├── professor.html        # Página 3 — Perfil do pesquisador
│   ├── css/style.css
│   ├── js/                   # common.js, charts.js, page1.js, flowmap.js, professor.js
│   └── lib/                  # D3, d3-sankey, d3-cloud, topojson (vendorizados, sem CDN)
│
├── data/
│   └── dashboard.json        # ⭐ fonte única de dados do site: { researchers, edges,
│                              #    institutions, manaus }, agregando todos os países
│
├── etl/                       # pipeline Python que gera data/dashboard.json
│   ├── lattes_parser.py      # extrai nome, ORCID, universidade, endereço dos PDFs Lattes
│   ├── geocode.py             # geocoding via Nominatim (cache local)
│   ├── openalex_enrich.py     # DOIs e keywords dos últimos 5 anos, via OpenAlex
│   ├── germany_match.py       # cruza keywords com pesquisadores/instituições da Alemanha
│   ├── db.py                  # schema SQLite (researchers, publications, keywords,
│   │                          #   research_areas, international_matches)
│   ├── run_etl.py              # orquestrador principal (Lattes -> banco)
│   ├── run_germany_match.py    # roda o cruzamento com a Alemanha
│   ├── export_dashboard_data.py  # gera data/dashboard.json a partir do banco
│   └── export_csv.py           # exporta as tabelas em CSV (separador `|`)
│
├── cache/                     # cache local de OpenAlex/Nominatim/matching (gitignored)
├── output/                    # gerbras.db (SQLite) + relatório do ETL (gitignored)
└── index.html                 # redireciona a raiz do site para docs/index.html
```

> `cache/` e `output/` **não são versionados** — o banco SQLite carrega dados
> pessoais dos professores (ORCID, endereço) extraídos dos currículos Lattes.
> Só `data/dashboard.json` (agregado, sem dado pessoal sensível) vai para o
> repositório público. O `.gitignore` já cuida disso.

## Como atualizar os dados

Com Python 3 e o `pdftotext` (poppler, `brew install poppler`) instalados:

```bash
cd "DASHBOARD 2"
python3 etl/run_etl.py                 # reprocessa os currículos Lattes -> banco
python3 etl/run_germany_match.py       # refaz o cruzamento com a Alemanha
python3 etl/export_dashboard_data.py   # gera data/dashboard.json a partir do banco
```

Reexecuções são rápidas graças ao cache local (`cache/`) — só bate na
internet para ORCIDs, cidades ou instituições novas.

Depois é só commitar e dar push: o GitHub Pages republica sozinho em ~1
minuto.

## Como rodar localmente

O dashboard precisa ser servido por HTTP (não abrir o `.html` direto, por
causa do CORS no `fetch` do JSON) e servido a partir da **raiz** de
`DASHBOARD 2/`, porque `docs/js/common.js` busca os dados em
`../data/dashboard.json`:

```bash
cd "DASHBOARD 2"
python3 -m http.server 8000
```

Depois abra `http://localhost:8000/docs/index.html`.

## Status por país

| País | Situação |
|---|---|
| Alemanha | Completo — 158 pesquisadores UEA, ~2.100 arestas de cruzamento, 208 instituições |
| Gana | Parcial — estrutura da University of Ghana e script de cruzamento prontos, falta rodar o cruzamento completo |
| África do Sul | Parcial — base de pesquisadores da University of Johannesburg via OpenAlex, ainda não integrada ao cruzamento |
| Angola, Argélia, Moçambique | A montar |

Ver `WEBSCRAPING/README.txt` (fora deste repo) para o passo a passo completo
de como adicionar um país novo.

## Fontes de dados

- **Lattes (CNPq)** — identificação, ORCID, universidade/endereço, áreas de
  atuação (Grande Área/Área/Subárea/Especialidade)
- **OpenAlex** — DOIs, keywords e publicações dos últimos 5 anos, por ORCID
- **Nominatim (OpenStreetMap)** — geocoding de cidades e instituições
- **ORCID** — perfil público usado como canal de contato dos pesquisadores
  estrangeiros (não coletamos e-mail/telefone)

## Limitações conhecidas

- Nem todo pesquisador da UEA tem ORCID no Lattes — sem ORCID, não há
  enriquecimento via OpenAlex (DOIs/keywords ficam vazios para esse registro).
- Coordenadas de algumas instituições estrangeiras são aproximadas (nível de
  cidade), quando o nome não é resolvido pelo Nominatim.
