/* ==========================================================================
   GERBRAS Dashboard — funções de gráfico (D3): Sankey, mapa, barras
   ========================================================================== */

/* ---------------- Sankey: linha de pesquisa (Lattes) -> keyword (OpenAlex) -> instituição estrangeira ---------------- */
const OTHER_INSTITUTIONS_LABEL = "Outras instituições";
const OTHER_KEYWORDS_LABEL = "outras keywords";

function buildSankeyGraph(edgeSubset, colorInfo, maxInstitutions, maxLinhas, maxKeywords) {
  const instCounts = countBy(edgeSubset, (e) => e.foreign_institution);
  const topInstList = topEntries(instCounts, maxInstitutions).map(([k]) => k);
  const topInst = new Set(topInstList);

  // colorInfo.scale só cobre as poucas linhas com cor própria (paleta
  // categórica validada, não dá pra inventar mais cores). Além dessas, uma
  // lista maior de linhas (maxLinhas) ainda aparece nomeada individualmente
  // no gráfico, só que na cor neutra "Outras" — só o que sobra dessa lista
  // maior é que vira de fato o balde agregado "Outras linhas de pesquisa".
  const linhaCounts = countBy(edgeSubset, (e) => e.keyword);
  const topLinhasList = topEntries(linhaCounts, maxLinhas).map(([k]) => k);
  const topLinhas = new Set(topLinhasList);

  // keyword_en é a keyword OpenAlex bruta que gerou o match — é ela que
  // conecta a linha de pesquisa (Lattes, PT) à instituição estrangeira.
  const kwCounts = countBy(edgeSubset, (e) => e.keyword_en);
  const topKwList = topEntries(kwCounts, maxKeywords).map(([k]) => k);
  const topKw = new Set(topKwList);

  const linkMapLK = new Map(); // linha -> keyword
  const linkMapKI = new Map(); // keyword -> instituição
  const nodeRealTotal = new Map();
  const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  for (const e of edgeSubset) {
    const linha = topLinhas.has(e.keyword) ? e.keyword : colorInfo.otherLabel;
    const kw = topKw.has(e.keyword_en) ? e.keyword_en : OTHER_KEYWORDS_LABEL;
    const inst = topInst.has(e.foreign_institution) ? e.foreign_institution : OTHER_INSTITUTIONS_LABEL;

    bump(linkMapLK, linha + "|||" + kw);
    bump(linkMapKI, kw + "|||" + inst);
    bump(nodeRealTotal, "L::" + linha);
    bump(nodeRealTotal, "K::" + kw);
    bump(nodeRealTotal, "I::" + inst);
  }

  const leftOrder = [...topLinhasList, colorInfo.otherLabel].filter((n) => nodeRealTotal.has("L::" + n));
  const midOrder = [...topKwList, OTHER_KEYWORDS_LABEL].filter((n) => nodeRealTotal.has("K::" + n));
  const rightOrder = [...topInstList, OTHER_INSTITUTIONS_LABEL].filter((n) => nodeRealTotal.has("I::" + n));

  const nodes = [
    ...leftOrder.map((name) => ({ name, side: "left", realValue: nodeRealTotal.get("L::" + name) || 0 })),
    ...midOrder.map((name) => ({ name, side: "middle", realValue: nodeRealTotal.get("K::" + name) || 0 })),
    ...rightOrder.map((name) => ({ name, side: "right", realValue: nodeRealTotal.get("I::" + name) || 0 })),
  ];
  const nodeIndex = new Map(nodes.map((n, i) => {
    const prefix = n.side === "left" ? "L::" : n.side === "middle" ? "K::" : "I::";
    return [prefix + n.name, i];
  }));

  // links que tocam um bucket "Outras..." recebem espessura fixa e fina no
  // layout, independente de quantos resultados foram agregados ali — isso
  // dá prioridade visual às linhas/keywords/instituições nomeadas
  // individualmente, que continuam proporcionais ao valor real
  const OTHER_LINK_WEIGHT = 1;
  const isOtherBucket = (name) =>
    name === colorInfo.otherLabel || name === OTHER_INSTITUTIONS_LABEL || name === OTHER_KEYWORDS_LABEL;

  const linksLK = [...linkMapLK.entries()].map(([key, value]) => {
    const [linha, kw] = key.split("|||");
    const isOther = isOtherBucket(linha) || isOtherBucket(kw);
    return {
      source: nodeIndex.get("L::" + linha),
      target: nodeIndex.get("K::" + kw),
      value: isOther ? OTHER_LINK_WEIGHT : value,
      realValue: value,
      keyword: linha, // usado pra colorir o link pela linha de origem
      tooltipLabel: linha,
      isOther,
    };
  });

  const linksKI = [...linkMapKI.entries()].map(([key, value]) => {
    const [kw, inst] = key.split("|||");
    const isOther = isOtherBucket(kw) || isOtherBucket(inst);
    return {
      source: nodeIndex.get("K::" + kw),
      target: nodeIndex.get("I::" + inst),
      value: isOther ? OTHER_LINK_WEIGHT : value,
      realValue: value,
      keyword: null, // uma keyword pode vir de mais de uma linha — sem cor de origem única, fica neutro
      tooltipLabel: kw,
      isOther,
    };
  });

  const links = [...linksLK, ...linksKI];
  // desenhados primeiro = ficam por baixo quando cruzam com links nomeados,
  // que são desenhados por cima logo em seguida
  links.sort((a, b) => (a.isOther === b.isOther ? 0 : a.isOther ? -1 : 1));

  return { nodes, links };
}

function renderSankey(el, edgeSubset, colorInfo, opts = {}) {
  const container = d3.select(el);
  container.selectAll("*").remove();
  const width = el.clientWidth, height = el.clientHeight;
  if (!edgeSubset.length || width < 10 || height < 10) {
    container.append("div").attr("class", "empty-hint").text("Nenhuma parceria potencial para os filtros selecionados.");
    return;
  }

  const maxInst = opts.maxInstitutions || 24;
  const maxLinhas = opts.maxLinhas || 22;
  const maxKeywords = opts.maxKeywords || 24;
  const graph = buildSankeyGraph(edgeSubset, colorInfo, maxInst, maxLinhas, maxKeywords);

  const sankeyLayout = d3.sankey()
    .nodeId((d) => d.index)
    .nodeWidth(10)
    .nodePadding(10)
    .nodeSort((a, b) => (b.value || 0) - (a.value || 0))
    .extent([[150, 6], [width - 165, height - 6]]);

  const graphNodes = graph.nodes.map((d, i) => ({ ...d, index: i }));
  const graphLinks = graph.links.map((d) => ({ ...d }));
  const { nodes, links } = sankeyLayout({ nodes: graphNodes, links: graphLinks });

  const svg = container.append("svg").attr("width", width).attr("height", height);

  const colorFor = (keyword) => (keyword === colorInfo.otherLabel ? colorInfo.otherColor : (colorInfo.scale.get(keyword) || colorInfo.otherColor));

  const linkG = svg.append("g").attr("fill", "none");
  const linkPaths = linkG.selectAll("path")
    .data(links)
    .join("path")
    .attr("class", "sankey-link")
    .attr("d", d3.sankeyLinkHorizontal())
    .attr("stroke", (d) => colorFor(d.keyword))
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
    .attr("fill", (d) => (d.side === "left" ? colorFor(d.name) : CHART_NODE_NEUTRAL));

  // a coluna do meio (keywords OpenAlex) não leva rótulo fixo — muitos nós
  // lado a lado não deixariam espaço pro texto sem sobrepor a coluna
  // seguinte; o nome dela ainda aparece via hover (title + tooltip)
  nodeSel.filter((d) => d.side !== "middle").append("text")
    .attr("x", (d) => (d.side === "left" ? d.x0 - 8 : d.x1 + 8))
    .attr("y", (d) => (d.y0 + d.y1) / 2)
    .attr("dy", "0.35em")
    .attr("text-anchor", (d) => (d.side === "left" ? "end" : "start"))
    .text((d) => truncateLabel(d.name, d.side === "left" ? 24 : 30));

  nodeSel.append("title").text((d) => `${d.name}\n${fmt(d.realValue)} conexão(ões)`);

  function dim(predicateLink, predicateNode) {
    linkPaths.classed("is-dim", predicateLink);
    nodeSel.classed("is-dim", predicateNode);
  }

  const isClickable = (d) =>
    (d.side === "left" && d.name !== colorInfo.otherLabel) ||
    (d.side === "right" && d.name !== OTHER_INSTITUTIONS_LABEL);
  const activeLinhas = opts.activeLinhas || new Set();
  nodeSel.classed("is-selected", (d) =>
    (d.side === "left" && activeLinhas.has(d.name)) ||
    (d.side === "right" && !!opts.activeInstituicao && d.name === opts.activeInstituicao)
  );

  linkPaths
    .on("mousemove", function (ev, d) {
      dim((l) => l !== d, (n) => n !== d.source && n !== d.target);
      showTooltip(ev.clientX, ev.clientY,
        `<b>${d.tooltipLabel}</b><br>${truncateLabel(d.target.name, 40)}<br>${fmt(d.realValue)} conexão(ões)`);
    })
    .on("mouseleave", function () { dim(() => false, () => false); hideTooltip(); });

  nodeSel
    .style("cursor", (d) => (isClickable(d) ? "pointer" : "default"))
    .on("click", (ev, d) => {
      if (!isClickable(d)) return;
      if (d.side === "left") opts.onLinhaClick && opts.onLinhaClick(d.name);
      else opts.onInstituicaoClick && opts.onInstituicaoClick(d.name);
    })
    .on("mousemove", function (ev, d) {
      dim((l) => l.source !== d && l.target !== d, (n) => n !== d);
      showTooltip(ev.clientX, ev.clientY, `<b>${d.name}</b><br>${fmt(d.realValue)} conexão(ões)`);
    })
    .on("mouseleave", function () { dim(() => false, () => false); hideTooltip(); });
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
    Mozambique: "Moçambique", "South Africa": "África do Sul",
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
