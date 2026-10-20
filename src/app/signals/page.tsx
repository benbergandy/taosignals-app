"use client";

// ── Signals — Composite v1 leaderboard ────────────────────────────────
// Primary surface for the CURRENT model: /data/composite_scores_v1.json
// (published daily at 12:00 UTC by the model pipeline). Until the first
// publication the page shows a "pending" state — it must NEVER present
// the legacy VSAT/core scores (combined_scores.json) as current: those
// were validated ANTI-predictive in the current protocol regime
// (Oct 2026) and are retained only in a collapsed reference section.

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import SubnetLogo from "@/components/SubnetLogo";
import {
  CompositeScoreRow,
  CompositeScoresFile,
  ingredientLabel,
  scaleFor,
  scoreBand,
  safeFetch,
} from "@/lib/composite";

/* ── Types ─────────────────────────────────────────────────── */
interface ChainSubnet {
  netuid: number;
  name?: string;
  tao_in?: number;
  alpha_price_tao?: number;
  emission_share_pct?: number;
}

interface ChainData {
  subnets?: ChainSubnet[];
  total_emission_tao?: number;
  block?: number;
}

// Legacy v2.1/VSAT scores — deprecated, reference section only
interface LegacyScore {
  netuid: number;
  name: string;
  combined_score: number;
  stability_score: number;
  yield_score: number;
  consensus_score: number;
  capital_flow_score: number;
  conviction_score: number;
  emission_share_pct: number;
  ema_tao_inflow: number;
  tao_in: number;
  price_vs_ema: number;
  [key: string]: unknown;
}

interface LegacyData {
  scores?: LegacyScore[];
  generated_at?: string;
}

/* ── Helpers ───────────────────────────────────────────────── */
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

// Thin percentile bar + value, colored by the shared 0-100 score bands
function PctBar({ value }: { value: number | null }) {
  if (value == null || !isFinite(value)) {
    return <span className="font-mono text-[11px] text-muted">—</span>;
  }
  const v = Math.max(0, Math.min(100, value));
  const band = scoreBand(v);
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`font-mono text-[11px] font-semibold w-6 text-right ${band.text}`}>{Math.round(v)}</span>
      <span className="inline-block w-12 h-1.5 bg-surface2 border border-border2 overflow-hidden align-middle">
        <span className={`block h-full ${band.bar}`} style={{ width: v + "%" }} />
      </span>
    </span>
  );
}

const thBase = "font-mono text-[9px] tracking-[0.12em] uppercase text-muted px-3 py-2.5 text-left font-normal whitespace-nowrap";

/* ── Main Page Component ───────────────────────────────────── */
export default function SignalsPage() {
  const [compositeFile, setCompositeFile] = useState<CompositeScoresFile | null>(null);
  const [chainData, setChainData] = useState<ChainData | null>(null);
  const [legacy, setLegacy] = useState<LegacyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<string>("score");
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [legacySort, setLegacySort] = useState<{ field: string; dir: -1 | 1 }>({ field: "combined_score", dir: -1 });

  /* ── Data Load ─────────────────────────────────────────── */
  // Note: no synchronous setLoading(true) here — `loading` starts true and
  // Refresh swaps data in place without flashing the loading state.
  const loadData = useCallback(async () => {
    const [comp, chain, leg] = await Promise.all([
      safeFetch<CompositeScoresFile>("/data/composite_scores_v1.json"),
      safeFetch<ChainData>("/data/chain_data.json"),
      safeFetch<LegacyData>("/data/combined_scores.json"),
    ]);
    setCompositeFile(comp && Array.isArray(comp.scores) && comp.scores.length > 0 ? comp : null);
    setChainData(chain);
    setLegacy(leg && Array.isArray(leg.scores) ? leg : null);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── Composite rows (normalised to 0-100, joined with chain) ── */
  const chainMap = useMemo(() => {
    const m = new Map<number, ChainSubnet>();
    chainData?.subnets?.forEach((s) => m.set(s.netuid, s));
    return m;
  }, [chainData]);

  const cScale = useMemo(
    () => scaleFor((compositeFile?.scores || []).map((r) => r.composite_score ?? NaN)),
    [compositeFile]
  );
  const ingScale = useMemo(() => {
    const vals: number[] = [];
    compositeFile?.scores?.forEach((r) => {
      Object.values(r.ingredients || {}).forEach((v) => {
        if (typeof v === "number" && isFinite(v)) vals.push(v);
      });
    });
    return scaleFor(vals);
  }, [compositeFile]);

  // Ingredient columns, in first-seen order across the file
  const ingredientKeys = useMemo(() => {
    const keys: string[] = [];
    compositeFile?.scores?.forEach((r) => {
      Object.keys(r.ingredients || {}).forEach((k) => {
        if (!keys.includes(k)) keys.push(k);
      });
    });
    return keys;
  }, [compositeFile]);

  interface Row extends CompositeScoreRow {
    score100: number;
    tao_in: number;
    displayName: string;
  }

  const rows: Row[] = useMemo(() => {
    return (compositeFile?.scores || [])
      .filter((r) => typeof r.composite_score === "number")
      .map((r) => ({
        ...r,
        score100: (r.composite_score as number) * cScale,
        tao_in: chainMap.get(r.netuid)?.tao_in ?? 0,
        displayName: r.name || chainMap.get(r.netuid)?.name || "SN" + r.netuid,
      }));
  }, [compositeFile, cScale, chainMap]);

  const sortedRows = useMemo(() => {
    const getVal = (r: Row): number => {
      if (sortField === "score") return r.score100;
      if (sortField === "tao_in") return r.tao_in;
      if (sortField === "netuid") return r.netuid;
      const v = r.ingredients?.[sortField];
      return typeof v === "number" && isFinite(v) ? v * ingScale : -1;
    };
    return [...rows].sort((a, b) => (sortDir === -1 ? getVal(b) - getVal(a) : getVal(a) - getVal(b)));
  }, [rows, sortField, sortDir, ingScale]);

  const handleSort = useCallback((field: string) => {
    setSortDir((d) => (field === sortField ? ((d * -1) as -1 | 1) : -1));
    setSortField(field);
  }, [sortField]);

  /* ── Stats ─────────────────────────────────────────────── */
  const hasScores = rows.length > 0;
  const topRow = hasScores ? [...rows].sort((a, b) => b.score100 - a.score100)[0] : null;
  const inPortfolioCount = rows.filter((r) => r.in_portfolio).length;
  const medianScore = (() => {
    if (!hasScores) return null;
    const s = rows.map((r) => r.score100).sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  })();
  const scoreDate = compositeFile?.date || compositeFile?.generated_at || null;

  /* ── Legacy sort ───────────────────────────────────────── */
  const legacySorted = useMemo(() => {
    const scores = [...(legacy?.scores || [])];
    const { field, dir } = legacySort;
    scores.sort((a, b) => {
      const av = (a[field] as number) ?? 0;
      const bv = (b[field] as number) ?? 0;
      return dir === -1 ? bv - av : av - bv;
    });
    return scores;
  }, [legacy, legacySort]);

  const handleLegacySort = useCallback((field: string) => {
    setLegacySort((prev) => ({ field, dir: prev.field === field ? ((prev.dir * -1) as -1 | 1) : -1 }));
  }, []);

  const sortArrow = (active: boolean, dir: -1 | 1) => (active ? (dir === -1 ? " ↓" : " ↑") : "");

  const LEGACY_COLS: { label: string; field: string }[] = [
    { label: "Satellite", field: "combined_score" },
    { label: "Core", field: "consensus_score" },
    { label: "Momentum", field: "conviction_score" },
    { label: "Flow", field: "capital_flow_score" },
    { label: "Yield", field: "yield_score" },
    { label: "Recovery", field: "stability_score" },
    { label: "Em. Share", field: "emission_share_pct" },
    { label: "TAO Staked", field: "tao_in" },
  ];

  /* ── Render ────────────────────────────────────────────── */
  return (
    <div>
      {/* ── Stats Row ──────────────────────────────────────── */}
      <div className="grid grid-cols-7 border-b border-border bg-surface max-md:grid-cols-4 max-sm:grid-cols-2">
        <div className="px-4 py-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-[5px]">Model</div>
          <div className="font-mono text-[16px] font-semibold tracking-tight leading-none text-cyan">Composite v1</div>
          <div className="font-mono text-[10px] text-muted mt-[3px]">walk-forward validated</div>
        </div>
        <div className="px-4 py-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-[5px]">Subnets Scored</div>
          <div className="font-mono text-xl font-semibold tracking-tight leading-none text-cyan">{hasScores ? rows.length : "—"}</div>
          <div className="font-mono text-[10px] text-muted mt-[3px]">128 total network</div>
        </div>
        <div className="px-4 py-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-[5px]">In Portfolio</div>
          <div className="font-mono text-xl font-semibold tracking-tight leading-none text-yellow">{hasScores ? inPortfolioCount : "—"}</div>
          <div className="font-mono text-[10px] text-muted mt-[3px]">model holdings ★</div>
        </div>
        <div className="px-4 py-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-[5px]">Top Score</div>
          <div className={`font-mono text-[16px] font-semibold tracking-tight leading-none ${topRow ? scoreBand(topRow.score100).text : "text-muted"}`}>
            {topRow ? Math.round(topRow.score100) : "—"}
          </div>
          <div className="font-mono text-[10px] text-muted mt-[3px]">
            {topRow ? `SN${topRow.netuid} ${topRow.displayName}` : "—"}
          </div>
        </div>
        <div className="px-4 py-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-[5px]">Median Score</div>
          <div className="font-mono text-xl font-semibold tracking-tight leading-none text-purple">
            {medianScore != null ? Math.round(medianScore) : "—"}
          </div>
          <div className="font-mono text-[10px] text-muted mt-[3px]">across scored universe</div>
        </div>
        <div className="px-4 py-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-[5px]">Network Emission</div>
          <div className="font-mono text-[16px] font-semibold tracking-tight leading-none text-yellow">
            {chainData?.total_emission_tao?.toFixed(4) ?? "—"}
          </div>
          <div className="font-mono text-[10px] text-muted mt-[3px]">TAO/block</div>
        </div>
        <div className="px-4 py-3">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-[5px]">Score Date</div>
          <div className="font-mono text-[14px] font-semibold tracking-tight leading-none text-green">
            {scoreDate ?? "pending"}
          </div>
          <div className="font-mono text-[10px] text-muted mt-[3px]">publishes 12:00 UTC daily</div>
        </div>
      </div>

      {/* ── Main Content ───────────────────────────────────── */}
      <div className="p-5 flex flex-col gap-5">

        {/* ── Composite v1 Leaderboard ─────────────────────── */}
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-text font-medium whitespace-nowrap">
              {"⚡"} Signal Leaderboard — Composite v1
            </div>
            {hasScores ? (
              <span className="font-mono text-[9px] tracking-[0.1em] uppercase px-2 py-[3px] border border-cyan text-cyan whitespace-nowrap">
                Composite v1 {"·"} {scoreDate}
              </span>
            ) : (
              <span className="font-mono text-[9px] tracking-[0.1em] uppercase px-2 py-[3px] border border-border2 text-muted whitespace-nowrap">
                First publication pending
              </span>
            )}
            <div className="flex-1 h-px bg-border" />
            <button
              onClick={loadData}
              className="font-mono text-[10px] tracking-[0.08em] uppercase bg-transparent border border-border2 text-muted px-3 py-[5px] cursor-pointer transition-all hover:border-cyan hover:text-cyan"
            >
              {"↻"} Refresh
            </button>
          </div>
          <p className="font-mono text-[10px] text-muted leading-relaxed mb-3 m-0">
            Blend of accumulation, emission-strength, and old-model-inverse percentiles — equal weight.
            Each column is a 0–100 percentile vs all scored subnets; ★ marks subnets held in the model portfolio.
            Live track record on <Link href="/tracking" className="text-cyan no-underline hover:underline">/tracking</Link>.
          </p>

          <div className="border border-border overflow-x-auto bg-surface">
            {loading ? (
              <div className="font-mono text-xs text-muted text-center py-12">Loading...</div>
            ) : !hasScores ? (
              <div className="text-center py-14 px-6">
                <div className="font-mono text-[12px] text-text mb-2">New model scores publish daily at 12:00 UTC — first publication pending</div>
                <div className="font-mono text-[10px] text-muted leading-relaxed max-w-[560px] mx-auto">
                  The Composite v1 leaderboard will appear here automatically once
                  <span className="text-text"> composite_scores_v1.json</span> ships with the next pipeline run.
                  Until then, see live subnet chain data on the <Link href="/" className="text-cyan no-underline hover:underline">Subnets</Link> page.
                </div>
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-surface2 border-b border-border2">
                    <th className={thBase}>#</th>
                    <th
                      className={`${thBase} cursor-pointer select-none transition-colors ${sortField === "netuid" ? "text-cyan" : "hover:text-text"}`}
                      onClick={() => handleSort("netuid")}
                    >
                      SN{sortArrow(sortField === "netuid", sortDir)}
                    </th>
                    <th className={thBase}>Name</th>
                    <th
                      className={`${thBase} cursor-pointer select-none transition-colors ${sortField === "score" ? "text-cyan" : "hover:text-text"}`}
                      onClick={() => handleSort("score")}
                    >
                      Composite Score{sortArrow(sortField === "score", sortDir)}
                    </th>
                    {ingredientKeys.map((k) => (
                      <th
                        key={k}
                        className={`${thBase} cursor-pointer select-none transition-colors ${sortField === k ? "text-cyan" : "hover:text-text"}`}
                        onClick={() => handleSort(k)}
                      >
                        {ingredientLabel(k)}{sortArrow(sortField === k, sortDir)}
                      </th>
                    ))}
                    <th
                      className={`${thBase} cursor-pointer select-none transition-colors ${sortField === "tao_in" ? "text-cyan" : "hover:text-text"}`}
                      onClick={() => handleSort("tao_in")}
                    >
                      Liquidity{sortArrow(sortField === "tao_in", sortDir)}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r, i) => {
                    const band = scoreBand(r.score100);
                    return (
                      <tr key={r.netuid} className="border-b border-border/80 hover:bg-cyan/[0.03] transition-colors">
                        <td className="font-mono text-[11px] text-muted px-3 py-2.5 w-8">
                          {r.rank != null ? "#" + r.rank : i + 1}
                        </td>
                        <td className="font-mono text-[10px] text-muted px-3 py-2.5 w-10">{r.netuid}</td>
                        <td className="font-semibold text-[13px] text-text px-3 py-2.5 min-w-[150px]">
                          <Link href={`/subnet/${r.netuid}`} className="inline-flex items-center gap-2 text-inherit no-underline">
                            <SubnetLogo netuid={r.netuid} size={18} />
                            <span className="border-b border-border2 hover:border-cyan">{r.displayName}</span>
                          </Link>
                          {r.in_portfolio && (
                            <span className="text-yellow text-[11px] ml-1.5" title="In model portfolio">★</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className="inline-flex items-center gap-2">
                            <span className={`font-mono text-[12px] font-semibold w-6 text-right ${band.text}`}>
                              {Math.round(r.score100)}
                            </span>
                            <span className="inline-block w-16 h-1.5 bg-surface2 border border-border2 overflow-hidden align-middle">
                              <span
                                className={`block h-full ${band.bar}`}
                                style={{ width: Math.max(0, Math.min(100, r.score100)) + "%" }}
                              />
                            </span>
                          </span>
                        </td>
                        {ingredientKeys.map((k) => {
                          const v = r.ingredients?.[k];
                          return (
                            <td key={k} className="px-3 py-2.5 whitespace-nowrap">
                              <PctBar value={typeof v === "number" && isFinite(v) ? v * ingScale : null} />
                            </td>
                          );
                        })}
                        <td className="px-3 py-2.5"><LiquidityBadge taoIn={r.tao_in} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Methodology ──────────────────────────────────── */}
        <div>
          <div className="flex items-center gap-3 mb-3">
            <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-text font-medium whitespace-nowrap">
              {"📐"} Methodology — Composite v1
            </div>
            <div className="flex-1 h-px bg-border" />
            <span className="font-mono text-[9px] tracking-[0.1em] uppercase px-2 py-[3px] border border-green text-green whitespace-nowrap">
              Walk-forward validated
            </span>
          </div>
          <div className="border border-border bg-surface p-6">
            <div className="text-xs text-muted leading-[1.7] mb-4 max-w-[820px]">
              Each day, every subnet is ranked 0–100 on three independent ingredients; the composite
              score is their equal-weight blend. A subnet needs at least two ingredients present to be scored.
            </div>
            <div className="max-w-[820px]">
              {[
                { label: "Accumulation", desc: "Volume × price stability — sustained buying without price spikes", color: "text-cyan" },
                { label: "Emission strength", desc: "30-day z-score of emission share — rising network rewards", color: "text-yellow" },
                { label: "Old-model inverse", desc: "The legacy model's ranking, inverted — it proved anti-predictive, so its lowest picks score highest", color: "text-purple" },
              ].map((item) => (
                <div key={item.label} className="flex items-start justify-between gap-3 py-1.5 border-b border-border/50 last:border-b-0">
                  <div className="flex items-center gap-2 min-w-[150px]">
                    <span className={`w-2.5 h-2.5 rounded-full ${item.color.replace("text-", "bg-")}`} />
                    <span className={`text-xs font-medium ${item.color}`}>{item.label}</span>
                  </div>
                  <span className="text-[11px] text-muted text-right flex-1">{item.desc}</span>
                </div>
              ))}
              <div className="mt-3 pt-3 border-t border-border/50 flex gap-5 flex-wrap">
                <Link href="/tracking" className="font-mono text-[11px] text-cyan no-underline hover:underline">
                  {"→"} Paper NAV + signal league on /tracking
                </Link>
                <Link href="/performance" className="font-mono text-[11px] text-cyan no-underline hover:underline">
                  {"→"} Live portfolio on /performance
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* ── Legacy model (deprecated, collapsed) ─────────── */}
        <div>
          <button
            onClick={() => setLegacyOpen((o) => !o)}
            className="w-full flex items-center gap-3 bg-transparent border border-border2 px-4 py-3 cursor-pointer text-left hover:border-red/60 transition-all"
          >
            <span className="font-mono text-[10px] text-muted">{legacyOpen ? "▾" : "▸"}</span>
            <span className="font-mono text-[10px] tracking-[0.1em] uppercase text-muted">
              Legacy model (deprecated Oct 2026 — validated anti-predictive in the current regime; retained for reference only)
            </span>
            <span className="flex-1" />
            <span className="font-mono text-[9px] tracking-[0.06em] uppercase px-1.5 py-0.5 border text-red border-red bg-red/10 whitespace-nowrap">
              Deprecated
            </span>
          </button>

          {legacyOpen && (
            <div className="border border-t-0 border-border2 bg-surface">
              <div className="px-4 py-3 border-b border-border bg-red/[0.04]">
                <p className="font-mono text-[10px] text-red leading-relaxed m-0">
                  {"⚠"} These V3/VSAT scores are NOT recommendations. Out-of-sample validation (Oct 2026) found
                  this model&apos;s rankings inverted — its top-ranked subnets underperformed — in the current protocol
                  regime. The current model (Composite v1, above) uses the INVERSE of these rankings as one ingredient.
                  This table is kept only so historical references remain auditable.
                </p>
              </div>
              {!legacy?.scores?.length ? (
                <div className="font-mono text-[11px] text-muted text-center py-10">Legacy score file not available</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-surface2 border-b border-border2">
                        <th className={thBase}>#</th>
                        <th className={thBase}>SN</th>
                        <th className={thBase}>Name</th>
                        {LEGACY_COLS.map((c) => (
                          <th
                            key={c.field}
                            className={`${thBase} cursor-pointer select-none transition-colors ${legacySort.field === c.field ? "text-cyan" : "hover:text-text"}`}
                            onClick={() => handleLegacySort(c.field)}
                          >
                            {c.label}{sortArrow(legacySort.field === c.field, legacySort.dir)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {legacySorted.map((s, i) => (
                        <tr key={s.netuid} className="border-b border-border/80 hover:bg-cyan/[0.03] transition-colors opacity-70">
                          <td className="font-mono text-[11px] text-muted px-3 py-2">{i + 1}</td>
                          <td className="font-mono text-[10px] text-muted px-3 py-2">{s.netuid}</td>
                          <td className="text-[12px] text-text px-3 py-2 min-w-[140px] whitespace-nowrap">
                            <Link href={`/subnet/${s.netuid}`} className="text-inherit no-underline border-b border-border2 hover:border-cyan">
                              {s.name}
                            </Link>
                          </td>
                          {LEGACY_COLS.map((c) => {
                            const v = s[c.field] as number | undefined;
                            return (
                              <td key={c.field} className="font-mono text-[11px] text-muted px-3 py-2">
                                {v == null || !isFinite(v) || v === 0
                                  ? "—"
                                  : c.field === "emission_share_pct"
                                  ? v.toFixed(2) + "%"
                                  : c.field === "tao_in"
                                  ? Math.round(v).toLocaleString()
                                  : v.toFixed(1)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {legacy?.generated_at && (
                <div className="font-mono text-[9px] text-muted px-4 py-2 border-t border-border">
                  Legacy scores last generated {legacy.generated_at}
                </div>
              )}
            </div>
          )}
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
