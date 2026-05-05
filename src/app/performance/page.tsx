"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Script from "next/script";
import Link from "next/link";

// ── Types ────────────────────────────────────────────────────
// All shapes match the V3+VSAT sleeved-portfolio paper trader output:
//   paper_daily_log_balanced_vsat_sleeved.json
//   paper_portfolio_balanced_vsat_sleeved.held.json
//   paper_trades_balanced_vsat_sleeved.json
interface DailyLogEntry {
  date: string;
  profile?: string;
  model?: string;
  portfolio_value: number;
  pnl_tao: number;
  pnl_pct: number;
  n_positions: number;
  root_stake: number;
  subnet_deployed: number;
  n_trades_today?: number;
  benchmark_eq_weight: number;
  benchmark_mcw: number;
  benchmark_root: number;
  alpha_vs_eq?: number;
  alpha_vs_mcw?: number;
  // tao_usd_price not emitted by paper_trader_sleeved (TAO/USD comes from /chain_data)
  tao_usd_price?: number;
  regime?: string;
}

interface Position {
  netuid?: number;
  name?: string;
  tao?: number;            // mark-to-spot value (display)
  entry_tao?: number;       // cost basis (entry value at entry date)
  entry_date?: string;
  entry_price?: number;     // spot at entry
  alpha_tokens?: number;    // current alpha holding (grows w/ emissions)
  accumulated_emission_tokens?: number;
  accumulated_emission_tao?: number;
  // Legacy fallback fields (in case any old held-state schema is read)
  cost_basis_tao?: number;
  alpha_tokens_at_entry?: number;
}

interface Portfolio {
  start_date?: string;
  profile?: string;
  total_tao?: number;
  root_stake?: number;
  accumulated_root_yield?: number;
  cash_value?: number;
  positions?: Record<string, Position> | Position[];
}

interface Trade {
  date: string;
  type: string;             // ENTRY | EXIT | INCREASE | DECREASE
  netuid: number;
  name?: string;
  // ENTRY fields
  tao?: number;
  alpha_tokens?: number;
  entry_price?: number;
  // EXIT fields (realized P&L)
  exit_price?: number;
  entry_date?: string;       // entry date carried into the exit record
  cost_basis_tao?: number;
  realized_pnl_tao?: number;
  realized_pnl_pct?: number;
  days_held?: number;
  // INCREASE / DECREASE
  tao_added?: number;
  alpha_added?: number;
  tao_removed?: number;
  alpha_removed?: number;
  spot_price?: number;
  // Legacy fields kept for back-compat with any cached older trade entries
  tao_received?: number;
  new_total?: number;
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
  // 2026-05-02: real-wallet benchmark fields added by client/bot_mirror.py
  benchmark_inception_date?: string;
  benchmark_starting_tao?: number;
  benchmark_hodl_tao?: number;
  benchmark_root_tao?: number;
  benchmark_eq_weight_tao?: number;
  benchmark_mcw_tao?: number;
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
  const [expandedPositions, setExpandedPositions] = useState<Set<number>>(new Set());
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

  // ── Live risk-adjusted performance ─────────────────────────
  // Annualised Sortino from daily NAV returns. Needs >=3 daily points to be
  // remotely meaningful; for 1-2 days we just show "—".
  const annualisedSortino: number | null = (() => {
    if (dailyLog.length < 3) return null;
    const navs = dailyLog.map((d) => d.portfolio_value).filter((v) => v > 0);
    if (navs.length < 3) return null;
    const rets: number[] = [];
    for (let i = 1; i < navs.length; i++) {
      rets.push((navs[i] - navs[i - 1]) / navs[i - 1]);
    }
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const downside = rets.filter((r) => r < 0);
    if (downside.length === 0) return mean > 0 ? Infinity : 0;
    const downVar = downside.reduce((a, b) => a + b * b, 0) / downside.length;
    const downStd = Math.sqrt(downVar);
    if (downStd < 1e-12) return null;
    return (mean / downStd) * Math.sqrt(365);
  })();

  // Alpha vs each benchmark — pulled directly from the daily log when present,
  // computed from NAV deltas otherwise.
  const alphaVsEq = latest?.alpha_vs_eq ?? null;
  const alphaVsMcw = latest?.alpha_vs_mcw ?? null;
  const alphaVsRoot: number | null = (() => {
    if (!latest) return null;
    const total = latest.portfolio_value;
    const root = latest.benchmark_root ?? 1000;
    if (!total || !root) return null;
    return (total - root) / root * 100;
  })();

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
  // Reads paper_portfolio_balanced_vsat_sleeved.held.json positions, where each
  // position carries: alpha_tokens (current, including emission accrual),
  // entry_tao (cost basis at entry), entry_price, entry_date,
  // accumulated_emission_tokens, accumulated_emission_tao.
  const holdings: HoldingRow[] = (() => {
    const rawPos = portfolio?.positions;
    if (!rawPos) return [];

    const entries: Array<[string, Position]> = Array.isArray(rawPos)
      ? rawPos.map((p) => [String(p.netuid ?? ""), p])
      : Object.entries(rawPos);

    return entries.map(([uid, p]) => {
      const netuid = p.netuid ?? parseInt(uid) ?? 0;
      const priceData = currentPrices[netuid];
      const entryPrice = p.entry_price || 0;
      const currentPrice = priceData?.moving_price || entryPrice;

      // Total alpha currently held (already includes emission accrual)
      const totalTokens = p.alpha_tokens || p.alpha_tokens_at_entry || 0;
      const emissionTokens = p.accumulated_emission_tokens || 0;
      const entryTokens = Math.max(0, totalTokens - emissionTokens);

      const costBasis = p.entry_tao || p.cost_basis_tao || 0;
      // mark-to-spot
      const currentValue = totalTokens * currentPrice;
      const totalPnl = currentValue - costBasis;
      const pricePnl = entryTokens * (currentPrice - entryPrice);
      const emissionValueTao = emissionTokens * currentPrice;
      const pnlPctVal = costBasis > 0 ? (totalPnl / costBasis) * 100 : 0;

      return {
        netuid,
        name: p.name || priceData?.name || "SN" + uid,
        symbol: priceData?.symbol || "",
        tao: p.tao || currentValue,
        cost_basis: costBasis,
        entry_price: entryPrice,
        current_price: currentPrice,
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
      // 2026-05-04: data sources flipped from legacy v2.1 paper portfolio to
      // the V3+VSAT sleeved profile (balanced_vsat = bot's mirror target).
      const [portfolioData, dailyData, tradeData, regimeData, chainRes, botData] = await Promise.all([
        safeFetch<Portfolio>("/data/paper_portfolio_balanced_vsat_sleeved.held.json"),
        safeFetch<DailyLogEntry[]>("/data/paper_daily_log_balanced_vsat_sleeved.json"),
        safeFetch<Trade[]>("/data/paper_trades_balanced_vsat_sleeved.json"),
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

  // ── Bot mirror chart (real wallet vs benchmarks at the wallet's scale) ──
  const buildBotChart = useCallback(() => {
    if (!chartReady || !botChartRef.current || botLog.length === 0) return;
    const Chart = window.Chart;
    if (!Chart) return;

    // Bot capital is only "live" from the first execute run onward — dry-runs
    // before inception can include pre-funding deposits that aren't returns.
    const firstExecuteIdx = botLog.findIndex((e) => !e.dry_run);
    if (firstExecuteIdx < 0) return;
    const liveEntries = botLog.slice(firstExecuteIdx);

    // Extract real wallet NAV + benchmark NAVs per run.
    // Pre-2026-05-02 runs lack benchmark fields — those points are dropped
    // from the benchmark series but the wallet series renders for them.
    const points = liveEntries
      .map((e) => ({
        ts: e.timestamp,
        bot: e.real_total_tao_after ?? e.real_total_tao_before ?? 0,
        eq:  e.benchmark_eq_weight_tao ?? null,
        mcw: e.benchmark_mcw_tao ?? null,
        root: e.benchmark_root_tao ?? null,
      }))
      .filter((p) => p.bot > 0);
    if (points.length === 0) return;

    const bot0 = points[0].bot;
    // Index everything to 1.00 at the FIRST execute run. For benchmarks, use
    // their own first-available value so they index cleanly even if added
    // mid-stream.
    const eq0 = points.find((p) => p.eq != null && p.eq > 0)?.eq ?? null;
    const mcw0 = points.find((p) => p.mcw != null && p.mcw > 0)?.mcw ?? null;
    const root0 = points.find((p) => p.root != null && p.root > 0)?.root ?? null;

    const labels = points.map((p) => {
      const d = new Date(p.ts);
      return `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;
    });
    const botSeries = points.map((p) => p.bot / bot0);
    const eqSeries = eq0 ? points.map((p) => (p.eq != null ? p.eq / eq0 : null)) : null;
    const mcwSeries = mcw0 ? points.map((p) => (p.mcw != null ? p.mcw / mcw0 : null)) : null;
    const rootSeries = root0 ? points.map((p) => (p.root != null ? p.root / root0 : null)) : null;
    const ptRadius = points.length <= 14 ? 3 : 1.5;

    if (botChartInstance.current) botChartInstance.current.destroy();

    const datasets: any[] = [
      {
        label: "Bot Wallet (real)",
        data: botSeries,
        borderColor: "#ffd000",
        borderWidth: 2.5,
        pointRadius: ptRadius,
        pointBackgroundColor: "#ffd000",
        tension: 0.3,
        fill: false,
        spanGaps: true,
      },
    ];
    if (eqSeries) datasets.push({
      label: "Equal-Weight",
      data: eqSeries,
      borderColor: "#00d4ff",
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.3,
      fill: false,
      spanGaps: true,
    });
    if (mcwSeries) datasets.push({
      label: "Market-Cap Weighted",
      data: mcwSeries,
      borderColor: "#9966ff",
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.3,
      fill: false,
      spanGaps: true,
    });
    if (rootSeries) datasets.push({
      label: "Root Only (HODL)",
      data: rootSeries,
      borderColor: "rgba(68,85,102,0.5)",
      borderWidth: 1,
      borderDash: [4, 4],
      pointRadius: 0,
      tension: 0,
      fill: false,
      spanGaps: true,
    });

    botChartInstance.current = new Chart(botChartRef.current.getContext("2d"), {
      type: "line",
      data: { labels, datasets },
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

  function togglePosition(netuid: number) {
    setExpandedPositions((prev) => {
      const next = new Set(prev);
      if (next.has(netuid)) next.delete(netuid);
      else next.add(netuid);
      return next;
    });
  }

  // Build a per-netuid trade history for the wallet panel drop-downs
  const tradesByNetuid: Record<number, Trade[]> = (() => {
    const out: Record<number, Trade[]> = {};
    for (const t of trades) {
      const nid = t.netuid;
      if (!out[nid]) out[nid] = [];
      out[nid].push(t);
    }
    // Newest-first within each subnet
    for (const nid of Object.keys(out)) {
      out[Number(nid)].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    }
    return out;
  })();

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

        {/* Risk-adjusted performance \u2014 Sortino + alpha-vs-benchmarks \u2500\u2500\u2500\u2500\u2500\u2500\u2500 */}
        <div className="grid grid-cols-4 border-t border-border bg-surface2 max-md:grid-cols-2">
          <div className="px-5 py-3 border-r border-border">
            <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">Sortino (annual.)</div>
            <div className={`font-mono text-base font-semibold leading-none ${
              annualisedSortino == null ? "text-muted"
                : annualisedSortino === Infinity ? "text-green"
                : annualisedSortino > 1 ? "text-green"
                : annualisedSortino > 0 ? "text-yellow"
                : "text-red"
            }`}>
              {annualisedSortino == null
                ? "\u2014"
                : annualisedSortino === Infinity
                ? "+\u221e"
                : (annualisedSortino >= 0 ? "+" : "") + annualisedSortino.toFixed(2)}
            </div>
            <div className="font-mono text-[10px] text-muted mt-0.5">
              {dailyLog.length < 3 ? `need ${3 - dailyLog.length} more days` : `from ${dailyLog.length}d NAV`}
            </div>
          </div>
          <div className="px-5 py-3 border-r border-border">
            <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">Alpha vs Eq-Wt</div>
            <div className={`font-mono text-base font-semibold leading-none ${
              alphaVsEq == null ? "text-muted" : alphaVsEq >= 0 ? "text-green" : "text-red"
            }`}>
              {alphaVsEq == null ? "\u2014" : fmtPct(alphaVsEq)}
            </div>
            <div className="font-mono text-[10px] text-muted mt-0.5">vs equal-weight basket</div>
          </div>
          <div className="px-5 py-3 border-r border-border">
            <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">Alpha vs MCW</div>
            <div className={`font-mono text-base font-semibold leading-none ${
              alphaVsMcw == null ? "text-muted" : alphaVsMcw >= 0 ? "text-green" : "text-red"
            }`}>
              {alphaVsMcw == null ? "\u2014" : fmtPct(alphaVsMcw)}
            </div>
            <div className="font-mono text-[10px] text-muted mt-0.5">vs market-cap weighted</div>
          </div>
          <div className="px-5 py-3">
            <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">Alpha vs Root</div>
            <div className={`font-mono text-base font-semibold leading-none ${
              alphaVsRoot == null ? "text-muted" : alphaVsRoot >= 0 ? "text-green" : "text-red"
            }`}>
              {alphaVsRoot == null ? "\u2014" : fmtPct(alphaVsRoot)}
            </div>
            <div className="font-mono text-[10px] text-muted mt-0.5">vs all-in SN0</div>
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
              Bot Wallet vs Benchmarks
            </div>
            <div className="flex-1 h-px bg-border" />
            <span className="font-mono text-[9px] tracking-[0.1em] px-2 py-0.5 border border-border2 text-muted uppercase whitespace-nowrap">
              {(() => {
                const firstExec = botLog.findIndex((e) => !e.dry_run);
                return firstExec < 0 ? 0 : botLog.length - firstExec;
              })()} live runs
            </span>
          </div>

          <div className="bg-surface border border-border p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-yellow">
                Real wallet (V3+VSAT) vs equal-weight / market-cap / root benchmarks, all indexed to 1.00 at the first execute run
              </div>
              <div className="font-mono text-[9px] text-muted">
                divergence = strategy alpha at this wallet scale, after slippage
              </div>
            </div>
            <div className="h-[260px] relative">
              {(() => {
                const liveRuns = botLog.filter((e, i) => {
                  const firstExec = botLog.findIndex((x) => !x.dry_run);
                  return firstExec >= 0 && i >= firstExec;
                }).length;
                if (liveRuns >= 2) {
                  return <canvas ref={botChartRef} />;
                }
                return (
                  <div className="font-mono text-[11px] text-muted text-center py-12">
                    {liveRuns === 1
                      ? "Bot inception logged — chart will populate after the next daily run"
                      : "No live bot runs yet — chart starts at the first execute run"}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* ── WALLET — open positions with click-to-expand detail ────── */}
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-text font-medium whitespace-nowrap">
              Wallet — Open Positions
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
            <div className="bg-surface border border-border">
              {/* Sortable column header */}
              <div className="bg-surface2 border-b border-border2 grid grid-cols-[40px_60px_1fr_120px_120px_140px_160px_60px] gap-2 px-3 py-2.5">
                {[
                  { label: "", field: "" },
                  { label: "SN", field: "netuid" },
                  { label: "Name", field: "name" },
                  { label: "Tokens", field: "" },
                  { label: "Cost Basis", field: "position_tao" },
                  { label: "Value", field: "pct_portfolio" },
                  { label: "P&L", field: "pnl" },
                  { label: "Held", field: "days_held" },
                ].map((col, i) => (
                  <div
                    key={i}
                    onClick={() => col.field && sortHoldings(col.field)}
                    className={`font-mono text-[9px] tracking-[0.12em] uppercase font-normal whitespace-nowrap transition-colors duration-150 ${
                      col.field
                        ? holdSortField === col.field
                          ? "text-cyan cursor-pointer select-none"
                          : "text-muted cursor-pointer select-none hover:text-text"
                        : "text-muted"
                    } ${i >= 3 ? "text-right" : ""}`}
                  >
                    {col.label}
                    {col.field && holdSortField === col.field && (holdSortDir === -1 ? " ↓" : " ↑")}
                  </div>
                ))}
              </div>

              {/* Position rows + drop-downs */}
              {sortedHoldings.map((p) => {
                const val = p.current_value || p.tao || 0;
                const pnl = p.pnl_tao || 0;
                const pnlPctH = p.pnl_pct || 0;
                const emPnl = p.emission_pnl || 0;
                const daysHeld = p.entry_date ? daysBetween(p.entry_date, today) : 0;
                const tokenStr =
                  p.total_tokens > 0
                    ? p.total_tokens.toLocaleString(undefined, { maximumFractionDigits: 1 }) +
                      (p.symbol ? " " + p.symbol : "")
                    : "—";
                const isOpen = expandedPositions.has(p.netuid);
                const tradeHistory = tradesByNetuid[p.netuid] || [];
                const realizedPnl = tradeHistory
                  .filter((t) => t.realized_pnl_tao != null)
                  .reduce((s, t) => s + (t.realized_pnl_tao || 0), 0);
                const priceMove = p.entry_price > 0
                  ? ((p.current_price - p.entry_price) / p.entry_price) * 100
                  : 0;

                return (
                  <div key={p.netuid} className="border-b border-border/80 last:border-b-0">
                    {/* Row */}
                    <div
                      onClick={() => togglePosition(p.netuid)}
                      className="grid grid-cols-[40px_60px_1fr_120px_120px_140px_160px_60px] gap-2 px-3 py-2.5 cursor-pointer hover:bg-cyan/[0.03] transition-colors items-center"
                    >
                      <div className="font-mono text-[10px] text-muted">{isOpen ? "▾" : "▸"}</div>
                      <div className="font-mono text-[11px] text-muted">{p.netuid}</div>
                      <div className="font-semibold text-[13px] whitespace-nowrap overflow-hidden text-ellipsis">
                        <Link
                          href={`/subnet/${p.netuid}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-inherit no-underline border-b border-border2 hover:border-cyan"
                        >
                          {p.name}
                        </Link>
                        {p.symbol && <span className="text-cyan text-[11px] ml-1">{p.symbol}</span>}
                      </div>
                      <div className="font-mono text-[11px] text-text text-right">{tokenStr}</div>
                      <div className="font-mono text-[11px] text-text text-right">
                        {fmtVal(p.cost_basis, showUSD, taoUsdPrice)}
                      </div>
                      <div className="font-mono text-[11px] text-cyan text-right">
                        {fmtVal(val, showUSD, taoUsdPrice)}
                      </div>
                      <div className={`font-mono text-[11px] text-right whitespace-nowrap ${pnl >= 0 ? "text-green" : "text-red"}`}>
                        {(pnl >= 0 ? "+" : "") + fmtVal(pnl, showUSD, taoUsdPrice)}
                        <span className="text-[10px] ml-1 opacity-80">
                          ({(pnlPctH >= 0 ? "+" : "") + pnlPctH.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-text text-right">{daysHeld}d</div>
                    </div>

                    {/* Drop-down — full position detail + per-subnet trade history */}
                    {isOpen && (
                      <div className="bg-surface2 border-t border-border/60 px-5 py-4">
                        <div className="grid grid-cols-2 max-md:grid-cols-1 gap-x-8 gap-y-3">
                          {/* Left: position math */}
                          <div>
                            <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-muted mb-2">
                              Position
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[11px]">
                              <div className="text-muted">Entry date</div>
                              <div className="text-text text-right">{fmtDateFull(p.entry_date)}</div>
                              <div className="text-muted">Days held</div>
                              <div className="text-text text-right">{daysHeld}d</div>
                              <div className="text-muted">Entry price</div>
                              <div className="text-text text-right">
                                {p.entry_price > 0 ? p.entry_price.toFixed(8) + " τ/α" : "—"}
                              </div>
                              <div className="text-muted">Current price</div>
                              <div className="text-text text-right">
                                {p.current_price > 0 ? p.current_price.toFixed(8) + " τ/α" : "—"}
                              </div>
                              <div className="text-muted">Price move</div>
                              <div className={`text-right ${priceMove >= 0 ? "text-green" : "text-red"}`}>
                                {(priceMove >= 0 ? "+" : "") + priceMove.toFixed(2)}%
                              </div>
                              <div className="text-muted">Cost basis</div>
                              <div className="text-text text-right">{fmtVal(p.cost_basis, showUSD, taoUsdPrice)}</div>
                              <div className="text-muted">Mark-to-spot value</div>
                              <div className="text-cyan text-right">{fmtVal(p.current_value, showUSD, taoUsdPrice)}</div>
                              <div className="text-muted font-medium">Unrealized P&L</div>
                              <div className={`text-right font-medium ${pnl >= 0 ? "text-green" : "text-red"}`}>
                                {(pnl >= 0 ? "+" : "") + fmtVal(pnl, showUSD, taoUsdPrice)}
                                <span className="text-[10px] ml-1 opacity-80">
                                  ({(pnlPctH >= 0 ? "+" : "") + pnlPctH.toFixed(2)}%)
                                </span>
                              </div>
                              {realizedPnl !== 0 && (
                                <>
                                  <div className="text-muted">Realized (trims/exits)</div>
                                  <div className={`text-right ${realizedPnl >= 0 ? "text-green" : "text-red"}`}>
                                    {(realizedPnl >= 0 ? "+" : "") + fmtVal(realizedPnl, showUSD, taoUsdPrice)}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Right: alpha tokens + emission */}
                          <div>
                            <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-muted mb-2">
                              Alpha Tokens
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[11px]">
                              <div className="text-muted">At entry</div>
                              <div className="text-text text-right">
                                {p.entry_tokens.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                              </div>
                              <div className="text-muted">From emissions</div>
                              <div className={`text-right ${p.emission_tokens > 0 ? "text-green" : "text-muted"}`}>
                                {p.emission_tokens > 0 ? "+" : ""}
                                {p.emission_tokens.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                              </div>
                              <div className="text-muted font-medium">Total held</div>
                              <div className="text-text text-right font-medium">
                                {p.total_tokens.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                                {p.symbol ? " " + p.symbol : " α"}
                              </div>
                              <div className="text-muted">Emission value (TAO)</div>
                              <div className={`text-right ${emPnl > 0.001 ? "text-green" : "text-muted"}`}>
                                {emPnl > 0.001 ? "+" + fmtVal(emPnl, showUSD, taoUsdPrice) : "—"}
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Trade history for this subnet */}
                        <div className="mt-4">
                          <div className="font-mono text-[9px] tracking-[0.12em] uppercase text-muted mb-2">
                            Activity for SN{p.netuid} ({tradeHistory.length}{" "}
                            {tradeHistory.length === 1 ? "trade" : "trades"})
                          </div>
                          {tradeHistory.length === 0 ? (
                            <div className="font-mono text-[11px] text-dim italic">
                              No trades recorded yet for this position
                            </div>
                          ) : (
                            <div className="border border-border/60 bg-surface">
                              {tradeHistory.map((t, ti) => {
                                const amount =
                                  t.tao_added != null
                                    ? t.tao_added
                                    : t.tao_removed != null
                                    ? -t.tao_removed
                                    : t.tao || 0;
                                const realized = t.realized_pnl_tao;
                                const ttype = (t.type || "").toUpperCase();
                                const priceShown =
                                  ttype === "ENTRY"
                                    ? t.entry_price
                                    : ttype === "EXIT"
                                    ? t.exit_price
                                    : t.spot_price;
                                return (
                                  <div
                                    key={ti}
                                    className="flex items-center gap-3 px-3 py-1.5 border-b border-border/40 last:border-b-0 flex-wrap"
                                  >
                                    <div className="font-mono text-[10px] text-muted min-w-[60px]">
                                      {fmtDate(t.date)}
                                    </div>
                                    <TradeBadge type={t.type} />
                                    <div className={`font-mono text-[11px] flex-1 ${
                                      amount >= 0 ? "text-green" : "text-red"
                                    }`}>
                                      {amount >= 0 ? "+" : ""}
                                      {fmtVal(Math.abs(amount), showUSD, taoUsdPrice)}
                                      {!showUSD && " τ"}
                                    </div>
                                    {priceShown != null && (
                                      <div className="font-mono text-[10px] text-muted">
                                        @ {priceShown.toFixed(8)}
                                      </div>
                                    )}
                                    {realized != null && (
                                      <div className={`font-mono text-[10px] font-medium ${
                                        realized >= 0 ? "text-green" : "text-red"
                                      }`}>
                                        realized {realized >= 0 ? "+" : ""}
                                        {fmtVal(realized, showUSD, taoUsdPrice)}
                                        {t.realized_pnl_pct != null && (
                                          <span className="ml-1 opacity-80">
                                            ({t.realized_pnl_pct >= 0 ? "+" : ""}
                                            {t.realized_pnl_pct.toFixed(1)}%)
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
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
                        <div className="font-mono text-[10px] text-right whitespace-nowrap min-w-[120px]">
                          {t.realized_pnl_tao != null ? (
                            <span className={t.realized_pnl_tao >= 0 ? "text-green" : "text-red"}>
                              {t.realized_pnl_tao >= 0 ? "+" : ""}
                              {fmtVal(t.realized_pnl_tao, showUSD, taoUsdPrice)}
                              {t.realized_pnl_pct != null && (
                                <span className="text-[9px] ml-1 opacity-80">
                                  ({t.realized_pnl_pct >= 0 ? "+" : ""}{t.realized_pnl_pct.toFixed(1)}%)
                                </span>
                              )}
                            </span>
                          ) : ""}
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
                                  {t.entry_price ? t.entry_price.toFixed(8) + " τ" : "—"}
                                </span>
                              </div>
                              <div>
                                Position Size: <span className="text-text">{fmtVal(tao, showUSD, taoUsdPrice)}</span>
                              </div>
                              <div>
                                Alpha Tokens:{" "}
                                <span className="text-text">
                                  {t.alpha_tokens != null
                                    ? t.alpha_tokens.toLocaleString(undefined, { maximumFractionDigits: 4 })
                                    : "—"}
                                </span>
                              </div>
                            </>
                          )}
                          {type === "EXIT" && (
                            <>
                              <div>
                                Position Closed:{" "}
                                <span className="text-text">{fmtVal(t.tao || 0, showUSD, taoUsdPrice)}</span>
                                {t.alpha_tokens != null && (
                                  <span className="text-muted ml-2">
                                    ({t.alpha_tokens.toLocaleString(undefined, { maximumFractionDigits: 4 })} α)
                                  </span>
                                )}
                              </div>
                              <div>
                                Cost Basis:{" "}
                                <span className="text-text">{fmtVal(t.cost_basis_tao || 0, showUSD, taoUsdPrice)}</span>
                              </div>
                              <div>
                                Realized P&L:{" "}
                                <span className={(t.realized_pnl_tao || 0) >= 0 ? "text-green font-medium" : "text-red font-medium"}>
                                  {(t.realized_pnl_tao || 0) >= 0 ? "+" : ""}
                                  {fmtVal(t.realized_pnl_tao || 0, showUSD, taoUsdPrice)}
                                  {t.realized_pnl_pct != null && (
                                    <span className="ml-1 opacity-80">
                                      ({t.realized_pnl_pct >= 0 ? "+" : ""}{t.realized_pnl_pct.toFixed(2)}%)
                                    </span>
                                  )}
                                </span>
                              </div>
                              <div>
                                Entry → Exit:{" "}
                                <span className="text-text">
                                  {t.entry_price ? t.entry_price.toFixed(8) : "—"} →{" "}
                                  {t.exit_price ? t.exit_price.toFixed(8) : "—"} τ
                                </span>
                              </div>
                              <div>
                                Days Held: <span className="text-text">{t.days_held != null ? t.days_held + "d" : "—"}</span>
                                {t.entry_date && (
                                  <span className="text-muted ml-2">(entered {fmtDate(t.entry_date)})</span>
                                )}
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
                                {t.alpha_added != null && (
                                  <span className="text-muted ml-2">
                                    (+{t.alpha_added.toLocaleString(undefined, { maximumFractionDigits: 4 })} α)
                                  </span>
                                )}
                              </div>
                              <div>
                                Spot Price:{" "}
                                <span className="text-text">
                                  {t.spot_price ? t.spot_price.toFixed(8) + " τ" : "—"}
                                </span>
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
                                {t.alpha_removed != null && (
                                  <span className="text-muted ml-2">
                                    (-{t.alpha_removed.toLocaleString(undefined, { maximumFractionDigits: 4 })} α)
                                  </span>
                                )}
                              </div>
                              <div>
                                Spot Price:{" "}
                                <span className="text-text">
                                  {t.spot_price ? t.spot_price.toFixed(8) + " τ" : "—"}
                                </span>
                              </div>
                            </>
                          )}
                          <div className="mt-1 text-dim">Date: {t.date || "—"}</div>
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
