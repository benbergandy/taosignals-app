"use client";

// ── Tracking — composite_v1 paper NAV + signal league ─────────────────
// Data sources (all may 404 until the model pipeline ships them — every
// panel must degrade to a "coming soon" state, never break):
//   /data/paper_daily_log_composite_v1_sleeved.json  (same schema as the
//     other paper_daily_log_*_sleeved.json files)
//   /data/signal_league.json  (signal_track.py league payload)

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import Chart from "chart.js/auto";
import { safeFetch } from "@/lib/composite";

interface DailyLogEntry {
  date: string;
  portfolio_value: number;
  pnl_tao?: number;
  pnl_pct?: number;
  n_positions?: number;
  benchmark_eq_weight?: number;
  alpha_vs_eq?: number;
}

interface LeagueRow {
  signal: string;
  horizon: number;
  era: string;
  n_days: number;
  // Headline stats are GROSS (prediction skill); rows scored before the
  // gross migration only carry the net columns — fall back to those.
  ic_tstat_gross?: number | null;
  ic_tstat?: number | null;
  mean_ic_gross?: number | null;
  mean_ic?: number | null;
  ewma_ic?: number | null;
  last_10d_mean_ic?: number | null;
  hit_rate?: number | null;
  cusum_state?: string | null;
}

interface LeagueFile {
  generated_at?: string;
  max_rank_date_scored?: string;
  bonferroni_t_bar?: number;
  league?: LeagueRow[];
}

const RANGES = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "ALL", days: 0 },
];

function cusumDot(state: string | null | undefined): { cls: string; label: string } {
  switch (state) {
    case "ok": return { cls: "bg-green", label: "ok" };
    case "tripped_decay": return { cls: "bg-red", label: "decay" };
    case "tripped_emergence": return { cls: "bg-cyan", label: "emergence" };
    default: return { cls: "bg-muted", label: "—" };
  }
}

export default function TrackingPage() {
  const [dailyLog, setDailyLog] = useState<DailyLogEntry[] | null>(null);
  const [leagueFile, setLeagueFile] = useState<LeagueFile | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(0);

  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstance = useRef<Chart | null>(null);

  useEffect(() => {
    async function load() {
      const [log, league] = await Promise.all([
        safeFetch<DailyLogEntry[]>("/data/paper_daily_log_composite_v1_sleeved.json"),
        safeFetch<LeagueFile>("/data/signal_league.json"),
      ]);
      setDailyLog(Array.isArray(log) && log.length > 0 ? log : null);
      setLeagueFile(league && Array.isArray(league.league) ? league : null);
      setLoading(false);
    }
    load();
  }, []);

  // ── NAV chart ───────────────────────────────────────────────
  const buildChart = useCallback(() => {
    if (!chartRef.current || !dailyLog?.length) return;
    const data = range > 0 ? dailyLog.slice(-range) : dailyLog;
    const labels = data.map((d) => (d.date ? d.date.slice(5) : ""));
    const ptRadius = data.length <= 14 ? 3 : data.length <= 60 ? 1.5 : 0;

    if (chartInstance.current) chartInstance.current.destroy();
    chartInstance.current = new Chart(chartRef.current.getContext("2d")!, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Composite v1 Portfolio",
            data: data.map((d) => d.portfolio_value || 0),
            borderColor: "#ffd000",
            borderWidth: 2.5,
            pointRadius: ptRadius,
            pointBackgroundColor: "#ffd000",
            tension: 0.3,
            fill: { target: "origin", above: "rgba(255,208,0,0.04)" },
            spanGaps: true,
          },
          {
            label: "Equal-Weight Benchmark",
            data: data.map((d) => d.benchmark_eq_weight ?? null),
            borderColor: "#00d4ff",
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
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
              label: (ctx) => ` ${ctx.dataset.label}: ${(ctx.parsed.y as number).toFixed(2)} TAO`,
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
            ticks: { color: "#445566", font: { family: "IBM Plex Mono", size: 9 } },
            border: { color: "#1a2230" },
            title: { display: true, text: "TAO", color: "#445566", font: { family: "IBM Plex Mono", size: 10 } },
          },
        },
      },
    });
  }, [dailyLog, range]);

  useEffect(() => { buildChart(); }, [buildChart]);
  useEffect(() => () => { if (chartInstance.current) chartInstance.current.destroy(); }, []);

  // ── League rows: era=all, horizon=7, n_days>=30, by |t| ─────
  const tBar = leagueFile?.bonferroni_t_bar ?? 3.65;
  const leagueRows = useMemo(() => {
    const rows = (leagueFile?.league || [])
      .filter((r) => r.era === "all" && r.horizon === 7 && (r.n_days || 0) >= 30)
      .map((r) => ({
        ...r,
        t: r.ic_tstat_gross ?? r.ic_tstat ?? null,
        ic: r.mean_ic_gross ?? r.mean_ic ?? null,
        ewma: r.ewma_ic ?? null,
      }));
    rows.sort((a, b) => {
      const at = a.t != null && isFinite(a.t) ? Math.abs(a.t) : -1;
      const bt = b.t != null && isFinite(b.t) ? Math.abs(b.t) : -1;
      return bt - at;
    });
    return rows;
  }, [leagueFile]);

  const latest = dailyLog?.length ? dailyLog[dailyLog.length - 1] : null;
  const pnlPct = latest?.pnl_pct ?? null;

  if (loading) {
    return <div className="font-mono text-xs text-muted text-center py-12">Loading tracking data...</div>;
  }

  return (
    <div className="p-6 flex flex-col gap-6 max-w-[1400px] mx-auto">
      {/* ── COMPOSITE V1 PAPER NAV ───────────────────────── */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-text font-medium whitespace-nowrap">
            Composite v1 — Paper Portfolio
          </div>
          <div className="flex-1 h-px bg-border" />
          {latest && (
            <>
              <span className="font-mono text-[9px] tracking-[0.1em] px-2 py-0.5 border border-border2 text-muted uppercase whitespace-nowrap">
                {dailyLog!.length} days
              </span>
              <span className={`font-mono text-[9px] tracking-[0.1em] px-2 py-0.5 border uppercase whitespace-nowrap ${
                pnlPct != null && pnlPct >= 0 ? "border-green text-green" : "border-red text-red"
              }`}>
                {pnlPct != null ? (pnlPct >= 0 ? "+" : "") + pnlPct.toFixed(2) + "%" : "—"}
              </span>
            </>
          )}
        </div>

        {dailyLog ? (
          <div className="bg-surface border border-border p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-yellow">
                NAV vs equal-weight benchmark (TAO)
              </div>
              <div className="flex gap-1">
                {RANGES.map((r) => (
                  <button
                    key={r.label}
                    onClick={() => setRange(r.days)}
                    className={`font-mono text-[9px] tracking-[0.08em] uppercase px-2.5 py-1 border cursor-pointer transition-all duration-150 ${
                      range === r.days
                        ? "border-cyan text-cyan"
                        : "border-border2 text-muted hover:border-cyan hover:text-cyan"
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-[300px] relative">
              <canvas ref={chartRef} />
            </div>
            <div className="font-mono text-[9px] text-muted mt-3">
              Paper-traded daily on the composite_v1 score (no real capital). The equal-weight benchmark holds every
              liquid subnet equally — divergence above it is selection skill, not market direction.
            </div>
          </div>
        ) : (
          <div className="bg-surface border border-border">
            <div className="font-mono text-[11px] text-muted text-center py-12">
              Composite v1 tracking coming soon — the paper trader publishes its first daily log shortly
            </div>
          </div>
        )}
      </div>

      {/* ── SIGNAL LEAGUE ─────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-text font-medium whitespace-nowrap">
            Signal League — 7-Day Horizon
          </div>
          <div className="flex-1 h-px bg-border" />
          {leagueFile?.max_rank_date_scored && (
            <span className="font-mono text-[9px] tracking-[0.1em] px-2 py-0.5 border border-border2 text-muted uppercase whitespace-nowrap">
              scored through {leagueFile.max_rank_date_scored}
            </span>
          )}
        </div>

        <div className="bg-surface border border-border">
          <div className="px-4 py-3 border-b border-border">
            <p className="font-mono text-[10px] text-muted leading-relaxed m-0">
              <strong className="text-text">IC</strong> = daily rank correlation between a signal and next-week subnet
              returns (higher = more predictive). <strong className="text-text">t</strong> = statistical confidence that
              the IC is real rather than luck — the multiple-testing bar is |t| ≈ {tBar.toFixed(2)}.{" "}
              <strong className="text-text">EWMA IC</strong> weights recent days more: it shows what the signal is doing
              now. Status: <span className="text-green">●</span> ok, <span className="text-red">●</span> decay tripwire,{" "}
              <span className="text-cyan">●</span> emergence tripwire. Signals with identical histories are deduped;
              only signals with ≥30 scored days are shown.
            </p>
          </div>

          {!leagueFile ? (
            <div className="font-mono text-[11px] text-muted text-center py-12">
              Signal league coming soon — published by the daily signal-tracking run
            </div>
          ) : leagueRows.length === 0 ? (
            <div className="font-mono text-[11px] text-muted text-center py-12">
              No signals have ≥30 scored days at the 7-day horizon yet — check back as history accrues
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-surface2 border-b border-border2">
                    {["#", "Signal", "t (NW)", "Gross IC", "EWMA IC", "Hit Rate", "Days", "Status"].map((h, i) => (
                      <th
                        key={h}
                        className={`font-mono text-[9px] tracking-[0.12em] uppercase px-3 py-2.5 font-normal whitespace-nowrap text-muted ${
                          i >= 2 && i <= 6 ? "text-right" : "text-left"
                        }`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leagueRows.map((r, i) => {
                    const sig = r.t != null && isFinite(r.t) && Math.abs(r.t) >= tBar;
                    const dot = cusumDot(r.cusum_state);
                    return (
                      <tr key={r.signal} className="border-b border-border/80 hover:bg-cyan/[0.03] transition-colors">
                        <td className="font-mono text-[11px] text-muted px-3 py-2.5">{i + 1}</td>
                        <td className="font-mono text-[11px] text-text px-3 py-2.5 whitespace-nowrap">
                          {r.signal.replace(/_/g, " ")}
                        </td>
                        <td className={`font-mono text-[11px] px-3 py-2.5 text-right font-semibold ${
                          r.t == null ? "text-muted" : sig ? "text-green" : "text-text"
                        }`}>
                          {r.t == null || !isFinite(r.t) ? "—" : r.t.toFixed(2)}
                          {sig && <span className="text-[9px] ml-1 text-green" title={`past the |t| ≈ ${tBar.toFixed(2)} bar`}>✓</span>}
                        </td>
                        <td className={`font-mono text-[11px] px-3 py-2.5 text-right ${
                          r.ic == null ? "text-muted" : r.ic >= 0 ? "text-green" : "text-red"
                        }`}>
                          {r.ic == null ? "—" : (r.ic >= 0 ? "+" : "") + r.ic.toFixed(4)}
                        </td>
                        <td className={`font-mono text-[11px] px-3 py-2.5 text-right ${
                          r.ewma == null ? "text-muted" : r.ewma >= 0 ? "text-green" : "text-red"
                        }`}>
                          {r.ewma == null ? "—" : (r.ewma >= 0 ? "+" : "") + r.ewma.toFixed(4)}
                        </td>
                        <td className="font-mono text-[11px] text-text px-3 py-2.5 text-right">
                          {r.hit_rate == null ? "—" : (r.hit_rate * 100).toFixed(0) + "%"}
                        </td>
                        <td className="font-mono text-[11px] text-muted px-3 py-2.5 text-right">{r.n_days}</td>
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase text-muted whitespace-nowrap">
                            <span className={`w-1.5 h-1.5 rounded-full ${dot.cls}`} />
                            {dot.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Disclaimer */}
      <div className="border-t border-border pt-5">
        <p className="font-mono text-[10px] text-muted leading-relaxed">
          <strong className="text-text">DISCLAIMER:</strong> All portfolios on this page are paper-traded simulations
          for research purposes. Nothing on this platform constitutes financial advice. Past performance is not
          indicative of future results.
        </p>
      </div>
    </div>
  );
}
