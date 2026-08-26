/* ==========================================================================
   GERBRAS Dashboard — Página 2: Flow Map Manaus → instituições na Alemanha
   ========================================================================== */
(async function () {
  const data = await loadData();
  const { researchers, edges, manaus, researcherById } = data;
  // instituições sem coordenada resolvida (país novo ainda sem fallback
  // geocodificado) quebrariam os arcos/projeção — melhor ficar de fora do
  // globo do que gerar NaN
  const institutions = data.institutions.filter((d) => d.lat != null && d.lon != null);
  const world = await getWorld();

  d3.select("#topbar-stats").html(`
    <div class="topbar__stat" data-help="Número de instituições estrangeiras (destinos) com coordenadas resolvidas e pelo menos uma conexão com a UEA."><b>${fmt(institutions.length)}</b><small>Destinos</small></div>
    <div class="topbar__stat" data-help="Número total de pares (pesquisador da UEA, pesquisador estrangeiro) identificados como possível parceria."><b>${fmt(edges.length)}</b><small>Conexões</small></div>
  `);

  const maxMatches = d3.max(institutions, (d) => d.n_matches) || 1;
  let widthScale, colorScale, dotScale;
  function computeScales() {
    widthScale = d3.scaleSqrt().domain([1, maxMatches]).range([1.4, 6]);
    colorScale = d3.scaleQuantize().domain([1, maxMatches]).range(GREEN_SEQUENTIAL.slice(1));
    dotScale = d3.scaleSqrt().domain([1, maxMatches]).range([3, 11]);
  }
  computeScales();

  renderLegend();
  let activeInstitution = null;

  const el = document.getElementById("flow-chart");
  let projection, path, baseScale, minScale, maxScale;
  let svg, arcs, dots, originG, originLabel, highlight;

  initThemeToggle();
  build();
  window.addEventListener("resize", debounce(build, 200));
  window.addEventListener("gerbras:themechange", () => {
    computeScales();
    renderLegend();
    build();
  });

  function build() {
    const width = el.clientWidth, height = el.clientHeight;
    d3.select(el).selectAll("*").remove();
    if (width < 10 || height < 10) return;

    const midLon = (manaus.lon + d3.mean(institutions, (d) => d.lon)) / 2;
    const midLat = (manaus.lat + d3.mean(institutions, (d) => d.lat)) / 2;

    projection = d3.geoOrthographic().rotate([-midLon, -midLat]).clipAngle(90);
    const points = {
      type: "MultiPoint",
      coordinates: [[manaus.lon, manaus.lat], ...institutions.map((d) => [d.lon, d.lat])],
    };
    projection.fitExtent([[36, 30], [width - 36, height - 30]], points);
    path = d3.geoPath(projection);
    baseScale = projection.scale();
    minScale = baseScale * 0.55;
    maxScale = baseScale * 5;

    svg = d3.select(el).append("svg").attr("width", width).attr("height", height)
      .attr("class", "flow-globe").on("click", () => { if (!justDragged) setActive(null); });

    svg.append("path").attr("class", "map-sphere");
    svg.append("path").attr("class", "map-graticule");
    svg.append("g").attr("class", "countries-g").selectAll("path.country")
      .data(world.features)
      .join("path")
      .attr("class", "map-country")
      .attr("fill", CHART_MAP_FILL)
      .attr("stroke", CHART_MAP_BORDER)
      .attr("stroke-width", 1);

    const arcG = svg.append("g");
    arcs = arcG.selectAll("path.flow-arc")
      .data(institutions)
      .join("path")
      .attr("class", "flow-arc")
      .attr("stroke", (d) => colorScale(d.n_matches))
      .attr("stroke-width", (d) => widthScale(d.n_matches))
      .attr("stroke-opacity", 0.75)
      .attr("stroke-linecap", "round");

    const dotsG = svg.append("g");
    dots = dotsG.selectAll("circle.flow-dot-dest")
      .data(institutions)
      .join("circle")
      .attr("class", "flow-dot-dest")
      .attr("r", (d) => dotScale(d.n_matches))
      .attr("fill", (d) => colorScale(d.n_matches))
      .attr("stroke", CHART_MAP_BORDER)
      .attr("stroke-width", 1.4);

    originG = svg.append("g");
    originG.append("circle").attr("class", "flow-dot-origin").attr("r", 6);
    originG.append("circle").attr("r", 6).attr("fill", "none")
      .attr("stroke", CHART_NODE_NEUTRAL).attr("stroke-width", 1.4).attr("opacity", 0.5)
      .append("animate").attr("attributeName", "r").attr("values", "6;20;6").attr("dur", "3s").attr("repeatCount", "indefinite");
    originG.append("circle").attr("r", 6).attr("fill", "none")
      .attr("stroke", CHART_NODE_NEUTRAL).attr("stroke-width", 1.4)
      .append("animate").attr("attributeName", "opacity").attr("values", "0.5;0;0.5").attr("dur", "3s").attr("repeatCount", "indefinite");
    originLabel = svg.append("text").attr("text-anchor", "middle").attr("class", "bar-label")
      .style("font-weight", 800).text("Manaus");

    highlight = function (inst) {
      arcs.classed("is-dim", (d) => inst && d.instituicao !== inst.instituicao);
      dots.attr("opacity", (d) => (!inst || d.instituicao === inst.instituicao ? 1 : 0.25));
    };

    arcs
      .on("mousemove", (ev, d) => {
        if (!activeInstitution) highlight(d);
        showTooltip(ev.clientX, ev.clientY, `<b>${d.instituicao}</b><br>${fmt(d.n_matches)} conexões · ${fmt(d.n_researchers)} professor(es)`);
        ev.stopPropagation();
      })
      .on("mouseleave", () => { if (!activeInstitution) highlight(null); hideTooltip(); })
      .on("click", (ev, d) => { ev.stopPropagation(); setActive(d); });

    dots
      .on("mousemove", (ev, d) => {
        if (!activeInstitution) highlight(d);
        showTooltip(ev.clientX, ev.clientY, `<b>${d.instituicao}</b><br>${fmt(d.n_matches)} conexões · ${fmt(d.n_researchers)} professor(es)`);
        ev.stopPropagation();
      })
      .on("mouseleave", () => { if (!activeInstitution) highlight(null); hideTooltip(); })
      .on("click", (ev, d) => { ev.stopPropagation(); setActive(d); });

    attachInteraction();
    redraw();
    if (activeInstitution) highlight(activeInstitution);
  }

  /* ---------- arrastar p/ girar, scroll p/ zoom ---------- */
  let justDragged = false;
  function attachInteraction() {
    const ROTATE_SENSITIVITY = 60;

    const drag = d3.drag()
      .on("start", () => { justDragged = false; svg.classed("is-grabbing", true); })
      .on("drag", (ev) => {
        if (Math.abs(ev.dx) + Math.abs(ev.dy) > 1) justDragged = true;
        const k = ROTATE_SENSITIVITY / projection.scale();
        const r = projection.rotate();
        const nextLat = Math.max(-89, Math.min(89, r[1] - ev.dy * k));
        projection.rotate([r[0] + ev.dx * k, nextLat]);
        redraw();
      })
      .on("end", () => {
        svg.classed("is-grabbing", false);
        if (justDragged) hideTooltip();
      });

    svg.call(drag);

    svg.on("wheel", (ev) => {
      ev.preventDefault();
      const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = Math.max(minScale, Math.min(maxScale, projection.scale() * factor));
      projection.scale(next);
      redraw();
    }, { passive: false });
  }

  function redraw() {
    const rotate = projection.rotate();
    const visibleOrthographic = (lon, lat) =>
      d3.geoDistance([lon, lat], [-rotate[0], -rotate[1]]) < Math.PI / 2 - 0.02;

    svg.select("path.map-sphere").attr("d", path({ type: "Sphere" }));
    svg.select("path.map-graticule").attr("d", path(d3.geoGraticule10()));
    svg.selectAll("path.map-country").attr("d", path);

    arcs.attr("d", (d) => path({
      type: "LineString",
      coordinates: interpolatedLine([manaus.lon, manaus.lat], [d.lon, d.lat]),
    }));

    dots
      .style("display", (d) => (visibleOrthographic(d.lon, d.lat) ? null : "none"))
      .attr("cx", (d) => projection([d.lon, d.lat])[0])
      .attr("cy", (d) => projection([d.lon, d.lat])[1]);

    const originXY = projection([manaus.lon, manaus.lat]);
    originG.attr("transform", `translate(${originXY[0]},${originXY[1]})`);
    originLabel.attr("x", originXY[0]).attr("y", originXY[1] - 14)
      .style("display", visibleOrthographic(manaus.lon, manaus.lat) ? null : "none");
  }

  function interpolatedLine(a, b) {
    const interp = d3.geoInterpolate(a, b);
    const dist = d3.geoDistance(a, b);
    const n = Math.max(2, Math.round(dist / 0.02));
    return d3.range(0, n + 1).map((i) => interp(i / n));
  }

  function setActive(inst) {
    activeInstitution = inst;
    highlight(inst);
    if (!inst) { d3.select("#flow-detail").classed("is-visible", false); return; }
    showDetail(inst);
  }

  function showDetail(inst) {
    const relatedEdges = edges.filter((e) => e.foreign_institution === inst.instituicao);
    const kwCounts = topEntries(countBy(relatedEdges, (e) => e.keyword), 10);
    const profIds = [...new Set(relatedEdges.map((e) => e.researcher_id))];
    const profs = profIds.map((id) => researcherById.get(id)).filter(Boolean)
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    d3.select("#fd-title").text(inst.instituicao);
    d3.select("#fd-sub").text(`${inst.pais} · ${fmt(inst.n_matches)} conexões · ${fmt(profs.length)} professor(es) da UEA`);
    d3.select("#fd-keywords").html(kwCounts.map(([k]) => `<span class="kw-tag">${k}</span>`).join(""));

    const rows = d3.select("#fd-professors").selectAll(".pickrow").data(profs, (d) => d.id).join("div").attr("class", "pickrow");
    rows.html((d) => `<span class="dot" style="background:var(--accent)"></span><span class="label">${d.nome}</span><span class="count">${d.n_matches}</span>`);
    rows.style("cursor", "pointer").on("click", (ev, d) => {
      ev.stopPropagation();
      location.href = `index.html?professor=${d.id}`;
    });

    d3.select("#flow-detail").classed("is-visible", true);
  }

  d3.select("#fd-close").on("click", () => setActive(null));
  d3.select("#flow-detail").on("click", (ev) => ev.stopPropagation());

  function renderLegend() {
    const steps = [
      { label: "Poucas conexões", color: GREEN_SEQUENTIAL[1] },
      { label: "Conexões moderadas", color: GREEN_SEQUENTIAL[4] },
      { label: "Muitas conexões", color: GREEN_SEQUENTIAL[6] },
    ];
    d3.select("#flow-legend").selectAll(".flow-legend__item").data(steps).join("div")
      .attr("class", "flow-legend__item")
      .html((d) => `<span class="flow-legend__swatch" style="background:${d.color}"></span>${d.label}`);
  }
})();
