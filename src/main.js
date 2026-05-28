import { Chart, LineController, LineElement, PointElement, LinearScale, TimeScale, CategoryScale, Tooltip, Legend, Filler } from "chart.js";
import { createClient } from "@supabase/supabase-js";
import { createIcons, Activity, BarChart3, BriefcaseBusiness, ChevronLeft, ChevronRight, Database, RefreshCw, WalletCards } from "lucide";
import "./styles.css";

Chart.register(LineController, LineElement, PointElement, LinearScale, TimeScale, CategoryScale, Tooltip, Legend, Filler);
Chart.defaults.font.family = '"Times New Roman", Times, serif';

let supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
let supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const GLOBAL_STRATEGY_ID = 0;
const TRADE_PAGE_SIZE = 40;
const SUPABASE_BATCH_SIZE = 1000;

const app = document.querySelector("#app");
const state = {
  route: "dashboard",
  loading: false,
  error: "",
  strategies: [],
  dashboard: null,
  analytics: null,
  ledger: null,
  selectedStrategies: new Set([GLOBAL_STRATEGY_ID]),
  ledgerFilter: "all",
  tradePage: 1,
  charts: {},
};

let supabaseConfigured = false;
let supabase = null;

const palette = ["#000000", "#333333", "#666666", "#999999", "#111111", "#444444", "#777777", "#aaaaaa"];

const icons = { Activity, BarChart3, BriefcaseBusiness, ChevronLeft, ChevronRight, Database, RefreshCw, WalletCards };

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

function strategyName(id) {
  const strategy = state.strategies.find((item) => Number(item.id) === Number(id));
  if (strategy) return strategy.name;
  return Number(id) === GLOBAL_STRATEGY_ID ? "Global Portfolio" : `Strategy ${id}`;
}

function routeFromHash() {
  const route = window.location.hash.replace("#", "");
  return ["dashboard", "analytics", "ledger"].includes(route) ? route : "dashboard";
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

async function loadStrategies() {
  if (!supabase || state.strategies.length) return;
  const strategies = await queryOrThrow(supabase.from("strategies").select("id,name").order("id", { ascending: true }));
  const hasGlobal = strategies.some((item) => Number(item.id) === GLOBAL_STRATEGY_ID);
  state.strategies = hasGlobal ? strategies : [{ id: GLOBAL_STRATEGY_ID, name: "Global Portfolio" }, ...strategies];
}

async function loadDashboard() {
  if (state.dashboard || !supabase) return;
  const [equity, metrics, positions, latestTrade] = await Promise.all([
    queryOrThrow(supabase.from("portfolio_equity").select("time,strategy_id,invested_value,cash_balance,total_equity").eq("strategy_id", GLOBAL_STRATEGY_ID).order("time", { ascending: false }).limit(1)),
    queryOrThrow(supabase.from("daily_metrics").select("date,strategy_id,sharpe_ratio,beta,max_drawdown").eq("strategy_id", GLOBAL_STRATEGY_ID).order("date", { ascending: false }).limit(1)),
    queryOrThrow(supabase.from("current_positions").select("strategy_id,asset_id,current_qty,avg_entry_price,unrealized_pnl").order("asset_id", { ascending: true })),
    queryOrThrow(supabase.from("trades").select("time,strategy_id,asset_id,action,price,qty").order("time", { ascending: false }).limit(1)),
  ]);
  state.dashboard = {
    equity: equity[0] ?? null,
    metrics: metrics[0] ?? null,
    positions: combinePositions(positions),
    latestTrade: latestTrade[0] ?? null,
  };
}

async function loadAnalytics() {
  if (state.analytics || !supabase) return;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sinceDate = since.slice(0, 10);
  const [equity, metrics] = await Promise.all([
    queryAll(() => supabase.from("portfolio_equity").select("time,strategy_id,invested_value,cash_balance,total_equity").gte("time", since).order("time", { ascending: true })),
    queryAll(() => supabase.from("daily_metrics").select("date,strategy_id,sharpe_ratio,beta,max_drawdown").gte("date", sinceDate).order("date", { ascending: true })),
  ]);
  const activeIds = Array.from(new Set([...equity.map((row) => Number(row.strategy_id)), ...metrics.map((row) => Number(row.strategy_id)), GLOBAL_STRATEGY_ID])).sort((a, b) => a - b);
  state.analytics = { equity, metrics, activeIds };
}

async function loadLedger() {
  if (state.ledger || !supabase) return;
  const [positions, trades] = await Promise.all([
    queryAll(() => supabase.from("current_positions").select("strategy_id,asset_id,current_qty,avg_entry_price,unrealized_pnl").order("strategy_id", { ascending: true })),
    queryAll(() => supabase.from("trades").select("time,strategy_id,asset_id,action,price,qty").order("time", { ascending: false })),
  ]);
  state.ledger = { positions, trades };
}

async function loadRouteData(force = false) {
  if (!supabaseConfigured) {
    state.error = "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then rebuild.";
    render();
    return;
  }

  if (force) {
    state.dashboard = null;
    state.analytics = null;
    state.ledger = null;
  }

  state.loading = true;
  state.error = "";
  render();
  try {
    await loadStrategies();
    if (state.route === "dashboard") await loadDashboard();
    if (state.route === "analytics") await loadAnalytics();
    if (state.route === "ledger") await loadLedger();
  } catch (error) {
    state.error = error.message ?? "Unable to fetch dashboard data.";
  } finally {
    state.loading = false;
    render();
  }
}

function combinePositions(positions) {
  const grouped = new Map();
  for (const row of positions) {
    const key = row.asset_id;
    const existing = grouped.get(key) ?? { asset_id: key, current_qty: 0, avg_entry_numerator: 0, avg_entry_denominator: 0, unrealized_pnl: 0 };
    const qty = Number(row.current_qty) || 0;
    const avg = Number(row.avg_entry_price) || 0;
    existing.current_qty += qty;
    existing.avg_entry_numerator += Math.abs(qty) * avg;
    existing.avg_entry_denominator += Math.abs(qty);
    existing.unrealized_pnl += Number(row.unrealized_pnl) || 0;
    grouped.set(key, existing);
  }
  return Array.from(grouped.values()).map((row) => ({
    asset_id: row.asset_id,
    current_qty: row.current_qty,
    avg_entry_price: row.avg_entry_denominator ? row.avg_entry_numerator / row.avg_entry_denominator : 0,
    unrealized_pnl: row.unrealized_pnl,
  }));
}

function shell(content) {
  const nav = [
    ["dashboard", "Overview", "activity"],
    ["analytics", "Analytics", "bar-chart-3"],
    ["ledger", "Ledger", "database"],
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
          ${nav.map(([route, label, icon]) => `
            <button class="nav-tab ${state.route === route ? "active" : ""}" data-route="${route}" type="button">
              <i data-lucide="${icon}"></i>
              <span>${label}</span>
            </button>
          `).join("")}
        </nav>
        <button class="refresh-button" type="button" data-action="refresh">
          <i data-lucide="refresh-cw"></i>
          <span>Refresh data</span>
        </button>
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
  if (state.route === "analytics") return "Analytics & Graphs";
  if (state.route === "ledger") return "Ledger & Holdings";
  return "Main Dashboard";
}

function renderDashboard() {
  const data = state.dashboard;
  if (!data) return emptyPanel("Waiting for dashboard data");
  const { equity, metrics, positions, latestTrade } = data;
  return `
    <section class="metric-grid">
      ${metricCard("Total Value", formatCurrency(equity?.total_equity))}
      ${metricCard("Cash Balance", formatCurrency(equity?.cash_balance))}
      ${metricCard("Invested Value", formatCurrency(equity?.invested_value))}
      ${metricCard("Sharpe / Beta", `${formatNumber(metrics?.sharpe_ratio)} / ${formatNumber(metrics?.beta)}`)}
    </section>
    <section class="split-layout">
      <div class="panel">
        <div class="panel-heading">
          <h2>Combined Holdings</h2>
          <span>${positions.length} assets</span>
        </div>
        ${positionsTable(positions, false)}
      </div>
      <div class="panel">
        <div class="panel-heading">
          <h2>Latest Trade</h2>
          <span>${formatDateTime(latestTrade?.time)}</span>
        </div>
        ${latestTrade ? `
          <dl class="trade-summary">
            <div><dt>Asset</dt><dd>${latestTrade.asset_id}</dd></div>
            <div><dt>Action</dt><dd>${latestTrade.action}</dd></div>
            <div><dt>Strategy</dt><dd>${strategyName(latestTrade.strategy_id)}</dd></div>
            <div><dt>Quantity</dt><dd>${formatQty(latestTrade.qty)}</dd></div>
            <div><dt>Price</dt><dd>${formatCurrency(latestTrade.price)}</dd></div>
          </dl>
        ` : emptyPanel("No trades found")}
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

function renderAnalytics() {
  const data = state.analytics;
  if (!data) return emptyPanel("Waiting for analytics data");
  const strategyOptions = data.activeIds.map((id) => `
    <label class="strategy-toggle">
      <input type="checkbox" data-strategy-toggle="${id}" ${state.selectedStrategies.has(id) ? "checked" : ""} ${id === GLOBAL_STRATEGY_ID ? "disabled" : ""} />
      <span>${strategyName(id)}</span>
    </label>
  `).join("");

  return `
    <section class="panel controls-panel">
      <div>
        <h2>Strategy visibility</h2>
        <p>All 30-day data is loaded once; toggles only hide or show cached series.</p>
      </div>
      <div class="strategy-list">${strategyOptions}</div>
    </section>
    <section class="chart-stack">
      ${chartPanel("Portfolio Equity", "equityChart", "main-chart")}
      <div class="subchart-grid">
        ${chartPanel("Daily Rolling Sharpe", "sharpeChart", "")}
        ${chartPanel("Beta", "betaChart", "")}
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
  const positions = filterByStrategy(data.positions);
  const trades = filterByStrategy(data.trades);
  const pages = Math.max(1, Math.ceil(trades.length / TRADE_PAGE_SIZE));
  state.tradePage = Math.min(state.tradePage, pages);
  const pageStart = (state.tradePage - 1) * TRADE_PAGE_SIZE;
  const pageTrades = trades.slice(pageStart, pageStart + TRADE_PAGE_SIZE);
  return `
    <section class="panel controls-panel">
      <div>
        <h2>Raw tables</h2>
        <p>Trades are paginated in the browser to keep rendering responsive.</p>
      </div>
      <label class="filter-label">
        <span>Strategy</span>
        <select data-ledger-filter>
          <option value="all" ${state.ledgerFilter === "all" ? "selected" : ""}>All strategies</option>
          ${state.strategies.map((strategy) => `<option value="${strategy.id}" ${String(state.ledgerFilter) === String(strategy.id) ? "selected" : ""}>${strategyName(strategy.id)}</option>`).join("")}
        </select>
      </label>
    </section>
    <section class="panel">
      <div class="panel-heading">
        <h2>Current Positions</h2>
        <span>${positions.length} rows</span>
      </div>
      ${positionsTable(positions, true)}
    </section>
    <section class="panel">
      <div class="panel-heading">
        <h2>Trades</h2>
        <span>${trades.length} rows</span>
      </div>
      ${tradesTable(pageTrades)}
      <div class="pagination">
        <button type="button" data-page-prev ${state.tradePage <= 1 ? "disabled" : ""} aria-label="Previous page"><i data-lucide="chevron-left"></i></button>
        <span>Page ${state.tradePage} of ${pages}</span>
        <button type="button" data-page-next ${state.tradePage >= pages ? "disabled" : ""} aria-label="Next page"><i data-lucide="chevron-right"></i></button>
      </div>
    </section>
  `;
}

function filterByStrategy(rows) {
  if (state.ledgerFilter === "all") return rows;
  return rows.filter((row) => String(row.strategy_id) === String(state.ledgerFilter));
}

function positionsTable(rows, includeStrategy) {
  if (!rows.length) return emptyPanel("No positions found");
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            ${includeStrategy ? "<th>Strategy</th>" : ""}
            <th>Asset</th>
            <th class="numeric">Qty</th>
            <th class="numeric">Avg Entry</th>
            <th class="numeric">Unrealized PnL</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              ${includeStrategy ? `<td>${strategyName(row.strategy_id)}</td>` : ""}
              <td>${row.asset_id}</td>
              <td class="numeric">${formatQty(row.current_qty)}</td>
              <td class="numeric">${formatCurrency(row.avg_entry_price)}</td>
              <td class="numeric ${Number(row.unrealized_pnl) >= 0 ? "positive" : "negative"}">${formatCurrency(row.unrealized_pnl)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function tradesTable(rows) {
  if (!rows.length) return emptyPanel("No trades found");
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Strategy</th>
            <th>Asset</th>
            <th>Action</th>
            <th class="numeric">Price</th>
            <th class="numeric">Qty</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${formatDateTime(row.time)}</td>
              <td>${strategyName(row.strategy_id)}</td>
              <td>${row.asset_id}</td>
              <td><span class="action-pill">${row.action}</span></td>
              <td class="numeric">${formatCurrency(row.price)}</td>
              <td class="numeric">${formatQty(row.qty)}</td>
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
  const content = state.route === "analytics" ? renderAnalytics() : state.route === "ledger" ? renderLedger() : renderDashboard();
  app.innerHTML = shell(content);
  bindEvents();
  createIcons({ icons });
  if (state.route === "analytics" && state.analytics) {
    requestAnimationFrame(renderCharts);
  }
}

function bindEvents() {
  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => setRoute(button.dataset.route));
  });
  document.querySelector("[data-action='refresh']")?.addEventListener("click", () => loadRouteData(true));
  document.querySelectorAll("[data-strategy-toggle]").forEach((input) => {
    input.addEventListener("change", () => {
      const id = Number(input.dataset.strategyToggle);
      if (input.checked) state.selectedStrategies.add(id);
      else state.selectedStrategies.delete(id);
      renderCharts();
    });
  });
  document.querySelector("[data-ledger-filter]")?.addEventListener("change", (event) => {
    state.ledgerFilter = event.target.value;
    state.tradePage = 1;
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
  if (!state.analytics) return;
  destroyCharts();
  state.charts.equity = makeLineChart("equityChart", buildEquityDatasets(), "time");
  state.charts.sharpe = makeLineChart("sharpeChart", buildMetricDatasets("sharpe_ratio"), "date");
  state.charts.beta = makeLineChart("betaChart", buildMetricDatasets("beta"), "date");
  state.charts.drawdown = makeLineChart("drawdownChart", buildMetricDatasets("max_drawdown"), "date");
}

function buildEquityDatasets() {
  return datasetByStrategy(state.analytics.equity, "time", "total_equity");
}

function buildMetricDatasets(field) {
  return datasetByStrategy(state.analytics.metrics, "date", field);
}

function datasetByStrategy(rows, xField, yField) {
  return Array.from(state.selectedStrategies).map((strategyId, index) => {
    const color = palette[index % palette.length];
    return {
      label: strategyName(strategyId),
      data: rows
        .filter((row) => Number(row.strategy_id) === Number(strategyId))
        .map((row) => ({ x: row[xField], y: Number(row[yField]) || 0 })),
      borderColor: color,
      backgroundColor: `${color}22`,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.25,
      fill: false,
    };
  });
}

function makeLineChart(id, datasets, xMode) {
  const canvas = document.querySelector(`#${id}`);
  if (!canvas) return null;
  return new Chart(canvas, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      animation: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { labels: { color: "#000000", usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          callbacks: {
            title: (items) => xMode === "time" ? formatDateTime(items[0]?.raw?.x) : items[0]?.raw?.x,
          },
        },
      },
      scales: {
        x: {
          type: "category",
          ticks: { color: "#000000", maxTicksLimit: 8 },
          grid: { display: false },
        },
        y: {
          ticks: { color: "#000000", maxTicksLimit: 6 },
          grid: { color: "#000000" },
        },
      },
    },
  });
}

window.addEventListener("hashchange", () => {
  state.route = routeFromHash();
  render();
  void loadRouteData();
});

async function bootstrap() {
  await initSupabase();
  state.route = routeFromHash();
  render();
  await loadRouteData();
}

void bootstrap();
