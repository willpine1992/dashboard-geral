ETL COMPLETO E FUNCIONANDO

Banco: DASHBOARD 2/output/gerbras.db (SQLite, 3 tabelas)

Tabela          | Conteúdo
--------------- | -------------------------------------------------------------------
researchers     | 158 pesquisadores únicos (169 CVs, 11 atuam em 2 programas) - nome,
                 | lattes_id, orcid, universidade, cidade, uf, pais, latitude,
                 | longitude, programa
publications    | 3.725 publicações dos últimos 5 anos (2021-2026), com DOI, título,
                 | ano, periódico
keywords        | 11.746 linhas (keyword + frequência) por pesquisador, vindas dos
                 | conceitos estruturados do OpenAlex

Cobertura: 135/158 (85%) têm ORCID e foram enriquecidos via OpenAlex; 139/158
(88%) têm coordenadas geográficas. Os que faltam (ORCID ou endereço)
genuinamente não têm essa informação no PDF Lattes - foi checado caso a caso,
não é bug do parser.

COMO FUNCIONA

1. lattes_parser.py lê os 169 PDFs (exclui os *_Curriculos_Reunidos.pdf e a
   pasta PPGs, que são duplicatas) via `pdftotext -layout` e extrai os campos
   de identificação/endereço.
2. geocode.py busca lat/long no Nominatim (cache em cache/geocode_cache.json).
3. openalex_enrich.py usa o ORCID como chave para buscar no OpenAlex DOIs,
   título, periódico e keywords dos últimos 5 anos (cache em
   cache/openalex_cache.json).
4. db.py grava tudo no SQLite, com upsert por lattes_id (reprocessar não
   duplica).
5. run_etl.py orquestra tudo:

     python3 etl/run_etl.py

   Flags disponíveis:
     --limit N          processa só os N primeiros CVs (teste rápido)
     --skip-geocode      não geocodifica
     --skip-openalex      não consulta OpenAlex
     --data-dir PATH      aponta para outra pasta de PDFs (padrão: DATA BASE)
     --from-year YYYY      sobrescreve o ano inicial da janela de 5 anos

Reexecuções são rápidas (~28s) graças ao cache - só bate na rede para ORCIDs
ou cidades novas que ainda não estão em cache. Único requisito externo é o
`pdftotext` (poppler), já instalado via Homebrew.
