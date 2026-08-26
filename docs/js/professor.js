/* ==========================================================================
   GERBRAS Dashboard — Página 3: Perfil do pesquisador estrangeiro
   ========================================================================== */
(async function () {
  const { edges, institutions, researcherById } = await loadData();
  initThemeToggle();

  const params = new URLSearchParams(location.search);
  const oaId = params.get("oa");
  const nameParam = params.get("name");

  const matched = edges.filter((e) => {
    const shortId = (e.foreign_author_openalex_id || "").split("/").pop();
    return oaId ? shortId === oaId : e.foreign_author_name === nameParam;
  });

  if (!matched.length) {
    document.querySelector("main").innerHTML =
      '<div class="empty-hint" style="padding:80px; font-size:14px;">Pesquisador não encontrado. Volte ao painel e selecione novamente.</div>';
    return;
  }

  const first = matched[0];
  const foreignName = first.foreign_author_name;
  const foreignOrcid = first.foreign_author_orcid;
  const foreignOaId = first.foreign_author_openalex_id;
  const instName = first.foreign_institution;
  const country = first.foreign_country;
  const inst = institutions.find((i) => i.instituicao === instName);

  // só linhas REAIS do Lattes entram aqui — keywords sem match (fallback de
  // tradução) não são linhas de pesquisa cadastradas do professor
  const linhaCounts = countBy(matched.filter((e) => e.linha_real), (e) => e.keyword);
  const linhas = topEntries(linhaCounts, 30);

  const ueaIds = [...new Set(matched.map((e) => e.researcher_id))];
  const ueaProfs = ueaIds.map((id) => researcherById.get(id)).filter(Boolean)
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  const samplePubs = [];
  const seenTitles = new Set();
  for (const e of matched) {
    if (e.sample_work_title && !seenTitles.has(e.sample_work_title)) {
      seenTitles.add(e.sample_work_title);
      samplePubs.push({ title: e.sample_work_title, doi: e.sample_work_doi });
    }
  }

  renderPersonal();
  renderInstitution();
  renderPublications();
  wireBackButton();

  window.addEventListener("gerbras:themechange", () => {
    renderPersonal();
    if (inst && inst.lat != null) renderInstitutionMap(document.getElementById("institution-map"), inst.lat, inst.lon, instName);
  });

  /* ---------------- coluna 1: pessoal ---------------- */
  function renderPersonal() {
    d3.select("#topbar-stats").html(`
      <div class="topbar__stat" data-help="Número de linhas de pesquisa do Lattes desses professores da UEA que casaram com as keywords do OpenAlex deste pesquisador estrangeiro."><b>${fmt(linhas.length)}</b><small>Linhas em comum</small></div>
      <div class="topbar__stat" data-help="Número de professores da UEA conectados a este pesquisador estrangeiro."><b>${fmt(ueaProfs.length)}</b><small>Prof. UEA</small></div>
    `);

    d3.select("#p-avatar").style("background", colorFor(foreignName)).text(initials(foreignName));
    d3.select("#p-nome").text(foreignName);
    d3.select("#p-sub").text(`${instName} · ${country}`);

    const badges = [];
    if (foreignOrcid) badges.push(`<a class="badge badge--link" href="https://orcid.org/${foreignOrcid}" target="_blank" rel="noopener">ORCID ${foreignOrcid}</a>`);
    if (foreignOaId) badges.push(`<a class="badge badge--link" href="${foreignOaId}" target="_blank" rel="noopener">Perfil OpenAlex</a>`);
    badges.push(`<span class="badge">${country}</span>`);
    d3.select("#p-badges").html(badges.join(""));

    d3.select("#p-contact").html(
      `<p class="text-sm muted" style="margin:0;">Não coletamos e-mail ou telefone diretamente das fontes públicas. Use o ORCID ou o perfil OpenAlex acima como canal de contato/apresentação inicial.</p>`
    );

    d3.select("#p-linhas-hint").text(fmt(linhas.length));
    d3.select("#p-linhas").html(
      linhas.map(([k, v]) => `<span class="kw-tag" title="${v} conexão(ões)">${k}</span>`).join("") ||
      '<div class="empty-hint">Sem linhas registradas.</div>'
    );

    d3.select("#p-profs-hint").text(fmt(ueaProfs.length));
    const wrap = d3.select("#p-profs");
    if (!ueaProfs.length) {
      wrap.html('<div class="empty-hint">Nenhum professor encontrado.</div>');
    } else {
      const rows = wrap.selectAll(".pickrow").data(ueaProfs, (d) => d.id).join("div").attr("class", "pickrow");
      rows.html((d) => `<span class="dot" style="background:var(--accent)"></span><span class="label">${d.nome}</span><span class="count">${d.n_matches}</span>`);
      rows.style("cursor", "pointer").on("click", (_, d) => { location.href = `index.html?professor=${d.id}`; });
    }
  }

  /* ---------------- coluna 2: instituição ---------------- */
  function renderInstitution() {
    d3.select("#i-nome").text(instName);
    d3.select("#i-sub").text(country);
    d3.select("#i-matches").text(inst ? fmt(inst.n_matches) : "—");
    d3.select("#i-researchers").text(inst ? fmt(inst.n_researchers) : "—");

    if (inst && inst.lat != null) {
      renderInstitutionMap(document.getElementById("institution-map"), inst.lat, inst.lon, instName);
    } else {
      document.getElementById("institution-map").innerHTML = '<div class="empty-hint">Localização não disponível.</div>';
    }

    fetchInstitutionInfo(instName);
  }

  async function fetchInstitutionInfo(name) {
    const el = document.getElementById("i-details");
    try {
      const url = `https://api.openalex.org/institutions?search=${encodeURIComponent(name)}&per-page=1`;
      const data = await fetch(url).then((r) => r.json());
      const i = data.results && data.results[0];
      if (!i) { el.innerHTML = '<div class="empty-hint">Sem informações adicionais.</div>'; return; }

      const rows = [];
      if (i.type) rows.push(["Tipo", capitalize(i.type)]);
      if (i.homepage_url) rows.push(["Site", `<a href="${i.homepage_url}" target="_blank" rel="noopener">${shortenUrl(i.homepage_url)}</a>`]);
      if (i.works_count != null) rows.push(["Publicações (OpenAlex)", fmt(i.works_count)]);
      if (i.cited_by_count != null) rows.push(["Citações", fmt(i.cited_by_count)]);
      if (i.ror) rows.push(["ROR", `<a href="${i.ror}" target="_blank" rel="noopener">registro ROR ↗</a>`]);

      el.innerHTML = rows.map(([k, v]) => `<div class="info-row"><span>${k}</span><span>${v}</span></div>`).join("") ||
        '<div class="empty-hint">Sem informações adicionais.</div>';
    } catch (e) {
      el.innerHTML = '<div class="empty-hint">Não foi possível carregar informações da instituição agora.</div>';
    }
  }

  /* ---------------- coluna 3: publicações ---------------- */
  async function renderPublications() {
    const el = document.getElementById("pub-list");
    if (!foreignOrcid) { renderPubFallback(el); return; }

    try {
      const url = `https://api.openalex.org/works?filter=author.orcid:${foreignOrcid}&sort=publication_date:desc&per-page=25&select=id,doi,title,publication_year,primary_location`;
      const data = await fetch(url).then((r) => r.json());
      const works = (data.results || []).map((w) => ({
        title: w.title,
        year: w.publication_year,
        source: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || null,
        doi: w.doi ? w.doi.replace("https://doi.org/", "") : null,
      }));
      if (!works.length) { renderPubFallback(el); return; }
      d3.select("#pub-hint").text(`${fmt(works.length)} via OpenAlex`);
      el.innerHTML = works.map(pubCardHtml).join("");
    } catch (e) {
      renderPubFallback(el);
    }
  }

  function renderPubFallback(el) {
    if (!samplePubs.length) {
      el.innerHTML = '<div class="empty-hint">Nenhuma publicação encontrada.</div>';
      d3.select("#pub-hint").text("");
      return;
    }
    d3.select("#pub-hint").text(`${fmt(samplePubs.length)} (amostra das conexões)`);
    el.innerHTML = samplePubs.map((p) => pubCardHtml({ title: p.title, year: null, source: null, doi: p.doi })).join("");
  }

  function pubCardHtml(p) {
    const meta = [];
    if (p.year) meta.push(p.year);
    if (p.source) meta.push(p.source);
    if (p.doi) meta.push(`<a href="https://doi.org/${p.doi}" target="_blank" rel="noopener">DOI ↗</a>`);
    return `<div class="pub-card"><div class="pub-card__title">${p.title || "(sem título)"}</div><div class="pub-card__meta">${meta.join(" · ")}</div></div>`;
  }

  /* ---------------- utilidades ---------------- */
  function initials(name) {
    const parts = name.trim().split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[parts.length - 1]?.[0] || "")).toUpperCase();
  }
  function colorFor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
    return CAT_COLORS[hash % CAT_COLORS.length];
  }
  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function shortenUrl(u) { return u.replace(/^https?:\/\//, "").replace(/\/$/, ""); }

  function wireBackButton() {
    d3.select("#btn-back").on("click", (ev) => {
      ev.preventDefault();
      if (document.referrer && document.referrer.includes(location.host)) history.back();
      else location.href = "index.html";
    });
  }
})();
