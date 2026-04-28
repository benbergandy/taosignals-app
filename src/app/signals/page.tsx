"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import SubnetLogo from "@/components/SubnetLogo";

/* ── Types (v2.1 model) ────────────────────────────────────── */
interface SubnetScore {
  netuid: number;
  name: string;
  combined_score: number;
  stability_score: number;
  yield_score: number;
  consensus_score: number;
  capital_flow_score: number;     // v2.1: replaces flow_score
  conviction_score: number;
  emission_vs_network: number;
  rank_consistency: number;
  avg_dividends: number;
  weight_concentration_trend: number;
  // v2.1 Capital Flow Momentum signals (replace emission_velocity)
  validator_total_stake_velocity_7d: number;
  alpha_out_velocity_7d: number;
  alpha_out_in_ratio: number;
  volume_velocity_7d: number;
  inflow_momentum: number;
  avg_validator_trust: number;
  n_active_delta: number;
  emission_share_pct: number;
  ema_tao_inflow: number;
  tao_in: number;
  price_vs_ema: number;
  alpha_ratio: number;
  price_vs_ema_signal?: string;
  flow_signal?: string;
  vs_network_signal?: string;
  [key: string]: unknown;
}

interface ChainData {
  subnets?: Array<{
    netuid: number;
    alpha_ratio?: number;
    ema_tao_inflow?: number;
    tao_in?: number;
  }>;
  total_emission_tao?: number;
  block?: number;
}

interface CombinedData {
  scores?: SubnetScore[];
  generated_at?: string;
}

/* ── Types (Core sleeve model) ─────────────────────────────── */
interface CoreSleevePick {
  netuid: number;
  name: string;
  score: number;            // weighted-sum z-scored core combined score
  rank: number;             // 1-indexed within scored universe
  tao_in?: number | null;
  moving_price?: number | null;
  emission_share_pct?: number | null;
}

interface SleeveOutputsData {
  date?: string;
  generated_at?: string;
  filter_universe_size?: number;
  sleeves?: {
    core?: {
      model?: string;
      universe_filter?: string;
      scored_universe_size?: number;
      n_picks_held?: number;
      exit_rules?: Record<string, unknown>;
      picks?: CoreSleevePick[];
      full_score_table?: CoreSleevePick[];
    };
    satellite?: {
      picks?: CoreSleevePick[];
      full_score_table?: CoreSleevePick[];
    };
    root?: Record<string, unknown>;
  };
}

type AlphaModel = "satellite" | "core";
type ViewMode = "combined" | "stability" | "yield" | "consensus";
type FilterMode = "all" | "strong" | "stability" | "yield" | "consensus" | "oversold";

interface SortState {
  field: string;
  dir: -1 | 1;
}

/* ── Helpers ───────────────────────────────────────────────── */
function scoreColor(s: number): string {
  return s >= 65 ? "var(--color-green)" : s >= 45 ? "var(--color-yellow)" : "var(--color-red)";
}
function scoreColorClass(s: number): string {
  return s >= 65 ? "text-green" : s >= 45 ? "text-yellow" : "text-red";
}
function barColorClass(s: number): string {
  return s >= 65 ? "bg-green" : s >= 45 ? "bg-yellow" : "bg-red";
}

function fmtSignal(val: number | null | undefined): string {
  if (val === null || val === undefined) return "\u2014";
  return (val * 100).toFixed(0);
}

/* Liquidity tier — must match the Subnets page (page.tsx) exactly so the
   badge looks identical across surfaces. */
function liquidityTier(taoIn: number): { label: string; color: string } {
  if (taoIn >= 50000) return { label: "DEEP", color: "text-green border-green bg-green/10" };
  if (taoIn >= 10000) return { label: "ADEQUATE", color: "text-cyan border-cyan bg-cyan/10" };
  if (taoIn >= 1000)  return { label: "THIN", color: "text-yellow border-yellow bg-yellow/10" };
  if (taoIn >= 100)   return { label: "VERY THIN", color: "text-orange border-orange bg-orange/10" };
  return { label: "ILLIQUID", color: "text-red border-red bg-red/10" };
}

function LiquidityBadge({ taoIn }: { taoIn: number }) {
  const tier = liquidityTier(taoIn);
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.06em] uppercase px-1.5 py-0.5 border ${tier.color}`}>
      <span className="w-1 h-1 rounded-full bg-current" />
      {tier.label}
    </span>
  );
}

function fmtInflow(val: number | null | undefined): string {
  if (val === null || val === undefined) return "\u2014";
  const sign = val >= 0 ? "+" : "";
  if (Math.abs(val) >= 1) return `${sign}${val.toFixed(2)}`;
  if (Math.abs(val) >= 0.001) return `${sign}${val.toFixed(4)}`;
  return `${sign}${val.toFixed(6)}`;
}

function badgeColorClasses(signal: string | undefined): string {
  if (!signal) return "text-muted border-border2 bg-transparent";
  const s = signal.toLowerCase();
  if (
    ["strong", "dominant", "collapsing", "active", "very_stable", "highly_persistent",
      "well_below", "below", "deeply_oversold", "accelerating", "accumulating",
      "turning", "very_consistent"].some((v) => s.includes(v))
  ) return "text-green border-green bg-green/[0.08]";
  if (
    ["moderate", "declining", "inflow", "falling", "growing", "recovering",
      "increasing", "persistent", "consistent", "stable"].some((v) => s.includes(v))
  ) return "text-cyan border-cyan bg-cyan/[0.08]";
  if (
    ["slowing", "low", "above", "rising", "holding", "sporadic",
      "young", "quiet"].some((v) => s.includes(v))
  ) return "text-yellow border-yellow bg-yellow/[0.08]";
  if (
    ["weak", "zero", "none", "heavy_outflow", "well_above", "far_above",
      "worsening", "exiting", "deteriorating", "absent", "inconsistent",
      "decelerating"].some((v) => s.includes(v))
  ) return "text-red border-red bg-red/[0.08]";
  if (
    ["bleeding", "minimal_emission", "zero_emission", "volatile"].some((v) => s.includes(v))
  ) return "text-orange border-orange bg-orange/[0.08]";
  if (
    ["surging"].some((v) => s.includes(v))
  ) return "text-purple border-purple bg-purple/[0.08]";
  return "text-muted border-border2 bg-transparent";
}

/* ── Score Display Component ───────────────────────────────── */
function ScoreDisplay({ score, isMomentum = false }: { score: number; isMomentum?: boolean }) {
  const pct = Math.min((score / 100) * 100, 100);
  const color = isMomentum ? "var(--color-purple)" : scoreColor(score);
  return (
    <div className="flex items-center gap-[7px]">
      <div className="w-10 h-[3px] relative overflow-hidden shrink-0" style={{ background: "var(--color-dim)" }}>
        <div className="absolute left-0 top-0 bottom-0" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-mono text-xs font-semibold min-w-[32px]" style={{ color }}>
        {score.toFixed(1)}
      </span>
    </div>
  );
}

/* ── Badge Component ───────────────────────────────────────── */
function Badge({ signal }: { signal: string | undefined }) {
  if (!signal || signal === "UNKNOWN") {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.06em] uppercase px-[7px] py-[3px] border font-medium whitespace-nowrap text-muted border-border2 bg-transparent">
        {"\u2014"}
      </span>
    );
  }
  const cls = badgeColorClasses(signal);
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.06em] uppercase px-[7px] py-[3px] border font-medium whitespace-nowrap ${cls}`}>
      <span className="w-1 h-1 rounded-full bg-current shrink-0" />
      {signal}
    </span>
  );
}

/* ── Sortable TH Component ─────────────────────────────────── */
function SortTh({
  label, field, sortState, onSort, variant,
}: {
  label: string;
  field: string;
  sortState: SortState;
  onSort: (field: string) => void;
  variant?: "chain" | "momentum";
}) {
  const sorted = sortState.field === field;
  const arrow = sorted ? (sortState.dir === -1 ? " \u2193" : " \u2191") : "";
  let colorCls = "text-muted hover:text-text";
  if (variant === "chain") colorCls = "text-green/60 hover:text-green";
  if (variant === "momentum") colorCls = "text-purple/70 hover:text-purple";
  if (sorted) {
    if (variant === "chain") colorCls = "text-green";
    else if (variant === "momentum") colorCls = "text-purple";
    else colorCls = "text-cyan";
  }
  return (
    <th
      className={`font-mono text-[9px] tracking-[0.12em] uppercase px-3 py-2.5 text-left font-normal whitespace-nowrap cursor-pointer select-none transition-colors ${colorCls}`}
      onClick={() => onSort(field)}
    >
      {label}{arrow}
    </th>
  );
}

const thBase = "font-mono text-[9px] tracking-[0.12em] uppercase text-muted px-3 py-2.5 text-left font-normal whitespace-nowrap";

/* ── Main Page Component ───────────────────────────────────── */
export default function SignalsPage() {
  const [allScores, setAllScores] = useState<SubnetScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string>("\u2014");
  const [chainBlock, setChainBlock] = useState<string>("\u2014");
  const [chainEmission, setChainEmission] = useState<string>("\u2014");

  const [currentModel, setCurrentModel] = useState<AlphaModel>("satellite");
  const [currentView, setCurrentView] = useState<ViewMode>("combined");
  const [currentFilter, setCurrentFilter] = useState<FilterMode>("all");
  const [sortStates, setSortStates] = useState<Record<ViewMode, SortState>>({
    combined: { field: "combined_score", dir: -1 },
    stability: { field: "stability_score", dir: -1 },
    yield: { field: "yield_score", dir: -1 },
    consensus: { field: "consensus_score", dir: -1 },
  });
  // Core sleeve state — separate from v2.1 satellite scores
  const [corePicks, setCorePicks] = useState<CoreSleevePick[]>([]);
  const [coreSortDir, setCoreSortDir] = useState<-1 | 1>(-1);
  const [coreModelMeta, setCoreModelMeta] = useState<{ scoredUniverse: number; date?: string }>({ scoredUniverse: 0 });

  /* ── Data Load ─────────────────────────────────────────── */
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [combinedRes, chainRes, sleeveRes] = await Promise.all([
        fetch(`/data/combined_scores.json?t=${Date.now()}`),
        fetch(`/data/chain_data.json?t=${Date.now()}`),
        fetch(`/data/sleeve_outputs.json?t=${Date.now()}`),
      ]);
      if (!combinedRes.ok) throw new Error("Could not load data");

      const combined: CombinedData = await combinedRes.json();
      const chain: ChainData | null = chainRes.ok ? await chainRes.json() : null;
      const sleeve: SleeveOutputsData | null = sleeveRes.ok ? await sleeveRes.json() : null;

      // Load core sleeve picks (full ranked table — not just top 10) so users
      // can browse the full universe scored by the core model
      if (sleeve?.sleeves?.core?.full_score_table) {
        setCorePicks(sleeve.sleeves.core.full_score_table);
        setCoreModelMeta({
          scoredUniverse: sleeve.sleeves.core.scored_universe_size || 0,
          date: sleeve.date,
        });
      } else {
        setCorePicks([]);
      }

      const chainMap: Record<number, ChainData["subnets"] extends (infer U)[] | undefined ? U : never> = {};
      if (chain?.subnets) {
        chain.subnets.forEach((s) => { chainMap[s.netuid] = s; });
      }

      const scores: SubnetScore[] = (combined.scores || []).map((s) => ({
        ...s,
        alpha_ratio: s.alpha_ratio ?? chainMap[s.netuid]?.alpha_ratio ?? 0,
        ema_tao_inflow: s.ema_tao_inflow ?? chainMap[s.netuid]?.ema_tao_inflow ?? 0,
        tao_in: s.tao_in ?? chainMap[s.netuid]?.tao_in ?? 0,
      }));

      scores.sort((a, b) => b.combined_score - a.combined_score);
      setAllScores(scores);
      setUpdatedAt(combined.generated_at || "\u2014");

      if (chain) {
        setChainEmission(chain.total_emission_tao?.toFixed(4) || "\u2014");
        setChainBlock(chain.block?.toLocaleString() || "\u2014");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── Stats ─────────────────────────────────────────────── */
  const stats = useMemo(() => {
    if (!allScores.length) return null;
    const positiveInflow = allScores.filter((s) => (s.ema_tao_inflow || 0) > 0).length;
    const topC = allScores[0];
    const topS = [...allScores].sort((a, b) => b.stability_score - a.stability_score)[0];
    const topY = [...allScores].sort((a, b) => b.yield_score - a.yield_score)[0];
    const topCon = [...allScores].sort((a, b) => b.consensus_score - a.consensus_score)[0];
    return { total: allScores.length, positiveInflow, topC, topS, topY, topCon };
  }, [allScores]);

  /* ── Filter + Sort ─────────────────────────────────────── */
  const filteredSorted = useMemo(() => {
    let scores = [...allScores];

    // filter
    switch (currentFilter) {
      case "strong": scores = scores.filter((s) => (s.ema_tao_inflow || 0) > 0); break;
      case "stability": scores = scores.filter((s) => s.stability_score >= 65); break;
      case "yield": scores = scores.filter((s) => s.yield_score >= 60); break;
      case "consensus": scores = scores.filter((s) => s.consensus_score >= 65); break;
      case "oversold": scores = scores.filter((s) => ["COLLAPSING", "FALLING", "DEEPLY_OVERSOLD"].includes(s.price_vs_ema_signal || "")); break;
    }

    // sort
    const { field, dir } = sortStates[currentView];
    scores.sort((a, b) => {
      const av = (a[field] as number) ?? 0;
      const bv = (b[field] as number) ?? 0;
      return dir === -1 ? bv - av : av - bv;
    });

    return scores;
  }, [allScores, currentFilter, currentView, sortStates]);

  /* ── Sort Handler ──────────────────────────────────────── */
  const handleSort = useCallback((field: string) => {
    setSortStates((prev) => {
      const cur = prev[currentView];
      return {
        ...prev,
        [currentView]: {
          field,
          dir: cur.field === field ? (cur.dir * -1 as -1 | 1) : -1,
        },
      };
    });
  }, [currentView]);

  const ss = sortStates[currentView];

  /* ── View toggle buttons ───────────────────────────────── */
  const viewButtons: { key: ViewMode; label: string; activeClass: string }[] = [
    { key: "combined", label: "Combined", activeClass: "text-cyan bg-cyan/[0.08]" },
    { key: "stability", label: "Stability", activeClass: "text-green bg-green/[0.08]" },
    { key: "yield", label: "Yield", activeClass: "text-yellow bg-yellow/[0.08]" },
    { key: "consensus", label: "Consensus", activeClass: "text-purple bg-purple/[0.08]" },
  ];

  const filterButtons: { key: FilterMode; label: string }[] = [
    { key: "all", label: "All" },
    { key: "strong", label: "Positive Inflow" },
    { key: "stability", label: "High Stability (>65)" },
    { key: "yield", label: "High Yield (>60)" },
    { key: "consensus", label: "High Consensus (>65)" },
    { key: "oversold", label: "Price Below EMA" },
  ];

  /* ── Table Renderers ───────────────────────────────────── */
  const renderCombinedRow = (s: SubnetScore, i: number) => (
    <tr key={s.netuid} className="border-b border-border/80 hover:bg-cyan/[0.03] transition-colors">
      <td className="font-mono text-[11px] text-muted px-3 py-2.5 w-8">{i + 1}</td>
      <td className="font-mono text-[10px] text-muted px-3 py-2.5 w-10">{s.netuid}</td>
      <td className="font-semibold text-[13px] text-text px-3 py-2.5 min-w-[140px]">
        <Link href={`/subnet/${s.netuid}`} className="inline-flex items-center gap-2 text-inherit no-underline">
          <SubnetLogo netuid={s.netuid} size={18} />
          <span className="border-b border-border2 hover:border-cyan">{s.name}</span>
        </Link>
      </td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.combined_score} /></td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.stability_score} /></td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.yield_score} /></td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.consensus_score} isMomentum /></td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.capital_flow_score} /></td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.conviction_score} /></td>
      <td className={`font-mono text-[11px] px-3 py-2.5 ${(s.price_vs_ema || 1) >= 1 ? "text-green" : "text-red"}`}>
        {(s.price_vs_ema || 0).toFixed(3)}
      </td>
      <td className={`font-mono text-[11px] px-3 py-2.5 ${(s.ema_tao_inflow || 0) >= 0 ? "text-green" : "text-red"}`}>
        {fmtInflow(s.ema_tao_inflow)} {"\u03C4"}
      </td>
      <td className="font-mono text-[11px] text-cyan px-3 py-2.5">{(s.emission_share_pct || 0).toFixed(2)}%</td>
      <td className="px-3 py-2.5"><LiquidityBadge taoIn={s.tao_in || 0} /></td>
    </tr>
  );

  const renderStabilityRow = (s: SubnetScore, i: number) => (
    <tr key={s.netuid} className="border-b border-border/80 hover:bg-cyan/[0.03] transition-colors">
      <td className="font-mono text-[11px] text-muted px-3 py-2.5 w-8">{i + 1}</td>
      <td className="font-mono text-[10px] text-muted px-3 py-2.5 w-10">{s.netuid}</td>
      <td className="font-semibold text-[13px] text-text px-3 py-2.5 min-w-[140px]">
        <Link href={`/subnet/${s.netuid}`} className="inline-flex items-center gap-2 text-inherit no-underline">
          <SubnetLogo netuid={s.netuid} size={18} />
          <span className="border-b border-border2 hover:border-cyan">{s.name}</span>
        </Link>
      </td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.stability_score} /></td>
      <td className="font-mono text-[11px] px-3 py-2.5">{fmtSignal(s.emission_vs_network)}</td>
      <td className="font-mono text-[11px] px-3 py-2.5">{fmtSignal(s.rank_consistency)}</td>
      <td className="font-mono text-[11px] text-cyan px-3 py-2.5">{(s.emission_share_pct || 0).toFixed(2)}%</td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.combined_score} /></td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.yield_score} /></td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.consensus_score} isMomentum /></td>
      <td className="px-3 py-2.5"><LiquidityBadge taoIn={s.tao_in || 0} /></td>
    </tr>
  );

  const renderYieldRow = (s: SubnetScore, i: number) => (
    <tr key={s.netuid} className="border-b border-border/80 hover:bg-cyan/[0.03] transition-colors">
      <td className="font-mono text-[11px] text-muted px-3 py-2.5 w-8">{i + 1}</td>
      <td className="font-mono text-[10px] text-muted px-3 py-2.5 w-10">{s.netuid}</td>
      <td className="font-semibold text-[13px] text-text px-3 py-2.5 min-w-[140px]">
        <Link href={`/subnet/${s.netuid}`} className="inline-flex items-center gap-2 text-inherit no-underline">
          <SubnetLogo netuid={s.netuid} size={18} />
          <span className="border-b border-border2 hover:border-cyan">{s.name}</span>
        </Link>
      </td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.yield_score} /></td>
      <td className="font-mono text-[11px] px-3 py-2.5">{fmtSignal(s.avg_dividends)}</td>
      <td className={`font-mono text-[11px] px-3 py-2.5 ${(s.ema_tao_inflow || 0) >= 0 ? "text-green" : "text-red"}`}>
        {fmtInflow(s.ema_tao_inflow)} {"\u03C4"}
      </td>
      <td className="font-mono text-[11px] text-cyan px-3 py-2.5">{(s.tao_in || 0).toFixed(0)} {"\u03C4"}</td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.combined_score} /></td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.stability_score} /></td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.consensus_score} isMomentum /></td>
      <td className="px-3 py-2.5"><LiquidityBadge taoIn={s.tao_in || 0} /></td>
    </tr>
  );

  const renderConsensusRow = (s: SubnetScore, i: number) => (
    <tr key={s.netuid} className="border-b border-border/80 hover:bg-cyan/[0.03] transition-colors">
      <td className="font-mono text-[11px] text-muted px-3 py-2.5 w-8">{i + 1}</td>
      <td className="font-mono text-[10px] text-muted px-3 py-2.5 w-10">{s.netuid}</td>
      <td className="font-semibold text-[13px] text-text px-3 py-2.5 min-w-[140px]">
        <Link href={`/subnet/${s.netuid}`} className="inline-flex items-center gap-2 text-inherit no-underline">
          <SubnetLogo netuid={s.netuid} size={18} />
          <span className="border-b border-border2 hover:border-cyan">{s.name}</span>
        </Link>
      </td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.consensus_score} isMomentum /></td>
      <td className="font-mono text-[11px] px-3 py-2.5">{fmtSignal(s.weight_concentration_trend)}</td>
      <td className={`font-mono text-[11px] px-3 py-2.5 ${(s.ema_tao_inflow || 0) >= 0 ? "text-green" : "text-red"}`}>
        {fmtInflow(s.ema_tao_inflow)} {"\u03C4"}
      </td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.combined_score} /></td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.stability_score} /></td>
      <td className="px-3 py-2.5"><ScoreDisplay score={s.yield_score} /></td>
      <td className="px-3 py-2.5"><LiquidityBadge taoIn={s.tao_in || 0} /></td>
    </tr>
  );

  /* ── Table Headers per View ────────────────────────────── */
  const renderHeaders = () => {
    const ns = <th key="ns-hash" className={thBase}>#</th>;
    const sn = <th key="ns-sn" className={thBase}>SN</th>;
    const nm = <th key="ns-name" className={thBase}>Name</th>;
    const base = [ns, sn, nm];

    switch (currentView) {
      case "combined":
        return (
          <tr className="bg-surface2 border-b border-border2">
            {base}
            <SortTh label="Combined" field="combined_score" sortState={ss} onSort={handleSort} />
            <SortTh label="Stability" field="stability_score" sortState={ss} onSort={handleSort} />
            <SortTh label="Yield" field="yield_score" sortState={ss} onSort={handleSort} />
            <SortTh label="Consensus" field="consensus_score" sortState={ss} onSort={handleSort} variant="momentum" />
            <SortTh label="Cap. Flow" field="capital_flow_score" sortState={ss} onSort={handleSort} />
            <SortTh label="Conviction" field="conviction_score" sortState={ss} onSort={handleSort} />
            <SortTh label="Price/EMA" field="price_vs_ema" sortState={ss} onSort={handleSort} />
            <SortTh label={"\u26D3 EMA Inflow"} field="ema_tao_inflow" sortState={ss} onSort={handleSort} variant="chain" />
            <SortTh label={"\u26D3 Em. Share"} field="emission_share_pct" sortState={ss} onSort={handleSort} variant="chain" />
            <SortTh label="Liquidity" field="tao_in" sortState={ss} onSort={handleSort} variant="chain" />
          </tr>
        );
      case "stability":
        return (
          <tr className="bg-surface2 border-b border-border2">
            {base}
            <SortTh label="Stability" field="stability_score" sortState={ss} onSort={handleSort} />
            <SortTh label="Em vs Network" field="emission_vs_network" sortState={ss} onSort={handleSort} />
            <SortTh label="Rank Consistency" field="rank_consistency" sortState={ss} onSort={handleSort} />
            <SortTh label={"\u26D3 Em. Share"} field="emission_share_pct" sortState={ss} onSort={handleSort} variant="chain" />
            <SortTh label="Combined" field="combined_score" sortState={ss} onSort={handleSort} />
            <SortTh label="Yield" field="yield_score" sortState={ss} onSort={handleSort} />
            <SortTh label="Consensus" field="consensus_score" sortState={ss} onSort={handleSort} variant="momentum" />
            <SortTh label="Liquidity" field="tao_in" sortState={ss} onSort={handleSort} variant="chain" />
          </tr>
        );
      case "yield":
        return (
          <tr className="bg-surface2 border-b border-border2">
            {base}
            <SortTh label="Yield" field="yield_score" sortState={ss} onSort={handleSort} />
            <SortTh label="Avg Dividends" field="avg_dividends" sortState={ss} onSort={handleSort} />
            <SortTh label={"\u26D3 EMA Inflow"} field="ema_tao_inflow" sortState={ss} onSort={handleSort} variant="chain" />
            <SortTh label={"\u26D3 TAO in Pool"} field="tao_in" sortState={ss} onSort={handleSort} variant="chain" />
            <SortTh label="Combined" field="combined_score" sortState={ss} onSort={handleSort} />
            <SortTh label="Stability" field="stability_score" sortState={ss} onSort={handleSort} />
            <SortTh label="Consensus" field="consensus_score" sortState={ss} onSort={handleSort} variant="momentum" />
            <SortTh label="Liquidity" field="tao_in" sortState={ss} onSort={handleSort} variant="chain" />
          </tr>
        );
      case "consensus":
        return (
          <tr className="bg-surface2 border-b border-border2">
            {base}
            <SortTh label="Consensus" field="consensus_score" sortState={ss} onSort={handleSort} variant="momentum" />
            <SortTh label="Wt Conc Trend" field="weight_concentration_trend" sortState={ss} onSort={handleSort} />
            <SortTh label={"\u26D3 EMA Inflow"} field="ema_tao_inflow" sortState={ss} onSort={handleSort} variant="chain" />
            <SortTh label="Combined" field="combined_score" sortState={ss} onSort={handleSort} />
            <SortTh label="Stability" field="stability_score" sortState={ss} onSort={handleSort} />
            <SortTh label="Yield" field="yield_score" sortState={ss} onSort={handleSort} />
            <SortTh label="Liquidity" field="tao_in" sortState={ss} onSort={handleSort} variant="chain" />
          </tr>
        );
    }
  };

  const renderRow = (s: SubnetScore, i: number) => {
    switch (currentView) {
      case "combined": return renderCombinedRow(s, i);
      case "stability": return renderStabilityRow(s, i);
      case "yield": return renderYieldRow(s, i);
      case "consensus": return renderConsensusRow(s, i);
    }
  };

  /* ── Render ────────────────────────────────────────────── */
  return (
    <div>
      {/* ── Stats Row ──────────────────────────────────────── */}
      <div className="grid grid-cols-8 border-b border-border bg-surface">
        <div className="px-4 py-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-[5px]">Subnets Scored</div>
          <div className="font-mono text-xl font-semibold tracking-tight leading-none text-cyan">{stats?.total ?? "\u2014"}</div>
          <div className="font-mono text-[10px] text-muted mt-[3px]">128 total network</div>
        </div>
        <div className="px-4 py-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-[5px]">Positive Inflow</div>
          <div className="font-mono text-xl font-semibold tracking-tight leading-none text-green">{stats?.positiveInflow ?? "\u2014"}</div>
          <div className="font-mono text-[10px] text-muted mt-[3px]">net capital inflow</div>
        </div>
        <div className="px-4 py-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-[5px]">Top Combined</div>
          <div className="font-mono text-[16px] font-semibold tracking-tight leading-none text-cyan">{stats?.topC?.combined_score?.toFixed(1) ?? "\u2014"}</div>
          <div className="font-mono text-[10px] text-muted mt-[3px]">{stats?.topC ? `SN${stats.topC.netuid} ${stats.topC.name}` : "\u2014"}</div>
        </div>
        <div className="px-4 py-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-[5px]">Top Stability</div>
          <div className="font-mono text-[16px] font-semibold tracking-tight leading-none text-green">{stats?.topS?.stability_score?.toFixed(1) ?? "\u2014"}</div>
          <div className="font-mono text-[10px] text-muted mt-[3px]">{stats?.topS ? `SN${stats.topS.netuid} ${stats.topS.name}` : "\u2014"}</div>
        </div>
        <div className="px-4 py-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-[5px]">Top Yield</div>
          <div className="font-mono text-[16px] font-semibold tracking-tight leading-none text-yellow">{stats?.topY?.yield_score?.toFixed(1) ?? "\u2014"}</div>
          <div className="font-mono text-[10px] text-muted mt-[3px]">{stats?.topY ? `SN${stats.topY.netuid} ${stats.topY.name}` : "\u2014"}</div>
        </div>
        <div className="px-4 py-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-[5px]">Top Consensus</div>
          <div className="font-mono text-[16px] font-semibold tracking-tight leading-none text-purple">{stats?.topCon?.consensus_score?.toFixed(1) ?? "\u2014"}</div>
          <div className="font-mono text-[10px] text-muted mt-[3px]">{stats?.topCon ? `SN${stats.topCon.netuid} ${stats.topCon.name}` : "\u2014"}</div>
        </div>
        <div className="px-4 py-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-[5px]">Network Emission</div>
          <div className="font-mono text-[16px] font-semibold tracking-tight leading-none text-yellow">{chainEmission}</div>
          <div className="font-mono text-[10px] text-muted mt-[3px]">TAO/block</div>
        </div>
        <div className="px-4 py-3">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-[5px]">Current Block</div>
          <div className="font-mono text-[14px] font-semibold tracking-tight leading-none text-purple">{chainBlock}</div>
          <div className="font-mono text-[10px] text-muted mt-[3px]">direct from chain {"\u26D3"}</div>
        </div>
      </div>

      {/* ── Main Content ───────────────────────────────────── */}
      <div className="p-5 flex flex-col gap-5">

        {/* Section Header */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-text font-medium whitespace-nowrap">
              {"\u26A1"} Subnet Leaderboard
            </div>
            <span className="font-mono text-[9px] tracking-[0.1em] uppercase px-2 py-[3px] border border-cyan text-cyan whitespace-nowrap">
              Five-Factor Model v2.0 {"\u00B7"} PCA-derived
            </span>
            <div className="flex-1 h-px bg-border" />
            <span className="font-mono text-[9px] tracking-[0.1em] uppercase px-2 py-[3px] border border-green text-green whitespace-nowrap">
              {"\u26D3"} Chain Native
            </span>
          </div>

          {/* Model Toggle (top-level: which alpha model are we showing?) */}
          <div className="mb-3 flex items-center gap-2.5 flex-wrap">
            <span className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted">Model:</span>
            <div className="flex items-center border border-border2 w-fit">
              {([
                { key: "satellite", label: "Satellite v2.1", activeClass: "text-cyan bg-cyan/[0.08]" },
                { key: "core", label: "Core (long-hold)", activeClass: "text-yellow bg-yellow/[0.08]" },
              ] as { key: AlphaModel; label: string; activeClass: string }[]).map((mb, idx) => (
                <button
                  key={mb.key}
                  onClick={() => setCurrentModel(mb.key)}
                  style={{ borderTop: 'none', borderBottom: 'none', borderLeft: 'none', borderRight: idx < 1 ? '1px solid var(--color-border2)' : 'none' }}
                  className={`font-mono text-[10px] tracking-[0.12em] uppercase bg-transparent px-[18px] py-[7px] cursor-pointer transition-all whitespace-nowrap ${
                    currentModel === mb.key
                      ? mb.activeClass
                      : "text-muted hover:text-text hover:bg-surface2"
                  }`}
                >
                  {mb.label}
                </button>
              ))}
            </div>
            {currentModel === "core" && (
              <span className="font-mono text-[9px] tracking-[0.1em] uppercase px-2 py-[3px] border border-border2 text-muted whitespace-nowrap">
                {coreModelMeta.scoredUniverse} subnets scored {coreModelMeta.date ? `· ${coreModelMeta.date}` : ""}
              </span>
            )}
          </div>

          {/* View Toggle (sub-views WITHIN the satellite model — only shown when satellite is selected) */}
          {currentModel === "satellite" && (
            <div className="mb-3">
              <div className="flex items-center border border-border2 w-fit">
                {viewButtons.map((vb, idx) => (
                  <button
                    key={vb.key}
                    onClick={() => setCurrentView(vb.key)}
                    style={{ borderTop: 'none', borderBottom: 'none', borderLeft: 'none', borderRight: idx < viewButtons.length - 1 ? '1px solid var(--color-border2)' : 'none' }}
                    className={`font-mono text-[10px] tracking-[0.12em] uppercase bg-transparent px-[18px] py-[7px] cursor-pointer transition-all whitespace-nowrap ${
                      currentView === vb.key
                        ? vb.activeClass
                        : "text-muted hover:text-text hover:bg-surface2"
                    }`}
                  >
                    {vb.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Filters + Refresh — filters apply to satellite (v2.1) only */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2.5">
            {currentModel === "satellite" ? (
              <div className="flex gap-1.5 flex-wrap items-center">
                <span className="font-mono text-[9px] tracking-[0.12em] uppercase text-muted">Filter:</span>
                {filterButtons.map((fb) => (
                  <button
                    key={fb.key}
                    onClick={() => setCurrentFilter(fb.key)}
                    className={`font-mono text-[9px] tracking-[0.08em] uppercase border px-[10px] py-1 cursor-pointer transition-all ${
                      currentFilter === fb.key
                        ? "border-cyan text-cyan"
                        : "border-border2 text-muted hover:border-cyan hover:text-cyan"
                    } bg-transparent`}
                  >
                    {fb.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="font-mono text-[10px] text-muted">
                Top 5 ranked = current core sleeve holdings.
                Universe filter: top 30 pct by tao_in. Equal-weighted z-score sum across 5 signals.
              </div>
            )}
            <button
              onClick={loadData}
              className="font-mono text-[10px] tracking-[0.08em] uppercase bg-transparent border border-border2 text-muted px-3 py-[5px] cursor-pointer transition-all hover:border-cyan hover:text-cyan"
            >
              {"\u21BB"} Refresh
            </button>
          </div>

          {/* Table — switches between Satellite and Core based on model */}
          <div className="border border-border overflow-x-auto bg-surface">
            {loading ? (
              <div className="font-mono text-xs text-muted text-center py-12">Loading...</div>
            ) : error ? (
              <div className="font-mono text-xs text-red text-center py-12">{"\u26A0"} {error}</div>
            ) : currentModel === "core" ? (
              corePicks.length === 0 ? (
                <div className="font-mono text-xs text-muted text-center py-12">
                  Core sleeve data not yet available.
                </div>
              ) : (
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-surface2 border-b border-border2">
                      <th className={thBase + " w-8"}>#</th>
                      <th className={thBase + " w-12"}>SN</th>
                      <th className={thBase + " min-w-[140px]"}>Name</th>
                      <th
                        className={thBase + " cursor-pointer select-none hover:text-text"}
                        onClick={() => setCoreSortDir((d) => (d * -1) as -1 | 1)}
                      >
                        Core Score {coreSortDir === -1 ? "\u2193" : "\u2191"}
                      </th>
                      <th className={thBase}>Liquidity</th>
                      <th className={thBase}>Pool Depth</th>
                      <th className={thBase}>Emission</th>
                      <th className={thBase}>Spot Price</th>
                      <th className={thBase}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...corePicks]
                      .sort((a, b) => coreSortDir === -1 ? b.score - a.score : a.score - b.score)
                      .map((p, i) => {
                        const isHeld = p.rank <= 5;  // top 5 = current core sleeve picks
                        return (
                          <tr key={p.netuid}
                              className={`border-b border-border/80 transition-colors ${
                                isHeld ? "bg-yellow/[0.04] hover:bg-yellow/[0.08]" : "hover:bg-cyan/[0.03]"
                              }`}>
                            <td className="font-mono text-[11px] text-muted px-3 py-2.5">{i + 1}</td>
                            <td className="font-mono text-[10px] text-muted px-3 py-2.5">{p.netuid}</td>
                            <td className="font-semibold text-[13px] text-text px-3 py-2.5">
                              <Link href={`/subnet/${p.netuid}`} className="inline-flex items-center gap-2 text-inherit no-underline">
                                <SubnetLogo netuid={p.netuid} size={18} />
                                <span className="border-b border-border2 hover:border-cyan">{p.name}</span>
                              </Link>
                            </td>
                            <td className={`font-mono text-[12px] font-semibold px-3 py-2.5 ${
                              p.score > 0 ? "text-yellow" : "text-muted"
                            }`}>
                              {p.score >= 0 ? "+" : ""}{p.score.toFixed(3)}
                            </td>
                            <td className="px-3 py-2.5"><LiquidityBadge taoIn={p.tao_in || 0} /></td>
                            <td className="font-mono text-[11px] text-cyan px-3 py-2.5">
                              {(p.tao_in || 0).toFixed(0)} {"\u03C4"}
                            </td>
                            <td className="font-mono text-[11px] px-3 py-2.5">
                              {(p.emission_share_pct || 0).toFixed(2)}%
                            </td>
                            <td className="font-mono text-[11px] text-muted px-3 py-2.5">
                              {p.moving_price ? p.moving_price.toFixed(6) : "\u2014"}
                            </td>
                            <td className="px-3 py-2.5">
                              {isHeld ? (
                                <span className="font-mono text-[9px] tracking-[0.1em] uppercase px-2 py-[3px] border border-yellow text-yellow whitespace-nowrap">
                                  HELD
                                </span>
                              ) : (
                                <span className="font-mono text-[9px] tracking-[0.1em] uppercase px-2 py-[3px] border border-border2 text-muted whitespace-nowrap">
                                  WATCHING
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )
            ) : filteredSorted.length === 0 ? (
              <div className="font-mono text-xs text-muted text-center py-12">No subnets match this filter</div>
            ) : (
              <table className="w-full border-collapse">
                <thead>{renderHeaders()}</thead>
                <tbody>{filteredSorted.map((s, i) => renderRow(s, i))}</tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Methodology ──────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-text font-medium whitespace-nowrap">
              {"\uD83D\uDCD0"} Signal Methodology
            </div>
            <div className="flex-1 h-px bg-border" />
            <span className="font-mono text-[9px] tracking-[0.1em] uppercase px-2 py-[3px] border border-green text-green whitespace-nowrap">
              Walk-forward validated {"\u00B7"} held-out test set
            </span>
          </div>

          <div className="border border-border bg-surface p-6 grid grid-cols-2 gap-8">
            {/* Left column: Five-Factor Model */}
            <div className="flex flex-col gap-5">
              <div>
                <div className="font-mono text-[9px] tracking-[0.15em] uppercase mb-2.5 pb-2 border-b border-border text-cyan">
                  Five-Factor Model v2.0
                </div>
                <div className="text-xs text-muted leading-[1.7]">
                  TAO Signal uses a <strong className="text-text">PCA-derived five-factor model</strong> built on on-chain
                  Bittensor data and metagraph validator signals, updated daily. No third-party APIs.
                </div>
                <div className="mt-3">
                  {[
                    { label: "Stability", color: "text-green" },
                    { label: "Yield", color: "text-yellow" },
                    { label: "Consensus", color: "text-purple" },
                    { label: "Flow", color: "text-cyan" },
                    { label: "Conviction", color: "text-orange" },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-b-0">
                      <span className="text-xs text-text">{item.label}</span>
                      <span className={`w-2.5 h-2.5 rounded-full ${item.color.replace("text-", "bg-")}`} />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right column: Validation */}
            <div className="flex flex-col gap-5">
              <div>
                <div className="font-mono text-[9px] tracking-[0.15em] uppercase mb-2.5 pb-2 border-b border-border text-cyan">
                  Validation
                </div>
                <div className="mt-1">
                  {[
                    { label: "Top 10% emission WR", value: "86.7%", color: "text-green" },
                    { label: "Top 10% price WR", value: "88.7%", color: "text-green" },
                    { label: "Top 10% avg price return", value: "+24.8%", color: "text-cyan" },
                    { label: "Methodology", value: "Walk-forward \u00B7 PCA \u00B7 no look-ahead", color: "text-muted" },
                    { label: "Live track record", value: null, color: "text-cyan", link: true },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-b-0">
                      <span className="text-xs text-text">{item.label}</span>
                      {item.link ? (
                        <Link href="/performance" className="font-mono text-[11px] text-cyan no-underline hover:underline">
                          {"\u2192"} Performance
                        </Link>
                      ) : (
                        <span className={`font-mono text-[11px] ${item.color}`}>{item.value}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Disclaimer ───────────────────────────────────── */}
        <div className="border-t border-border pt-5 bg-surface -mx-5 px-5 pb-5">
          <div className="font-mono text-[10px] text-muted leading-relaxed max-w-[1600px] mx-auto">
            <strong className="text-text">DISCLAIMER:</strong> TAO Signal provides quantitative data analysis tools for informational and educational purposes only. Nothing on this platform constitutes financial advice, investment advice, or any other form of advice. Past performance is not indicative of future results. Cryptocurrency markets are highly volatile and involve significant risk. Always conduct your own research and consult a qualified financial advisor before making investment decisions.
          </div>
        </div>
      </div>
    </div>
  );
}
