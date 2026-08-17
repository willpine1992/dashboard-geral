/* ==========================================================================
   GERBRAS Dashboard — Página 1: orquestração de filtros e gráficos
   ========================================================================== */
(async function () {
  const { researchers, edges, institutions, manaus, researcherById } = await loadData();

  let filters = readFiltersFromURL();
  let profSearchText = filters.q || "";

  /* ---- se chegamos de um link do Flow Map (?professor=ID), deriva os
     demais filtros a partir do perfil desse professor ---- */
  if (filters.professorId && !filters.grandeArea && !filters.area && filters.ppgs.size === 0) {
    const prof = researcherById.get(filters.professorId);
    if (prof) {
      filters.grandeArea = prof.grande_areas[0] || "";
      filters.area = prof.areas.includes(filters.area) ? filters.area : (prof.areas[0] || "");
      filters.ppgs = new Set(prof.programas);
    }
  }

  const ALL_GRANDE_AREAS = [...new Set(researchers.flatMap((r) => r.grande_areas))].sort();
  const ALL_PPGS = [...new Set(researchers.flatMap((r) => r.programas))].sort();

  function areaOptionsFor(grandeArea) {
    const pool = grandeArea ? researchers.filter((r) => r.grande_areas.includes(grandeArea)) : researchers;
    return [...new Set(pool.flatMap((r) => r.areas))].sort();
  }

  function populateSelect(sel, options, current) {
    const el = d3.select(sel);
    const placeholder = el.select("option").node();
    el.selectAll("option:not(:first-child)").remove();
    el.selectAll(null)
      .data(options)
      .join("option")
      .attr("value", (d) => d)
      .text((d) => d);
    el.property("value", options.includes(current) ? current : "");
  }

  populateSelect("#filter-grande-area", ALL_GRANDE_AREAS, filters.grandeArea);
  populateSelect("#filter-area", areaOptionsFor(filters.grandeArea), filters.area);

  /* ---- topbar stats ---- */
  d3.select("#topbar-stats").html(`
    <div class="topbar__stat"><b>${fmt(researchers.length)}</b><small>Pesquisadores</small></div>
    <div class="topbar__stat"><b>${fmt(institutions.length)}</b><small>Instituições DE</small></div>
    <div class="topbar__stat"><b>${fmt(edges.length)}</b><small>Conexões</small></div>
  `);

  /* ---- eventos ---- */
  d3.select("#filter-grande-area").on("change", function () {
    filters.grandeArea = this.value;
    filters.area = "";
    populateSelect("#filter-area", areaOptionsFor(filters.grandeArea), "");
    syncURL(); render();
  });
  d3.select("#filter-area").on("change", function () {
    filters.area = this.value;
    syncURL(); render();
  });
  d3.select("#prof-search").property("value", profSearchText).on("input", debounce(function (ev) {
    profSearchText = ev.target.value;
    renderProfessorList();
  }, 120));
  d3.select("#btn-clear-filters").on("click", () => {
    filters = { grandeArea: "", area: "", ppgs: new Set(), linhas: new Set(), professorId: null, q: "" };
    profSearchText = "";
    d3.select("#prof-search").property("value", "");
    populateSelect("#filter-grande-area", ALL_GRANDE_AREAS, "");
    populateSelect("#filter-area", areaOptionsFor(""), "");
    syncURL(); render();
  });

  window.addEventListener("resize", debounce(render, 200));
  window.addEventListener("gerbras:themechange", render);
  initThemeToggle();

  function syncURL() {
    const qs = filtersToURL(filters);
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : ""));
  }

  function toggleProfessor(id) {
    filters.professorId = filters.professorId === id ? null : id;
    syncURL(); render();
  }
  function togglePPG(ppg) {
    filters.ppgs.has(ppg) ? filters.ppgs.delete(ppg) : filters.ppgs.add(ppg);
    syncURL(); render();
  }
  function toggleLinha(kw) {
    filters.linhas.has(kw) ? filters.linhas.delete(kw) : filters.linhas.add(kw);
    syncURL(); render();
  }

  /* ---- estado corrente derivado, preenchido a cada render() ---- */
  let currentFilteredResearchers = [];

  function render() {
    currentFilteredResearchers = applyResearcherFilters(researchers, filters);
    const filteredIds = new Set(currentFilteredResearchers.map((r) => r.id));
    const edgesForList = edges.filter((e) => filteredIds.has(e.researcher_id));
    const edgesForCharts = applyEdgeFilters(edges, filteredIds, filters);

    renderPPGChecklist();
    renderLinhasList(edgesForList);
    renderProfessorList();
    renderForeignRanking(edgesForCharts);

    const colorBase = edgesForCharts.length ? edgesForCharts : edgesForList;
    const colorInfo = buildLinhaColorScale(colorBase);

    renderSankey(document.getElementById("sankey-chart"), edgesForCharts, colorInfo);
    renderWordcloud(document.getElementById("wordcloud-chart"), edgesForCharts);
    renderCountryMap(document.getElementById("map-chart"), edgesForCharts);
    renderBarChart(document.getElementById("bar-chart"), edgesForCharts, colorInfo, { n: 6 });

    d3.select("#sankey-hint").text(`${fmt(edgesForCharts.length)} conexões`);
    d3.select("#prof-count-hint").text(`${fmt(currentFilteredResearchers.length)} / ${fmt(researchers.length)}`);
  }

  function renderPPGChecklist() {
    const base = researchers.filter((r) => {
      if (filters.grandeArea && !r.grande_areas.includes(filters.grandeArea)) return false;
      if (filters.area && !r.areas.includes(filters.area)) return false;
      if (filters.professorId && r.id !== filters.professorId) return false;
      return true;
    });
    const counts = new Map(ALL_PPGS.map((p) => [p, 0]));
    base.forEach((r) => r.programas.forEach((p) => counts.set(p, (counts.get(p) || 0) + 1)));

    const rows = d3.select("#filter-ppg-list")
      .selectAll(".checkrow")
      .data(ALL_PPGS, (d) => d)
      .join("label")
      .attr("class", "checkrow");

    rows.html((d) => `
      <input type="checkbox" ${filters.ppgs.has(d) ? "checked" : ""} />
      <span>${d}</span><small>${fmt(counts.get(d) || 0)}</small>`);
    rows.select("input").on("change", (_, d) => togglePPG(d));

    d3.select("#ppg-count-hint").text(filters.ppgs.size ? `${filters.ppgs.size} selecionado(s)` : "");
  }

  function renderLinhasList(edgeSubset) {
    const counts = countBy(edgeSubset, (e) => e.keyword);
    const top = topEntries(counts, 45);
    const colorInfo = buildLinhaColorScale(edgeSubset);

    const wrap = d3.select("#linhas-list");
    if (!top.length) { wrap.html('<div class="empty-hint">Sem conexões para os filtros atuais.</div>'); return; }

    const rows = wrap.selectAll(".pickrow").data(top, (d) => d[0]).join("div")
      .attr("class", (d) => "pickrow" + (filters.linhas.has(d[0]) ? " is-active" : ""));
    rows.html(([kw, v]) => `
      <span class="dot" style="background:${colorForLinha(kw, colorInfo)}"></span>
      <span class="label">${kw}</span><span class="count">${fmt(v)}</span>`);
    rows.on("click", (_, d) => toggleLinha(d[0]));
  }

  function renderProfessorList() {
    const filtered = currentFilteredResearchers.filter((r) =>
      !profSearchText || r.nome.toLowerCase().includes(profSearchText.toLowerCase())
    ).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    const wrap = d3.select("#prof-list");
    if (!filtered.length) { wrap.html('<div class="empty-hint">Nenhum professor encontrado.</div>'); return; }

    const rows = wrap.selectAll(".pickrow").data(filtered, (d) => d.id).join("div")
      .attr("class", (d) => "pickrow" + (filters.professorId === d.id ? " is-active" : ""));
    rows.html((d) => `
      <span class="dot" style="background:${d.n_matches ? "var(--accent)" : "var(--border-strong)"}"></span>
      <span class="label" title="${d.nome}">${d.nome}</span>
      <span class="count">${d.n_matches || 0}</span>`);
    rows.on("click", (_, d) => toggleProfessor(d.id));
  }

  function renderForeignRanking(edgeSubset) {
    const byAuthor = new Map();
    for (const e of edgeSubset) {
      const key = e.foreign_author_orcid || e.foreign_author_name;
      if (!byAuthor.has(key)) {
        byAuthor.set(key, {
          nome: e.foreign_author_name, instituicao: e.foreign_institution,
          oaId: (e.foreign_author_openalex_id || "").split("/").pop(), count: 0,
        });
      }
      byAuthor.get(key).count += 1;
    }
    const ranked = [...byAuthor.values()].sort((a, b) => b.count - a.count).slice(0, 12);

    const wrap = d3.select("#foreign-ranking");
    if (!ranked.length) { wrap.html('<div class="empty-hint">Sem pesquisadores para os filtros atuais.</div>'); return; }

    const rows = wrap.selectAll(".rank").data(ranked, (d) => d.nome).join("div").attr("class", "rank");
    rows.style("cursor", "pointer").on("click", (_, d) => {
      const q = new URLSearchParams({ oa: d.oaId, name: d.nome });
      location.href = `professor.html?${q.toString()}`;
    });
    rows.html((d, i) => `
      <span class="rank__pos">${i + 1}</span>
      <span class="rank__name" title="${d.nome} · ${d.instituicao}">${d.nome}</span>
      <span class="rank__val">${d.count}</span>`);
  }

  render();
})();
