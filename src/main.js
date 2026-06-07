import { Chart, LineController, LineElement, PointElement, LinearScale, TimeScale, CategoryScale, Tooltip, Legend, Filler } from "chart.js";
import { createClient } from "@supabase/supabase-js";
import { createIcons, Activity, BarChart3, BriefcaseBusiness, ChevronLeft, ChevronRight, Database, Moon, RotateCw, Sun, WalletCards } from "lucide";
import "./styles.css";

Chart.register(LineController, LineElement, PointElement, LinearScale, TimeScale, CategoryScale, Tooltip, Legend, Filler);
Chart.defaults.font.family = '"Times New Roman", Times, serif';

let supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
let supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const TRADE_PAGE_SIZE = 40;
const SUPABASE_BATCH_SIZE = 1000;

const app = document.querySelector("#app");
const state = {
  route: "dashboard",
  loading: false,
  error: "",
  darkMode: localStorage.getItem("reap-theme") === "dark",
  dashboard: null,
  performance: null,
  ledger: null,
  tradePage: 1,
  charts: {},
};

let supabaseConfigured = false;
let supabase = null;

const primaryColor = "#c1121f";

const icons = { Activity, BarChart3, BriefcaseBusiness, ChevronLeft, ChevronRight, Database, Moon, RotateCw, Sun, WalletCards };

function applyTheme() {
  document.documentElement.dataset.theme = state.darkMode ? "dark" : "light";
}

function themeInk() {
  return getComputedStyle(document.documentElement).getPropertyValue("--black").trim() || "#000000";
}

async function loadRuntimeConfig() {
  try {
    const response = await fetch("./config.json", { cache: "no-store" });
    if (!response.ok) return {};
    return await response.json();
  } catch {
    return {};
  }
}

async function initSupabase() {
  const runtimeConfig = await loadRuntimeConfig();
  supabaseUrl ||= runtimeConfig.supabaseUrl;
  supabaseAnonKey ||= runtimeConfig.supabaseAnonKey;
  supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
  supabase = supabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;
}

function formatCurrency(value) {
  if (!Number.isFinite(Number(value))) return "$0.00";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value));
}

function formatNumber(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return "0.00";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value));
}

function formatQty(value) {
  if (!Number.isFinite(Number(value))) return "0";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(Number(value));
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatAxisDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
  }).format(new Date(`${value}T00:00:00`));
}

function routeFromHash() {
  const route = window.location.hash.replace("#", "");
  return ["dashboard", "performance", "ledger"].includes(route) ? route : "dashboard";
}

function setRoute(route) {
  state.route = route;
  window.location.hash = route;
  render();
  void loadRouteData();
}

async function queryOrThrow(builder) {
  const { data, error } = await builder;
  if (error) throw error;
  return data ?? [];
}

async function queryAll(builderFactory) {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + SUPABASE_BATCH_SIZE - 1;
    const batch = await queryOrThrow(builderFactory().range(from, to));
    rows.push(...batch);
    if (batch.length < SUPABASE_BATCH_SIZE) break;
    from += SUPABASE_BATCH_SIZE;
  }
  return rows;
}

async function loadDashboard() {
  if (state.dashboard || !supabase) return;
  const [holdings, equityRows, latestFills] = await Promise.all([
    queryOrThrow(supabase.from("holdings").select("symbol,quantity,market_value,unrealized_pnl").order("symbol", { ascending: true })),
    queryOrThrow(supabase.from("portfolio_equity").select("date,total_equity,gross_notional,available_cash").order("date", { ascending: false }).limit(1)),
    queryOrThrow(supabase.from("orders").select("symbol,side,quantity,fill_price,filled_at").not("filled_at", "is", null).order("filled_at", { ascending: false }).limit(5)),
  ]);
  state.dashboard = { equity: equityRows[0] ?? null, holdings, latestFills };
}

async function loadPerformance() {
  if (state.performance || !supabase) return;
  const [equityRows, metricsRows] = await Promise.all([
    queryOrThrow(supabase.from("portfolio_equity").select("date,total_equity").order("date", { ascending: false }).limit(30)),
    queryOrThrow(supabase.from("portfolio_metrics").select("date,sharpe_ratio,max_drawdown").order("date", { ascending: false }).limit(30)),
  ]);
  state.performance = { equity: equityRows.reverse(), metrics: metricsRows.reverse() };
}

async function loadLedger() {
  if (state.ledger || !supabase) return;
  const [holdings, orders] = await Promise.all([
    queryOrThrow(supabase.from("holdings").select("symbol,quantity,avg_cost_basis,market_value,unrealized_pnl").order("symbol", { ascending: true })),
    queryAll(() => supabase.from("orders").select("intent_id,symbol,side,quantity,order_type,fill_price,fill_quantity,filled_at,submitted_at,status").order("filled_at", { ascending: false, nullsFirst: false })),
  ]);
  state.ledger = { holdings, orders };
}

async function loadRouteData(force = false) {
  if (!supabaseConfigured) {
    state.error = "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild.";
    render();
    return;
  }
  if (force) {
    state.dashboard = null;
    state.performance = null;
    state.ledger = null;
  }
  state.loading = true;
  state.error = "";
  render();
  try {
    if (state.route === "dashboard") await loadDashboard();
    if (state.route === "performance") await loadPerformance();
    if (state.route === "ledger") await loadLedger();
  } catch (error) {
    state.error = error.message ?? "Unable to fetch data.";
  } finally {
    state.loading = false;
    render();
  }
}

function shell(content) {
  const nav = [
    ["dashboard", "Overview"],
    ["performance", "Performance"],
    ["ledger", "Ledger"],
  ];
  return `
    <div class="app-frame">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark" aria-label="Reap Capital gamma logo">Γ</div>
          <div>
            <strong>Reap Capital</strong>
            <span>Portfolio desk</span>
          </div>
        </div>
        <nav class="nav-tabs" aria-label="Dashboard pages">
          ${nav.map(([route, label]) => `
            <button class="nav-tab ${state.route === route ? "active" : ""}" data-route="${route}" type="button">
              <span>${label}</span>
            </button>
          `).join("")}
        </nav>
        <div class="sidebar-actions">
          <div class="icon-actions" aria-label="Quick actions">
            <button class="icon-action" type="button" data-action="theme-toggle" aria-label="${state.darkMode ? "Switch to light mode" : "Switch to dark mode"}" aria-pressed="${state.darkMode}">
              <i data-lucide="${state.darkMode ? "sun" : "moon"}"></i>
            </button>
            <a class="icon-action" href="https://github.com/cantsoar" target="_blank" rel="noreferrer" aria-label="GitHub">
              <svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 1.5C6.2 1.5 1.5 6.3 1.5 12.2c0 4.7 3 8.6 7.2 10 .5.1.7-.2.7-.5v-1.9c-2.9.6-3.5-1.2-3.5-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 0 1.6 1.1 1.6 1.1.9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.7-1.4-2.3-.3-4.8-1.2-4.8-5.2 0-1.1.4-2.1 1.1-2.8-.1-.3-.5-1.4.1-2.8 0 0 .9-.3 2.9 1.1.8-.2 1.7-.3 2.6-.3.9 0 1.8.1 2.6.3 2-1.4 2.9-1.1 2.9-1.1.6 1.4.2 2.5.1 2.8.7.8 1.1 1.7 1.1 2.8 0 4-2.4 4.9-4.8 5.2.4.3.7 1 .7 2v2.9c0 .3.2.6.7.5 4.2-1.4 7.2-5.3 7.2-10C22.5 6.3 17.8 1.5 12 1.5Z"/>
              </svg>
            </a>
            <a class="icon-action" href="https://www.linkedin.com/in/aryan-malik-xd/" target="_blank" rel="noreferrer" aria-label="LinkedIn">
              <svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.8 8.7h3.4v10.8H4.8V8.7Zm1.7-5.4c1.1 0 1.9.8 1.9 1.8S7.6 7 6.5 7 4.6 6.2 4.6 5.1s.8-1.8 1.9-1.8Zm3.8 5.4h3.2v1.5h.1c.4-.8 1.5-1.8 3.2-1.8 3.4 0 4 2.2 4 5.1v6h-3.4v-5.3c0-1.3 0-2.9-1.8-2.9s-2.1 1.4-2.1 2.8v5.4h-3.4V8.7Z"/>
              </svg>
            </a>
            <button class="icon-action" type="button" data-action="refresh" aria-label="Refresh data">
              <i data-lucide="rotate-cw"></i>
            </button>
          </div>
        </div>
      </aside>
      <main class="content">
        <header class="topbar">
          <div>
            <p class="eyebrow">Live from Supabase</p>
            <h1>${pageTitle()}</h1>
          </div>
          <div class="status-pill ${supabaseConfigured ? "ready" : "blocked"}">${supabaseConfigured ? "Read only" : "Needs config"}</div>
        </header>
        ${state.error ? `<div class="notice error">${state.error}</div>` : ""}
        ${state.loading ? `<div class="notice">Loading latest portfolio data...</div>` : ""}
        ${content}
      </main>
    </div>
  `;
}

function pageTitle() {
  if (state.route === "performance") return "Performance";
  if (state.route === "ledger") return "Ledger & Holdings";
  return "Main Dashboard";
}

function renderDashboard() {
  const data = state.dashboard;
  if (!data) return emptyPanel("Waiting for dashboard data");
  const { equity, holdings, latestFills } = data;
  return `
    <section class="metric-grid">
      ${metricCard("Total Equity", formatCurrency(equity?.total_equity))}
      ${metricCard("Gross Notional", formatCurrency(equity?.gross_notional))}
      ${metricCard("Available Cash", formatCurrency(equity?.available_cash))}
      ${metricCard("Open Positions", String(holdings.length))}
    </section>
    <section class="split-layout">
      <div class="panel">
        <div class="panel-heading">
          <h2>Holdings</h2>
          <span>${holdings.length} position${holdings.length === 1 ? "" : "s"}</span>
        </div>
        ${holdingsTable(holdings)}
      </div>
      <div class="panel">
        <div class="panel-heading">
          <h2>Latest Fills</h2>
          <span>${latestFills.length ? formatDateTime(latestFills[0].filled_at) : "—"}</span>
        </div>
        ${latestFillsTable(latestFills)}
      </div>
    </section>
  `;
}

function metricCard(label, value) {
  return `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
    </article>
  `;
}

function holdingsTable(rows, showCostBasis = false) {
  if (!rows.length) return emptyPanel("No open positions");
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th class="numeric">Qty</th>
            ${showCostBasis ? '<th class="numeric">Avg Cost Basis</th>' : ""}
            <th class="numeric">Market Value</th>
            <th class="numeric">Unrealized PnL</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => {
            const qty = Number(row.quantity);
            const isShort = qty < 0;
            return `
              <tr>
                <td>
                  <span class="symbol-cell">
                    <strong>${row.symbol}</strong>
                    ${isShort ? '<span class="side-badge short">SHORT</span>' : ""}
                  </span>
                </td>
                <td class="numeric">${formatQty(qty)}</td>
                ${showCostBasis ? `<td class="numeric">${formatCurrency(row.avg_cost_basis)}</td>` : ""}
                <td class="numeric">${formatCurrency(row.market_value)}</td>
                <td class="numeric ${Number(row.unrealized_pnl) >= 0 ? "positive" : "negative"}">${formatCurrency(row.unrealized_pnl)}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function latestFillsTable(rows) {
  if (!rows.length) return emptyPanel("No recent fills");
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Side</th>
            <th class="numeric">Qty</th>
            <th class="numeric">Fill Price</th>
            <th>Filled At</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td><strong>${row.symbol}</strong></td>
              <td><span class="side-badge ${(row.side ?? "").toLowerCase()}">${row.side}</span></td>
              <td class="numeric">${formatQty(row.quantity)}</td>
              <td class="numeric">${formatCurrency(row.fill_price)}</td>
              <td>${formatDateTime(row.filled_at)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderPerformance() {
  const data = state.performance;
  if (!data) return emptyPanel("Waiting for performance data");
  return `
    <section class="chart-stack">
      ${chartPanel("Portfolio Equity", "equityChart", "main-chart")}
      <div class="subchart-grid">
        ${chartPanel("Rolling Sharpe", "sharpeChart", "")}
        ${chartPanel("Drawdown", "drawdownChart", "")}
      </div>
    </section>
  `;
}

function chartPanel(title, id, className) {
  return `
    <div class="panel chart-panel ${className}">
      <div class="panel-heading"><h2>${title}</h2></div>
      <div class="chart-box"><canvas id="${id}"></canvas></div>
    </div>
  `;
}

function renderLedger() {
  const data = state.ledger;
  if (!data) return emptyPanel("Waiting for ledger data");
  const { holdings, orders } = data;
  const pages = Math.max(1, Math.ceil(orders.length / TRADE_PAGE_SIZE));
  state.tradePage = Math.min(state.tradePage, pages);
  const pageStart = (state.tradePage - 1) * TRADE_PAGE_SIZE;
  const pageOrders = orders.slice(pageStart, pageStart + TRADE_PAGE_SIZE);
  return `
    <section class="panel">
      <div class="panel-heading">
        <h2>Current Holdings</h2>
        <span>${holdings.length} position${holdings.length === 1 ? "" : "s"}</span>
      </div>
      ${holdingsTable(holdings, true)}
    </section>
    <section class="panel" style="margin-top: 18px;">
      <div class="panel-heading">
        <h2>Orders</h2>
        <span>${orders.length} rows</span>
      </div>
      <div class="notice">Orders shown with 1-day delay.</div>
      ${ordersTable(pageOrders)}
      <div class="pagination">
        <button type="button" data-page-prev ${state.tradePage <= 1 ? "disabled" : ""} aria-label="Previous page"><i data-lucide="chevron-left"></i></button>
        <span>Page ${state.tradePage} of ${pages}</span>
        <button type="button" data-page-next ${state.tradePage >= pages ? "disabled" : ""} aria-label="Next page"><i data-lucide="chevron-right"></i></button>
      </div>
    </section>
  `;
}


function ordersTable(rows) {
  if (!rows.length) return emptyPanel("No orders found");
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Filled At</th>
            <th>Symbol</th>
            <th>Side</th>
            <th class="numeric">Qty</th>
            <th>Type</th>
            <th class="numeric">Fill Price</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${formatDateTime(row.filled_at ?? row.submitted_at)}</td>
              <td><strong>${row.symbol}</strong></td>
              <td><span class="side-badge ${(row.side ?? "").toLowerCase()}">${row.side}</span></td>
              <td class="numeric">${formatQty(row.fill_quantity ?? row.quantity)}</td>
              <td>${row.order_type ?? "-"}</td>
              <td class="numeric">${formatCurrency(row.fill_price)}</td>
              <td>${row.status ?? "-"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function emptyPanel(message) {
  return `<div class="empty-state">${message}</div>`;
}

function render() {
  destroyCharts();
  const content = state.route === "performance" ? renderPerformance() : state.route === "ledger" ? renderLedger() : renderDashboard();
  app.innerHTML = shell(content);
  bindEvents();
  createIcons({ icons });
  if (state.route === "performance" && state.performance) {
    requestAnimationFrame(renderCharts);
  }
}

function bindEvents() {
  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => setRoute(button.dataset.route));
  });
  document.querySelector("[data-action='refresh']")?.addEventListener("click", () => loadRouteData(true));
  document.querySelector("[data-action='theme-toggle']")?.addEventListener("click", () => {
    state.darkMode = !state.darkMode;
    localStorage.setItem("reap-theme", state.darkMode ? "dark" : "light");
    applyTheme();
    render();
  });
  document.querySelector("[data-page-prev]")?.addEventListener("click", () => {
    state.tradePage = Math.max(1, state.tradePage - 1);
    render();
  });
  document.querySelector("[data-page-next]")?.addEventListener("click", () => {
    state.tradePage += 1;
    render();
  });
}

function destroyCharts() {
  Object.values(state.charts).forEach((chart) => chart?.destroy());
  state.charts = {};
}

function renderCharts() {
  if (!state.performance) return;
  destroyCharts();
  const { equity, metrics } = state.performance;
  state.charts.equity = makeLineChart("equityChart", buildSeries(equity, "date", "total_equity"), { xTitle: "Date", yTitle: "Total equity", yFormat: "currency" });
  state.charts.sharpe = makeLineChart("sharpeChart", buildSeries(metrics, "date", "sharpe_ratio"), { xTitle: "Date", yTitle: "Sharpe ratio", yFormat: "number" });
  state.charts.drawdown = makeLineChart("drawdownChart", buildSeries(metrics, "date", "max_drawdown"), { xTitle: "Date", yTitle: "Max drawdown", yFormat: "percent" });
}

function buildSeries(rows, xField, yField) {
  const labels = rows.map((row) => formatAxisDate(row[xField]));
  const data = rows.map((row) => (Number.isFinite(Number(row[yField])) ? Number(row[yField]) : null));
  return {
    labels,
    datasets: [{
      label: yField.replace(/_/g, " "),
      data,
      borderColor: primaryColor,
      backgroundColor: `${primaryColor}22`,
      borderWidth: 3,
      pointRadius: rows.length <= 40 ? 3 : 0,
      pointHoverRadius: 5,
      tension: 0.2,
      fill: false,
      spanGaps: true,
    }],
  };
}

function makeLineChart(id, series, config) {
  const canvas = document.querySelector(`#${id}`);
  if (!canvas) return null;
  const ink = themeInk();
  const grid = state.darkMode ? "#ffffff33" : "#00000022";
  return new Chart(canvas, {
    type: "line",
    data: series,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: ink, usePointStyle: true, boxWidth: 10, padding: 14 },
        },
        tooltip: {
          callbacks: {
            title: (items) => items[0]?.label ?? "",
            label: (item) => `${item.dataset.label}: ${formatChartValue(item.parsed.y, config.yFormat)}`,
          },
        },
      },
      scales: {
        x: {
          type: "category",
          title: { display: true, text: config.xTitle, color: ink, font: { weight: "bold" } },
          ticks: { color: ink, maxTicksLimit: 8, maxRotation: 0, autoSkip: true },
          grid: { display: false },
        },
        y: {
          title: { display: true, text: config.yTitle, color: ink, font: { weight: "bold" } },
          ticks: {
            color: ink,
            maxTicksLimit: 6,
            callback: (value) => formatChartValue(value, config.yFormat),
          },
          grid: { color: grid },
        },
      },
    },
  });
}

function formatChartValue(value, mode) {
  if (!Number.isFinite(Number(value))) return "-";
  if (mode === "currency") return formatCurrency(value);
  if (mode === "percent") return `${formatNumber(Number(value) * 100, 1)}%`;
  return formatNumber(value, 2);
}

window.addEventListener("hashchange", () => {
  state.route = routeFromHash();
  render();
  void loadRouteData();
});

async function bootstrap() {
  await initSupabase();
  applyTheme();
  state.route = routeFromHash();
  render();
  await loadRouteData();
}

void bootstrap();
