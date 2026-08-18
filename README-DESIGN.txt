================================================================================
 README-DESIGN — Especificação de design do dashboard publicado (PROPESP)
================================================================================
Atualizado em: 2026-08-17

Este arquivo é um PROMPT/BRIEFING autocontido para replicar o design e o
comportamento deste dashboard com outra base de dados. Não descreve "o que
o código faz" em termos de implementação — descreve decisões de design
(cores, tipografia, layout, interação) com precisão suficiente para
reconstruir a experiência do zero, inclusive por outro agente de IA sem
acesso a este repositório.

Site de referência (como está publicado hoje):
  https://willpine1992.github.io/dashboard-geral/

--------------------------------------------------------------------------------
0. RESUMO EM UMA FRASE
--------------------------------------------------------------------------------
Um dashboard estático (HTML/CSS/JS puro, sem framework, sem build step) com
3 páginas que exploram uma rede de conexões entre um grupo de origem (ex.:
pesquisadores de uma universidade) e "destinos" categorizados por país/
instituição, usando D3.js para todas as visualizações: um diagrama Sankey
central, um mapa coroplético, um ranking em barras, um globo 3D com arcos de
fluxo geográfico, e páginas de perfil individual. Estética "clara, bordas
finas verdes, motion estilo Apple" — superfícies brancas, uma cor de
acento verde-escura, cantos arredondados generosos, sombras muito sutis,
transições rápidas com easing customizado, tema claro/escuro completo.

--------------------------------------------------------------------------------
1. STACK TÉCNICO E RESTRIÇÕES
--------------------------------------------------------------------------------
  - Zero framework, zero bundler, zero build step. Só HTML/CSS/JS servidos
    como arquivos estáticos (funciona em GitHub Pages, S3, qualquer host
    estático — inclusive `python3 -m http.server` local).
  - Bibliotecas, todas vendorizadas em lib/ (sem CDN, pra funcionar offline
    e não depender de terceiros no ar):
      - D3.js v7 (core)
      - d3-sankey (só na página 1, pro diagrama Sankey)
      - topojson-client (pra converter o TopoJSON do mundo em GeoJSON)
      - um arquivo TopoJSON de países do mundo em baixa resolução
        (ex.: world-atlas/countries-110m — ~108 KB), usado pelo mapa
        coroplético e pelo globo 3D
  - Toda a UI é gerada via D3 selection/join (sem React/Vue/etc.) — os
    "componentes" são funções JS que recebem um elemento DOM + dados e
    desenham SVG dentro dele.
  - Fonte de dados: um ÚNICO arquivo JSON estático (não uma API), buscado
    uma vez por página via fetch() com `cache: "no-cache"` (sempre revalida
    com o servidor, já que os dados mudam a cada reexport do pipeline, mas
    não precisa de backend/servidor dinâmico).
  - Estado de filtro é 100% client-side e persistido na querystring da URL
    (?grandeArea=...&pais=...&professor=123), para permitir voltar/
    compartilhar/deep-link sem backend.
  - CSS: só custom properties (variáveis CSS) + media query de tema, sem
    pré-processador.

--------------------------------------------------------------------------------
2. MODELO DE DADOS (genérico, adaptar nomes de campo pro seu domínio)
--------------------------------------------------------------------------------
Um único arquivo JSON, ex. `data/dashboard.json`, com 4 chaves de topo:

  {
    "researchers":   [ ... ],   // entidades de ORIGEM (ex.: pesquisadores)
    "edges":         [ ... ],   // conexões entre origem e destino
    "institutions":  [ ... ],   // entidades de DESTINO agregadas (ex.: universidades)
    "manaus":        { ... }    // ponto de origem geográfico fixo (cidade-base)
  }

Adapte os nomes para o seu domínio (ex.: "produtos"/"fornecedores",
"funcionários"/"clientes" etc.) — a estrutura relacional é o que importa:

  researchers[i] = {
    id, nome,
    orcid,                          // identificador único opcional
    universidade, cidade, uf, pais, // metadados de origem
    lat, lon,                       // geocoding da origem (pode ser null)
    programas: [string],            // categorias/grupos (multi-valor)
    grande_areas: [string],         // taxonomia nível 1 (multi-valor)
    areas: [string],                // taxonomia nível 2 (multi-valor)
    n_publicacoes: int,
    n_matches: int,                 // contagem de conexões — usado em toda
                                     // a UI pra dimensionar/colorir
  }

  edges[i] = {
    researcher_id,                  // FK -> researchers[].id
    keyword,                        // a "linha de pesquisa"/categoria da conexão
    foreign_author_name, foreign_author_orcid, foreign_author_openalex_id,
    foreign_institution,            // nome da instituição de destino
    foreign_country,                // país de destino (chave pro mapa/filtro)
    sample_work_title, sample_work_doi,  // 1 exemplo concreto da conexão
  }

  institutions[i] = {
    instituicao, pais,
    lat, lon,                       // geocoding do destino (pode ser null —
                                     // ver seção 8 sobre fallback)
    n_matches, n_researchers,       // agregados pré-calculados
  }

  manaus = { cidade, uf, pais, lat, lon }   // origem fixa, usada como o
                                             // "centro" do globo de fluxo

IMPORTANTE: os agregados (n_matches, n_researchers, contagens por keyword)
são pré-calculados no pipeline de dados, NÃO no cliente a cada render —
o JS só faz `countBy`/`topEntries` sobre arrays já pequenos (dezenas a
poucas centenas de itens). Se sua base for maior, pré-agregue no back-end/
ETL, não tente escalar esse padrão de app 100% client-side para dezenas de
milhares de linhas sem paginação.

--------------------------------------------------------------------------------
3. DESIGN SYSTEM — TOKENS EXATOS
--------------------------------------------------------------------------------
Tudo declarado como CSS custom properties em `:root`, redefinido em bloco
`@media (prefers-color-scheme: dark)` E em `:root[data-theme="dark"]`
(dois lugares, ver seção 9 sobre o toggle de tema). O JS lê essas variáveis
via `getComputedStyle` pra colorir os gráficos D3 (que não entendem CSS
var() diretamente em atributos SVG como `fill`).

TEMA CLARO (padrão):
  Superfícies:
    --surface-page:   #ffffff   (fundo da página)
    --surface-panel:  #ffffff   (fundo dos cards)
    --surface-alt:    #f6faf8   (fundo de inputs, tiles, esqueleto de loading)
    --surface-hover:  #eef8f2   (hover de itens de lista)
  Texto:
    --ink-primary:    #0b3d2b   (verde bem escuro — títulos, valores em destaque)
    --ink-secondary:  #3a3a3c   (cinza escuro — corpo de texto)
    --ink-muted:      #7a8580   (cinza médio — legendas, eixos, metadados)
    --ink-on-accent:  #ffffff   (texto sobre fundo colorido/escuro)
  Bordas:
    --border-hairline: #cdeedd  (verde bem claro, 1px, quase todo painel)
    --border-strong:   #9fd9bb  (hover/estado ativo)
  Acento interativo:
    --accent:         #1f8a5f
    --accent-strong:  #0b6b45   (hover de botão primário, links)
    --accent-wash:    rgba(31, 138, 95, 0.08)  (fundo de item selecionado)
  Paleta categórica (linhas de pesquisa / séries — 8 cores, a 8ª é reservada
  pro bucket "outras"):
    --cat-1: #2a78d6 (azul)     --cat-5: #e87ba4 (magenta)
    --cat-2: #eb6834 (laranja)  --cat-6: #008300 (verde)
    --cat-3: #1baf7a (água)     --cat-7: #4a3aa7 (violeta)
    --cat-4: #eda100 (amarelo)  --cat-8: #e34948 (vermelho — SEMPRE "outras")
  Sequencial (mapas de calor / choropleth, 7 degradês do mesmo verde):
    --chart-seq-1: #eaf7f0 (mais claro) ... --chart-seq-7: #0b5c3a (mais escuro)
  Cromo neutro de mapas/gráficos (lido via JS):
    --chart-map-fill:   #eef5f1
    --chart-map-border: #0b6b45  (ver seção 8 — precisa ter ALTO CONTRASTE
                                   com o fill, não um tom quase igual)
    --chart-node-neutral: #0b3d2b

TEMA ESCURO (@media prefers-color-scheme:dark E [data-theme="dark"]):
    --surface-page:   #0a100c   --ink-primary:   #7fe8ab
    --surface-panel:  #101712   --ink-secondary: #e7ebe8
    --surface-alt:    #171f1a   --ink-muted:     #93a196
    --surface-hover:  #1e2921   --ink-on-accent: #06120a
    --border-hairline: #24352b  --accent:        #34d399
    --border-strong:   #3a5a45  --accent-strong: #6ee7b8
    --accent-wash: rgba(52, 211, 153, 0.16)
    --cat-1..8: mesmas cores da paleta clara, mas dessaturadas ~15% e
      clareadas pra manter contraste em fundo escuro (ex.: cat-1 vira
      #3987e5 em vez de #2a78d6)
    --chart-map-fill:   #1c2620
    --chart-map-border: #6ee7b8  (agora CLARO sobre fundo escuro — o
                                   princípio é sempre alto contraste
                                   fill×border, nunca uma cor fixa)
    --chart-seq-1..7: degradê verde invertido (mais escuro pro mais claro)

Geometria:
    --radius-sm: 10px   --radius-md: 16px   --radius-lg: 22px
    --radius-pill: 999px (botões, badges, chips)
Sombra (3 níveis, sempre tingida da cor de tinta primária, não preto puro):
    --shadow-sm: 0 1px 2px rgba(11,61,43,.05), 0 1px 1px rgba(11,61,43,.03)
    --shadow-md: 0 8px 24px rgba(11,61,43,.08)
    --shadow-lift: 0 12px 32px rgba(11,61,43,.14)  (tooltip, painel flutuante)
Motion — 1 curva de easing usada em TUDO, "estilo Apple":
    --ease: cubic-bezier(0.32, 0.72, 0, 1)
    --dur-fast: 160ms  (hover, toggle)
    --dur-mid:  280ms  (fill de barra/mapa, box-shadow)
    --dur-slow: 480ms  (entrada dos painéis ao carregar a página)
Tipografia:
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display",
      "SF Pro Text", "Segoe UI", "Helvetica Neue", Arial, sans-serif
    Escala: 10px (metadado) → 11-12.5px (corpo/listas) → 13-15px (títulos
    de card) → 16-22px (h1) → 26px (destaque grande, raro)
    Títulos de painel: 12px, weight 700, UPPERCASE, letter-spacing 0.06em,
    cor --ink-primary — esse é o "assinatura visual" mais repetido do
    design, use em todo header de card.

--------------------------------------------------------------------------------
4. LAYOUT — GRID DE 3 COLUNAS (página principal)
--------------------------------------------------------------------------------
  html, body: height 100%, overflow HIDDEN (a página nunca rola — só as
  colunas internas rolam). Isso é uma decisão central: o dashboard se
  comporta como um app de uma tela só, não como uma página longa.

  .topbar: altura 10vh (mín. 56px), sticky no topo via posição normal
    (não precisa de position:sticky porque o body não rola), com
    backdrop-filter: blur(14px) saturate(180%) e fundo semi-transparente
    (rgba do surface-page, opacidade ~0.9). Contém: logo + título à
    esquerda, estatísticas numéricas ao centro-direita (grandes números +
    label pequeno abaixo), navegação por abas + botão de tema + botão
    "limpar filtros" à direita.

  .layout: `display: grid; grid-template-columns: 20fr 60fr 20fr; gap: 16px;
    padding: 16px;` height = 100vh - altura da topbar.
    - Coluna esquerda (20%): filtros, em ordem de cima pra baixo do mais
      genérico pro mais específico (área temática → subcategoria →
      programas/grupos → categoria específica com clique-pra-filtrar →
      lista de busca da entidade principal).
    - Coluna central (60%): O GRÁFICO PRINCIPAL, sozinho, ocupando toda a
      coluna (1 painel `panel--grow`). É deliberadamente a maior área da
      tela — o Sankey é o "herói" da página.
    - Coluna direita (20%): painéis menores empilhados — 1 filtro extra
      (dropdown), 1 mapa pequeno, 1 gráfico de barras, 1 ranking em lista.

  Cada coluna: `overflow-y: auto` (rola independente), `gap: 14px` entre
  os cards.

  Responsivo: abaixo de 980px, a grid vira 1 coluna e a página passa a
  rolar normalmente (overflow: auto no body). Não há breakpoint
  intermediário — é desktop-first, com um fallback simples pra mobile.

--------------------------------------------------------------------------------
5. COMPONENTE "PANEL" — o átomo visual de todo o dashboard
--------------------------------------------------------------------------------
Todo bloco de conteúdo é um `.panel`:
  fundo --surface-panel, borda 1px --border-hairline, radius 16px,
  shadow-sm, padding 14px 16px, transição de shadow/borda em hover
  (shadow-md + border-strong).

Header do panel (`.panel__header`): flex space-between, título uppercase
12px à esquerda (ver seção 3), "hint" pequeno opcional à direita (10.5px,
cor muted — normalmente uma contagem tipo "43 conexões" ou instrução tipo
"clique p/ filtrar").

Variante `.panel--grow`: flex:1, usado quando o card deve esticar pra
preencher o espaço vertical restante da coluna (listas, o Sankey).

Animação de entrada: todo `.panel` nasce com `rise-in` (opacity 0→1,
translateY 10px→0, 480ms), com delay escalonado por coluna/posição (20ms,
60ms, 100ms, 140ms...) — dá a sensação de "cascata" no primeiro load, não
tudo aparecendo de uma vez.

--------------------------------------------------------------------------------
6. GRÁFICO CENTRAL — DIAGRAMA SANKEY (o "herói")
--------------------------------------------------------------------------------
Biblioteca: d3-sankey. Layout horizontal, nós à esquerda = categoria da
conexão (ex. "linha de pesquisa"), nós à direita = entidade de destino
(ex. "instituição estrangeira").

CONSTRUÇÃO DO GRAFO:
  1. Categoriza a categoria em "top N com cor própria" (N=7, ver paleta
     categórica) + 1 bucket "Outras <categoria>" pro resto.
  2. Categoriza o destino em "top M mais frequentes" (M=13, configurável)
     + 1 bucket "Outras <destino>" pro resto.
  3. Cada combinação (categoria_bucket, destino_bucket) vira 1 link, com
     peso = contagem de conexões reais.
  4. *** REGRA DE PRIORIZAÇÃO VISUAL (importante) ***: os links que tocam
     um bucket "Outras..." recebem peso FIXO e pequeno no layout (ex. 1),
     independente de quantas conexões reais foram agregadas ali — só os
     nós/categorias NOMEADOS individualmente têm espessura proporcional ao
     valor real. Sem essa regra, um bucket "outras" que agrega centenas de
     conexões dispersas visualmente engole o diagrama inteiro e esconde
     os resultados específicos, que são o que interessa mostrar. Guarde o
     valor real separado (ex. campo `realValue`) só pra exibir no tooltip
     — a geometria do desenho usa o valor achatado.
  5. Links que tocam "Outras..." são desenhados PRIMEIRO (ficam por baixo
     visualmente quando cruzam com os nomeados) e com opacidade/espessura
     mínima menor (~metade da opacidade padrão, floor de stroke-width bem
     fino) — reforça que são "ruído de fundo", não o foco.
  6. `nodeSort` por valor decrescente — como o bucket "Outras" tem peso
     achatado, ele naturalmente cai pro fim/base da coluna, virando "quase
     invisível e por último" sem lógica extra.

LAYOUT VISUAL:
  nodeWidth: 12px | nodePadding: 14px | extent com margem de 150px à
  esquerda e 165px à direita (espaço pros rótulos de texto fora das barras)

  Nó: retângulo arredondado (rx 4), preenchido com a cor categórica (lado
  esquerdo) ou uma cor neutra sólida (lado direito — o destino não tem
  "cor própria", só o texto). Rótulo de texto ancorado do lado de fora do
  nó (end/right conforme o lado), 11px semibold.

  Link: path do d3.sankeyLinkHorizontal, stroke = cor da categoria de
  origem, stroke-opacity 0.42 (0.22 se for link "Outras"), stroke-width =
  largura calculada pelo layout com floor mínimo de 1.2px (0.6px se
  "Outras") — links nunca ficam invisivelmente finos, sempre há um piso.

INTERAÇÃO:
  - Hover num link ou nó: "dim" (esmaece pra opacity 0.06/0.15) tudo que
    NÃO está conectado ao elemento sob o mouse; tooltip flutuante com
    nome + contagem REAL (não a achatada).
  - Clique num nó nomeado (não nos buckets "Outras"): dispara um filtro
    global — clicar numa categoria filtra por ela, clicar num destino
    filtra a lista principal de entidades pra só as conectadas àquele
    destino (ver seção 10, filtros combináveis). Nó ativo/selecionado
    ganha `stroke` mais grosso (2.5px) na cor --ink-primary e texto em
    negrito — feedback visual claro de "isso está aplicado".
  - Cursor: pointer nos nós clicáveis, default nos buckets "Outras".

--------------------------------------------------------------------------------
7. GRÁFICO PEQUENO 1 — MAPA COROPLÉTICO (país de destino)
--------------------------------------------------------------------------------
D3 geoMercator + topojson, painel pequeno (~200px de altura) na coluna
lateral. Enquadra DINAMICAMENTE só os países que têm conexões nos dados
filtrados atuais (fitExtent na FeatureCollection filtrada, não no mundo
inteiro) — importante pra funcionar com qualquer número de países sem
hardcode. Se não houver nenhum match, cai pra enquadrar a esfera inteira.

Preenchimento: escala sequencial (7 degradês verdes) por contagem de
conexões daquele país; países sem conexão ficam com o fill neutro
(--chart-map-fill). Traço de borda de todos os países = --chart-map-border,
stroke-width 1px (ver seção 8, motivo do valor).

Tooltip on-hover só nos países com dado (mostra nome + contagem).

Precisa de uma função de normalização de nome de país: o TopoJSON tem
nomes em inglês ("Germany", "Ghana"...), seus dados provavelmente usam
nomes localizados ("Alemanha", "Gana"...) — mantenha um dicionário de
tradução explícito e ADICIONE UMA ENTRADA A CADA PAÍS NOVO que entrar na
base, senão o país nunca aparece destacado no mapa mesmo tendo dado certo.

--------------------------------------------------------------------------------
8. REGRA DE OURO — CONTRASTE DE MAPA (bug real que já aconteceu aqui)
--------------------------------------------------------------------------------
Dois problemas reais encontrados e corrigidos neste dashboard, documentados
aqui pra não se repetirem na réplica:

  a) Contraste fill×border do mapa: se a cor de borda do país for quase
     igual à cor de preenchimento (ex. branco sobre um verde bem claro),
     as fronteiras ficam PRATICAMENTE INVISÍVEIS — pior ainda projetado
     num telão/datashow, que reduz contraste natural da imagem. Regra:
     calcule o contraste WCAG entre --chart-map-fill e --chart-map-border
     e garanta pelo menos ~5:1 em ambos os temas (aqui, o valor antigo
     era 1.1:1 no claro e 1.2:1 no escuro — corrigido pra 5.9:1 e 10.2:1
     trocando a cor da borda, não o fill). Stroke-width mínimo de 1px nos
     três lugares que desenham país (mapa pequeno, mapa do globo,
     mini-mapa de instituição) — abaixo disso some em qualquer tela grande.

  b) Geocoding do destino não pode assumir um único país fixo: se seu
     pipeline de geocoding usa um hint de país fixo (ex. sempre "Alemanha")
     pra resolver o endereço de QUALQUER instituição, instituições de
     outros países vão falhar a busca e cair num fallback também fixo —
     resultado: uma universidade de Gana aparecia cravada no centro
     geográfico da Alemanha. Regra: sempre geocodifique com o país REAL
     daquela instituição, e tenha um dicionário de fallback POR PAÍS (não
     um fallback global único) pro caso do geocoder não resolver o nome.
     Prefira um fallback honesto (centro do país) a uma coordenada
     "precisa" porém não verificada — geocoders fuzzy-match podem
     resolver pro campus errado com um nome ambíguo, o que é pior que
     admitir imprecisão.

--------------------------------------------------------------------------------
9. GRÁFICO PEQUENO 2 — RANKING EM BARRAS HORIZONTAIS
--------------------------------------------------------------------------------
Sem eixo, sem grid — cada linha é: rótulo de texto (truncado em ~26
caracteres) acima, trilho cheio (barra de fundo --surface-alt) com uma
barra de preenchimento colorida por cima (largura proporcional ao valor
sobre o máximo do top-N exibido, floor de 4px), valor numérico alinhado à
direita. Altura de cada linha = altura total / N linhas (top 6-8, sempre
poucas — é um "at a glance", não uma tabela completa). Cor da barra =
mesma paleta categórica usada no Sankey (consistência entre os dois
gráficos é o que faz eles lerem como "do mesmo sistema").

--------------------------------------------------------------------------------
10. FILTROS DA COLUNA ESQUERDA/DIREITA
--------------------------------------------------------------------------------
5 tipos de filtro, TODOS combináveis entre si (AND lógico) e persistidos
na querystring da URL a cada mudança (`history.replaceState`, não
`pushState` — não quer poluir o histórico do navegador a cada clique):

  1. Dois `<select>` em cascata (categoria nível 1 → nível 2): mudar o
     nível 1 reseta e repopula as opções do nível 2 filtradas por ele.
  2. Checklist multi-seleção (ex. "programas"): cada linha mostra o rótulo
     + contagem calculada sobre o subconjunto já filtrado pelos filtros
     acima (não sobre o total geral) — os números mudam junto conforme
     você refina outros filtros, reforçando que tudo está conectado.
  3. Lista "pick" de clique único-mas-múltiplo (ex. "linhas de pesquisa"):
     linhas com uma bolinha colorida (mesma cor do Sankey/barras) + label
     + contagem; clicar dá toggle (adiciona/remove de um Set), item ativo
     ganha fundo --accent-wash e borda --border-strong.
  4. Busca por texto livre + lista da entidade principal (debounce ~120ms
     no input), com contagem "X selecionados / Y total" no header do card.
  5. Dropdown simples de categoria "achatada" (ex. país) — populado
     DINAMICAMENTE a partir dos valores distintos presentes nos dados
     (`[...new Set(edges.map(e => e.campo))].sort()`), nunca com uma lista
     hardcoded — é assim que a réplica "aprende" categorias novas sozinha
     conforme a base cresce.

  Botão "Limpar filtros": reseta todo o estado pro objeto vazio inicial e
  repopula os selects — sempre disponível na topbar.

  REGRA DE DEPENDÊNCIA ENTRE FILTROS: se dois filtros formam uma hierarquia
  implícita (ex. "instituição" pertence a um "país"), ao trocar o mais
  genérico (país), verifique se o valor do mais específico (instituição)
  ainda é compatível — se não for, limpe-o automaticamente. Evita o
  usuário ficar com uma combinação de filtros que nunca bate com nada e
  não entender por que a tela ficou vazia.

  REGRA DE FILTRO DERIVADO POR RELACIONAMENTO: alguns filtros (destino/
  instituição, país) não são atributos diretos da entidade principal —
  são inferidos via edges. Pra aplicar esse filtro na lista principal,
  primeiro filtre as edges pelo critério, depois derive o conjunto de IDs
  de entidades principais que aparecem nessas edges, e SÓ ENTÃO filtre a
  lista principal por esse conjunto de IDs — não tente adicionar um campo
  "país" direto na entidade principal (ela pode ter conexões com vários
  países ao mesmo tempo).

--------------------------------------------------------------------------------
11. PÁGINA 2 — GLOBO 3D DE FLUXO ("Mapa de Fluxo")
--------------------------------------------------------------------------------
Página inteira dedicada a 1 visualização full-bleed: um globo 3D
(`d3.geoOrthographic`) com arcos curvos ligando o ponto de origem fixo
(ex. a cidade-base) a cada destino, espessura/cor do arco proporcional ao
volume de conexões (mesma escala sequencial verde do resto do dashboard).

  - Rotação: arrastar com o mouse gira o globo (sensibilidade calibrada
    por `60 / projection.scale()`, clampando latitude a ±89°).
  - Zoom: scroll do mouse, fator ~1.12x por "tick", limitado a
    [escala_inicial × 0.55, escala_inicial × 5].
  - Ponto de origem: círculo sólido com 2 anéis de pulso animados via SVG
    `<animate>` (raio 6→20 e opacidade 0.5→0, loop de 3s) — o único
    elemento com animação contínua da página, chama atenção pro "centro".
  - Destinos ocultos quando saem do hemisfério visível (`d3.geoDistance`
    do ponto até o centro de rotação > 90°) — `display:none`, não deletar
    do DOM (senão perde o bind de dado a cada frame).
  - Clique num arco/ponto: abre um painel de detalhe FLUTUANTE fixo no
    canto inferior direito (`position:fixed`, animação de entrada
    translateY+scale), com nome do destino, tags de categorias em comum, e
    lista de entidades de origem conectadas — cada uma linkando de volta
    pra página 1 já com o filtro de entidade aplicado (`?entidade=ID`).
  - Legenda simples de 3 degraus de cor no header da página (não é uma
    escala contínua, só "poucas / moderadas / muitas conexões").

--------------------------------------------------------------------------------
12. PÁGINA 3 — PERFIL INDIVIDUAL (entidade de destino)
--------------------------------------------------------------------------------
Grid de 3 colunas com proporção diferente da página 1 (30fr 40fr 30fr, mais
equilibrada — aqui não há "1 gráfico hero", são 3 blocos de informação
igualmente importantes):

  Coluna 1 (pessoal): avatar circular com iniciais + cor determinada por
  hash determinístico do nome (mesma paleta categórica — sempre a mesma
  cor pra mesma pessoa, sem precisar guardar isso em lugar nenhum), nome,
  instituição/país, badges (links pra identificadores externos tipo
  ORCID), categorias em comum como "tags" (pill pequeno com fundo
  --accent-wash), lista de entidades de origem conectadas.

  Coluna 2 (instituição): nome, 2 "stat tiles" lado a lado (número grande
  + label pequeno), um mini-mapa de localização (mesmo estilo do mapa
  coroplético, só que centralizado num ponto único com marcador
  pulsante), e uma seção "sobre" que busca dados extras AO VIVO de uma API
  pública externa (aqui, OpenAlex) no carregamento da página — com
  skeleton loading (gradiente animado 1.4s) enquanto não chega.

  Coluna 3 (publicações/atividade): lista de "cards" com título + metadados
  (ano, fonte, link externo) — busca ao vivo na mesma API externa por
  ORCID; se não tiver ORCID ou a busca falhar, cai num fallback usando
  amostras de título/DOI que já vieram junto nos dados de conexão
  (garante que a coluna nunca fica vazia mesmo sem internet/API).

  Navegação: chega nessa página via querystring (`?id=X` ou `?nome=Y`),
  nunca por um menu — é sempre um "drill-down" a partir de um clique em
  outro lugar do dashboard. Botão "← Voltar" tenta `history.back()` se o
  referrer for do mesmo site, senão volta pro painel principal.

--------------------------------------------------------------------------------
13. TEMA CLARO/ESCURO
--------------------------------------------------------------------------------
  - Detecção: por padrão segue `prefers-color-scheme` do SO via media
    query CSS. Usuário pode forçar com um toggle (ícone sol/lua, botão
    circular 34px na topbar), que seta `data-theme="light|dark"` no
    `<html>` e salva em localStorage.
  - Pra evitar flash de tema errado no load, um `<script>` INLINE (não
    arquivo externo) no `<head>`, antes de qualquer CSS, lê o localStorage
    e já aplica o atributo `data-theme` síncronamente.
  - Troca de tema dispara um CustomEvent (`gerbras:themechange` — renomeie
    pro seu domínio) que toda página escuta pra RE-RENDERIZAR os gráficos
    D3 (eles leem cor via getComputedStyle no momento do desenho, então
    precisam redesenhar quando o tema muda — CSS var() sozinho não
    repinta SVG já desenhado).

--------------------------------------------------------------------------------
14. TOM DE MICROCOPY (textos de interface)
--------------------------------------------------------------------------------
  - Idioma do domínio (aqui, PT-BR), direto e informativo, sem gíria.
  - Estados vazios sempre têm uma frase explicativa, nunca só "vazio" ou
    tela em branco (ex. "Nenhuma parceria potencial para os filtros
    selecionados." em vez de sumir o painel).
  - Hints de painel (canto superior direito do header) são sempre um
    número ou uma instrução de ação curta ("clique p/ filtrar"), nunca
    texto longo.
  - Avisos de limitação de dado são explícitos e honestos (ex. "Não
    coletamos e-mail ou telefone diretamente das fontes públicas") — o
    design assume que o usuário vai notar campos ausentes e prefere
    explicar por que, em vez de fingir que o dado existe.

--------------------------------------------------------------------------------
15. CHECKLIST PRA REPLICAR COM OUTRA BASE
--------------------------------------------------------------------------------
  [ ] 1. Modele seu JSON único no formato da seção 2 (origem, edges,
         destino agregado, ponto-base).
  [ ] 2. Copie os tokens de design da seção 3 literalmente (cores, radius,
         sombra, motion) — é o que dá a identidade visual; só troque a
         cor de acento se quiser uma marca diferente, mantendo a MESMA
         estrutura de tokens (superfície/tinta/borda/acento/categórica/
         sequencial/neutro-de-mapa) nos dois temas.
  [ ] 3. Monte o grid de 3 colunas (seção 4) com o layout.css genérico —
         não depende dos seus dados.
  [ ] 4. Implemente o Sankey (seção 6) com a REGRA DE PRIORIZAÇÃO VISUAL do
         bucket "outras" — é o detalhe mais fácil de esquecer e o que mais
         estraga a legibilidade se pular.
  [ ] 5. Monte mapa coroplético + globo 3D (seções 7 e 11), com atenção ao
         contraste de borda e ao geocoding por-país (seção 8) desde o
         início — são os 2 bugs reais já cometidos aqui.
  [ ] 6. Filtros (seção 10): implemente primeiro os filtros diretos
         (atributo da entidade), depois os derivados por relacionamento
         (via edges) — nessa ordem, porque os derivados dependem da mesma
         função de narrowing dos diretos.
  [ ] 7. Página de perfil (seção 12) por último — é a que mais depende de
         API externa específica do seu domínio, adapte ou remova essa
         parte se não tiver uma fonte de enriquecimento ao vivo.
  [ ] 8. Tema escuro (seção 13) desde o início, não como "depois" — é
         muito mais barato fazer os dois temas nos tokens de uma vez do
         que retrofitar.
================================================================================
