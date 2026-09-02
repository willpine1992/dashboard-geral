/* ==========================================================================
   GERBRAS Dashboard — utilidades compartilhadas: dados, paleta, filtros
   ========================================================================== */

// Valores iniciais (tema claro); refreshThemeColors() os substitui lendo as
// CSS custom properties, então ficam corretos tanto no 1º load quanto após
// alternar o tema. Ficam como `let` de propósito — outros arquivos leem o
// mesmo binding global e enxergam a reatribuição automaticamente.
let CAT_COLORS = [
  "#2a78d6", // 1 azul
  "#eb6834", // 2 laranja
  "#1baf7a", // 3 água
  "#eda100", // 4 amarelo
  "#e87ba4", // 5 magenta
  "#008300", // 6 verde
  "#4a3aa7", // 7 violeta
  "#e34948", // 8 vermelho — reservado p/ bucket "Outras"
];
let OTHER_COLOR = CAT_COLORS[7];
const MAX_CATEGORICAL_INDIVIDUAL = 7; // até 7 linhas visíveis: usa a paleta validada (CAT_COLORS) tal e qual
// acima de 7 linhas visíveis simultaneamente (ex.: Sankey sem filtro, que mostra
// até maxLinhas=22 nós nomeados — ver charts.js), cada uma ainda ganha cor
// própria, só que gerada por rotação de matiz (ângulo áureo) em vez de vir de
// uma paleta fixa — não existe mais "paleta categórica validada" pra tantas
// cores simultâneas, então isso é uma extensão best-effort, não substitui os
// 7 tons cuidadosamente escolhidos. Cobre generosamente o maxLinhas do Sankey;
// o que ainda sobrar cai no bucket cinza "Outras linhas de pesquisa".
const MAX_CATEGORICAL_TOTAL = 24;
const GOLDEN_ANGLE_DEG = 137.508;

function generateCategoricalColors(n) {
  if (n <= CAT_COLORS.length - 1) return CAT_COLORS.slice(0, n);
  const dark = getTheme() === "dark";
  const s = dark ? 62 : 68;
  const l = dark ? 64 : 47;
  const startHue = 205; // próximo do azul do slot 1, pra dar continuidade visual
  const out = [];
  for (let i = 0; i < n; i++) {
    const hue = (startHue + i * GOLDEN_ANGLE_DEG) % 360;
    out.push(`hsl(${hue.toFixed(1)}, ${s}%, ${l}%)`);
  }
  return out;
}

let GREEN_SEQUENTIAL = ["#eaf7f0", "#c7ecda", "#96dab9", "#5fc192", "#2e9e6c", "#0f7a4d", "#0b5c3a"];
let CHART_MAP_FILL = "#eef5f1";
let CHART_MAP_BORDER = "#ffffff";
let CHART_NODE_NEUTRAL = "#0b3d2b";

/* ---------- tema claro/escuro ---------- */
const THEME_KEY = "gerbras-theme";

function readCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function refreshThemeColors() {
  CAT_COLORS = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => readCssVar(`--cat-${i}`));
  OTHER_COLOR = CAT_COLORS[7];
  GREEN_SEQUENTIAL = [1, 2, 3, 4, 5, 6, 7].map((i) => readCssVar(`--chart-seq-${i}`));
  CHART_MAP_FILL = readCssVar("--chart-map-fill");
  CHART_MAP_BORDER = readCssVar("--chart-map-border");
  CHART_NODE_NEUTRAL = readCssVar("--chart-node-neutral");
}

function getTheme() {
  return document.documentElement.getAttribute("data-theme") ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  refreshThemeColors();
  const btn = document.getElementById("theme-toggle");
  if (btn) btn.setAttribute("aria-label", theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro");
  window.dispatchEvent(new CustomEvent("gerbras:themechange", { detail: { theme } }));
}

function toggleTheme() { applyTheme(getTheme() === "dark" ? "light" : "dark"); }

function initThemeToggle() {
  refreshThemeColors();
  const theme = getTheme();
  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.setAttribute("aria-label", theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro");
    btn.addEventListener("click", toggleTheme);
  }
  initHelpTooltips();
}

async function loadData() {
  const opts = { cache: "no-cache" }; // sempre revalida com o servidor — dados mudam a cada reexport do ETL
  const [{ researchers, edges, institutions, manaus }, capesNotas] = await Promise.all([
    fetch("../data/dashboard.json", opts).then((r) => r.json()),
    fetch("../data/capes_notas.json", opts).then((r) => r.json()),
  ]);
  const institutionByName = new Map(institutions.map((i) => [i.instituicao, i]));
  const researcherById = new Map(researchers.map((r) => [r.id, r]));
  // normaliza para NFC: o Excel de origem grava acentos como caractere
  // pré-composto, mas o Lattes (via dashboard.json) às vezes grava a forma
  // decomposta (base + acento combinante) — mesma string visualmente, bytes
  // diferentes. Sem isso, códigos como "PROFÁGUA" não batem no Map.get().
  const capesByCode = new Map(capesNotas.programas.map((p) => [p.codigo.normalize("NFC"), p]));
  return {
    researchers, edges, institutions, manaus, institutionByName, researcherById,
    capesByCode, capesOpcoes: capesNotas.opcoes,
  };
}

/* ---------- Avaliação CAPES por PPG ---------- */
// um PPG "atende" um filtro de nível/modalidade/situação se QUALQUER um dos
// seus cursos (ex.: Mestrado e Doutorado são cursos distintos do mesmo PPG)
// tiver aquele valor — o conceito, por sua vez, é único por PPG.
function ppgMatchesCapesFilters(codigo, capesByCode, filters) {
  const p = capesByCode.get(codigo.normalize("NFC"));
  if (!p) return !(filters.nivel || filters.modalidade || filters.situacao || filters.conceito);
  if (filters.conceito && String(p.conceito) !== filters.conceito) return false;
  if (filters.nivel || filters.modalidade || filters.situacao) {
    const ok = p.cursos.some((c) =>
      (!filters.nivel || c.nivel === filters.nivel) &&
      (!filters.modalidade || c.modalidade === filters.modalidade) &&
      (!filters.situacao || c.situacao === filters.situacao)
    );
    if (!ok) return false;
  }
  return true;
}

/* ---------- estado de filtros, compartilhado via querystring ---------- */
function readFiltersFromURL() {
  const p = new URLSearchParams(location.search);
  return {
    grandeArea: p.get("grandeArea") || "",
    area: p.get("area") || "",
    ppgs: new Set((p.get("ppgs") || "").split(",").filter(Boolean)),
    linhas: new Set((p.get("linhas") || "").split("||").filter(Boolean)),
    pais: p.get("pais") || "",
    instituicao: p.get("instituicao") || "",
    professorId: p.get("professor") ? Number(p.get("professor")) : null,
    q: p.get("q") || "",
    nivel: p.get("nivel") || "",
    modalidade: p.get("modalidade") || "",
    situacao: p.get("situacao") || "",
    conceito: p.get("conceito") || "",
  };
}

function filtersToURL(filters) {
  const p = new URLSearchParams();
  if (filters.grandeArea) p.set("grandeArea", filters.grandeArea);
  if (filters.area) p.set("area", filters.area);
  if (filters.ppgs.size) p.set("ppgs", [...filters.ppgs].join(","));
  if (filters.linhas.size) p.set("linhas", [...filters.linhas].join("||"));
  if (filters.pais) p.set("pais", filters.pais);
  if (filters.instituicao) p.set("instituicao", filters.instituicao);
  if (filters.professorId) p.set("professor", filters.professorId);
  if (filters.q) p.set("q", filters.q);
  if (filters.nivel) p.set("nivel", filters.nivel);
  if (filters.modalidade) p.set("modalidade", filters.modalidade);
  if (filters.situacao) p.set("situacao", filters.situacao);
  if (filters.conceito) p.set("conceito", filters.conceito);
  return p.toString();
}

function applyResearcherFilters(researchers, filters, capesByCode) {
  const capesActive = capesByCode && (filters.nivel || filters.modalidade || filters.situacao || filters.conceito);
  return researchers.filter((r) => {
    if (filters.grandeArea && !r.grande_areas.includes(filters.grandeArea)) return false;
    if (filters.area && !r.areas.includes(filters.area)) return false;
    if (filters.ppgs.size && !r.programas.some((p) => filters.ppgs.has(p))) return false;
    if (filters.professorId && r.id !== filters.professorId) return false;
    if (capesActive && !r.programas.some((p) => ppgMatchesCapesFilters(p, capesByCode, filters))) return false;
    return true;
  });
}

function applyEdgeFilters(edges, filteredResearcherIds, filters) {
  return edges.filter((e) => {
    if (!filteredResearcherIds.has(e.researcher_id)) return false;
    if (filters.linhas.size && !filters.linhas.has(e.keyword)) return false;
    if (filters.pais && e.foreign_country !== filters.pais) return false;
    if (filters.instituicao && e.foreign_institution !== filters.instituicao) return false;
    return true;
  });
}

/* ---------- agregações ---------- */
function countBy(arr, keyFn) {
  const m = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function topEntries(map, n) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/* dá uma cor própria a cada uma das top-N linhas de pesquisa presentes num
   conjunto de edges (N = MAX_CATEGORICAL_TOTAL, cobre o maxLinhas do Sankey),
   dobrando só o que sobrar disso em "Outras linhas de pesquisa" */
function buildLinhaColorScale(edgeSubset) {
  const counts = countBy(edgeSubset, (e) => e.keyword);
  const top = topEntries(counts, MAX_CATEGORICAL_TOTAL).map(([k]) => k);
  const palette = generateCategoricalColors(top.length);
  const scale = new Map();
  top.forEach((k, i) => scale.set(k, palette[i]));
  return { scale, top, otherLabel: "Outras linhas de pesquisa", otherColor: OTHER_COLOR };
}
function colorForLinha(keyword, colorInfo) {
  return colorInfo.scale.get(keyword) || colorInfo.otherColor;
}

/* ---------- tooltip global ---------- */
let tooltipEl = null;
function ensureTooltip() {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "viz-tooltip";
    document.body.appendChild(tooltipEl);
  }
  return tooltipEl;
}
function showTooltip(x, y, html) {
  const el = ensureTooltip();
  el.innerHTML = html;
  el.style.left = x + "px";
  el.style.top = y + "px";
  el.classList.add("is-visible");
}
function moveTooltip(x, y) {
  if (tooltipEl) { tooltipEl.style.left = x + "px"; tooltipEl.style.top = y + "px"; }
}
function hideTooltip() {
  if (tooltipEl) tooltipEl.classList.remove("is-visible");
}

/* ---------- tooltip de ajuda: hover parado por 3s sobre [data-help] ----------
   Independente do tooltip de dados (showTooltip/hideTooltip acima, usado
   pelos gráficos D3 em cima de pontos/links específicos) — este mostra uma
   legenda explicando o card/gráfico como um todo, então usa seu próprio
   elemento e um delay bem maior. Delegação em document (mouseover/mouseout,
   que borbulham) em vez de mouseenter/mouseleave direto nos elementos, para
   funcionar em cards renderizados dinamicamente sem precisar re-inicializar. */
const HELP_HOLD_MS = 3000;
let helpTooltipEl = null;
let helpTimer = null;
let helpActiveTarget = null;

function ensureHelpTooltip() {
  if (!helpTooltipEl) {
    helpTooltipEl = document.createElement("div");
    helpTooltipEl.className = "help-tooltip";
    document.body.appendChild(helpTooltipEl);
  }
  return helpTooltipEl;
}

function positionHelpTooltip(x, y) {
  const el = helpTooltipEl;
  if (!el) return;
  const pad = 16;
  const rect = el.getBoundingClientRect();
  let left = x + pad;
  let top = y + pad;
  if (left + rect.width > window.innerWidth - 8) left = x - rect.width - pad;
  if (top + rect.height > window.innerHeight - 8) top = y - rect.height - pad;
  el.style.left = Math.max(8, left) + "px";
  el.style.top = Math.max(8, top) + "px";
}

function showHelpTooltip(text, x, y) {
  const el = ensureHelpTooltip();
  el.textContent = text;
  el.classList.add("is-visible");
  positionHelpTooltip(x, y);
}

function hideHelpTooltip() {
  clearTimeout(helpTimer);
  helpTimer = null;
  helpActiveTarget = null;
  if (helpTooltipEl) helpTooltipEl.classList.remove("is-visible");
}

function initHelpTooltips() {
  let lastX = 0, lastY = 0;
  document.addEventListener("mousemove", (ev) => { lastX = ev.clientX; lastY = ev.clientY; }, { passive: true });

  document.addEventListener("mouseover", (ev) => {
    const target = ev.target.closest("[data-help]");
    if (!target || target === helpActiveTarget) return;
    hideHelpTooltip();
    helpActiveTarget = target;
    helpTimer = setTimeout(() => {
      showHelpTooltip(target.getAttribute("data-help"), lastX, lastY);
    }, HELP_HOLD_MS);
  });

  document.addEventListener("mouseout", (ev) => {
    const target = ev.target.closest("[data-help]");
    // relatedTarget é null ao sair da janela; contains() cobre mover entre filhos do mesmo card
    if (!target || (ev.relatedTarget && target.contains(ev.relatedTarget))) return;
    hideHelpTooltip();
  });

  window.addEventListener("scroll", hideHelpTooltip, true);
  window.addEventListener("blur", hideHelpTooltip);
}

function fmt(n) { return n.toLocaleString("pt-BR"); }

function debounce(fn, ms) {
  let t;
  return function (...args) {
    const ctx = this; // preserva o `this` de quem chamou (ex: elemento do input em handlers do D3)
    clearTimeout(t);
    t = setTimeout(() => fn.apply(ctx, args), ms);
  };
}
