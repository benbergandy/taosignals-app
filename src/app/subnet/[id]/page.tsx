"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

// ── TYPES ────────────────────────────────────────────────────
interface ScoreData {
  netuid: number;
  name?: string;
  combined_score?: number;
  stability_score?: number;
  yield_score?: number;
  consensus_score?: number;
  flow_score?: number;
  conviction_score?: number;
  flow_signal?: string;
  price_vs_ema_signal?: string;
  vs_network_signal?: string;
  emission_velocity_signal?: string;
  emission_stability_signal?: string;
  rank_consistency_signal?: string;
  validator_retention_signal?: string;
  emission_vs_network?: number;
  rank_consistency?: number;
  emission_stability?: number;
  avg_dividends?: number;
  weight_concentration_trend?: number;
  weight_conc_delta?: number;
  emission_velocity?: number;
  inflow_momentum?: number;
  avg_validator_trust?: number;
  n_active_delta?: number;
}

interface LiveSubnet {
  netuid: number;
  name?: string;
  symbol?: string;
  alpha_price_tao?: number;
  moving_price?: number;
  price_vs_ema?: number;
  ema_tao_inflow?: number;
  emission_tao?: number;
  alpha_ratio?: number;
  tao_in?: number;
  alpha_in?: number;
  alpha_out?: number;
  subnet_volume?: number;
  miners?: number;
  network_registered_at?: number;
  github?: string;
  url?: string;
}

interface ChainData {
  subnets?: LiveSubnet[];
  total_emission_tao?: number;
  block?: number;
}

interface HistoryRecord {
  date: string;
  price: number;
  moving_price: number;
  emission_tao: number;
  ema_tao_inflow: number;
  alpha_ratio: number;
  subnet_volume: number;
  tao_in: number;
  alpha_in: number;
  alpha_out: number;
}

// ── CONSTANTS ────────────────────────────────────────────────
const NETWORK_AVG = 100 / 128;
const SWAP_FEE = 0.0005;

const PROTOCOL_EVENTS = [
  { date: "2025-02-13", color: "#00d4ff" },
  { date: "2025-11-01", color: "#ff8800" },
  { date: "2025-12-14", color: "#9966ff" },
];

type RangeKey = "1m" | "3m" | "6m" | "all";

// ── HELPERS ──────────────────────────────────────────────────
function filterRange(
  labels: string[],
  data: number[][],
  range: RangeKey
): { labels: string[]; data: number[][] } {
  if (range === "all") return { labels, data };
  const days = range === "1m" ? 30 : range === "3m" ? 90 : 180;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutStr = cutoff.toISOString().slice(0, 10);
  const idx = labels.findIndex((l) => l >= cutStr);
  if (idx < 0) return { labels, data };
  return {
    labels: labels.slice(idx),
    data: data.map((d) => d.slice(idx)),
  };
}

function getBadgeClass(signal: string): string {
  if (!signal || signal === "UNKNOWN") return "b-muted";
  const sl = signal.toLowerCase();
  if (
    [
      "strong", "dominant", "thriving", "collapsing", "active", "strong_inflow",
      "veteran", "well_below", "below", "slight_below", "deeply_oversold",
      "accumulating", "turning", "highly_persistent", "very_stable", "very_consistent",
    ].some((v) => sl.includes(v))
  )
    return "b-green";
  if (
    [
      "moderate", "declining", "inflow", "established", "falling", "growing",
      "recovering", "increasing", "persistent", "consistent", "stable",
    ].some((v) => sl.includes(v))
  )
    return "b-cyan";
  if (
    ["slowing", "low", "slight_inflow", "young", "rising", "above", "holding", "sporadic"].some(
      (v) => sl.includes(v)
    )
  )
    return "b-yellow";
  if (
    [
      "weak", "zero", "none", "heavy_outflow", "well_above", "far_above",
      "reversing", "worsening", "exiting", "deteriorating", "inconsistent",
      "absent", "exodus", "decelerating",
    ].some((v) => sl.includes(v))
  )
    return "b-red";
  if (["bleeding", "minimal", "volatile", "zero_emission"].some((v) => sl.includes(v)))
    return "b-orange";
  if (["surging", "accelerating"].some((v) => sl.includes(v))) return "b-purple";
  return "b-muted";
}

const badgeColorMap: Record<string, string> = {
  "b-green": "text-green border-green bg-green/10",
  "b-cyan": "text-cyan border-cyan bg-cyan/[0.08]",
  "b-yellow": "text-yellow border-yellow bg-yellow/[0.08]",
  "b-red": "text-red border-red bg-red/[0.08]",
  "b-orange": "text-orange border-orange bg-orange/[0.08]",
  "b-purple": "text-purple border-purple bg-purple/[0.08]",
  "b-muted": "text-muted border-border2 bg-transparent",
};

function Badge({ signal }: { signal?: string }) {
  if (!signal || signal === "UNKNOWN")
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.06em] uppercase px-1.5 py-0.5 border font-medium whitespace-nowrap text-muted border-border2 bg-transparent">
        ---
      </span>
    );
  const cls = getBadgeClass(signal);
  const tw = badgeColorMap[cls] || badgeColorMap["b-muted"];
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.06em] uppercase px-1.5 py-0.5 border font-medium whitespace-nowrap ${tw}`}
    >
      <span className="w-1 h-1 rounded-full bg-current shrink-0" />
      {signal}
    </span>
  );
}

function fmtSig(val?: number | null): string {
  if (val === null || val === undefined) return "---";
  return (val * 100).toFixed(0);
}

// ── CHART HELPERS ────────────────────────────────────────────
const TTip = {
  backgroundColor: "rgba(10,14,18,0.95)",
  borderColor: "#243040",
  borderWidth: 1,
  titleColor: "#445566",
  bodyColor: "#c8d8e8",
  titleFont: { family: "IBM Plex Mono", size: 10 },
  bodyFont: { family: "IBM Plex Mono", size: 11 },
  padding: 10,
};

const XScale = {
  grid: { color: "rgba(26,34,48,0.5)", drawTicks: false },
  ticks: {
    color: "#445566",
    font: { family: "IBM Plex Mono", size: 9 },
    maxTicksLimit: 8,
    maxRotation: 0,
  },
  border: { color: "#1a2230" },
};

function yOpts(label: string, color = "#445566", isLog = false) {
  return {
    type: isLog ? ("logarithmic" as const) : ("linear" as const),
    grid: { color: "rgba(26,34,48,0.5)", drawTicks: false },
    ticks: {
      color,
      font: { family: "IBM Plex Mono", size: 9 },
      callback: (v: number | string) => {
        const n = typeof v === "string" ? parseFloat(v) : v;
        if (isLog) {
          return Math.abs(Math.log10(n) - Math.round(Math.log10(n))) < 0.01
            ? n < 1
              ? n.toFixed(4)
              : n.toFixed(2)
            : "";
        }
        return n.toFixed(4);
      },
    },
    border: { color: "#1a2230" },
    title: {
      display: true,
      text: label,
      color,
      font: { family: "IBM Plex Mono", size: 8 },
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function drawEvents(chart: any, labels: string[]) {
  const ctx2 = chart.ctx;
  PROTOCOL_EVENTS.forEach((ev) => {
    const idx = labels.findIndex((l) => l >= ev.date);
    if (idx < 0) return;
    const x = chart.scales.x.getPixelForValue(idx);
    ctx2.save();
    ctx2.strokeStyle = ev.color;
    ctx2.lineWidth = 1;
    ctx2.setLineDash([4, 4]);
    ctx2.globalAlpha = 0.7;
    ctx2.beginPath();
    ctx2.moveTo(x, chart.chartArea.top);
    ctx2.lineTo(x, chart.chartArea.bottom);
    ctx2.stroke();
    ctx2.restore();
  });
}

// ── RANGE BUTTON COMPONENT ───────────────────────────────────
function RangeButtons({
  active,
  chartKey,
  onSet,
}: {
  active: RangeKey;
  chartKey: string;
  onSet: (r: RangeKey) => void;
}) {
  return (
    <>
      {(["1m", "3m", "6m", "all"] as RangeKey[]).map((r) => (
        <button
          key={`${chartKey}-${r}`}
          className={`font-mono text-[9px] tracking-[0.06em] uppercase bg-transparent border px-[7px] py-[3px] cursor-pointer transition-all ${
            active === r
              ? "border-cyan text-cyan bg-cyan/[0.08]"
              : "border-border2 text-muted hover:border-text hover:text-text"
          }`}
          onClick={() => onSet(r)}
        >
          {r.toUpperCase()}
        </button>
      ))}
    </>
  );
}

// ── INFO ROW COMPONENT ───────────────────────────────────────
function InfoRow({ label, value, valueHtml }: { label: string; value?: string; valueHtml?: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center py-[5px] border-b border-border/50 last:border-b-0">
      <span className="text-[11px] text-muted">{label}</span>
      {valueHtml ? (
        <span className="font-mono text-[11px]">{valueHtml}</span>
      ) : (
        <span className="font-mono text-[11px]">{value || "---"}</span>
      )}
    </div>
  );
}

// ── MAIN PAGE COMPONENT ──────────────────────────────────────
export default function SubnetDetailPage() {
  const params = useParams();
  const NETUID = parseInt((params.id as string) || "3");

  const [score, setScore] = useState<ScoreData | null>(null);
  const [live, setLive] = useState<LiveSubnet | null>(null);
  const [chainMeta, setChainMeta] = useState<{ totalEmission: number; block: number }>({
    totalEmission: 1,
    block: 0,
  });
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Chart state
  const [priceRange, setPriceRange] = useState<RangeKey>("6m");
  const [emissionRange, setEmissionRange] = useState<RangeKey>("6m");
  const [flowRange, setFlowRange] = useState<RangeKey>("6m");
  const [priceScale, setPriceScale] = useState<"linear" | "log">("linear");

  // Position calculator
  const [positionSize, setPositionSize] = useState(100);

  // Chart refs
  const priceCanvasRef = useRef<HTMLCanvasElement>(null);
  const emissionCanvasRef = useRef<HTMLCanvasElement>(null);
  const flowCanvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartsRef = useRef<{ price: any; emission: any; flow: any }>({
    price: null,
    emission: null,
    flow: null,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ChartRef = useRef<any>(null);

  // ── LOAD DATA ────────────────────────────────────────────────
  useEffect(() => {
    async function loadData() {
      try {
        const [combinedRes, chainRes] = await Promise.all([
          fetch(`/data/combined_scores.json?t=${Date.now()}`),
          fetch(`/data/chain_data.json?t=${Date.now()}`),
        ]);
        const combined = await combinedRes.json();
        const chain: ChainData = await chainRes.json();

        const s = combined.scores?.find((s: ScoreData) => s.netuid === NETUID) || null;
        const l = chain.subnets?.find((s: LiveSubnet) => s.netuid === NETUID) || null;

        setScore(s);
        setLive(l);
        setChainMeta({
          totalEmission: chain.total_emission_tao || 1,
          block: chain.block || 0,
        });
        setLoading(false);
      } catch (e) {
        console.error("Failed to load data:", e);
        setLoading(false);
      }
    }
    loadData();
  }, [NETUID]);

  // ── LOAD CHAIN HISTORY ───────────────────────────────────────
  useEffect(() => {
    async function loadChainHistory() {
      const today = new Date();
      const dates: string[] = [];
      for (let i = 400; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().slice(0, 10));
      }

      const records: HistoryRecord[] = [];
      const batchSize = 30;

      for (let i = 0; i < dates.length; i += batchSize) {
        const batch = dates.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map((date) =>
            fetch(`/data/chain_history/${date}.json`)
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null)
          )
        );
        results.forEach((result) => {
          if (result.status === "fulfilled" && result.value) {
            const data = result.value;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const subnet = data.subnets?.find((s: any) => s.netuid === NETUID);
            if (subnet) {
              records.push({
                date: data.date,
                price: subnet.price || 0,
                moving_price: subnet.moving_price || 0,
                emission_tao: subnet.emission_tao || 0,
                ema_tao_inflow: subnet.ema_tao_inflow || 0,
                alpha_ratio: subnet.alpha_ratio || 0,
                subnet_volume: subnet.subnet_volume || 0,
                tao_in: subnet.tao_in || 0,
                alpha_in: subnet.alpha_in || 0,
                alpha_out: subnet.alpha_out || 0,
              });
            }
          }
        });
      }

      records.sort((a, b) => a.date.localeCompare(b.date));
      setHistory(records);
      setHistoryLoading(false);
    }
    loadChainHistory();
  }, [NETUID]);

  // ── CHART.JS DYNAMIC IMPORT ──────────────────────────────────
  useEffect(() => {
    async function loadChartJS() {
      const chartModule = await import("chart.js");
      chartModule.Chart.register(
        chartModule.LineController,
        chartModule.BarController,
        chartModule.CategoryScale,
        chartModule.LinearScale,
        chartModule.LogarithmicScale,
        chartModule.PointElement,
        chartModule.LineElement,
        chartModule.BarElement,
        chartModule.Title,
        chartModule.Tooltip,
        chartModule.Legend,
        chartModule.Filler
      );
      ChartRef.current = chartModule.Chart;
    }
    loadChartJS();
  }, []);

  // ── BUILD PRICE CHART ────────────────────────────────────────
  const buildPriceChart = useCallback(() => {
    const Chart = ChartRef.current;
    if (!Chart || !history.length || !priceCanvasRef.current) return;

    const isLog = priceScale === "log";
    const allLabels = history.map((r) => r.date);
    const allPrices = history.map((r) => (isLog && (r.price || 0) <= 0 ? 0.000001 : r.price || 0));
    const allEMA = history.map((r) => r.moving_price || 0);
    const {
      labels,
      data: [prices, ema],
    } = filterRange(allLabels, [allPrices, allEMA], priceRange);

    // Build segments for coloring
    const segs: { start: number; end: number; bull: boolean }[] = [];
    let bull = prices[0] >= ema[0],
      start = 0;
    for (let i = 1; i < prices.length; i++) {
      const nb = prices[i] >= ema[i];
      if (nb !== bull) {
        segs.push({ start, end: i, bull });
        start = i;
        bull = nb;
      }
    }
    segs.push({ start, end: prices.length - 1, bull });

    if (chartsRef.current.price) chartsRef.current.price.destroy();
    chartsRef.current.price = new Chart(priceCanvasRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Price",
            data: prices,
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
            fill: false,
            segment: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              borderColor: (ctx: any) => {
                const i = ctx.p1DataIndex;
                const s = segs.find((s) => i >= s.start && i <= s.end);
                return s?.bull ? "rgba(0,255,136,0.9)" : "rgba(255,51,85,0.85)";
              },
            },
          },
          {
            label: "EMA",
            data: ema,
            borderColor: "rgba(0,212,255,0.5)",
            borderWidth: 1,
            borderDash: [3, 3],
            pointRadius: 0,
            tension: 0.3,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index" as const, intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TTip,
            callbacks: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              label: (ctx: any) =>
                ctx.dataset.label === "Price"
                  ? ` Price: ${ctx.parsed.y?.toFixed(6)} TAO`
                  : ` EMA: ${ctx.parsed.y?.toFixed(6)} TAO`,
            },
          },
        },
        scales: { x: XScale, y: yOpts("ALPHA PRICE (TAO)", "#445566", isLog) },
        animation: {
          onComplete: function (this: unknown) {
            drawEvents(this, labels);
          },
        },
      },
    });
  }, [history, priceRange, priceScale]);

  // ── BUILD EMISSION CHART ─────────────────────────────────────
  const buildEmissionChart = useCallback(() => {
    const Chart = ChartRef.current;
    if (!Chart || !history.length || !emissionCanvasRef.current) return;

    const networkAvg = 0.5 / 128;
    const allLabels = history.map((r) => r.date);
    const allEm = history.map((r) => r.emission_tao || 0);
    const {
      labels,
      data: [em],
    } = filterRange(allLabels, [allEm], emissionRange);
    const avgLine = em.map(() => networkAvg);

    if (chartsRef.current.emission) chartsRef.current.emission.destroy();
    chartsRef.current.emission = new Chart(emissionCanvasRef.current, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Emission",
            data: em,
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
            fill: true,
            backgroundColor: "rgba(255,208,0,0.04)",
            segment: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              borderColor: (ctx: any) =>
                em[ctx.p1DataIndex] < networkAvg
                  ? "rgba(255,208,0,0.9)"
                  : "rgba(0,255,136,0.7)",
            },
          },
          {
            label: "Network Avg",
            data: avgLine,
            borderColor: "rgba(255,136,0,0.65)",
            borderWidth: 1,
            borderDash: [6, 3],
            pointRadius: 0,
            tension: 0,
            fill: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index" as const, intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TTip,
            callbacks: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              label: (ctx: any) =>
                ctx.dataset.label === "Emission"
                  ? ` Emission: ${ctx.parsed.y?.toFixed(6)} TAO/blk`
                  : ` Network avg: ${ctx.parsed.y?.toFixed(6)}`,
            },
          },
        },
        scales: { x: XScale, y: yOpts("EMISSION (TAO/BLOCK)", "rgba(255,208,0,0.5)") },
        animation: {
          onComplete: function (this: unknown) {
            drawEvents(this, labels);
          },
        },
      },
    });
  }, [history, emissionRange]);

  // ── BUILD FLOW CHART ─────────────────────────────────────────
  const buildFlowChart = useCallback(() => {
    const Chart = ChartRef.current;
    if (!Chart || !history.length || !flowCanvasRef.current) return;

    const allLabels = history.map((r) => r.date);
    const allFlows = history.map((r) => r.ema_tao_inflow || 0);
    const {
      labels,
      data: [flows],
    } = filterRange(allLabels, [allFlows], flowRange);

    if (chartsRef.current.flow) chartsRef.current.flow.destroy();
    chartsRef.current.flow = new Chart(flowCanvasRef.current, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "EMA Inflow",
            data: flows,
            backgroundColor: flows.map((v) =>
              v >= 0 ? "rgba(0,255,136,0.6)" : "rgba(255,51,85,0.6)"
            ),
            borderWidth: 0,
            barPercentage: 0.8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index" as const, intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TTip,
            callbacks: {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              label: (ctx: any) => ` EMA Inflow: ${ctx.parsed.y?.toFixed(6)} TAO/blk`,
            },
          },
        },
        scales: { x: XScale, y: yOpts("EMA TAO INFLOW") },
      },
    });
  }, [history, flowRange]);

  // ── REBUILD CHARTS ON DEPS CHANGE ────────────────────────────
  useEffect(() => {
    if (!historyLoading && ChartRef.current) {
      buildPriceChart();
    }
  }, [historyLoading, buildPriceChart]);

  useEffect(() => {
    if (!historyLoading && ChartRef.current) {
      buildEmissionChart();
    }
  }, [historyLoading, buildEmissionChart]);

  useEffect(() => {
    if (!historyLoading && ChartRef.current) {
      buildFlowChart();
    }
  }, [historyLoading, buildFlowChart]);

  // ── DERIVED VALUES ─────────────────────────────────────────
  const name = score?.name || live?.name || `SN${NETUID}`;
  const symbol = live?.symbol || "";
  const price = live?.alpha_price_tao || 0;
  const movPrice = live?.moving_price || 0;
  const priceVsEma = live?.price_vs_ema || 1;
  const inflow = live?.ema_tao_inflow || 0;
  const emission = live?.emission_tao || 0;
  const totalEm = chainMeta.totalEmission;
  const emShare = ((emission / totalEm) * 100).toFixed(3);
  const alphaRatio = live?.alpha_ratio || 0;
  const miners = live?.miners || 0;
  const regAt = live?.network_registered_at || 0;
  const block = chainMeta.block;
  const ageDays = regAt && block ? Math.floor((block - regAt) / 7200) : 0;
  const taoIn = live?.tao_in || 0;

  // Liquidity
  const taoPool = live?.tao_in || 0;
  const alphaPool = live?.alpha_in || 0;
  let liqTier = "ILLIQUID",
    liqClass = "text-red border-red bg-red/[0.08]";
  if (taoPool >= 50000) {
    liqTier = "DEEP";
    liqClass = "text-green border-green bg-green/10";
  } else if (taoPool >= 10000) {
    liqTier = "ADEQUATE";
    liqClass = "text-cyan border-cyan bg-cyan/[0.08]";
  } else if (taoPool >= 1000) {
    liqTier = "THIN";
    liqClass = "text-yellow border-yellow bg-yellow/[0.08]";
  } else if (taoPool >= 100) {
    liqTier = "VERY THIN";
    liqClass = "text-orange border-orange bg-orange/[0.08]";
  }
  const liqMax1 = taoPool > 0 ? (taoPool * 0.01) / 0.99 : 0;
  const liqMax2 = taoPool > 0 ? (taoPool * 0.02) / 0.98 : 0;

  // Position calculator
  const calcPosition = useCallback(() => {
    if (!taoPool || !alphaPool || positionSize <= 0) return null;
    const T = taoPool;
    const A = alphaPool;
    const k = T * A;
    const pos = positionSize;

    const entrySlip = pos / (T + pos);
    const taoAfterFee = pos * (1 - SWAP_FEE);
    const alphaReceived = A - k / (T + taoAfterFee);
    const taoBack = T - k / (A + alphaReceived);
    const exitFee = taoBack * SWAP_FEE;
    const taoFinal = taoBack - exitFee;
    const rtCost = (pos - taoFinal) / pos;
    const costTao = pos - taoFinal;

    const yourShare = pos / (T + pos);
    const subnetDailyEm = (parseFloat(emShare) / 100) * totalEm * 7200;
    const dailyYield = subnetDailyEm > 0 ? (yourShare * subnetDailyEm) / pos : 0;
    const breakEven = dailyYield > 0 ? rtCost / dailyYield : null;

    const max1 = (T * 0.01) / 0.99;
    const max2 = (T * 0.02) / 0.98;
    const max5 = (T * 0.05) / 0.95;

    return { entrySlip, rtCost, costTao, dailyYield, breakEven, max1, max2, max5 };
  }, [taoPool, alphaPool, positionSize, emShare, totalEm]);

  const posCalc = calcPosition();

  // Signal history (last 14 days)
  const signalHistory = history.slice(-14).reverse();

  // ── RENDER ─────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen font-mono text-xs text-muted">
        Loading subnet data...
      </div>
    );
  }

  function slipColor(slip: number): string {
    if (slip < 0.01) return "text-green";
    if (slip < 0.03) return "text-yellow";
    if (slip < 0.10) return "text-orange";
    return "text-red";
  }

  return (
    <div>
      {/* ── HERO ────────────────────────────────────────────── */}
      <div className="px-6 pt-6 grid grid-cols-[1fr_auto] gap-6 items-start animate-[fadeUp_0.4s_ease_both]">
        <div>
          <div className="font-mono text-[9px] tracking-[0.2em] uppercase text-muted mb-1.5">
            Subnet Intelligence
          </div>
          <div className="text-[30px] font-bold tracking-tight text-text leading-none mb-2.5">
            {name} <span className="text-cyan font-mono text-base ml-2">{symbol}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {[
              score?.flow_signal,
              score?.price_vs_ema_signal,
              score?.vs_network_signal,
              score?.emission_velocity_signal,
            ]
              .filter(Boolean)
              .map((sig, i) => (
                <Badge key={i} signal={sig} />
              ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button className="font-mono text-[11px] tracking-[0.08em] uppercase px-5 py-2 cursor-pointer bg-green text-bg font-semibold border-none hover:opacity-80 transition-opacity">
              Stake
            </button>
            <button className="font-mono text-[11px] tracking-[0.08em] uppercase px-5 py-2 cursor-pointer bg-transparent border border-red text-red hover:bg-red/[0.08] transition-all">
              Unstake
            </button>
          </div>
        </div>

        {/* Score Cards */}
        <div className="grid grid-cols-3 gap-px bg-border border border-border min-w-[420px]">
          {[
            { label: "Combined", value: score?.combined_score, color: "text-cyan", sub: "overall signal" },
            { label: "Stability", value: score?.stability_score, color: "text-green", sub: "factor score" },
            { label: "Yield", value: score?.yield_score, color: "text-yellow", sub: "factor score" },
            { label: "Consensus", value: score?.consensus_score, color: "text-purple", sub: "factor score" },
            { label: "Flow", value: score?.flow_score, color: "text-cyan", sub: "factor score" },
            { label: "Conviction", value: score?.conviction_score, color: "text-orange", sub: "factor score" },
          ].map((card) => (
            <div key={card.label} className="bg-surface px-[18px] py-3.5 text-center">
              <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1.5">
                {card.label}
              </div>
              <div className={`font-mono text-[26px] font-semibold leading-none ${card.color}`}>
                {card.value?.toFixed(1) || "---"}
              </div>
              <div className="font-mono text-[9px] text-muted mt-1">{card.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── STATS STRIP ─────────────────────────────────────── */}
      <div className="grid grid-cols-8 border-t border-b border-border mt-[18px] bg-surface animate-[fadeUp_0.4s_ease_both]">
        <div className="px-3.5 py-[11px] border-r border-border">
          <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">Alpha Price</div>
          <div className="font-mono text-[13px] font-semibold">{price.toFixed(6)} t</div>
          <div className="font-mono text-[10px] mt-0.5 text-muted">
            {movPrice ? `EMA: ${movPrice.toFixed(6)} t` : "---"}
          </div>
        </div>
        <div className="px-3.5 py-[11px] border-r border-border">
          <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">Price vs EMA</div>
          <div className="font-mono text-[13px] font-semibold">{priceVsEma.toFixed(4)}x</div>
          <div className={`font-mono text-[10px] mt-0.5 ${priceVsEma < 1 ? "text-green" : "text-yellow"}`}>
            {score?.price_vs_ema_signal || "---"}
          </div>
        </div>
        <div className="px-3.5 py-[11px] border-r border-border">
          <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">EMA Inflow</div>
          <div className={`font-mono text-[13px] font-semibold ${inflow >= 0 ? "text-green" : "text-red"}`}>
            {(inflow >= 0 ? "+" : "") + inflow.toFixed(4)} t
          </div>
          <div className="font-mono text-[10px] mt-0.5 text-muted">{score?.flow_signal || "---"}</div>
        </div>
        <div className="px-3.5 py-[11px] border-r border-border">
          <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">Emission Share</div>
          <div className="font-mono text-[13px] font-semibold">{emission.toFixed(6)} t/blk</div>
          <div className={`font-mono text-[10px] mt-0.5 ${parseFloat(emShare) >= NETWORK_AVG ? "text-green" : "text-yellow"}`}>
            {emShare}% of network
          </div>
        </div>
        <div className="px-3.5 py-[11px] border-r border-border">
          <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">Alpha Ratio</div>
          <div className="font-mono text-[13px] font-semibold">{alphaRatio.toFixed(2)}x</div>
          <div className="font-mono text-[10px] mt-0.5 text-muted">staked / pool</div>
        </div>
        <div className="px-3.5 py-[11px] border-r border-border">
          <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">TAO in Pool</div>
          <div className="font-mono text-[13px] font-semibold">
            {taoIn >= 1000 ? (taoIn / 1000).toFixed(1) + "k t" : taoIn.toFixed(0) + " t"}
          </div>
          <div className="font-mono text-[10px] mt-0.5 text-muted">liquidity depth</div>
        </div>
        <div className="px-3.5 py-[11px] border-r border-border">
          <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">Avg Dividends</div>
          <div className="font-mono text-[13px] font-semibold">
            {score?.avg_dividends ? (score.avg_dividends * 100).toFixed(0) : "---"}
          </div>
          <div className="font-mono text-[10px] mt-0.5 text-muted">yield signal</div>
        </div>
        <div className="px-3.5 py-[11px]">
          <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1">Active Neurons</div>
          <div className="font-mono text-[13px] font-semibold">{miners || "---"}</div>
          <div className="font-mono text-[10px] mt-0.5 text-muted">
            {ageDays ? ageDays + "d post-dTAO" : "---"}
          </div>
        </div>
      </div>

      {/* ── MAIN GRID (CHARTS + SIDEBAR) ────────────────────── */}
      <div className="px-6 py-[18px] grid grid-cols-[1fr_290px] gap-[18px]">
        {/* Charts Column */}
        <div className="flex flex-col gap-3.5">
          {/* Price Chart */}
          <div className="bg-surface border border-border overflow-hidden animate-[fadeUp_0.4s_ease_both]">
            <div className="flex items-center justify-between px-4 py-[11px] border-b border-border gap-2 flex-wrap">
              <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-text font-medium whitespace-nowrap">
                Alpha Token Price
              </div>
              <div className="flex gap-1 items-center flex-wrap">
                <RangeButtons active={priceRange} chartKey="price" onSet={setPriceRange} />
                <div className="w-px h-3.5 bg-border2 mx-0.5" />
                <select
                  className="font-mono text-[9px] bg-surface2 border border-border2 text-cyan px-1.5 py-[3px] cursor-pointer uppercase tracking-[0.06em]"
                  value={priceScale}
                  onChange={(e) => setPriceScale(e.target.value as "linear" | "log")}
                >
                  <option value="linear">LINEAR</option>
                  <option value="log">LOG</option>
                </select>
              </div>
            </div>
            <div className="px-4 py-3.5">
              {historyLoading ? (
                <div className="flex items-center justify-center h-[240px] font-mono text-[11px] text-muted flex-col gap-2">
                  Loading chain history...
                </div>
              ) : history.length === 0 ? (
                <div className="flex items-center justify-center h-[240px] font-mono text-[11px] text-red">
                  No chain history data
                </div>
              ) : (
                <div style={{ height: 240, position: "relative" }}>
                  <canvas ref={priceCanvasRef} />
                </div>
              )}
            </div>
            <div className="flex gap-3 px-4 py-[7px] flex-wrap border-t border-border">
              <div className="flex items-center gap-[5px] font-mono text-[9px] text-muted">
                <div className="w-3.5 h-0.5 bg-green shrink-0" />
                Bullish (price &gt; EMA)
              </div>
              <div className="flex items-center gap-[5px] font-mono text-[9px] text-muted">
                <div className="w-3.5 h-0.5 bg-red shrink-0" />
                Bearish (price &lt; EMA)
              </div>
              <div className="flex items-center gap-[5px] font-mono text-[9px] text-muted">
                <div className="w-3.5 h-0 border-t-2 border-dashed border-cyan shrink-0" />
                Moving Price (EMA)
              </div>
              <div className="flex items-center gap-[5px] font-mono text-[9px] text-muted">
                <div className="w-[7px] h-[7px] rounded-full bg-cyan shrink-0" />
                dTAO Feb 2025
              </div>
              <div className="flex items-center gap-[5px] font-mono text-[9px] text-muted">
                <div className="w-[7px] h-[7px] rounded-full bg-orange shrink-0" />
                Taoflow Nov 2025
              </div>
              <div className="flex items-center gap-[5px] font-mono text-[9px] text-muted">
                <div className="w-[7px] h-[7px] rounded-full bg-purple shrink-0" />
                Halving Dec 2025
              </div>
            </div>
          </div>

          {/* Emission Chart */}
          <div className="bg-surface border border-border overflow-hidden animate-[fadeUp_0.4s_ease_both]">
            <div className="flex items-center justify-between px-4 py-[11px] border-b border-border gap-2 flex-wrap">
              <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-text font-medium whitespace-nowrap">
                Emission Share vs Network
              </div>
              <div className="flex gap-1 items-center flex-wrap">
                <RangeButtons active={emissionRange} chartKey="emission" onSet={setEmissionRange} />
              </div>
            </div>
            <div className="px-4 py-3.5">
              {historyLoading ? (
                <div className="flex items-center justify-center h-[180px] font-mono text-[11px] text-muted flex-col gap-2">
                  Loading chain history...
                </div>
              ) : history.length === 0 ? (
                <div className="flex items-center justify-center h-[180px] font-mono text-[11px] text-red">
                  No chain history data
                </div>
              ) : (
                <div style={{ height: 180, position: "relative" }}>
                  <canvas ref={emissionCanvasRef} />
                </div>
              )}
            </div>
            <div className="flex gap-3 px-4 py-[7px] flex-wrap border-t border-border">
              <div className="flex items-center gap-[5px] font-mono text-[9px] text-muted">
                <div className="w-3.5 h-0.5 bg-yellow shrink-0" />
                Below avg - mean reversion signal
              </div>
              <div className="flex items-center gap-[5px] font-mono text-[9px] text-muted">
                <div className="w-3.5 h-0.5 bg-green shrink-0" />
                Above avg - already priced in
              </div>
              <div className="flex items-center gap-[5px] font-mono text-[9px] text-muted">
                <div className="w-3.5 h-0 border-t-2 border-dashed border-orange shrink-0" />
                Network avg
              </div>
            </div>
          </div>

          {/* Flow Chart */}
          <div className="bg-surface border border-border overflow-hidden animate-[fadeUp_0.4s_ease_both]">
            <div className="flex items-center justify-between px-4 py-[11px] border-b border-border gap-2 flex-wrap">
              <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-text font-medium whitespace-nowrap">
                EMA TAO Inflow
              </div>
              <div className="flex gap-1 items-center flex-wrap">
                <RangeButtons active={flowRange} chartKey="flow" onSet={setFlowRange} />
              </div>
            </div>
            <div className="px-4 py-3.5">
              {historyLoading ? (
                <div className="flex items-center justify-center h-[160px] font-mono text-[11px] text-muted flex-col gap-2">
                  Loading chain history...
                </div>
              ) : history.length === 0 ? (
                <div className="flex items-center justify-center h-[160px] font-mono text-[11px] text-red">
                  No chain history data
                </div>
              ) : (
                <div style={{ height: 160, position: "relative" }}>
                  <canvas ref={flowCanvasRef} />
                </div>
              )}
            </div>
            <div className="font-mono text-[9px] text-muted px-4 py-1.5 border-t border-border bg-yellow/[0.03]">
              EMA TAO inflow data available from Taoflow upgrade (Nov 2025). Earlier values are zero.
            </div>
          </div>
        </div>

        {/* ── SIDEBAR ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-3.5">
          {/* Stability Signals */}
          <div className="bg-surface border border-border animate-[fadeUp_0.4s_ease_both]">
            <div className="px-3.5 py-[9px] border-b border-border font-mono text-[9px] tracking-[0.15em] uppercase text-green">
              Stability
            </div>
            <div className="px-3.5 py-2.5">
              <InfoRow label="Em vs Network" value={fmtSig(score?.emission_vs_network)} />
              <InfoRow label="Rank Consistency" value={fmtSig(score?.rank_consistency)} />
              <InfoRow label="Em Stability" value={fmtSig(score?.emission_stability)} />
              <InfoRow label="Factor Score" value={score?.stability_score?.toFixed(1) || "---"} />
            </div>
          </div>

          {/* Yield Signal */}
          <div className="bg-surface border border-border animate-[fadeUp_0.4s_ease_both]">
            <div className="px-3.5 py-[9px] border-b border-border font-mono text-[9px] tracking-[0.15em] uppercase text-yellow">
              Yield
            </div>
            <div className="px-3.5 py-2.5">
              <InfoRow label="Avg Dividends" value={fmtSig(score?.avg_dividends)} />
              <InfoRow label="Factor Score" value={score?.yield_score?.toFixed(1) || "---"} />
            </div>
          </div>

          {/* Consensus Signals */}
          <div className="bg-surface border border-border animate-[fadeUp_0.4s_ease_both]">
            <div className="px-3.5 py-[9px] border-b border-border font-mono text-[9px] tracking-[0.15em] uppercase text-purple">
              Consensus
            </div>
            <div className="px-3.5 py-2.5">
              <InfoRow label="Wt Conc Trend" value={fmtSig(score?.weight_concentration_trend)} />
              <InfoRow label="Wt Conc Delta" value={fmtSig(score?.weight_conc_delta)} />
              <InfoRow label="Factor Score" value={score?.consensus_score?.toFixed(1) || "---"} />
            </div>
          </div>

          {/* Flow Signals */}
          <div className="bg-surface border border-border animate-[fadeUp_0.4s_ease_both]">
            <div className="px-3.5 py-[9px] border-b border-border font-mono text-[9px] tracking-[0.15em] uppercase text-cyan">
              Flow
            </div>
            <div className="px-3.5 py-2.5">
              <InfoRow label="Em Velocity" value={fmtSig(score?.emission_velocity)} />
              <InfoRow label="Inflow Momentum" value={fmtSig(score?.inflow_momentum)} />
              <InfoRow label="Factor Score" value={score?.flow_score?.toFixed(1) || "---"} />
            </div>
          </div>

          {/* Conviction Signals */}
          <div className="bg-surface border border-border animate-[fadeUp_0.4s_ease_both]">
            <div className="px-3.5 py-[9px] border-b border-border font-mono text-[9px] tracking-[0.15em] uppercase text-orange">
              Conviction
            </div>
            <div className="px-3.5 py-2.5">
              <InfoRow label="Avg Val Trust" value={fmtSig(score?.avg_validator_trust)} />
              <InfoRow label="Active Val Delta" value={fmtSig(score?.n_active_delta)} />
              <InfoRow label="Factor Score" value={score?.conviction_score?.toFixed(1) || "---"} />
            </div>
          </div>

          {/* Signal History (14d) */}
          <div className="bg-surface border border-border animate-[fadeUp_0.4s_ease_both]">
            <div className="px-3.5 py-[9px] border-b border-border font-mono text-[9px] tracking-[0.15em] uppercase text-muted">
              Signal History (14d)
            </div>
            <div className="px-3.5 py-2.5">
              {historyLoading ? (
                <div className="flex items-center justify-center h-20 font-mono text-[11px] text-muted">
                  Loading...
                </div>
              ) : signalHistory.length === 0 ? (
                <div className="flex items-center justify-center h-20 font-mono text-[11px] text-muted">
                  No data
                </div>
              ) : (
                signalHistory.map((r) => {
                  const f = r.ema_tao_inflow || 0;
                  let color = "text-red";
                  let barBg = "bg-red";
                  let label = "WEAK";
                  if (f > 0.01) {
                    color = "text-green";
                    barBg = "bg-green";
                    label = "STRONG";
                  } else if (f > 0) {
                    color = "text-cyan";
                    barBg = "bg-cyan";
                    label = "TURNING";
                  } else if (f > -0.01) {
                    color = "text-yellow";
                    barBg = "bg-yellow";
                    label = "SLOWING";
                  }
                  return (
                    <div
                      key={r.date}
                      className="flex items-center gap-[7px] py-1 border-b border-border/40 last:border-b-0"
                    >
                      <div className="font-mono text-[9px] text-muted w-[70px] shrink-0">{r.date}</div>
                      <div className={`flex-1 h-[3px] rounded-sm ${barBg} opacity-70`} />
                      <span
                        className={`font-mono text-[8px] px-[5px] py-[2px] border bg-transparent ${color}`}
                        style={{ borderColor: "currentColor" }}
                      >
                        {label}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Chain Data */}
          <div className="bg-surface border border-border animate-[fadeUp_0.4s_ease_both]">
            <div className="px-3.5 py-[9px] border-b border-border font-mono text-[9px] tracking-[0.15em] uppercase text-muted">
              Chain Data
            </div>
            <div className="px-3.5 py-2.5">
              <InfoRow label="EMA Inflow" value={`${inflow >= 0 ? "+" : ""}${inflow.toFixed(6)} TAO/blk`} />
              <InfoRow label="Alpha Ratio" value={`${alphaRatio.toFixed(3)}x (staked/pool)`} />
              <InfoRow label="TAO in Pool" value={live?.tao_in ? live.tao_in.toFixed(0) + " TAO" : "---"} />
              <InfoRow label="Alpha in Pool" value={live?.alpha_in ? live.alpha_in.toFixed(0) + " a" : "---"} />
              <InfoRow label="Alpha Staked" value={live?.alpha_out ? live.alpha_out.toFixed(0) + " a" : "---"} />
              <InfoRow
                label="Volume"
                value={live?.subnet_volume ? live.subnet_volume.toFixed(0) + " a" : "---"}
              />
              <InfoRow label="Moving Price" value={movPrice.toFixed(6) + " TAO"} />
            </div>
          </div>

          {/* Liquidity */}
          <div className="bg-surface border border-border animate-[fadeUp_0.4s_ease_both]">
            <div className="px-3.5 py-[9px] border-b border-border font-mono text-[9px] tracking-[0.15em] uppercase text-cyan">
              Liquidity
            </div>
            <div className="px-3.5 py-2.5">
              <InfoRow
                label="Tier"
                valueHtml={
                  <span
                    className={`inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.06em] uppercase px-1.5 py-0.5 border font-medium whitespace-nowrap ${liqClass}`}
                  >
                    <span className="w-1 h-1 rounded-full bg-current shrink-0" />
                    {liqTier}
                  </span>
                }
              />
              <InfoRow
                label="TAO Reserve"
                value={
                  taoPool
                    ? taoPool.toLocaleString(undefined, { maximumFractionDigits: 0 }) + " TAO"
                    : "---"
                }
              />
              <InfoRow
                label="Alpha Reserve"
                value={
                  alphaPool
                    ? alphaPool.toLocaleString(undefined, { maximumFractionDigits: 0 }) + " a"
                    : "---"
                }
              />
              <InfoRow label="Max @1% slip" value={liqMax1 ? liqMax1.toFixed(0) + " TAO" : "---"} />
              <InfoRow label="Max @2% slip" value={liqMax2 ? liqMax2.toFixed(0) + " TAO" : "---"} />
            </div>
          </div>

          {/* Subnet Info */}
          <div className="bg-surface border border-border animate-[fadeUp_0.4s_ease_both]">
            <div className="px-3.5 py-[9px] border-b border-border font-mono text-[9px] tracking-[0.15em] uppercase text-muted">
              Subnet Info
            </div>
            <div className="px-3.5 py-2.5">
              <InfoRow label="Netuid" value={`SN${NETUID}`} />
              <InfoRow label="Symbol" value={symbol || "---"} />
              <InfoRow
                label="GitHub"
                valueHtml={
                  live?.github ? (
                    <a
                      href={live.github}
                      className="text-cyan text-[10px] no-underline hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View repo
                    </a>
                  ) : (
                    "---"
                  )
                }
              />
              <InfoRow
                label="Website"
                valueHtml={
                  live?.url ? (
                    <a
                      href={`https://${live.url}`}
                      className="text-cyan text-[10px] no-underline hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {live.url}
                    </a>
                  ) : (
                    "---"
                  )
                }
              />
              <InfoRow label="Age" value={ageDays ? ageDays + " days post-dTAO" : "---"} />
              <InfoRow label="Block" value={block ? block.toLocaleString() : "---"} />
            </div>
          </div>
        </div>
      </div>

      {/* ── POSITION SIZING CALCULATOR ──────────────────────── */}
      <div className="px-6 pb-[18px] animate-[fadeUp_0.4s_ease_both]">
        <div className="bg-surface border border-border px-6 py-5">
          <div className="flex items-center gap-3 mb-4">
            <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-cyan font-medium">
              Position Sizing Calculator
            </span>
            <div className="flex-1 h-px bg-border" />
            <span className="font-mono text-[9px] tracking-[0.1em] px-2 py-[3px] border border-cyan text-cyan uppercase">
              AMM Cost Model
            </span>
          </div>

          <div className="flex items-center gap-4 mb-[18px] flex-wrap">
            <div className="flex items-center gap-2">
              <label className="font-mono text-[10px] text-muted uppercase tracking-[0.1em]">
                Position Size
              </label>
              <input
                type="number"
                value={positionSize}
                min={1}
                step={10}
                onChange={(e) => setPositionSize(parseFloat(e.target.value) || 0)}
                className="font-mono text-[13px] bg-surface2 border border-border2 text-text px-3 py-1.5 w-[120px] text-right"
              />
              <span className="font-mono text-[11px] text-muted">TAO</span>
            </div>
            <div className="flex gap-1">
              {[10, 50, 100, 500, 1000, 5000, 10000].map((v) => (
                <button
                  key={v}
                  className={`font-mono text-[9px] tracking-[0.06em] uppercase bg-transparent border px-[7px] py-[3px] cursor-pointer transition-all ${
                    positionSize === v
                      ? "border-cyan text-cyan bg-cyan/[0.08]"
                      : "border-border2 text-muted hover:border-text hover:text-text"
                  }`}
                  onClick={() => setPositionSize(v)}
                >
                  {v >= 1000 ? v / 1000 + "K" : v}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-5 gap-px bg-border border border-border">
            <div className="bg-surface px-4 py-3.5 text-center">
              <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1.5">
                Entry Slippage
              </div>
              <div
                className={`font-mono text-[22px] font-semibold ${
                  posCalc ? slipColor(posCalc.entrySlip) : "text-yellow"
                }`}
              >
                {posCalc ? (posCalc.entrySlip * 100).toFixed(2) + "%" : "---"}
              </div>
            </div>
            <div className="bg-surface px-4 py-3.5 text-center">
              <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1.5">
                Round-Trip Cost
              </div>
              <div className="font-mono text-[22px] font-semibold text-orange">
                {posCalc ? (posCalc.rtCost * 100).toFixed(2) + "%" : "---"}
              </div>
            </div>
            <div className="bg-surface px-4 py-3.5 text-center">
              <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1.5">
                Cost in TAO
              </div>
              <div className="font-mono text-[22px] font-semibold text-red">
                {posCalc ? posCalc.costTao.toFixed(1) + "t" : "---"}
              </div>
            </div>
            <div className="bg-surface px-4 py-3.5 text-center">
              <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1.5">
                Daily Yield
              </div>
              <div className="font-mono text-[22px] font-semibold text-green">
                {posCalc && posCalc.dailyYield > 0
                  ? (posCalc.dailyYield * 100).toFixed(4) + "%"
                  : "N/A"}
              </div>
            </div>
            <div className="bg-surface px-4 py-3.5 text-center">
              <div className="font-mono text-[8px] tracking-[0.15em] uppercase text-muted mb-1.5">
                Break-Even
              </div>
              <div className="font-mono text-[22px] font-semibold text-cyan">
                {posCalc?.breakEven ? Math.ceil(posCalc.breakEven) + "d" : "N/A"}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-3.5">
            <div className="font-mono text-[9px] text-muted leading-relaxed">
              <span className="text-text">Max position @1% slip:</span>{" "}
              <span className="text-green">{posCalc ? posCalc.max1.toFixed(0) : "---"}</span> TAO
            </div>
            <div className="font-mono text-[9px] text-muted leading-relaxed">
              <span className="text-text">Max position @2% slip:</span>{" "}
              <span className="text-yellow">{posCalc ? posCalc.max2.toFixed(0) : "---"}</span> TAO
            </div>
            <div className="font-mono text-[9px] text-muted leading-relaxed">
              <span className="text-text">Max position @5% slip:</span>{" "}
              <span className="text-orange">{posCalc ? posCalc.max5.toFixed(0) : "---"}</span> TAO
            </div>
          </div>

          <div className="mt-3 font-mono text-[9px] text-dim border-t border-border pt-2.5">
            Constant-product AMM model. Includes 0.05% swap fee per transaction. Break-even assumes
            current emission rate and pool depth remain stable. Actual costs may vary.
          </div>
        </div>
      </div>

      {/* ── DISCLAIMER ──────────────────────────────────────── */}
      <div className="border-t border-border px-6 py-4 bg-surface font-mono text-[10px] text-muted leading-relaxed">
        <strong className="text-text">DISCLAIMER:</strong> TAO Signal provides quantitative data
        analysis tools for informational and educational purposes only. Nothing on this platform
        constitutes financial advice, investment advice, trading advice, or any other form of advice.
        TAO Signal does not recommend that any asset should be bought, sold, or held. Past performance
        of signals in backtesting or live tracking is not indicative of future results. Cryptocurrency
        markets are highly volatile and involve significant risk, including potential loss of capital.
        Always conduct your own research and consult a qualified financial advisor before making any
        investment decisions.
      </div>
    </div>
  );
}
