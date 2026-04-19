"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface Subnet {
  netuid: number;
  name: string;
  tao_in?: number;
  alpha_price_tao?: number;
  moving_price?: number;
  price_vs_ema?: number;
  ema_tao_inflow?: number;
  emission_share_pct?: number;
  miners?: number;
  alpha_ratio?: number;
  subnet_volume?: number;
}

interface ChainData {
  subnets: Subnet[];
  total_emission_tao?: number;
  block?: number;
  generated_at?: string;
}

type SortField = "tao_in" | "alpha_price_tao" | "price_vs_ema" | "ema_tao_inflow" | "emission_share_pct" | "miners" | "netuid" | "subnet_volume";
type FilterMode = "all" | "deep" | "inflow" | "active";

function liquidityTier(taoIn: number): { label: string; color: string } {
  if (taoIn >= 50000) return { label: "DEEP", color: "text-green border-green bg-green/10" };
  if (taoIn >= 10000) return { label: "ADEQUATE", color: "text-cyan border-cyan bg-cyan/10" };
  if (taoIn >= 1000)  return { label: "THIN", color: "text-yellow border-yellow bg-yellow/10" };
  if (taoIn >= 100)   return { label: "VERY THIN", color: "text-orange border-orange bg-orange/10" };
  return { label: "ILLIQUID", color: "text-red border-red bg-red/10" };
}

function fmtVolume(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toFixed(0);
}

function fmtInflow(v: number): string {
  const sign = v >= 0 ? "+" : "";
  if (Math.abs(v) >= 1) return sign + v.toFixed(2);
  if (Math.abs(v) >= 0.001) return sign + v.toFixed(4);
  return sign + v.toFixed(6);
}

function fmtComma(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

const COLUMNS: { label: string; field: SortField | null }[] = [
  { label: "#", field: null },
  { label: "SN", field: "netuid" },
  { label: "Name", field: null },
  { label: "Price", field: "alpha_price_tao" },
  { label: "Price vs EMA", field: "price_vs_ema" },
  { label: "Emission %", field: "emission_share_pct" },
  { label: "TAO Staked", field: "tao_in" },
  { label: "EMA Inflow", field: "ema_tao_inflow" },
  { label: "Volume", field: "subnet_volume" },
  { label: "Nodes", field: "miners" },
  { label: "Liquidity", field: "tao_in" },
];

const FILTERS: { label: string; value: FilterMode }[] = [
  { label: "All", value: "all" },
  { label: "Deep Liquidity", value: "deep" },
  { label: "Positive Inflow", value: "inflow" },
  { label: "Active Emission", value: "active" },
];

export default function SubnetsPage() {
  const [subnets, setSubnets] = useState<Subnet[]>([]);
  const [chainData, setChainData] = useState<ChainData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortField, setSortField] = useState<SortField>("tao_in");
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");

  const loadData = useCallback(() => {
    setLoading(true);
    fetch("/data/chain_data.json?t=" + Date.now())
      .then((r) => r.json())
      .then((data: ChainData) => {
        setChainData(data);
        setSubnets(data.subnets || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSort = useCallback((field: SortField | null) => {
    if (!field) return;
    if (field === sortField) {
      setSortDir((d) => (d === -1 ? 1 : -1));
    } else {
      setSortField(field);
      setSortDir(-1);
    }
  }, [sortField]);

  // Stats
  const activeCount = subnets.filter((s) => (s.emission_share_pct || 0) > 0).length;
  const totalTaoStaked = subnets.reduce((sum, s) => sum + (s.tao_in || 0), 0);
  const deepCount = subnets.filter((s) => (s.tao_in || 0) >= 50000).length;
  const adequateCount = subnets.filter((s) => (s.tao_in || 0) >= 10000 && (s.tao_in || 0) < 50000).length;
  const thinCount = subnets.filter((s) => (s.tao_in || 0) >= 1000 && (s.tao_in || 0) < 10000).length;

  // Filter + search
  const filtered = subnets.filter((s) => {
    // Search
    if (search) {
      const q = search.toLowerCase();
      if (!(s.name || "").toLowerCase().includes(q) && !String(s.netuid).includes(q)) return false;
    }
    // Filter
    switch (filter) {
      case "deep": return (s.tao_in || 0) >= 50000;
      case "inflow": return (s.ema_tao_inflow || 0) > 0;
      case "active": return (s.emission_share_pct || 0) > 0;
      default: return true;
    }
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = (a[sortField] as number) || 0;
    const bv = (b[sortField] as number) || 0;
    return sortDir === -1 ? bv - av : av - bv;
  });

  return (
    <div>
      {/* Stats Row */}
      <div className="grid grid-cols-8 border-b border-border bg-surface">
        <div className="p-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">Active Subnets</div>
          <div className="font-mono text-xl font-semibold text-cyan leading-none">{loading ? "—" : activeCount}</div>
          <div className="font-mono text-[10px] text-muted mt-0.5">with emission &gt; 0</div>
        </div>
        <div className="p-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">Total TAO Staked</div>
          <div className="font-mono text-xl font-semibold text-green leading-none">{loading ? "—" : fmtComma(totalTaoStaked)}</div>
          <div className="font-mono text-[10px] text-muted mt-0.5">across all subnets</div>
        </div>
        <div className="p-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">Network Emission</div>
          <div className="font-mono text-base font-semibold text-yellow leading-none">{loading ? "—" : (chainData?.total_emission_tao?.toFixed(4) || "—")}</div>
          <div className="font-mono text-[10px] text-muted mt-0.5">TAO/block</div>
        </div>
        <div className="p-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">Deep Liquidity</div>
          <div className="font-mono text-xl font-semibold text-green leading-none">{loading ? "—" : deepCount}</div>
          <div className="font-mono text-[10px] text-muted mt-0.5">&ge; 50,000 TAO</div>
        </div>
        <div className="p-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">Adequate Liquidity</div>
          <div className="font-mono text-xl font-semibold text-cyan leading-none">{loading ? "—" : adequateCount}</div>
          <div className="font-mono text-[10px] text-muted mt-0.5">&ge; 10,000 TAO</div>
        </div>
        <div className="p-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">Thin Liquidity</div>
          <div className="font-mono text-xl font-semibold text-yellow leading-none">{loading ? "—" : thinCount}</div>
          <div className="font-mono text-[10px] text-muted mt-0.5">&ge; 1,000 TAO</div>
        </div>
        <div className="p-3 border-r border-border">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">Current Block</div>
          <div className="font-mono text-sm font-semibold text-purple leading-none">{loading ? "—" : (chainData?.block?.toLocaleString() || "—")}</div>
          <div className="font-mono text-[10px] text-muted mt-0.5">direct from chain</div>
        </div>
        <div className="p-3">
          <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">Last Updated</div>
          <div className="font-mono text-xs font-semibold text-muted leading-none">{chainData?.generated_at || "—"}</div>
          <div className="font-mono text-[10px] text-muted mt-0.5">chain data snapshot</div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-5">
        {/* Section Header */}
        <div className="flex items-center gap-3 mb-3">
          <h1 className="font-mono text-[10px] tracking-[0.15em] uppercase text-text font-medium whitespace-nowrap">
            Subnet Explorer
          </h1>
          <div className="flex-1 h-px bg-border" />
          <span className="font-mono text-[9px] tracking-[0.1em] uppercase px-2 py-0.5 border border-green text-green whitespace-nowrap">
            On-chain data
          </span>
        </div>

        {/* Search + Filters + Refresh */}
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              placeholder="Search subnets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="font-mono text-[11px] bg-surface2 border border-border2 text-text px-3 py-1.5 w-44 outline-none focus:border-cyan transition-colors"
            />
            <span className="font-mono text-[9px] tracking-[0.12em] uppercase text-muted ml-2">Filter:</span>
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`font-mono text-[9px] tracking-[0.08em] uppercase px-2.5 py-1 border cursor-pointer transition-all ${
                  filter === f.value
                    ? "border-cyan text-cyan"
                    : "border-border2 text-muted hover:border-cyan hover:text-cyan"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            onClick={loadData}
            className="font-mono text-[10px] tracking-[0.08em] uppercase px-3 py-1.5 border border-border2 text-muted cursor-pointer hover:border-cyan hover:text-cyan transition-all"
          >
            ↻ Refresh
          </button>
        </div>

        {/* Table */}
        {loading ? (
          <div className="font-mono text-xs text-muted text-center py-12">Loading subnets...</div>
        ) : (
          <div className="border border-border bg-surface overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-surface2 border-b border-border2">
                  {COLUMNS.map((col, ci) => (
                    <th
                      key={col.label + ci}
                      onClick={() => handleSort(col.field)}
                      className={`font-mono text-[9px] tracking-[0.12em] uppercase px-3 py-2.5 text-left font-normal whitespace-nowrap select-none transition-colors ${
                        col.field
                          ? `cursor-pointer hover:text-text ${sortField === col.field ? "text-cyan" : "text-muted"}`
                          : "text-muted cursor-default"
                      }`}
                    >
                      {col.label}
                      {col.field === sortField && (
                        <span className="ml-1">{sortDir === -1 ? "↓" : "↑"}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length} className="font-mono text-xs text-muted text-center py-12">
                      No subnets match this filter
                    </td>
                  </tr>
                ) : (
                  sorted.map((s, i) => {
                    const tier = liquidityTier(s.tao_in || 0);
                    return (
                      <tr key={s.netuid} className="border-b border-border/80 hover:bg-cyan/[0.03] transition-colors">
                        <td className="font-mono text-[11px] text-muted px-3 py-2.5">{i + 1}</td>
                        <td className="font-mono text-[10px] text-muted px-3 py-2.5">{s.netuid}</td>
                        <td className="font-semibold text-[13px] px-3 py-2.5 min-w-[140px]">
                          <Link href={`/subnet/${s.netuid}`} className="text-inherit no-underline border-b border-border2 hover:border-cyan">
                            {s.name}
                          </Link>
                        </td>
                        <td className="font-mono text-[11px] px-3 py-2.5">
                          {(s.alpha_price_tao || s.moving_price || 0).toFixed(6)}{" "}
                          <span className="text-muted text-[9px]">τ</span>
                        </td>
                        <td className={`font-mono text-[11px] px-3 py-2.5 ${(s.price_vs_ema || 1) <= 1.0 ? "text-green" : "text-red"}`}>
                          {(s.price_vs_ema || 0).toFixed(3)}
                        </td>
                        <td className="font-mono text-[11px] text-yellow px-3 py-2.5">
                          {(s.emission_share_pct || 0).toFixed(3)}%
                        </td>
                        <td className="font-mono text-[11px] text-cyan px-3 py-2.5">
                          {fmtComma(s.tao_in || 0)}
                        </td>
                        <td className={`font-mono text-[11px] px-3 py-2.5 ${(s.ema_tao_inflow || 0) >= 0 ? "text-green" : "text-red"}`}>
                          {fmtInflow(s.ema_tao_inflow || 0)} τ
                        </td>
                        <td className="font-mono text-[11px] px-3 py-2.5">
                          {fmtVolume(s.subnet_volume || 0)}
                        </td>
                        <td className="font-mono text-[11px] text-muted px-3 py-2.5">{s.miners || "—"}</td>
                        <td className="px-3 py-2.5">
                          <span className={`inline-flex items-center gap-1 font-mono text-[9px] tracking-[0.06em] uppercase px-1.5 py-0.5 border ${tier.color}`}>
                            <span className="w-1 h-1 rounded-full bg-current" />
                            {tier.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Disclaimer */}
        <div className="border-t border-border mt-5 pt-5">
          <p className="font-mono text-[10px] text-muted leading-relaxed">
            <strong className="text-text">DISCLAIMER:</strong> TAO Signals provides quantitative data analysis tools for informational and educational purposes only. Nothing on this platform constitutes financial advice. Past performance is not indicative of future results. Cryptocurrency markets are highly volatile and involve significant risk.
          </p>
        </div>
      </div>
    </div>
  );
}
