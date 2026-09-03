/* ==========================================================================
   GERBRAS Dashboard — geração de Relatório de Prospecção (HTML imprimível)

   Recebe o recorte JÁ FILTRADO pela página (mesmos filtros do painel:
   grande área, PPG, país, instituição, professor…) e monta um documento
   HTML autônomo, aberto numa aba nova, pronto para "Salvar como PDF" via
   diálogo de impressão do navegador. Não depende de libs externas.
   ========================================================================== */

const REPORT_MAX_INSTITUTION_ROWS = 60;
const REPORT_MAX_LINHAS_PER_INSTITUTION = 6; // "principais" linhas de pesquisa — não a lista inteira
const REPORT_MAX_FOREIGN_PER_LINHA = 15;
const REPORT_MAX_LINHAS_PER_PPG = 10;

function reportEsc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function reportFmt(n) { return Number(n || 0).toLocaleString("pt-BR"); }

async function fetchLogoDataURI() {
  try {
    const svgText = await fetch("image/propespuea.svg").then((r) => r.text());
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgText)));
  } catch {
    return null;
  }
}

/* ---------- descrição legível dos filtros aplicados ---------- */
function describeReportFilters(filters, researcherById) {
  const chips = [];
  if (filters.grandeArea) chips.push(`Grande área: ${filters.grandeArea}`);
  if (filters.area) chips.push(`Área: ${filters.area}`);
  if (filters.ppgs.size) chips.push(`PPG: ${[...filters.ppgs].join(", ")}`);
  if (filters.pais) chips.push(`País: ${filters.pais}`);
  if (filters.instituicao) chips.push(`Instituição: ${filters.instituicao}`);
  if (filters.professorId) {
    const prof = researcherById.get(filters.professorId);
    chips.push(`Professor: ${prof ? prof.nome : "#" + filters.professorId}`);
  }
  if (filters.linhas.size) {
    const arr = [...filters.linhas];
    const shown = arr.slice(0, 6).join(", ");
    chips.push(`Linhas de pesquisa: ${shown}${arr.length > 6 ? ` (+${arr.length - 6})` : ""}`);
  }
  return chips;
}

/* ---------- agregações ---------- */
function aggregateForReport(researchers, edges, institutions) {
  const researcherIds = new Set(researchers.map((r) => r.id));

  const byCountry = new Map(); // pais -> { instituicoes:Set, pesquisadoresUEA:Set, conexoes:number }
  const byInstitution = new Map(); // instituicao -> { pais, uea:Set, estrangeiros:Set, conexoes:number }
  const byForeignResearcher = new Map(); // orcid|nome -> { nome, instituicao, pais, conexoes }

  for (const e of edges) {
    if (!researcherIds.has(e.researcher_id)) continue;

    if (!byCountry.has(e.foreign_country)) {
      byCountry.set(e.foreign_country, { instituicoes: new Set(), pesquisadoresUEA: new Set(), conexoes: 0 });
    }
    const c = byCountry.get(e.foreign_country);
    c.instituicoes.add(e.foreign_institution);
    c.pesquisadoresUEA.add(e.researcher_id);
    c.conexoes += 1;

    if (!byInstitution.has(e.foreign_institution)) {
      byInstitution.set(e.foreign_institution, {
        pais: e.foreign_country, uea: new Set(), estrangeiros: new Set(), conexoes: 0,
      });
    }
    const inst = byInstitution.get(e.foreign_institution);
    inst.uea.add(e.researcher_id);
    inst.estrangeiros.add(e.foreign_author_orcid || e.foreign_author_name);
    inst.conexoes += 1;

    const fKey = e.foreign_author_orcid || e.foreign_author_name;
    if (!byForeignResearcher.has(fKey)) {
      byForeignResearcher.set(fKey, {
        nome: e.foreign_author_name, instituicao: e.foreign_institution, pais: e.foreign_country, conexoes: 0,
      });
    }
    byForeignResearcher.get(fKey).conexoes += 1;
  }

  return { byCountry, byInstitution, byForeignResearcher };
}

/* ---------- linhas de pesquisa, separadas por PPG ----------
   Só conta edges com linha_real (linha de fato cadastrada no Lattes, não
   fallback de tradução de keyword) — mesmo critério já usado nas demais
   seções do relatório. Um professor vinculado a mais de um PPG contribui
   para as linhas de todos eles. */
function aggregateLinhasByPPG(researchers, edges) {
  const programasById = new Map(researchers.map((r) => [r.id, r.programas || []]));
  const byPPG = new Map(); // ppg -> Map(keyword -> conexoes)

  for (const e of edges) {
    if (!e.linha_real) continue;
    const programas = programasById.get(e.researcher_id);
    if (!programas) continue;
    for (const ppg of programas) {
      if (!byPPG.has(ppg)) byPPG.set(ppg, new Map());
      const m = byPPG.get(ppg);
      m.set(e.keyword, (m.get(e.keyword) || 0) + 1);
    }
  }
  return byPPG;
}

function buildLinhasByPPGSection(researchers, edges) {
  const byPPG = aggregateLinhasByPPG(researchers, edges);
  const ppgEntries = [...byPPG.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));

  const blocks = ppgEntries.map(([ppg, keywordMap]) => {
    const kwEntries = [...keywordMap.entries()].sort((a, b) => b[1] - a[1]);
    const truncated = kwEntries.length > REPORT_MAX_LINHAS_PER_PPG;
    const rows = kwEntries.slice(0, REPORT_MAX_LINHAS_PER_PPG)
      .map(([kw, n]) => `<tr><td>${reportEsc(kw)}</td><td class="num">${reportFmt(n)}</td></tr>`).join("");

    return `
      <div class="ppg-block">
        <h3>${reportEsc(ppg)}</h3>
        <table class="report-table report-table--compact">
          <thead><tr><th>Linha de pesquisa</th><th class="num">Conexões</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${truncated ? `<p class="truncate-note">+${reportFmt(kwEntries.length - REPORT_MAX_LINHAS_PER_PPG)} linha(s) não exibida(s).</p>` : ""}
      </div>`;
  }).join("");

  return `
    <section class="report-section">
      <h2>Principais linhas de pesquisa por PPG</h2>
      <p class="report-note">Para cada Programa de Pós-Graduação da UEA presente no recorte atual, as linhas de pesquisa confirmadas no Lattes com mais conexões internacionais. Um professor vinculado a mais de um PPG conta em cada um deles.</p>
      <div class="ppg-grid">${blocks || ""}</div>
      ${!blocks ? '<p class="report-note">Sem linhas de pesquisa confirmadas para os filtros atuais.</p>' : ""}
    </section>`;
}

/* ---------- hierarquia Instituição estrangeira > Linha de pesquisa > Pesquisadores estrangeiros ----------
   Nível 1: cada instituição estrangeira. Nível 2: as linhas de pesquisa da UEA que deram match
   com aquela instituição (rotuladas pela keyword — quando nenhum match da linha é "real"
   /confirmado no Lattes, ela carrega a tag "match por palavra-chave"). Nível 3: os pesquisadores
   ESTRANGEIROS daquela instituição conectados àquela linha (o contato a prospectar) — cada chip
   traz, no title, os professores da UEA que geraram aquele match. */
function aggregateInstitutionHierarchy(researchers, edges) {
  const researcherIds = new Set(researchers.map((r) => r.id));
  const byInst = new Map(); // instituicao -> { pais, uea:Set, estrangeiros:Set, conexoes, linhas:Map }

  for (const e of edges) {
    if (!researcherIds.has(e.researcher_id)) continue;

    if (!byInst.has(e.foreign_institution)) {
      byInst.set(e.foreign_institution, {
        pais: e.foreign_country, uea: new Set(), estrangeiros: new Set(), conexoes: 0, linhas: new Map(),
      });
    }
    const inst = byInst.get(e.foreign_institution);
    inst.uea.add(e.researcher_id);
    inst.estrangeiros.add(e.foreign_author_orcid || e.foreign_author_name);
    inst.conexoes += 1;

    if (!inst.linhas.has(e.keyword)) inst.linhas.set(e.keyword, { conexoes: 0, real: false, estrangeiros: new Map() });
    const linha = inst.linhas.get(e.keyword);
    linha.conexoes += 1;
    if (e.linha_real) linha.real = true;

    const fKey = e.foreign_author_orcid || e.foreign_author_name;
    if (!linha.estrangeiros.has(fKey)) {
      linha.estrangeiros.set(fKey, { nome: e.foreign_author_name, conexoes: 0, ueaProfs: new Set() });
    }
    const fEntry = linha.estrangeiros.get(fKey);
    fEntry.conexoes += 1;
    fEntry.ueaProfs.add(e.researcher_id);
  }

  return byInst;
}

function buildInstitutionHierarchySection(researchers, edges, researcherById) {
  const byInst = aggregateInstitutionHierarchy(researchers, edges);
  const instEntries = [...byInst.entries()].sort((a, b) => b[1].conexoes - a[1].conexoes);
  const instTruncated = instEntries.length > REPORT_MAX_INSTITUTION_ROWS;

  const blocks = instEntries.slice(0, REPORT_MAX_INSTITUTION_ROWS).map(([instName, inst]) => {
    // linhas confirmadas no Lattes (real) vêm antes das de match só por palavra-chave,
    // e dentro de cada grupo, as com mais conexões primeiro
    const linhaEntries = [...inst.linhas.entries()].sort((a, b) =>
      (b[1].real - a[1].real) || (b[1].conexoes - a[1].conexoes)
    );
    const linhasTruncated = linhaEntries.length > REPORT_MAX_LINHAS_PER_INSTITUTION;

    const linhaBlocks = linhaEntries.slice(0, REPORT_MAX_LINHAS_PER_INSTITUTION).map(([kw, linha]) => {
      const foreignEntries = [...linha.estrangeiros.values()]
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      const foreignTruncated = foreignEntries.length > REPORT_MAX_FOREIGN_PER_LINHA;
      const foreignChips = foreignEntries.slice(0, REPORT_MAX_FOREIGN_PER_LINHA).map((f) => {
        const ueaNames = [...f.ueaProfs].map((rid) => researcherById.get(rid)?.nome).filter(Boolean).join(", ");
        return `<span class="chip" title="Conecta com: ${reportEsc(ueaNames)}">${reportEsc(f.nome)}</span>`;
      }).join("");

      return `
        <div class="linha-block">
          <h4>${reportEsc(kw)}${linha.real ? "" : ' <span class="tag">match por palavra-chave</span>'}</h4>
          <div class="prof-chips">${foreignChips || '<span class="report-note">Nenhum pesquisador identificado.</span>'}</div>
          ${foreignTruncated ? `<p class="truncate-note">+${reportFmt(foreignEntries.length - REPORT_MAX_FOREIGN_PER_LINHA)} pesquisador(es) não exibido(s).</p>` : ""}
        </div>`;
    }).join("");

    return `
      <div class="inst-block">
        <h3>${reportEsc(instName)}</h3>
        <div class="inst-meta">${reportEsc(inst.pais)} · ${reportFmt(inst.uea.size)} pesquisador(es) UEA · ${reportFmt(inst.estrangeiros.size)} pesquisador(es) estrangeiro(s) · ${reportFmt(inst.conexoes)} conexões</div>
        ${linhaBlocks}
        ${linhasTruncated ? `<p class="truncate-note">+${reportFmt(linhaEntries.length - REPORT_MAX_LINHAS_PER_INSTITUTION)} linha(s) de pesquisa não exibida(s).</p>` : ""}
      </div>`;
  }).join("");

  return `
    <section class="report-section">
      <h2>Instituições estrangeiras</h2>
      <p class="report-note">Organizado por instituição estrangeira; dentro de cada uma, as principais linhas de pesquisa da UEA que deram match, e os pesquisadores estrangeiros daquela instituição conectados a cada linha (passe o mouse sobre o nome para ver qual professor da UEA gerou o match).</p>
      ${blocks || `<p class="report-note">Sem dados para os filtros atuais.</p>`}
      ${instTruncated ? `<p class="truncate-note">Mostrando as ${REPORT_MAX_INSTITUTION_ROWS} instituições com mais conexões, de ${reportFmt(instEntries.length)} no total.</p>` : ""}
    </section>`;
}

/* ---------- montagem do HTML ---------- */
function buildReportHTML({ researchers, edges, filters, researcherById, totals, logoDataURI }) {
  const agg = aggregateForReport(researchers, edges);
  const genDate = new Date().toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" });
  const filterChips = describeReportFilters(filters, researcherById);

  const distinctForeign = agg.byForeignResearcher.size;
  const distinctCountries = agg.byCountry.size;
  const distinctInstitutions = agg.byInstitution.size;

  const countryRows = [...agg.byCountry.entries()]
    .sort((a, b) => b[1].conexoes - a[1].conexoes)
    .map(([pais, v]) => `
      <tr>
        <td>${reportEsc(pais)}</td>
        <td class="num">${reportFmt(v.instituicoes.size)}</td>
        <td class="num">${reportFmt(v.pesquisadoresUEA.size)}</td>
        <td class="num">${reportFmt(v.conexoes)}</td>
      </tr>`).join("");

  const linhasByPPGSection = buildLinhasByPPGSection(researchers, edges);

  const foreignRankedRows = [...agg.byForeignResearcher.values()]
    .sort((a, b) => b.conexoes - a.conexoes)
    .slice(0, 20)
    .map((f, i) => `
      <tr>
        <td class="num">${i + 1}</td>
        <td>${reportEsc(f.nome)}</td>
        <td>${reportEsc(f.instituicao)}</td>
        <td>${reportEsc(f.pais)}</td>
        <td class="num">${reportFmt(f.conexoes)}</td>
      </tr>`).join("");

  const institutionHierarchySection = buildInstitutionHierarchySection(researchers, edges, researcherById);

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Relatório de Prospecção — Parcerias Internacionais UEA</title>
<style>
  :root {
    --ink-primary:#0b3d2b; --ink-secondary:#3a3a3c; --ink-muted:#7a8580;
    --border:#cdeedd; --border-strong:#9fd9bb; --accent:#1f8a5f; --wash:#f6faf8;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Arial, sans-serif;
    color: var(--ink-secondary); margin: 0; padding: 32px 40px 60px; background: #fff;
    max-width: 980px; margin-inline: auto;
  }
  h1 { color: var(--ink-primary); font-size: 22px; margin: 0 0 4px; }
  h2 { color: var(--ink-primary); font-size: 15px; margin: 0 0 10px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
  h4 { color: var(--ink-primary); font-size: 13px; margin: 18px 0 6px; }
  h4 small { color: var(--ink-muted); font-weight: 400; margin-left: 6px; }
  .report-header { display: flex; align-items: center; gap: 16px; border-bottom: 2px solid var(--ink-primary); padding-bottom: 16px; margin-bottom: 20px; }
  .report-header img { height: 44px; }
  .report-header .meta { color: var(--ink-muted); font-size: 12px; margin-top: 4px; }
  .filter-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 24px; }
  .filter-chips span { background: var(--wash); border: 1px solid var(--border); color: var(--ink-primary);
    border-radius: 999px; padding: 3px 10px; font-size: 11.5px; }
  .filter-chips.is-empty span { color: var(--ink-muted); }
  .stat-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 26px; }
  .stat-card { background: var(--wash); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; text-align: center; }
  .stat-card b { display: block; font-size: 19px; color: var(--ink-primary); }
  .stat-card span { font-size: 10.5px; color: var(--ink-muted); }
  .report-section { margin-bottom: 28px; }
  .report-note { font-size: 12px; color: var(--ink-muted); margin: 0 0 12px; }
  table.report-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.report-table th, table.report-table td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--border); }
  table.report-table th { color: var(--ink-muted); font-weight: 600; font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; }
  table.report-table td.num, table.report-table th.num { text-align: right; }
  table.report-table--compact td, table.report-table--compact th { padding: 4px 6px; font-size: 11.5px; }
  .tag { display: inline-block; font-size: 9.5px; color: var(--ink-muted); background: var(--wash); border: 1px solid var(--border);
    border-radius: 999px; padding: 1px 6px; margin-left: 4px; }
  .truncate-note { font-size: 11px; color: var(--ink-muted); margin-top: 6px; }
  /* hierarquia nível 1/2/3: Instituição estrangeira > Linha de pesquisa > Professores UEA */
  .inst-block { break-inside: avoid; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
  .inst-block:last-child { border-bottom: none; }
  .inst-block h3 { color: var(--ink-primary); font-size: 14px; margin: 0 0 3px; }
  .inst-block .inst-meta { font-size: 11px; color: var(--ink-muted); margin-bottom: 10px; }
  .linha-block { break-inside: avoid; margin: 0 0 10px 16px; }
  .linha-block h4 { font-size: 12px; color: var(--ink-secondary); margin: 0 0 5px; font-weight: 700; }
  /* linhas de pesquisa separadas por PPG — grade de 2 colunas, um bloco por PPG */
  .ppg-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; }
  .ppg-block { break-inside: avoid; margin-bottom: 14px; }
  .ppg-block h3 { color: var(--ink-primary); font-size: 12.5px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: .03em; }
  .prof-chips { display: flex; flex-wrap: wrap; gap: 5px; }
  .prof-chips .chip { display: inline-block; font-size: 11px; color: var(--ink-primary); background: var(--wash);
    border: 1px solid var(--border); border-radius: 999px; padding: 2px 9px; }
  .report-footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid var(--border); font-size: 10.5px; color: var(--ink-muted); }
  .print-bar { position: sticky; top: 0; background: #fff; padding: 10px 0 16px; display: flex; justify-content: flex-end; gap: 8px; }
  .print-bar button { font: inherit; font-size: 13px; padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border-strong);
    background: var(--accent); color: #fff; cursor: pointer; }
  .print-bar button:hover { opacity: .9; }
  @media print {
    .print-bar { display: none; }
    body { padding: 0 6mm; max-width: none; }
    .inst-block, .linha-block, .ppg-block { page-break-inside: avoid; }
    @page { margin: 14mm; }
  }
</style>
</head>
<body>

<div class="print-bar">
  <button type="button" onclick="window.print()">Imprimir / Salvar como PDF</button>
</div>

<div class="report-header">
  ${logoDataURI ? `<img src="${logoDataURI}" alt="PROPESP UEA" />` : ""}
  <div>
    <h1>Relatório de Prospecção de Parcerias Internacionais</h1>
    <div class="meta">Pesquisadores UEA × Mundo · gerado em ${reportEsc(genDate)}</div>
  </div>
</div>

<div class="filter-chips${filterChips.length ? "" : " is-empty"}">
  ${filterChips.length ? filterChips.map((c) => `<span>${reportEsc(c)}</span>`).join("") : "<span>Nenhum filtro aplicado — base completa do painel.</span>"}
</div>

<div class="stat-grid">
  <div class="stat-card"><b>${reportFmt(researchers.length)}</b><span>Pesquisadores UEA (de ${reportFmt(totals.researchers)})</span></div>
  <div class="stat-card"><b>${reportFmt(distinctInstitutions)}</b><span>Instituições estrangeiras (de ${reportFmt(totals.institutions)})</span></div>
  <div class="stat-card"><b>${reportFmt(distinctCountries)}</b><span>Países</span></div>
  <div class="stat-card"><b>${reportFmt(edges.length)}</b><span>Conexões</span></div>
  <div class="stat-card"><b>${reportFmt(distinctForeign)}</b><span>Pesquisadores estrangeiros</span></div>
</div>

<section class="report-section">
  <h2>Distribuição por país</h2>
  <table class="report-table">
    <thead><tr><th>País</th><th class="num">Instituições</th><th class="num">Pesquisadores UEA</th><th class="num">Conexões</th></tr></thead>
    <tbody>${countryRows || `<tr><td colspan="4">Sem dados para os filtros atuais.</td></tr>`}</tbody>
  </table>
</section>

${linhasByPPGSection}

<section class="report-section">
  <h2>Pesquisadores estrangeiros mais conectados</h2>
  <table class="report-table">
    <thead><tr><th class="num">#</th><th>Nome</th><th>Instituição</th><th>País</th><th class="num">Conexões</th></tr></thead>
    <tbody>${foreignRankedRows || `<tr><td colspan="5">Sem dados para os filtros atuais.</td></tr>`}</tbody>
  </table>
</section>

${institutionHierarchySection}

<div class="report-footer">
  Gerado automaticamente pelo Painel de Parcerias Internacionais — PROPESP/UEA. Fonte dos matches: OpenAlex (publicações) + Currículo Lattes (linhas de pesquisa), ranqueados por similaridade semântica (Sentence-BERT).
</div>

</body>
</html>`;
}

/* ---------- ponto de entrada usado pela página ----------
   window.open() PRECISA ser chamado de forma síncrona, dentro do próprio
   handler de clique — se rolar depois de um `await` (ex.: esperando o fetch
   da logo), a maioria dos navegadores não reconhece mais o gesto do usuário
   e bloqueia a aba silenciosamente (sem erro no console, sem cair no
   `if (!win)`). Por isso abrimos a aba (em branco, com uma mensagem de
   carregando) ANTES de qualquer await, e só depois preenchemos o conteúdo. */
function generateProspectingReport({ researchers, edges, filters, researcherById, totals }) {
  const win = window.open("", "_blank");
  if (!win) {
    alert("O navegador bloqueou a abertura da nova aba. Permita pop-ups para este site e tente novamente.");
    return;
  }
  win.document.write(
    '<!doctype html><meta charset="utf-8"><title>Gerando relatório…</title>' +
    '<body style="font-family:-apple-system,sans-serif;color:#3a3a3c;padding:40px;">Gerando relatório de prospecção…</body>'
  );

  const btn = document.getElementById("btn-report");
  if (btn) { btn.disabled = true; btn.textContent = "Gerando…"; }

  fetchLogoDataURI()
    .then((logoDataURI) => {
      const html = buildReportHTML({ researchers, edges, filters, researcherById, totals, logoDataURI });
      win.document.open();
      win.document.write(html);
      win.document.close();
    })
    .catch((err) => {
      win.document.open();
      win.document.write(
        '<!doctype html><meta charset="utf-8"><title>Erro</title>' +
        '<body style="font-family:-apple-system,sans-serif;color:#b00020;padding:40px;">' +
        "Erro ao gerar o relatório: " + reportEsc(err && err.message ? err.message : String(err)) + "</body>"
      );
      win.document.close();
      console.error("generateProspectingReport falhou:", err);
    })
    .finally(() => {
      if (btn) { btn.disabled = false; btn.textContent = "Gerar relatório de prospecção"; }
    });
}

window.generateProspectingReport = generateProspectingReport;
