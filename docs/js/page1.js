/* ==========================================================================
   GERBRAS Dashboard — Página 1: orquestração de filtros e gráficos
   ========================================================================== */
(async function () {
  const { researchers, edges, institutions, manaus, researcherById, capesByCode, capesOpcoes } = await loadData();

  let filters = readFiltersFromURL();
  let profSearchText = filters.q || "";
  // colunas do Sankey desativadas pelo usuário (ver renderSankeyToggles) —
  // ao desativar "keyword", linha de pesquisa conecta direto com instituição
  const hiddenSankeyCols = new Set();

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
  const ALL_PAISES = [...new Set(edges.map((e) => e.foreign_country))].sort();

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
  populateSelect("#filter-pais", ALL_PAISES, filters.pais);
  populateSelect("#filter-nivel", capesOpcoes.niveis, filters.nivel);
  populateSelect("#filter-modalidade", capesOpcoes.modalidades, filters.modalidade);
  populateSelect("#filter-situacao", capesOpcoes.situacoes, filters.situacao);
  populateSelect("#filter-conceito", capesOpcoes.conceitos.map(String), filters.conceito);

  /* ---- topbar stats ---- */
  d3.select("#topbar-stats").html(`
    <div class="topbar__stat" data-help="Número de pesquisadores da UEA com pelo menos uma conexão internacional identificada."><b>${fmt(researchers.length)}</b><small>Pesquisadores</small></div>
    <div class="topbar__stat" data-help="Número de instituições estrangeiras distintas com pelo menos um pesquisador em comum com a UEA."><b>${fmt(institutions.length)}</b><small>Instituições estrangeiras</small></div>
    <div class="topbar__stat" data-help="Número total de pares (pesquisador da UEA, pesquisador estrangeiro) identificados como possível parceria, considerando os filtros ativos."><b>${fmt(edges.length)}</b><small>Conexões</small></div>
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
  d3.select("#filter-pais").on("change", function () {
    filters.pais = this.value;
    // se a instituição selecionada não pertence mais ao país escolhido, limpa —
    // evita ficar com um filtro de instituição "órfão" que não bate com nada
    if (filters.instituicao && filters.pais) {
      const stillValid = edges.some(
        (e) => e.foreign_institution === filters.instituicao && e.foreign_country === filters.pais
      );
      if (!stillValid) filters.instituicao = "";
    }
    syncURL(); render();
  });
  d3.select("#prof-search").property("value", profSearchText).on("input", debounce(function (ev) {
    profSearchText = ev.target.value;
    renderProfessorList();
  }, 120));
  d3.select("#filter-nivel").on("change", function () {
    filters.nivel = this.value;
    syncURL(); render();
  });
  d3.select("#filter-modalidade").on("change", function () {
    filters.modalidade = this.value;
    syncURL(); render();
  });
  d3.select("#filter-situacao").on("change", function () {
    filters.situacao = this.value;
    syncURL(); render();
  });
  d3.select("#filter-conceito").on("change", function () {
    filters.conceito = this.value;
    syncURL(); render();
  });
  d3.select("#btn-clear-filters").on("click", () => {
    filters = {
      grandeArea: "", area: "", ppgs: new Set(), linhas: new Set(), pais: "", instituicao: "", professorId: null, q: "",
      nivel: "", modalidade: "", situacao: "", conceito: "",
    };
    profSearchText = "";
    d3.select("#prof-search").property("value", "");
    populateSelect("#filter-grande-area", ALL_GRANDE_AREAS, "");
    populateSelect("#filter-area", areaOptionsFor(""), "");
    populateSelect("#filter-pais", ALL_PAISES, "");
    populateSelect("#filter-nivel", capesOpcoes.niveis, "");
    populateSelect("#filter-modalidade", capesOpcoes.modalidades, "");
    populateSelect("#filter-situacao", capesOpcoes.situacoes, "");
    populateSelect("#filter-conceito", capesOpcoes.conceitos.map(String), "");
    syncURL(); render();
  });
  d3.select("#btn-report").on("click", () => {
    generateProspectingReport({
      researchers: currentFilteredResearchers,
      edges: currentEdgesForReport,
      filters,
      researcherById,
      totals: { researchers: researchers.length, institutions: institutions.length },
    });
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
  function toggleInstituicao(inst) {
    filters.instituicao = filters.instituicao === inst ? "" : inst;
    syncURL(); render();
  }
  function toggleSankeyCol(id) {
    if (hiddenSankeyCols.has(id)) {
      hiddenSankeyCols.delete(id);
    } else {
      // mantém sempre pelo menos 2 colunas ativas — com 1 só não há conexão pra desenhar
      if (SANKEY_COLUMN_ORDER.length - hiddenSankeyCols.size <= 2) return;
      hiddenSankeyCols.add(id);
    }
    renderSankeyToggles();
    render();
  }

  function renderSankeyToggles() {
    const data = SANKEY_COLUMN_ORDER.map((id) => ({ id, label: SANKEY_COLUMN_DEFS[id].label }));
    const btns = d3.select("#sankey-col-toggles")
      .selectAll(".col-toggle")
      .data(data, (d) => d.id)
      .join("button")
      .attr("type", "button")
      .attr("class", (d) => "col-toggle" + (hiddenSankeyCols.has(d.id) ? " is-off" : " is-active"));
    btns.text((d) => d.label);
    btns.on("click", (_, d) => toggleSankeyCol(d.id));
  }

  /* ---- estado corrente derivado, preenchido a cada render() ---- */
  let currentFilteredResearchers = [];
  let currentEdgesForReport = [];

  function render() {
    currentFilteredResearchers = applyResearcherFilters(researchers, filters, capesByCode);
    let filteredIds = new Set(currentFilteredResearchers.map((r) => r.id));

    // país/instituição não são atributos diretos do pesquisador — filtrar a
    // lista de professores por eles exige olhar as edges primeiro
    if (filters.pais || filters.instituicao) {
      const idsMatching = new Set(
        edges
          .filter((e) => filteredIds.has(e.researcher_id))
          .filter((e) => !filters.pais || e.foreign_country === filters.pais)
          .filter((e) => !filters.instituicao || e.foreign_institution === filters.instituicao)
          .map((e) => e.researcher_id)
      );
      currentFilteredResearchers = currentFilteredResearchers.filter((r) => idsMatching.has(r.id));
      filteredIds = idsMatching;
    }

    const edgesForList = edges.filter((e) => filteredIds.has(e.researcher_id));
    const edgesForCharts = applyEdgeFilters(edges, filteredIds, filters);
    currentEdgesForReport = edgesForCharts;

    // "Linhas de Pesquisa" só deve exibir linhas REAIS do Lattes do
    // pesquisador — keywords sem match real (fallback de tradução) não são
    // linhas cadastradas e não devem aparecer nesse painel/gráfico.
    const edgesForListLinhaReal = edgesForList.filter((e) => e.linha_real);
    const edgesForChartsLinhaReal = edgesForCharts.filter((e) => e.linha_real);

    renderPPGChecklist();
    renderLinhasList(edgesForListLinhaReal);
    renderProfessorList();
    renderForeignRanking(edgesForCharts);

    const colorBase = edgesForChartsLinhaReal.length ? edgesForChartsLinhaReal : edgesForListLinhaReal;
    const colorInfo = buildLinhaColorScale(colorBase);

    renderSankey(document.getElementById("sankey-chart"), edgesForChartsLinhaReal, colorInfo, {
      onLinhaClick: toggleLinha,
      onInstituicaoClick: toggleInstituicao,
      activeLinhas: filters.linhas,
      activeInstituicao: filters.instituicao,
      hiddenColumns: hiddenSankeyCols,
      onLinkHover: updateSbertCard,
    });
    updateSbertCard(null);
    renderCountryMap(document.getElementById("map-chart"), edgesForCharts);
    renderBarChart(document.getElementById("bar-chart"), edgesForChartsLinhaReal, colorInfo, { n: 10 });

    d3.select("#sankey-hint").text(`${fmt(edgesForChartsLinhaReal.length)} conexões`);
    d3.select("#prof-count-hint").text(`${fmt(currentFilteredResearchers.length)} / ${fmt(researchers.length)}`);
  }

  // mapeia o conceito CAPES (3–7) para um índice na escala verde sequencial
  // já usada no mapa de calor (charts.js) — mantém a paleta consistente e
  // reage sozinho a troca de tema, já que GREEN_SEQUENTIAL é recalculada em
  // refreshThemeColors() e renderPPGChecklist roda de novo a cada render().
  const CAPES_GRADE_INDEX = { 3: 1, 4: 2, 5: 4, 6: 5, 7: 6 };
  function capesConceitoBadge(codigo) {
    const p = capesByCode.get(codigo.normalize("NFC"));
    if (!p || p.conceito == null) return "";
    const label = String(p.conceito).replace(/"/g, "&quot;");
    const nome = (p.nome || "").replace(/"/g, "&quot;");
    if (label === "A") {
      return `<span class="capes-badge capes-badge--pending" title="Conceito CAPES ainda não atribuído (curso novo) · ${nome}">A</span>`;
    }
    const idx = CAPES_GRADE_INDEX[Number(label)] ?? 3;
    const bg = GREEN_SEQUENTIAL[idx];
    const fg = idx >= 3 ? "#ffffff" : "var(--ink-primary)";
    return `<span class="capes-badge" style="background:${bg};color:${fg};" title="Conceito CAPES ${label} · Avaliação Quadrienal 2021-2024 · ${nome}">${label}</span>`;
  }

  function renderPPGChecklist() {
    const idsMatching = (filters.pais || filters.instituicao)
      ? new Set(
          edges
            .filter((e) => !filters.pais || e.foreign_country === filters.pais)
            .filter((e) => !filters.instituicao || e.foreign_institution === filters.instituicao)
            .map((e) => e.researcher_id)
        )
      : null;
    const capesActive = filters.nivel || filters.modalidade || filters.situacao || filters.conceito;
    const base = researchers.filter((r) => {
      if (filters.grandeArea && !r.grande_areas.includes(filters.grandeArea)) return false;
      if (filters.area && !r.areas.includes(filters.area)) return false;
      if (filters.professorId && r.id !== filters.professorId) return false;
      if (idsMatching && !idsMatching.has(r.id)) return false;
      if (capesActive && !r.programas.some((p) => ppgMatchesCapesFilters(p, capesByCode, filters))) return false;
      return true;
    });
    const counts = new Map(ALL_PPGS.map((p) => [p, 0]));
    base.forEach((r) => r.programas.forEach((p) => counts.set(p, (counts.get(p) || 0) + 1)));

    const rows = d3.select("#filter-ppg-list")
      .selectAll(".checkrow")
      .data(ALL_PPGS, (d) => d)
      .join("label")
      .attr("class", "checkrow");

    rows
      .classed("checkrow--dim", (d) => capesActive && !ppgMatchesCapesFilters(d, capesByCode, filters))
      .html((d) => `
        <input type="checkbox" ${filters.ppgs.has(d) ? "checked" : ""} />
        <span>${d}</span>${capesConceitoBadge(d)}<small>${fmt(counts.get(d) || 0)}</small>`);
    rows.select("input").on("change", (_, d) => togglePPG(d));

    d3.select("#ppg-count-hint").text(filters.ppgs.size ? `${filters.ppgs.size} selecionado(s)` : "");
  }

  function updateSbertCard(link) {
    const scoreEl = document.getElementById("sbert-score");
    const fillEl = document.getElementById("sbert-fill");
    const pairEl = document.getElementById("sbert-pair");
    const hintEl = document.getElementById("sbert-hint");
    if (!scoreEl) return;

    if (!link || link.avgSimilarity == null) {
      scoreEl.textContent = "—";
      scoreEl.style.color = "";
      fillEl.style.width = "0%";
      hintEl.textContent = "";
      pairEl.innerHTML = hiddenSankeyCols.has("keyword")
        ? "Ative a coluna <b>Key word matching</b> para ver a similaridade desta conexão."
        : "Passe o mouse sobre uma conexão entre <b>Linha de pesquisa</b> e <b>Key word matching</b>.";
      return;
    }

    const sim = Math.max(0, Math.min(1, link.avgSimilarity));
    scoreEl.textContent = sim.toFixed(3).replace(".", ",");
    scoreEl.style.color = sim >= 0.3 ? "var(--ink-primary)" : "var(--ink-muted)";
    fillEl.style.width = `${(sim * 100).toFixed(1)}%`;
    hintEl.textContent = `${fmt(link.realValue)} conexão(ões)`;
    pairEl.innerHTML = `<b>${link.tooltipLabel}</b> ↔ ${link.target.name}`;
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

  renderSankeyToggles();
  render();
})();
