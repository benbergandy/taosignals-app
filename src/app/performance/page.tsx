"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Script from "next/script";
import Link from "next/link";

// ── Types ────────────────────────────────────────────────────
interface DailyLogEntry {
  date: string;
  portfolio_value: number;
  pnl_tao: number;
  pnl_pct: number;
  n_positions: number;
  root_stake: number;
  subnet_deployed: number;
  benchmark_eq_weight: number;
  benchmark_mcw: number;
  benchmark_root?: number;
  tao_usd_price: number;
  regime: string;
}

interface Position {
  netuid: number;
  name: string;
  tao: number;
  cost_basis_tao?: number;
  entry_price?: number;
  entry_date?: string;
  alpha_tokens_at_entry?: number;
  accumulated_emission_tokens?: number;
  accumulated_emission_tao?: number;
}

interface Portfolio {
  root_stake?: number;
  cash_value?: number;
  start_date?: string;
  positions?: Record<string, Position> | Position[];
}

interface Trade {
  date: string;
  netuid: number;
  name?: string;
  type: string;
  tao?: number;
  tao_added?: number;
  tao_removed?: number;
  tao_received?: number;
  new_total?: number;
  entry_price?: number;
  slippage_pct?: number;
  sortino?: number;
  reason?: string;
}

interface RegimeData {
  regime: string;
  drawdown?: number;
  correlation?: number;
  flow?: number;
  pool?: number;
  breadth?: number;
  indicators?: {
    drawdown?: number;
    correlation?: number;
    flow?: number;
    pool?: number;
    breadth?: number;
  };
}

interface ChainSubnet {
  netuid: number;
  name: string;
  moving_price?: number;
  symbol?: string;
  emission_share_pct?: number;
}

interface ChainData {
  subnets: ChainSubnet[];
}

interface BotMirrorEntry {
  timestamp: string;
  dry_run: boolean;
  real_total_tao_before: number;
  real_total_tao_after?: number;
  paper_total_tao: number;
}

interface HoldingRow {
  netuid: number;
  name: string;
  symbol: string;
  tao: number;
  cost_basis: number;
  entry_price: number;
  current_price: number;
  entry_tokens: number;
  emission_tokens: number;
  total_tokens: number;
  current_value: number;
  pnl_tao: number;
  price_pnl: number;
  emission_pnl: number;
  pnl_pct: number;
  entry_date: string;
}

// ── Helpers ──────────────────────────────────────────────────
function fmtVal(v: number | null | undefined, showUSD: boolean, taoUsdPrice: number, dec?: number): string {
  if (v == null) return "\u2014";
  const val = showUSD && taoUsdPrice > 0 ? v * taoUsdPrice : v;
  const prefix = showUSD ? "$" : "";
  const d = dec ?? (showUSD ? 2 : Math.abs(val) >= 100 ? 2 : Math.abs(val) >= 1 ? 4 : 6);
  return prefix + val.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "\u2014";
  const sign = v >= 0 ? "+" : "";
  return sign + v.toFixed(2) + "%";
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "\u2014";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDateFull(d: string | null | undefined): string {
  if (!d) return "\u2014";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function daysBetween(a: string, b: string): number {
  return Math.floor((new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000);
}

function regimeColor(r: string | null | undefined): { color: string; cls: string } {
  if (!r) return { color: "text-muted", cls: "badge-muted" };
  const s = r.toUpperCase();
  if (s === "NORMAL") return { color: "text-green", cls: "green" };
  if (s === "CAUTION") return { color: "text-yellow", cls: "yellow" };
  if (s === "STRESS") return { color: "text-orange", cls: "orange" };
  if (s === "CRISIS") return { color: "text-red", cls: "red" };
  return { color: "text-muted", cls: "muted" };
}

function indicatorColor(val: number | null | undefined): string {
  if (val == null) return "bg-muted";
  if (val <= 0.25) return "bg-green";
  if (val <= 0.5) return "bg-yellow";
  if (val <= 0.75) return "bg-orange";
  return "bg-red";
}

function indicatorTextColor(val: number | null | undefined): string {
  if (val == null) return "text-muted";
  if (val <= 0.25) return "text-green";
  if (val <= 0.5) return "text-yellow";
  if (val <= 0.75) return "text-orange";
  return "text-red";
}

// Badge component for trade types
function TradeBadge({ type }: { type: string }) {
  const t = (type || "").toUpperCase();
  const colorMap: Record<string, string> = {
    ENTRY: "text-green border-green bg-green/[0.08]",
    EXIT: "text-red border-red bg-red/[0.08]",
    INCREASE: "text-cyan border-cyan bg-cyan/[0.08]",
    DECREASE: "text-orange border-orange bg-orange/[0.08]",
  };
  const cls = colorMap[t] || "text-muted border-border2 bg-transparent";
  const label = t === "ENTRY" ? "Entry" : t === "EXIT" ? "Exit" : t === "INCREASE" ? "Increase" : t === "DECREASE" ? "Decrease" : type;

  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.06em] uppercase px-1.5 py-0.5 border font-medium whitespace-nowrap ${cls}`}>
      <span className="w-1 h-1 rounded-full bg-current shrink-0" />
      {label}
    </span>
  );
}

// Regime badge
function RegimeBadge({ regime }: { regime: string }) {
  const r = (regime || "UNKNOWN").toUpperCase();
  const colorMap: Record<string, string> = {
    NORMAL: "text-green border-green bg-green/[0.08]",
    CAUTION: "text-yellow border-yellow bg-yellow/[0.08]",
    STRESS: "text-orange border-orange bg-orange/[0.08]",
    CRISIS: "text-red border-red bg-red/[0.08]",
  };
  const cls = colorMap[r] || "text-muted border-border2 bg-transparent";

  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.06em] uppercase px-1.5 py-0.5 border font-medium whitespace-nowrap ${cls}`}>
      <span className="w-1 h-1 rounded-full bg-current shrink-0" />
      {r}
    </span>
  );
}

// ── Safe fetch ───────────────────────────────────────────────
async function safeFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url + "?t=" + Date.now());
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Chart.js types (minimal) ─────────────────────────────────
declare global {
  interface Window {
    Chart: any;
  }
}

// ── Main Component ───────────────────────────────────────────
export default function PerformancePage() {
  const [dailyLog, setDailyLog] = useState<DailyLogEntry[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [regime, setRegime] = useState<RegimeData | null>(null);
  const [chainData, setChainData] = useState<ChainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUSD, setShowUSD] = useState(false);
  const [currentRange, setCurrentRange] = useState(0); // 0 = ALL
  const [holdSortField, setHoldSortField] = useState("position_tao");
  const [holdSortDir, setHoldSortDir] = useState(-1);
  const [expandedTrades, setExpandedTrades] = useState<Set<number>>(new Set());
  const [chartReady, setChartReady] = useState(false);

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<any>(null);
  const botChartRef = useRef<HTMLCanvasElement>(null);
  const botChartInstance = useRef<any>(null);
  const [botLog, setBotLog] = useState<BotMirrorEntry[]>([]);

  // ── Derived values ─────────────────────────────────────────
  const latest = dailyLog.length ? dailyLog[dailyLog.length - 1] : null;
  const taoUsdPrice = latest?.tao_usd_price ?? 0;
  const rootStake = portfolio?.root_stake ?? latest?.root_stake ?? 1000;
  const currentVal = latest?.portfolio_value ?? portfolio?.cash_value ?? null;
  const pnlTao = latest?.pnl_tao ?? (currentVal != null ? currentVal - rootStake : null);
  const pnlPct = latest?.pnl_pct ?? (currentVal != null && rootStake > 0 ? ((currentVal / rootStake) - 1) * 100 : null);
  const nPos = (() => {
    const raw = portfolio?.positions;
    if (Array.isArray(raw)) return raw.length;
    if (raw && typeof raw === "object") return Object.keys(raw).length;
    return latest?.n_positions ?? 0;
  })();
  const startDate = portfolio?.start_date ?? (dailyLog.length ? dailyLog[0].date : null);
  const days = startDate ? daysBetween(startDate, new Date().toISOString().slice(0, 10)) : 0;
  const regimeState = latest?.regime ?? regime?.regime ?? null;
  const rc = regimeColor(regimeState);

  // Price lookup from chain data
  const currentPrices: Record<number, { moving_price: number; symbol: string; name: string }> = {};
  if (chainData?.subnets) {
    chainData.subnets.forEach((s) => {
      currentPrices[s.netuid] = {
        moving_price: s.moving_price || 0,
        symbol: s.symbol || "",
        name: s.name || "",
      };
    });
  }

  // ── Holdings computation ───────────────────────────────────
  const holdings: HoldingRow[] = (() => {
    const rawPos = portfolio?.positions;
    if (!rawPos) return [];

    if (Array.isArray(rawPos)) {
      return rawPos.map((p) => ({
        netuid: p.netuid,
        name: p.name || "SN" + p.netuid,
        symbol: "",
        tao: p.tao || 0,
        cost_basis: p.cost_basis_tao || p.tao || 0,
        entry_price: p.entry_price || 0,
        current_price: p.entry_price || 0,
        entry_tokens: 0,
        emission_tokens: 0,
        total_tokens: 0,
        current_value: p.tao || 0,
        pnl_tao: 0,
        price_pnl: 0,
        emission_pnl: 0,
        pnl_pct: 0,
        entry_date: p.entry_date || "",
      }));
    }

    return Object.entries(rawPos).map(([uid, p]) => {
      const entryPrice = p.entry_price || 0;
      const cp = currentPrices[parseInt(uid)]?.moving_price || entryPrice;
      const costBasis = p.cost_basis_tao || p.tao || 0;
      const entryTokens = p.alpha_tokens_at_entry || (entryPrice > 0 ? costBasis / entryPrice : 0);
      const emissionTokens = p.accumulated_emission_tokens || 0;
      const totalTokens = entryTokens + emissionTokens;
      const currentValue = totalTokens * cp;
      const emissionValueTao = p.accumulated_emission_tao || emissionTokens * cp;
      const totalPnl = currentValue - costBasis;
      const pricePnl = entryTokens * (cp - entryPrice);
      const pnlPctVal = costBasis > 0 ? (totalPnl / costBasis) * 100 : 0;
      const priceData = currentPrices[parseInt(uid)];

      return {
        netuid: parseInt(uid),
        name: p.name || "SN" + uid,
        symbol: priceData?.symbol || "",
        tao: p.tao || 0,
        cost_basis: costBasis,
        entry_price: entryPrice,
        current_price: cp,
        entry_tokens: entryTokens,
        emission_tokens: emissionTokens,
        total_tokens: totalTokens,
        current_value: currentValue,
        pnl_tao: totalPnl,
        price_pnl: pricePnl,
        emission_pnl: emissionValueTao,
        pnl_pct: pnlPctVal,
        entry_date: p.entry_date || "",
      };
    });
  })();

  const totalVal = holdings.reduce((s, p) => s + (p.current_value || p.tao || 0), 0) + (portfolio?.cash_value || 0);

  // Sort holdings
  const sortedHoldings = [...holdings].sort((a, b) => {
    let av: number | string, bv: number | string;
    switch (holdSortField) {
      case "netuid": av = a.netuid; bv = b.netuid; break;
      case "name": return holdSortDir * (a.name || "").toLowerCase().localeCompare((b.name || "").toLowerCase());
      case "position_tao": av = a.current_value || a.tao; bv = b.current_value || b.tao; break;
      case "pct_portfolio": av = (a.current_value || a.tao) / totalVal; bv = (b.current_value || b.tao) / totalVal; break;
      case "pnl": av = a.pnl_tao; bv = b.pnl_tao; break;
      case "days_held": return holdSortDir * (a.entry_date || "").localeCompare(b.entry_date || "") * -1;
      default: av = a.current_value || a.tao; bv = b.current_value || b.tao;
    }
    return holdSortDir * (bv > av ? 1 : bv < av ? -1 : 0);
  });

  const today = new Date().toISOString().slice(0, 10);

  // ── Data loading ───────────────────────────────────────────
  useEffect(() => {
    async function loadData() {
      const [portfolioData, dailyData, tradeData, regimeData, chainRes, botData] = await Promise.all([
        safeFetch<Portfolio>("/data/paper_portfolio.json"),
        safeFetch<DailyLogEntry[]>("/data/paper_daily_log.json"),
        safeFetch<Trade[]>("/data/paper_trades.json"),
        safeFetch<RegimeData>("/data/regime_state.json"),
        safeFetch<ChainData>("/data/chain_data.json"),
        safeFetch<BotMirrorEntry[]>("/data/bot_mirror_log.json"),
      ]);

      setPortfolio(portfolioData);
      setDailyLog(Array.isArray(dailyData) ? dailyData : []);
      setTrades(Array.isArray(tradeData) ? tradeData : []);
      setRegime(regimeData);
      setChainData(chainRes);
      setBotLog(Array.isArray(botData) ? botData : []);
      setLoading(false);
    }
    loadData();
  }, []);

  // ── Chart building ─────────────────────────────────────────
  const buildChart = useCallback(() => {
    if (!chartReady || !chartRef.current || !dailyLog.length) return;
    const Chart = window.Chart;
    if (!Chart) return;

    let data = dailyLog;
    if (currentRange > 0) {
      data = dailyLog.slice(-currentRange);
    }

    const labels = data.map((d) => (d.date ? d.date.slice(5) : ""));
    const mult = showUSD && taoUsdPrice > 0 ? taoUsdPrice : 1;
    const values = data.map((d) => (d.portfolio_value || 0) * mult);
    const eqValues = data.map((d) => (d.benchmark_eq_weight || 1000) * mult);
    const mcwValues = data.map((d) => (d.benchmark_mcw || 1000) * mult);
    const rootValues = data.map((d) => ((d as any).benchmark_root || 1000) * mult);
    const yLabel = showUSD ? "USD" : "TAO";
    const ptRadius = data.length <= 14 ? 3 : data.length <= 60 ? 1.5 : 0;

    if (chartInstance.current) chartInstance.current.destroy();

    chartInstance.current = new Chart(chartRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "TAO Signal Portfolio",
            data: values,
            borderColor: "#ffd000",
            borderWidth: 2.5,
            pointRadius: ptRadius,
            pointBackgroundColor: "#ffd000",
            tension: 0.3,
            fill: { target: "origin", above: "rgba(255,208,0,0.04)" },
            spanGaps: true,
          },
          {
            label: "Equal-Weight (all subnets)",
            data: eqValues,
            borderColor: "#00d4ff",
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
            fill: false,
            spanGaps: true,
          },
          {
            label: "Market-Cap Weighted (YCX proxy)",
            data: mcwValues,
            borderColor: "#9966ff",
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
            fill: false,
            spanGaps: true,
          },
          {
            label: "Root Only (TAO staking)",
            data: rootValues,
            borderColor: "rgba(68,85,102,0.5)",
            borderWidth: 1,
            borderDash: [4, 4],
            pointRadius: 0,
            fill: false,
            spanGaps: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            display: true,
            labels: {
              color: "#445566",
              font: { family: "IBM Plex Mono", size: 9 },
              boxWidth: 12,
              padding: 12,
            },
          },
          tooltip: {
            backgroundColor: "rgba(10,14,18,0.95)",
            borderColor: "#243040",
            borderWidth: 1,
            titleColor: "#445566",
            bodyColor: "#c8d8e8",
            titleFont: { family: "IBM Plex Mono", size: 10 },
            bodyFont: { family: "IBM Plex Mono", size: 11 },
            padding: 10,
            callbacks: {
              label: function (ctx: any) {
                const prefix = showUSD ? "$" : "";
                const suffix = showUSD ? "" : " TAO";
                return " " + ctx.dataset.label + ": " + prefix + ctx.parsed.y.toFixed(2) + suffix;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(26,34,48,0.5)", drawTicks: false },
            ticks: { color: "#445566", font: { family: "IBM Plex Mono", size: 9 }, maxRotation: 0, maxTicksLimit: 8 },
            border: { color: "#1a2230" },
          },
          y: {
            grid: { color: "rgba(26,34,48,0.5)", drawTicks: false },
            ticks: {
              color: "#445566",
              font: { family: "IBM Plex Mono", size: 9 },
              callback: function (v: any) {
                return (showUSD ? "$" : "") + v.toLocaleString();
              },
            },
            border: { color: "#1a2230" },
            title: { display: true, text: yLabel, color: "#445566", font: { family: "IBM Plex Mono", size: 10 } },
          },
        },
      },
    });
  }, [dailyLog, currentRange, showUSD, taoUsdPrice, chartReady]);

  useEffect(() => {
    buildChart();
  }, [buildChart]);

  // ── Bot mirror chart (real wallet vs paper, both indexed to 1.00) ──────
  const buildBotChart = useCallback(() => {
    if (!chartReady || !botChartRef.current || botLog.length === 0) return;
    const Chart = window.Chart;
    if (!Chart) return;

    // Use real_total_tao_after when present (execute runs), fall back to
    // real_total_tao_before for dry-run snapshots.
    const points = botLog
      .map((e) => ({
        ts: e.timestamp,
        bot: e.real_total_tao_after ?? e.real_total_tao_before ?? 0,
        paper: e.paper_total_tao ?? 0,
      }))
      .filter((p) => p.bot > 0 && p.paper > 0);

    if (points.length === 0) return;

    const bot0 = points[0].bot;
    const paper0 = points[0].paper;
    const labels = points.map((p) => {
      const d = new Date(p.ts);
      return `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;
    });
    const botSeries = points.map((p) => p.bot / bot0);
    const paperSeries = points.map((p) => p.paper / paper0);
    const ptRadius = points.length <= 14 ? 3 : 1.5;

    if (botChartInstance.current) botChartInstance.current.destroy();

    botChartInstance.current = new Chart(botChartRef.current.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Bot Wallet (real)",
            data: botSeries,
            borderColor: "#ffd000",
            borderWidth: 2.5,
            pointRadius: ptRadius,
            pointBackgroundColor: "#ffd000",
            tension: 0.3,
            fill: false,
          },
          {
            label: "Paper Portfolio",
            data: paperSeries,
            borderColor: "#00d4ff",
            borderWidth: 2,
            pointRadius: ptRadius,
            pointBackgroundColor: "#00d4ff",
            borderDash: [4, 4],
            tension: 0.3,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            display: true,
            labels: { color: "#445566", font: { family: "IBM Plex Mono", size: 9 }, boxWidth: 12, padding: 12 },
          },
          tooltip: {
            backgroundColor: "rgba(10,14,18,0.95)",
            borderColor: "#243040",
            borderWidth: 1,
            titleColor: "#445566",
            bodyColor: "#c8d8e8",
            titleFont: { family: "IBM Plex Mono", size: 10 },
            bodyFont: { family: "IBM Plex Mono", size: 11 },
            padding: 10,
            callbacks: {
              label: function (ctx: any) {
                const pct = (ctx.parsed.y - 1) * 100;
                const sign = pct >= 0 ? "+" : "";
                return ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(4)}× (${sign}${pct.toFixed(2)}%)`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(26,34,48,0.5)", drawTicks: false },
            ticks: { color: "#445566", font: { family: "IBM Plex Mono", size: 9 }, maxRotation: 0, maxTicksLimit: 8 },
            border: { color: "#1a2230" },
          },
          y: {
            grid: { color: "rgba(26,34,48,0.5)", drawTicks: false },
            ticks: {
              color: "#445566",
              font: { family: "IBM Plex Mono", size: 9 },
              callback: function (v: any) {
                return v.toFixed(3) + "×";
              },
            },
            border: { color: "#1a2230" },
            title: { display: true, text: "Indexed (1.00 = first run)", color: "#445566", font: { family: "IBM Plex Mono", size: 10 } },
          },
        },
      },
    });
  }, [botLog, chartReady]);

  useEffect(() => {
    buildBotChart();
  }, [buildBotChart]);

  // Cleanup chart on unmount
  useEffect(() => {
    return () => {
      if (chartInstance.current) chartInstance.current.destroy();
      if (botChartInstance.current) botChartInstance.current.destroy();
    };
  }, []);

  // ── Trade toggle ───────────────────────────────────────────
  function toggleTrade(idx: number) {
    setExpandedTrades((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  // ── Sort holdings ──────────────────────────────────────────
  function sortHoldings(field: string) {
    setHoldSortDir((prev) => (holdSortField === field ? prev * -1 : -1));
    setHoldSortField(field);
  }

  // ── Sorted trades ─────────────────────────────────────────
  const sortedTrades = [...trades].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 50);

  // ── Regime indicators ──────────────────────────────────────
  const regimeIndicators = regime
    ? [
        { label: "Drawdown", val: regime.drawdown ?? regime.indicators?.drawdown ?? null },
        { label: "Correlation", val: regime.correlation ?? regime.indicators?.correlation ?? null },
        { label: "Flow", val: regime.flow ?? regime.indicators?.flow ?? null },
        { label: "Pool Health", val: regime.pool ?? regime.indicators?.pool ?? null },
        { label: "Breadth", val: regime.breadth ?? regime.indicators?.breadth ?? null },
      ]
    : [];

  // ── Unit label helper ──────────────────────────────────────
  const unitLabel = showUSD ? "USD" : "TAO";

  // ── Render ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="font-mono text-xs text-muted text-center py-12">
        Loading performance data...
      </div>
    );
  }

  return (
    <>
      <Script
        src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"
        strategy="afterInteractive"
        onLoad={() => setChartReady(true)}
      />

      {/* ── HERO ─────────────────────────────────────────── */}
      <div className="px-6 pt-8 border-b border-border">
        <div className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted mb-2.5">
          Five-Factor Model &mdash; Paper Trading
        </div>
        <div className="flex items-baseline gap-4 mb-3 flex-wrap">
          <div className="font-mono text-[42px] font-bold tracking-tight leading-none text-yellow">
            {currentVal != null ? fmtVal(currentVal, showUSD, taoUsdPrice, 2) : "\u2014"}
          </div>
          <div className="font-mono text-lg text-muted">{unitLabel}</div>
          <div
            className={`font-mono text-lg font-semibold ${
              pnlPct != null && pnlPct >= 0 ? "text-green" : "text-red"
            }`}
          >
            {pnlPct != null ? fmtPct(pnlPct) : "\u2014"}
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-6 border-t border-border bg-surface max-md:grid-cols-3 max-sm:grid-cols-2">
          <div className="px-5 py-3.5 border-r border-border">
            <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">Starting Capital</div>
            <div className="font-mono text-xl font-semibold leading-none text-cyan">
              {fmtVal(1000, showUSD, taoUsdPrice, 0)}
            </div>
            <div className="font-mono text-[10px] text-muted mt-0.5">{unitLabel}</div>
          </div>
          <div className="px-5 py-3.5 border-r border-border">
            <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">Current Value</div>
            <div className="font-mono text-xl font-semibold leading-none text-green">
              {currentVal != null ? fmtVal(currentVal, showUSD, taoUsdPrice, 2) : "\u2014"}
            </div>
            <div className="font-mono text-[10px] text-muted mt-0.5">{unitLabel}</div>
          </div>
          <div className="px-5 py-3.5 border-r border-border">
            <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">P&L</div>
            <div
              className={`font-mono text-xl font-semibold leading-none ${
                pnlTao != null && pnlTao >= 0 ? "text-green" : "text-red"
              }`}
            >
              {pnlTao != null
                ? (pnlTao >= 0 ? "+" : "") + fmtVal(pnlTao, showUSD, taoUsdPrice, 2)
                : "\u2014"}
            </div>
            <div className="font-mono text-[10px] text-muted mt-0.5">{unitLabel}</div>
          </div>
          <div className="px-5 py-3.5 border-r border-border">
            <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">Days Active</div>
            <div className="font-mono text-xl font-semibold leading-none text-yellow">{days}</div>
            <div className="font-mono text-[10px] text-muted mt-0.5">since inception</div>
          </div>
          <div className="px-5 py-3.5 border-r border-border">
            <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">Positions</div>
            <div className="font-mono text-xl font-semibold leading-none text-purple">{nPos}</div>
            <div className="font-mono text-[10px] text-muted mt-0.5">active holdings</div>
          </div>
          <div className="px-5 py-3.5">
            <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">Regime Status</div>
            <div className={`font-mono text-xl font-semibold leading-none ${rc.color}`}>
              {regimeState || "\u2014"}
            </div>
            <div className="font-mono text-[10px] text-muted mt-0.5">market conditions</div>
          </div>
        </div>
      </div>

      {/* ── MAIN CONTENT ─────────────────────────────────── */}
      <div className="p-6 flex flex-col gap-6 max-w-[1400px] mx-auto">
        {/* ── CHART SECTION ──────────────────────────────── */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-text font-medium whitespace-nowrap">
              Portfolio Value Over Time
            </div>
            <div className="flex-1 h-px bg-border" />
            {/* TAO / USD toggle */}
            <div className="flex border border-border2">
              <button
                onClick={() => setShowUSD(false)}
                className={`font-mono text-[9px] tracking-[0.1em] uppercase px-3 py-1 border-r border-border2 cursor-pointer transition-all duration-150 ${
                  !showUSD ? "bg-cyan/[0.08] text-cyan" : "bg-transparent text-muted"
                }`}
              >
                TAO
              </button>
              <button
                onClick={() => setShowUSD(true)}
                className={`font-mono text-[9px] tracking-[0.1em] uppercase px-3 py-1 cursor-pointer transition-all duration-150 ${
                  showUSD ? "bg-cyan/[0.08] text-cyan" : "bg-transparent text-muted"
                }`}
              >
                USD
              </button>
            </div>
          </div>

          <div className="bg-surface border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-yellow">Portfolio NAV</div>
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  {[
                    { label: "1W", days: 7 },
                    { label: "1M", days: 30 },
                    { label: "3M", days: 90 },
                    { label: "ALL", days: 0 },
                  ].map((r) => (
                    <button
                      key={r.label}
                      onClick={() => setCurrentRange(r.days)}
                      className={`font-mono text-[9px] tracking-[0.08em] uppercase px-2.5 py-1 border cursor-pointer transition-all duration-150 ${
                        currentRange === r.days
                          ? "border-cyan text-cyan"
                          : "border-border2 text-muted hover:border-cyan hover:text-cyan"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="h-[300px] relative">
              {dailyLog.length > 0 ? (
                <canvas ref={chartRef} />
              ) : (
                <div className="font-mono text-[11px] text-muted text-center py-12">
                  No daily data yet &mdash; check back after the first daily run
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── BOT WALLET MIRROR CHART ─────────────────────── */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-text font-medium whitespace-nowrap">
              Bot Wallet vs Paper Portfolio
            </div>
            <div className="flex-1 h-px bg-border" />
            <span className="font-mono text-[9px] tracking-[0.1em] px-2 py-0.5 border border-border2 text-muted uppercase whitespace-nowrap">
              {botLog.length} runs
            </span>
          </div>

          <div className="bg-surface border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-yellow">
                Indexed Performance &mdash; both lines start at 1.00
              </div>
              <div className="font-mono text-[9px] text-muted">
                divergence = real execution drift from paper math
              </div>
            </div>
            <div className="h-[260px] relative">
              {botLog.length >= 2 ? (
                <canvas ref={botChartRef} />
              ) : (
                <div className="font-mono text-[11px] text-muted text-center py-12">
                  {botLog.length === 1
                    ? "Only one bot run logged so far — chart will populate after the next daily run"
                    : "No bot mirror data yet — check back after the first scheduled run"}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── HOLDINGS TABLE ─────────────────────────────── */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-text font-medium whitespace-nowrap">
              Current Holdings
            </div>
            <div className="flex-1 h-px bg-border" />
            <span className="font-mono text-[9px] tracking-[0.1em] px-2 py-0.5 border border-border2 text-muted uppercase whitespace-nowrap">
              {holdings.length} positions
            </span>
          </div>

          {holdings.length === 0 ? (
            <div className="bg-surface border border-border">
              <div className="font-mono text-xs text-muted text-center py-12">No open positions</div>
            </div>
          ) : (
            <div className="border border-border overflow-x-auto bg-surface">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-surface2 border-b border-border2">
                    <th className="font-mono text-[9px] tracking-[0.12em] uppercase text-muted px-3 py-2.5 text-left font-normal whitespace-nowrap">
                      #
                    </th>
                    {[
                      { label: "SN", field: "netuid" },
                      { label: "Name", field: "name" },
                      { label: "Cost Basis", field: "position_tao" },
                      { label: "Tokens", field: "" },
                      { label: "Value", field: "pct_portfolio" },
                      { label: "Total P&L", field: "pnl" },
                      { label: "Emissions", field: "" },
                      { label: "Entry Date", field: "" },
                      { label: "Days Held", field: "days_held" },
                    ].map((col) => (
                      <th
                        key={col.label}
                        onClick={() => col.field && sortHoldings(col.field)}
                        className={`font-mono text-[9px] tracking-[0.12em] uppercase px-3 py-2.5 text-left font-normal whitespace-nowrap transition-colors duration-150 ${
                          col.field
                            ? holdSortField === col.field
                              ? "text-cyan cursor-pointer select-none"
                              : "text-muted cursor-pointer select-none hover:text-text"
                            : "text-muted"
                        }`}
                      >
                        {col.label}
                        {holdSortField === col.field && (holdSortDir === -1 ? " \u2193" : " \u2191")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedHoldings.map((p, i) => {
                    const val = p.current_value || p.tao || 0;
                    const pnl = p.pnl_tao || 0;
                    const pnlPctH = p.pnl_pct || 0;
                    const emPnl = p.emission_pnl || 0;
                    const daysHeld = p.entry_date ? daysBetween(p.entry_date, today) : 0;
                    const tokenStr =
                      p.total_tokens > 0
                        ? p.total_tokens.toLocaleString(undefined, { maximumFractionDigits: 1 }) +
                          (p.symbol ? " " + p.symbol : "")
                        : "\u2014";

                    return (
                      <tr
                        key={p.netuid}
                        className="border-b border-border/80 hover:bg-cyan/[0.03] transition-colors"
                      >
                        <td className="font-mono text-[11px] text-muted px-3 py-2.5">{i + 1}</td>
                        <td className="font-mono text-[11px] text-muted px-3 py-2.5">{p.netuid}</td>
                        <td className="font-semibold text-[13px] px-3 py-2.5 whitespace-nowrap">
                          <Link
                            href={`/subnet/${p.netuid}`}
                            className="text-inherit no-underline border-b border-border2 hover:border-cyan"
                          >
                            {p.name}
                          </Link>
                          {p.symbol && (
                            <span className="text-cyan text-[11px] ml-1">{p.symbol}</span>
                          )}
                        </td>
                        <td className="font-mono text-[11px] text-text px-3 py-2.5 whitespace-nowrap">
                          {fmtVal(p.cost_basis, showUSD, taoUsdPrice)}
                        </td>
                        <td className="font-mono text-[11px] text-text px-3 py-2.5 whitespace-nowrap">
                          {tokenStr}
                        </td>
                        <td className="font-mono text-[11px] text-cyan px-3 py-2.5 whitespace-nowrap">
                          {fmtVal(val, showUSD, taoUsdPrice)}
                        </td>
                        <td
                          className={`font-mono text-[11px] px-3 py-2.5 whitespace-nowrap ${
                            pnl >= 0 ? "text-green" : "text-red"
                          }`}
                        >
                          {(pnl >= 0 ? "+" : "") +
                            fmtVal(pnl, showUSD, taoUsdPrice) +
                            " (" +
                            (pnlPctH >= 0 ? "+" : "") +
                            pnlPctH.toFixed(1) +
                            "%)"}
                        </td>
                        <td
                          className={`font-mono text-[11px] px-3 py-2.5 whitespace-nowrap ${
                            emPnl > 0 ? "text-green" : "text-muted"
                          }`}
                        >
                          {emPnl > 0.001 ? "+" + fmtVal(emPnl, showUSD, taoUsdPrice) : "\u2014"}
                        </td>
                        <td className="font-mono text-[11px] text-muted px-3 py-2.5 whitespace-nowrap">
                          {fmtDate(p.entry_date)}
                        </td>
                        <td className="font-mono text-[11px] text-text px-3 py-2.5 whitespace-nowrap">
                          {daysHeld}d
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── ACTIVITY FEED ──────────────────────────────── */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-text font-medium whitespace-nowrap">
              Recent Activity
            </div>
            <div className="flex-1 h-px bg-border" />
            <span className="font-mono text-[9px] tracking-[0.1em] px-2 py-0.5 border border-border2 text-muted uppercase whitespace-nowrap">
              {trades.length} trades
            </span>
          </div>

          <div className="bg-surface border border-border">
            {trades.length === 0 ? (
              <div className="font-mono text-xs text-muted text-center py-12">No trades recorded yet</div>
            ) : (
              <>
                {sortedTrades.map((t, idx) => {
                  const tao = t.tao || t.tao_added || t.tao_removed || 0;
                  const type = (t.type || "").toUpperCase();
                  const isExpanded = expandedTrades.has(idx);

                  return (
                    <div key={idx}>
                      <div
                        onClick={() => toggleTrade(idx)}
                        className="flex items-center gap-3 px-4 py-2.5 border-b border-border/50 cursor-pointer hover:bg-cyan/[0.02] flex-wrap"
                      >
                        <div className="font-mono text-[10px] text-muted min-w-[80px]">
                          {fmtDate(t.date)}
                        </div>
                        <TradeBadge type={t.type} />
                        <div className="text-xs font-semibold flex-1">
                          SN{t.netuid || "?"} {t.name || ""}
                        </div>
                        <div className="font-mono text-[11px] text-text min-w-[80px] text-right">
                          {fmtVal(tao, showUSD, taoUsdPrice)}
                          {!showUSD && " \u03c4"}
                        </div>
                        <div className="font-mono text-[10px] text-muted min-w-[60px] text-right">
                          {t.slippage_pct != null ? t.slippage_pct.toFixed(2) + "% slip" : ""}
                        </div>
                        <div className="text-[9px] text-muted ml-auto">{isExpanded ? "\u25B2" : "\u25BC"}</div>
                      </div>

                      {isExpanded && (
                        <div className="px-3.5 py-2 pb-3 bg-surface2 border-b border-border font-mono text-[10px] text-muted leading-[1.8]">
                          {type === "ENTRY" && (
                            <>
                              <div>
                                Entry Price:{" "}
                                <span className="text-text">
                                  {t.entry_price ? t.entry_price.toFixed(8) + " \u03c4" : "\u2014"}
                                </span>
                              </div>
                              <div>
                                Position Size: <span className="text-text">{fmtVal(tao, showUSD, taoUsdPrice)}</span>
                              </div>
                              <div>
                                Slippage: <span className="text-orange">{(t.slippage_pct || 0).toFixed(3)}%</span>
                              </div>
                              <div>
                                Sortino at Entry:{" "}
                                <span className="text-cyan">
                                  {t.sortino != null ? t.sortino.toFixed(4) : "\u2014"}
                                </span>
                              </div>
                            </>
                          )}
                          {type === "EXIT" && (
                            <>
                              <div>
                                Amount Exited: <span className="text-text">{fmtVal(t.tao, showUSD, taoUsdPrice)}</span>
                              </div>
                              <div>
                                TAO Received:{" "}
                                <span className="text-text">{fmtVal(t.tao_received || 0, showUSD, taoUsdPrice)}</span>
                              </div>
                              <div>
                                Slippage Cost:{" "}
                                <span className="text-red">
                                  {fmtVal((tao || 0) - (t.tao_received || 0), showUSD, taoUsdPrice)}
                                </span>{" "}
                                ({(t.slippage_pct || 0).toFixed(3)}%)
                              </div>
                              <div>
                                Reason: <span className="text-text">{t.reason || "\u2014"}</span>
                              </div>
                            </>
                          )}
                          {type === "INCREASE" && (
                            <>
                              <div>
                                Added:{" "}
                                <span className="text-green">
                                  +{fmtVal(t.tao_added || 0, showUSD, taoUsdPrice)}
                                </span>
                              </div>
                              <div>
                                New Total:{" "}
                                <span className="text-text">{fmtVal(t.new_total || 0, showUSD, taoUsdPrice)}</span>
                              </div>
                            </>
                          )}
                          {type === "DECREASE" && (
                            <>
                              <div>
                                Removed:{" "}
                                <span className="text-red">
                                  -{fmtVal(t.tao_removed || 0, showUSD, taoUsdPrice)}
                                </span>
                              </div>
                              <div>
                                New Total:{" "}
                                <span className="text-text">{fmtVal(t.new_total || 0, showUSD, taoUsdPrice)}</span>
                              </div>
                              <div>
                                Slippage: <span className="text-orange">{(t.slippage_pct || 0).toFixed(3)}%</span>
                              </div>
                            </>
                          )}
                          <div className="mt-1 text-dim">Date: {t.date || "\u2014"}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {trades.length > 50 && (
                  <div className="flex items-center justify-center px-4 py-2.5">
                    <span className="font-mono text-[11px] text-muted">+{trades.length - 50} older trades</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── REGIME MONITOR ─────────────────────────────── */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-text font-medium whitespace-nowrap">
              Regime Monitor
            </div>
            <div className="flex-1 h-px bg-border" />
          </div>

          <div className="bg-surface border border-border p-5">
            {!regime ? (
              <div className="font-mono text-xs text-muted text-center py-12">No regime data available</div>
            ) : (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <RegimeBadge regime={regime.regime} />
                  <span className="font-mono text-[10px] text-muted">Current market regime assessment</span>
                </div>

                {regimeIndicators.map((ind) => {
                  const pct = ind.val != null ? Math.min(Math.max(ind.val * 100, 0), 100) : 0;
                  return (
                    <div key={ind.label} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-b-0">
                      <div className="font-mono text-[10px] text-muted min-w-[120px] uppercase tracking-[0.08em]">
                        {ind.label}
                      </div>
                      <div className="flex-1 h-1.5 bg-surface2 border border-border relative">
                        <div
                          className={`h-full transition-all duration-400 ${indicatorColor(ind.val)}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <div className={`font-mono text-[10px] min-w-[50px] text-right ${indicatorTextColor(ind.val)}`}>
                        {ind.val != null ? (ind.val * 100).toFixed(0) + "%" : "\u2014"}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── DISCLAIMER ───────────────────────────────────── */}
      <div className="border-t border-border px-6 py-5 bg-surface font-mono text-[10px] text-muted leading-relaxed">
        <strong className="text-text">DISCLAIMER:</strong> TAO Signal provides quantitative data analysis tools
        for informational and educational purposes only. Nothing on this platform constitutes financial advice,
        investment advice, or any other form of advice. Past performance is not indicative of future results.
        Cryptocurrency markets are highly volatile and involve significant risk. Always conduct your own research
        and consult a qualified financial advisor before making investment decisions. Paper trading results are
        simulated and do not represent actual returns.
      </div>
    </>
  );
}
