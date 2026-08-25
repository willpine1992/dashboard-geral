/* ==========================================================================
   GERBRAS Dashboard — funções de gráfico (D3): Sankey, mapa, barras
   ========================================================================== */

/* ---------------- Sankey: linha de pesquisa (Lattes) -> keyword (OpenAlex) -> instituição estrangeira ---------------- */
const OTHER_INSTITUTIONS_LABEL = "Outras instituições";
const OTHER_KEYWORDS_LABEL = "outras keywords";

// as 3 colunas do Sankey — cada uma pode ser ativada/desativada individualmente
// (ver #sankey-col-toggles em page1.js); quando uma coluna do meio é
// desativada, as colunas vizinhas se conectam direto uma na outra.
const SANKEY_COLUMN_ORDER = ["linha", "keyword", "instituicao"];
const SANKEY_COLUMN_DEFS = {
  linha: { label: "Linha de pesquisa", key: (e) => e.keyword },
  keyword: { label: "Key word matching", key: (e) => e.keyword_en },
  instituicao: { label: "Instituição estrangeira", key: (e) => e.foreign_institution },
};

function buildSankeyGraph(edgeSubset, colorInfo, opts, activeIds) {
  const maxByCol = { linha: opts.maxLinhas, keyword: opts.maxKeywords, instituicao: opts.maxInstitutions };
  // colorInfo.scale só cobre as poucas linhas com cor própria (paleta
  // categórica validada, não dá pra inventar mais cores). Além dessas, uma
  // lista maior de linhas (maxLinhas) ainda aparece nomeada individualmente
  // no gráfico, só que na cor neutra "Outras" — só o que sobra dessa lista
  // maior é que vira de fato o balde agregado "Outras linhas de pesquisa".
  const otherLabelByCol = { linha: colorInfo.otherLabel, keyword: OTHER_KEYWORDS_LABEL, instituicao: OTHER_INSTITUTIONS_LABEL };

  const cols = activeIds.map((id) => {
    const def = SANKEY_COLUMN_DEFS[id];
    const counts = countBy(edgeSubset, def.key);
    const topList = topEntries(counts, maxByCol[id]).map(([k]) => k);
    return { id, key: def.key, label: def.label, otherLabel: otherLabelByCol[id], topSet: new Set(topList), topList };
  });

  const nodeRealTotal = new Map();
  const linkMaps = cols.slice(0, -1).map(() => new Map());
  // soma/contagem da similaridade de cosseno (SBERT) por link — só faz
  // sentido no par linha->keyword, que é onde esse matching acontece
  const linkScoreAgg = cols.slice(0, -1).map(() => new Map());
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  for (const e of edgeSubset) {
    const vals = cols.map((c) => (c.topSet.has(c.key(e)) ? c.key(e) : c.otherLabel));
    vals.forEach((v, i) => bump(nodeRealTotal, i + "::" + v));
    for (let i = 0; i < vals.length - 1; i++) {
      const linkKey = vals[i] + "|||" + vals[i + 1];
      bump(linkMaps[i], linkKey);
      if (cols[i].id === "linha" && e.cosine_similarity != null) {
        const agg = linkScoreAgg[i].get(linkKey) || { sum: 0, n: 0 };
        agg.sum += e.cosine_similarity;
        agg.n += 1;
        linkScoreAgg[i].set(linkKey, agg);
      }
    }
  }

  const nodes = [];
  const nodeIndex = new Map();
  cols.forEach((c, i) => {
    const order = [...c.topList, c.otherLabel].filter((n) => nodeRealTotal.has(i + "::" + n));
    order.forEach((name) => {
      nodeIndex.set(i + "::" + name, nodes.length);
      nodes.push({
        name, colId: c.id, colIndex: i,
        isFirst: i === 0, isLast: i === cols.length - 1,
        realValue: nodeRealTotal.get(i + "::" + name) || 0,
      });
    });
  });

  // links que tocam um bucket "Outras..." recebem espessura fixa e fina no
  // layout, independente de quantos resultados foram agregados ali — isso
  // dá prioridade visual às linhas/keywords/instituições nomeadas
  // individualmente, que continuam proporcionais ao valor real
  const OTHER_LINK_WEIGHT = 1;
  const links = [];
  linkMaps.forEach((map, i) => {
    const colA = cols[i], colB = cols[i + 1];
    for (const [key, value] of map.entries()) {
      const [a, b] = key.split("|||");
      const isOther = a === colA.otherLabel || b === colB.otherLabel;
      const scoreAgg = linkScoreAgg[i].get(key);
      links.push({
        source: nodeIndex.get(i + "::" + a),
        target: nodeIndex.get((i + 1) + "::" + b),
        value: isOther ? OTHER_LINK_WEIGHT : value,
        realValue: value,
        // só colore o link pela linha de origem quando a 1ª coluna do par É a
        // linha de pesquisa; nos demais casos (ex: keyword -> instituição) uma
        // keyword pode vir de mais de uma linha, então fica neutro
        keyword: colA.id === "linha" ? a : null,
        tooltipLabel: colA.id === "linha" ? a : b,
        // similaridade de cosseno média (SBERT) das conexões agregadas nesse
        // link — só existe no par linha->keyword; alimenta o card abaixo do
        // gráfico (ver #sbert-card em page1.js)
        avgSimilarity: scoreAgg ? scoreAgg.sum / scoreAgg.n : null,
        isOther,
      });
    }
  });
  links.sort((a, b) => (a.isOther === b.isOther ? 0 : a.isOther ? -1 : 1));

  return { nodes, links, cols };
}

function renderSankey(el, edgeSubset, colorInfo, opts = {}) {
  const container = d3.select(el);
  container.selectAll("*").remove();
  const width = el.clientWidth, height = el.clientHeight;

  const activeIds = SANKEY_COLUMN_ORDER.filter((id) => !opts.hiddenColumns || !opts.hiddenColumns.has(id));
  if (activeIds.length < 2) {
    container.append("div").attr("class", "empty-hint").text("Ative pelo menos duas colunas para ver as conexões.");
    return;
  }
  if (!edgeSubset.length || width < 10 || height < 10) {
    container.append("div").attr("class", "empty-hint").text("Nenhuma parceria potencial para os filtros selecionados.");
    return;
  }

  const maxInst = opts.maxInstitutions || 24;
  const maxLinhas = opts.maxLinhas || 22;
  const maxKeywords = opts.maxKeywords || 24;
  const graph = buildSankeyGraph(edgeSubset, colorInfo, { maxInstitutions: maxInst, maxLinhas, maxKeywords }, activeIds);

  const HEADER_H = 30;
  const sankeyLayout = d3.sankey()
    .nodeId((d) => d.index)
    .nodeWidth(10)
    .nodePadding(10)
    .nodeSort((a, b) => (b.value || 0) - (a.value || 0))
    .extent([[150, HEADER_H], [width - 165, height - 6]]);

  const graphNodes = graph.nodes.map((d, i) => ({ ...d, index: i }));
  const graphLinks = graph.links.map((d) => ({ ...d }));
  const { nodes, links } = sankeyLayout({ nodes: graphNodes, links: graphLinks });

  const svg = container.append("svg").attr("width", width).attr("height", height);

  const colorForName = (name) => (name === colorInfo.otherLabel ? colorInfo.otherColor : (colorInfo.scale.get(name) || colorInfo.otherColor));
  const colorForNode = (d) => (d.colId === "linha" ? colorForName(d.name) : CHART_NODE_NEUTRAL);
  const colorForLink = (keyword) => (keyword == null ? CHART_NODE_NEUTRAL : colorForName(keyword));

  // legenda "Linha de pesquisa" / "Key word matching" / "Instituição
  // estrangeira" acima de cada coluna atualmente visível
  const headerG = svg.append("g").attr("class", "sankey-col-headers");
  graph.cols.forEach((c, i) => {
    const colNodes = nodes.filter((n) => n.colIndex === i);
    if (!colNodes.length) return;
    const cx = (d3.min(colNodes, (n) => n.x0) + d3.max(colNodes, (n) => n.x1)) / 2;
    headerG.append("text")
      .attr("class", "sankey-col-title")
      .attr("x", cx).attr("y", HEADER_H - 12).attr("text-anchor", "middle")
      .text(c.label);
  });

  const linkG = svg.append("g").attr("fill", "none");
  const linkPaths = linkG.selectAll("path")
    .data(links)
    .join("path")
    .attr("class", "sankey-link")
    .attr("d", d3.sankeyLinkHorizontal())
    .attr("stroke", (d) => colorForLink(d.keyword))
    .attr("stroke-opacity", (d) => (d.isOther ? 0.22 : 0.42))
    .attr("stroke-width", (d) => Math.max(d.isOther ? 0.6 : 1.2, d.width));

  const nodeG = svg.append("g");
  const nodeSel = nodeG.selectAll("g")
    .data(nodes)
    .join("g")
    .attr("class", "sankey-node");

  nodeSel.append("rect")
    .attr("x", (d) => d.x0)
    .attr("y", (d) => d.y0)
    .attr("width", (d) => d.x1 - d.x0)
    .attr("height", (d) => Math.max(2, d.y1 - d.y0))
    .attr("rx", 3)
    .attr("fill", colorForNode);

  // colunas que não são a primeira nem a última não levam rótulo fixo —
  // muitos nós lado a lado não deixariam espaço pro texto sem sobrepor a
  // coluna seguinte; o nome ainda aparece via hover (title + tooltip)
  nodeSel.filter((d) => d.isFirst || d.isLast).append("text")
    .attr("x", (d) => (d.isFirst ? d.x0 - 8 : d.x1 + 8))
    .attr("y", (d) => (d.y0 + d.y1) / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", (d) => (d.isFirst ? "end" : "start"))
    .text((d) => truncateLabel(d.name, d.isFirst ? 24 : 30));

  nodeSel.append("title").text((d) => `${d.name}\n${fmt(d.realValue)} conexão(ões)`);

  function dim(predicateLink, predicateNode) {
    linkPaths.classed("is-dim", predicateLink);
    nodeSel.classed("is-dim", predicateNode);
  }

  const isClickable = (d) =>
    (d.colId === "linha" && d.name !== colorInfo.otherLabel) ||
    (d.colId === "instituicao" && d.name !== OTHER_INSTITUTIONS_LABEL);
  const activeLinhas = opts.activeLinhas || new Set();
  nodeSel.classed("is-selected", (d) =>
    (d.colId === "linha" && activeLinhas.has(d.name)) ||
    (d.colId === "instituicao" && !!opts.activeInstituicao && d.name === opts.activeInstituicao)
  );

  linkPaths
    .on("mousemove", function (ev, d) {
      dim((l) => l !== d, (n) => n !== d.source && n !== d.target);
      showTooltip(ev.clientX, ev.clientY,
        `<b>${d.tooltipLabel}</b><br>${truncateLabel(d.target.name, 40)}<br>${fmt(d.realValue)} conexão(ões)` +
        (d.avgSimilarity != null ? `<br>Similaridade (SBERT): ${d.avgSimilarity.toFixed(2)}` : ""));
      opts.onLinkHover && opts.onLinkHover(d);
    })
    .on("mouseleave", function () { dim(() => false, () => false); hideTooltip(); opts.onLinkHover && opts.onLinkHover(null); });

  nodeSel
    .style("cursor", (d) => (isClickable(d) ? "pointer" : "default"))
    .on("click", (ev, d) => {
      if (!isClickable(d)) return;
      if (d.colId === "linha") opts.onLinhaClick && opts.onLinhaClick(d.name);
      else if (d.colId === "instituicao") opts.onInstituicaoClick && opts.onInstituicaoClick(d.name);
    })
    .on("mousemove", function (ev, d) {
      dim((l) => l.source !== d && l.target !== d, (n) => n !== d);
      showTooltip(ev.clientX, ev.clientY, `<b>${d.name}</b><br>${fmt(d.realValue)} conexão(ões)`);
    })
    .on("mouseleave", function () { dim(() => false, () => false); hideTooltip(); opts.onLinkHover && opts.onLinkHover(null); });
}

function truncateLabel(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

/* ---------------- Mapa: países estrangeiros com match ---------------- */
let _worldCache = null;
async function getWorld() {
  if (!_worldCache) {
    const topo = await fetch("lib/countries-110m.json").then((r) => r.json());
    _worldCache = topojson.feature(topo, topo.objects.countries);
  }
  return _worldCache;
}

/* ---------------- Mini-mapa: localização de uma instituição ---------------- */
async function renderInstitutionMap(el, lat, lon, label) {
  const container = d3.select(el);
  container.selectAll("*").remove();
  const width = el.clientWidth, height = el.clientHeight;
  if (width < 10 || height < 10) return;

  const world = await getWorld();
  const pad = 5; // graus ao redor do ponto
  const bbox = {
    type: "Polygon",
    coordinates: [[[lon - pad, lat - pad], [lon + pad, lat - pad], [lon + pad, lat + pad], [lon - pad, lat + pad], [lon - pad, lat - pad]]],
  };
  const projection = d3.geoMercator().fitExtent([[10, 10], [width - 10, height - 10]], bbox);
  const path = d3.geoPath(projection);

  const svg = container.append("svg").attr("width", width).attr("height", height);
  svg.append("g").selectAll("path.country")
    .data(world.features)
    .join("path")
    .attr("class", "map-country")
    .attr("fill", CHART_MAP_FILL)
    .attr("stroke", CHART_MAP_BORDER)
    .attr("stroke-width", 1)
    .attr("d", path);

  const xy = projection([lon, lat]);
  const g = svg.append("g").attr("transform", `translate(${xy[0]},${xy[1]})`);
  g.append("circle").attr("r", 7).attr("fill", CHART_NODE_NEUTRAL).attr("stroke", CHART_MAP_BORDER).attr("stroke-width", 2);
  g.append("circle").attr("r", 7).attr("fill", "none").attr("stroke", CHART_NODE_NEUTRAL).attr("stroke-width", 1.4).attr("opacity", 0.5)
    .append("animate").attr("attributeName", "r").attr("values", "7;20;7").attr("dur", "2.4s").attr("repeatCount", "indefinite");

  if (label) {
    svg.append("text").attr("x", xy[0]).attr("y", xy[1] - 14).attr("text-anchor", "middle")
      .attr("class", "bar-label").style("font-weight", 800)
      .text(truncateLabel(label, 30));
  }
}

async function renderCountryMap(el, edgeSubset) {
  const container = d3.select(el);
  container.selectAll("*").remove();
  const width = el.clientWidth, height = el.clientHeight;
  if (width < 10 || height < 10) return;

  const world = await getWorld();
  const counts = countBy(edgeSubset, (e) => e.foreign_country);
  const maxV = d3.max([...counts.values()]) || 1;
  const colorScale = d3.scaleQuantize().domain([0, maxV]).range(GREEN_SEQUENTIAL);

  const countryNameToCount = new Map();
  for (const [pt, v] of counts) countryNameToCount.set(normalizeCountry(pt), v);

  const svg = container.append("svg").attr("width", width).attr("height", height);

  // Enquadra dinamicamente o(s) país(es) com parceria — funciona para
  // qualquer país que passe a ter matches no futuro, não só Alemanha.
  const matchedFeatures = world.features.filter((f) => countryNameToCount.has(normalizeCountry(f.properties.name)));
  const frame = matchedFeatures.length
    ? { type: "FeatureCollection", features: matchedFeatures }
    : { type: "Sphere" };
  const projection = d3.geoMercator().fitExtent([[10, 10], [width - 10, height - 10]], frame);
  const path = d3.geoPath(projection);

  svg.append("path").attr("class", "map-sphere").attr("d", path({ type: "Sphere" }));
  svg.append("path").attr("class", "map-graticule").attr("d", path(d3.geoGraticule10()));

  svg.selectAll("path.country")
    .data(world.features)
    .join("path")
    .attr("class", "map-country")
    .attr("d", path)
    .attr("fill", (d) => {
      const v = countryNameToCount.get(normalizeCountry(d.properties.name));
      return v ? colorScale(v) : CHART_MAP_FILL;
    })
    .attr("stroke", CHART_MAP_BORDER)
    .attr("stroke-width", 1)
    .on("mousemove", (ev, d) => {
      const v = countryNameToCount.get(normalizeCountry(d.properties.name));
      if (!v) return;
      showTooltip(ev.clientX, ev.clientY, `<b>${d.properties.name}</b><br>${fmt(v)} conexão(ões)`);
    })
    .on("mouseleave", hideTooltip);
}

function normalizeCountry(name) {
  // nomes em inglês do TopoJSON -> nomes em português usados em foreign_country
  const map = {
    Germany: "Alemanha", Ghana: "Gana", Angola: "Angola", Algeria: "Argélia",
    Mozambique: "Moçambique", "South Africa": "África do Sul", "United Kingdom": "Reino Unido",
  };
  return map[name] || name;
}

/* ---------------- Barras: linhas de pesquisa ---------------- */
function renderBarChart(el, edgeSubset, colorInfo, opts = {}) {
  const container = d3.select(el);
  container.selectAll("*").remove();
  const width = el.clientWidth, height = el.clientHeight;
  if (!edgeSubset.length || width < 10 || height < 10) {
    container.append("div").attr("class", "empty-hint").text("Sem dados.");
    return;
  }

  const n = opts.n || 8;
  const counts = countBy(edgeSubset, (e) => e.keyword);
  const data = topEntries(counts, n);
  const maxV = data[0][1];

  const rowH = height / data.length;
  const svg = container.append("svg").attr("width", width).attr("height", height);
  const g = svg.selectAll("g.bar-track")
    .data(data)
    .join("g")
    .attr("class", "bar-track")
    .attr("transform", (_, i) => `translate(0, ${i * rowH})`);

  g.append("text")
    .attr("class", "bar-label")
    .attr("x", 0).attr("y", rowH * 0.32)
    .text(([k]) => truncateLabel(k, 26));

  const barY = rowH * 0.45, barH = Math.max(5, rowH * 0.32);
  g.append("rect").attr("class", "bg")
    .attr("x", 0).attr("y", barY).attr("width", width).attr("height", barH).attr("rx", barH / 2);

  g.append("rect").attr("class", "fg")
    .attr("x", 0).attr("y", barY).attr("height", barH).attr("rx", barH / 2)
    .attr("width", ([, v]) => Math.max(4, (v / maxV) * (width - 46)))
    .attr("fill", ([k]) => colorForLinha(k, colorInfo))
    .on("mousemove", (ev, [k, v]) => showTooltip(ev.clientX, ev.clientY, `<b>${k}</b><br>${fmt(v)} conexão(ões)`))
    .on("mouseleave", hideTooltip);

  g.append("text").attr("class", "bar-value")
    .attr("x", width).attr("y", barY + barH / 2).attr("dy", "0.35em")
    .attr("text-anchor", "end")
    .text(([, v]) => fmt(v));
}
