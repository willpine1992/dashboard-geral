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
const MAX_CATEGORICAL_INDIVIDUAL = 7; // top-N linhas de pesquisa ganham cor própria; resto -> "Outras"

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
}

async function loadData() {
  const opts = { cache: "no-cache" }; // sempre revalida com o servidor — dados mudam a cada reexport do ETL
  const { researchers, edges, institutions, manaus } = await fetch("../data/dashboard.json", opts).then((r) => r.json());
  const institutionByName = new Map(institutions.map((i) => [i.instituicao, i]));
  const researcherById = new Map(researchers.map((r) => [r.id, r]));
  return { researchers, edges, institutions, manaus, institutionByName, researcherById };
}

/* ---------- estado de filtros, compartilhado via querystring ---------- */
function readFiltersFromURL() {
  const p = new URLSearchParams(location.search);
  return {
    grandeArea: p.get("grandeArea") || "",
    area: p.get("area") || "",
    ppgs: new Set((p.get("ppgs") || "").split(",").filter(Boolean)),
    linhas: new Set((p.get("linhas") || "").split("||").filter(Boolean)),
    professorId: p.get("professor") ? Number(p.get("professor")) : null,
    q: p.get("q") || "",
  };
}

function filtersToURL(filters) {
  const p = new URLSearchParams();
  if (filters.grandeArea) p.set("grandeArea", filters.grandeArea);
  if (filters.area) p.set("area", filters.area);
  if (filters.ppgs.size) p.set("ppgs", [...filters.ppgs].join(","));
  if (filters.linhas.size) p.set("linhas", [...filters.linhas].join("||"));
  if (filters.professorId) p.set("professor", filters.professorId);
  if (filters.q) p.set("q", filters.q);
  return p.toString();
}

function applyResearcherFilters(researchers, filters) {
  return researchers.filter((r) => {
    if (filters.grandeArea && !r.grande_areas.includes(filters.grandeArea)) return false;
    if (filters.area && !r.areas.includes(filters.area)) return false;
    if (filters.ppgs.size && !r.programas.some((p) => filters.ppgs.has(p))) return false;
    if (filters.professorId && r.id !== filters.professorId) return false;
    return true;
  });
}

function applyEdgeFilters(edges, filteredResearcherIds, filters) {
  return edges.filter((e) => {
    if (!filteredResearcherIds.has(e.researcher_id)) return false;
    if (filters.linhas.size && !filters.linhas.has(e.keyword)) return false;
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

/* categoriza as top-N linhas de pesquisa presentes num conjunto de edges,
   dobrando o resto em "Outras linhas de pesquisa" */
function buildLinhaColorScale(edgeSubset) {
  const counts = countBy(edgeSubset, (e) => e.keyword);
  const top = topEntries(counts, MAX_CATEGORICAL_INDIVIDUAL).map(([k]) => k);
  const scale = new Map();
  top.forEach((k, i) => scale.set(k, CAT_COLORS[i]));
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

function fmt(n) { return n.toLocaleString("pt-BR"); }

function debounce(fn, ms) {
  let t;
  return function (...args) {
    const ctx = this; // preserva o `this` de quem chamou (ex: elemento do input em handlers do D3)
    clearTimeout(t);
    t = setTimeout(() => fn.apply(ctx, args), ms);
  };
}
