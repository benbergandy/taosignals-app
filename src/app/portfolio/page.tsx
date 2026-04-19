"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { supabase, API_BASE } from "@/lib/supabase";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";

/* ── Types ──────────────────────────────────────────────────── */

interface Profile {
  id: string;
  email: string;
  risk_preference: string;
  tao_budget: number;
  wallet_address: string | null;
  rebalance_frequency: string;
}

interface Position {
  netuid: number;
  name: string;
  tao_value: number;
  alpha_tokens: number;
  price_tao: number;
  cost_basis: number;
  pnl_tao: number;
  pnl_pct: number;
  pct_of_portfolio: number;
}

interface HistoryPoint {
  date: string;
  total_value: number;
}

interface PortfolioData {
  total_value_tao: number;
  total_pnl_tao: number;
  total_pnl_pct: number;
  free_balance_tao: number;
  total_staked_tao: number;
  n_positions: number;
  tao_usd: number;
  positions: Position[];
  history?: HistoryPoint[];
  timestamp: string;
}

interface ScoreEntry {
  netuid: number;
  name: string;
  combined_score: number;
}

interface ScoresData {
  scores: ScoreEntry[];
  generated_at?: string;
}

interface RiskSubnet {
  volatility?: number;
  max_drawdown_pct?: number;
  sortino_ratio?: number;
}

/* ── Constants ──────────────────────────────────────────────── */

const OPTIM_DESCRIPTIONS: Record<string, string> = {
  sortino: "Maximize return per unit downside risk",
  sharpe: "Maximize return per unit total volatility",
  calmar: "Maximize return per unit max drawdown",
  alpha: "Maximize expected return (ignore risk)",
};

const RISK_PRESETS: Record<string, { root: number; maxPos: number; maxN: number; minSortino: number; maxVol: number; maxDD: number }> = {
  conservative: { root: 40, maxPos: 8, maxN: 12, minSortino: 5, maxVol: 30, maxDD: 50 },
  balanced: { root: 15, maxPos: 12, maxN: 20, minSortino: 0, maxVol: 60, maxDD: 100 },
  aggressive: { root: 10, maxPos: 20, maxN: 25, minSortino: -5, maxVol: 150, maxDD: 200 },
};

const CHART_RANGES = ["1D", "1W", "1M", "3M", "YTD", "1Y", "ALL"] as const;

/* ── Helpers ────────────────────────────────────────────────── */

function fmtVal(val: number, unit: string) {
  if (unit === "usd") return "$" + val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return val.toFixed(4) + " TAO";
}

function fmtPnl(val: number, pct: number, unit: string) {
  const sign = val >= 0 ? "+" : "";
  const valStr = unit === "usd" ? sign + "$" + Math.abs(val).toFixed(2) : sign + val.toFixed(4) + " TAO";
  return valStr + " (" + sign + pct.toFixed(2) + "%)";
}

/* ── Component ──────────────────────────────────────────────── */

export default function PortfolioPage() {
  /* Auth state */
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authTab, setAuthTab] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");

  /* Portfolio state */
  const [portfolioData, setPortfolioData] = useState<PortfolioData | null>(null);
  const [displayUnit, setDisplayUnit] = useState<"tao" | "usd">("tao");
  const [chartRange, setChartRange] = useState("1M");

  /* Wallet */
  const [walletInput, setWalletInput] = useState("");

  /* Manager */
  const [managerEnabled, setManagerEnabled] = useState(false);
  const [showManagerWarning, setShowManagerWarning] = useState(false);
  const [tradeWarning, setTradeWarning] = useState(false);

  /* Builder */
  const [optimizeMode, setOptimizeMode] = useState("sortino");
  const [sliderRoot, setSliderRoot] = useState(15);
  const [sliderMaxPos, setSliderMaxPos] = useState(12);
  const [sliderMaxN, setSliderMaxN] = useState(20);
  const [sliderMinSortino, setSliderMinSortino] = useState(0);
  const [sliderMaxVol, setSliderMaxVol] = useState(60);
  const [sliderMaxDD, setSliderMaxDD] = useState(100);
  const [taoBudget, setTaoBudget] = useState(1000);
  const [rebalanceFreq, setRebalanceFreq] = useState("daily");

  /* Recommendations */
  const [recommendations, setRecommendations] = useState<string | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);

  /* Expandable sections */
  const [expandedPositions, setExpandedPositions] = useState<Set<number>>(new Set());
  const [showManualTrade, setShowManualTrade] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [manualSubnet, setManualSubnet] = useState("");
  const [manualAmount, setManualAmount] = useState("");
  const [manualAction, setManualAction] = useState<"stake" | "unstake">("stake");
  const [manualTradePreview, setManualTradePreview] = useState("");

  const chartRef = useRef<HTMLDivElement>(null);

  /* ── Auth init ────────────────────────────────────────────── */

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        setUser(session.user);
        await loadProfile(session.user);
      }
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        setUser(session.user);
        await loadProfile(session.user);
      } else {
        setUser(null);
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Profile CRUD ─────────────────────────────────────────── */

  async function loadProfile(u: User) {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", u.id)
      .single();

    if (error && error.code === "PGRST116") {
      const { data: newProfile, error: insertError } = await supabase
        .from("user_profiles")
        .insert({
          id: u.id,
          email: u.email,
          risk_preference: "balanced",
          tao_budget: 1000,
          rebalance_frequency: "daily",
        })
        .select()
        .single();

      if (!insertError && newProfile) {
        setProfile(newProfile as Profile);
        setTaoBudget(1000);
        setRebalanceFreq("daily");
        applyPreset("balanced");
      }
    } else if (data) {
      const p = data as Profile;
      setProfile(p);
      setTaoBudget(p.tao_budget || 1000);
      setRebalanceFreq(p.rebalance_frequency || "daily");
      if (p.risk_preference && p.risk_preference !== "custom") {
        applyPreset(p.risk_preference);
      }
    }
  }

  const saveProfile = useCallback(async (updates: Partial<Profile>) => {
    if (!user || !profile) return;
    const merged = { ...profile, ...updates };
    const { error } = await supabase
      .from("user_profiles")
      .update({
        risk_preference: merged.risk_preference,
        tao_budget: merged.tao_budget,
        rebalance_frequency: merged.rebalance_frequency,
        wallet_address: merged.wallet_address,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);
    if (!error) {
      setProfile(merged);
    }
  }, [user, profile]);

  /* ── Auth actions ─────────────────────────────────────────── */

  async function handleAuth() {
    setAuthError("");
    setAuthSuccess("");

    if (!email || !password) {
      setAuthError("Please enter email and password");
      return;
    }

    if (authTab === "signup") {
      if (password.length < 6) {
        setAuthError("Password must be at least 6 characters");
        return;
      }
      if (password !== confirmPassword) {
        setAuthError("Passwords do not match");
        return;
      }
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) { setAuthError(error.message); return; }
      setAuthSuccess("Account created! Check your email to confirm, then sign in.");
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { setAuthError(error.message); return; }
      setUser(data.user);
      await loadProfile(data.user);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setPortfolioData(null);
  }

  /* ── Wallet ───────────────────────────────────────────────── */

  async function connectWallet() {
    const addr = walletInput.trim();
    if (!addr || !addr.startsWith("5") || addr.length < 40) {
      alert("Please enter a valid Bittensor coldkey address (starts with 5)");
      return;
    }
    await saveProfile({ wallet_address: addr });
  }

  async function disconnectWallet() {
    setWalletInput("");
    await saveProfile({ wallet_address: null });
    setPortfolioData(null);
  }

  /* ── Load portfolio ───────────────────────────────────────── */

  const loadPortfolio = useCallback(async () => {
    if (!profile?.wallet_address) return;
    try {
      const res = await fetch(`${API_BASE}/api/portfolio?address=${encodeURIComponent(profile.wallet_address)}`);
      const data = await res.json();
      if (data.error) return;
      setPortfolioData(data);
    } catch {
      // handled by null state
    }
  }, [profile?.wallet_address]);

  useEffect(() => {
    if (profile?.wallet_address) loadPortfolio();
  }, [profile?.wallet_address, loadPortfolio]);

  /* ── Risk presets ─────────────────────────────────────────── */

  function applyPreset(preset: string) {
    const p = RISK_PRESETS[preset];
    if (!p) return;
    setSliderRoot(p.root);
    setSliderMaxPos(p.maxPos);
    setSliderMaxN(p.maxN);
    setSliderMinSortino(p.minSortino);
    setSliderMaxVol(p.maxVol);
    setSliderMaxDD(p.maxDD);
  }

  function setRisk(risk: string) {
    if (risk !== "custom") applyPreset(risk);
    saveProfile({ risk_preference: risk });
  }

  function setRebalance(freq: string) {
    setRebalanceFreq(freq);
    saveProfile({ rebalance_frequency: freq });
  }

  /* ── Portfolio manager toggle ─────────────────────────────── */

  function toggleManager() {
    if (!managerEnabled) {
      setShowManagerWarning(true);
    } else {
      setManagerEnabled(false);
    }
  }

  function confirmManager(confirmed: boolean) {
    setShowManagerWarning(false);
    if (confirmed) setManagerEnabled(true);
  }

  function handleTradeClick() {
    if (managerEnabled) {
      setTradeWarning(true);
      setTimeout(() => setTradeWarning(false), 5000);
      return;
    }
    // Would open trade modal
  }

  /* ── Manual trade preview ─────────────────────────────────── */

  function previewManualTrade() {
    const subnet = parseInt(manualSubnet);
    const amount = parseFloat(manualAmount);
    if (!subnet || !amount || amount <= 0) {
      setManualTradePreview("error");
      return;
    }
    setManualTradePreview("ok");
  }

  /* ── Recommendations ──────────────────────────────────────── */

  async function loadRecommendations() {
    setRecsLoading(true);
    try {
      const res = await fetch("/data/combined_scores.json?t=" + Date.now());
      const scores: ScoresData = await res.json();

      let riskSubs: Record<string, RiskSubnet> = {};
      try {
        const riskRes = await fetch("/data/risk_metrics.json?t=" + Date.now());
        const riskData = await riskRes.json();
        riskSubs = riskData?.subnets || {};
      } catch { /* no risk data */ }

      const budget = taoBudget;
      const rootPct = sliderRoot;
      const deployable = budget * (1 - rootPct / 100);
      const rootTao = budget * rootPct / 100;
      const maxPositions = sliderMaxN;
      const minSortino = sliderMinSortino / 10;

      const candidates = scores.scores
        .filter((s) => {
          const r = riskSubs[String(s.netuid)] || {};
          const vol = r.volatility ?? 999;
          const dd = r.max_drawdown_pct ?? 999;
          const sortino = r.sortino_ratio ?? 0;
          return vol <= sliderMaxVol && dd <= sliderMaxDD && sortino >= minSortino;
        })
        .sort((a, b) => b.combined_score - a.combined_score)
        .slice(0, maxPositions);

      if (!candidates.length) {
        setRecommendations("empty");
        setRecsLoading(false);
        return;
      }

      const totalScore = candidates.reduce((s, c) => s + c.combined_score, 0);
      const risk = profile?.risk_preference || "balanced";

      const recData = {
        rootPct,
        rootTao,
        candidates: candidates.map((s, i) => {
          const alloc = (s.combined_score / totalScore) * deployable;
          const pct = (alloc / budget * 100).toFixed(1);
          return { rank: i + 1, netuid: s.netuid, name: s.name, score: s.combined_score, alloc, pct };
        }),
        risk,
        budget,
        count: candidates.length,
        generated_at: scores.generated_at || "-",
      };

      setRecommendations(JSON.stringify(recData));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setRecommendations("error:" + msg);
    }
    setRecsLoading(false);
  }

  /* ── Chart rendering ──────────────────────────────────────── */

  function renderChart(d: PortfolioData): string {
    if (!d.history || d.history.length < 2) {
      return "";
    }

    const now = new Date();
    const cutoff = new Date();
    const rangeKey = chartRange.toLowerCase();
    switch (rangeKey) {
      case "1d": cutoff.setDate(now.getDate() - 1); break;
      case "1w": cutoff.setDate(now.getDate() - 7); break;
      case "1m": cutoff.setMonth(now.getMonth() - 1); break;
      case "3m": cutoff.setMonth(now.getMonth() - 3); break;
      case "ytd": cutoff.setTime(new Date(now.getFullYear(), 0, 1).getTime()); break;
      case "1y": cutoff.setFullYear(now.getFullYear() - 1); break;
      case "all": cutoff.setTime(new Date(2020, 0, 1).getTime()); break;
    }
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    let filtered = d.history.filter((h) => h.date >= cutoffStr);
    if (filtered.length < 2) filtered = d.history;

    const mult = displayUnit === "usd" ? d.tao_usd : 1;
    const values = filtered.map((h) => h.total_value * mult);
    const dates = filtered.map((h) => h.date);
    const minVal = Math.min(...values) * 0.95;
    const maxVal = Math.max(...values) * 1.05;
    const range = maxVal - minVal || 1;
    const w = chartRef.current?.offsetWidth || 700;
    const h = 200;
    const padding = 40;
    const chartW = w - padding * 2;
    const chartH = h - padding;

    const points = values.map((v, i) => {
      const x = padding + (i / (values.length - 1)) * chartW;
      const y = h - padding - ((v - minVal) / range) * chartH;
      return `${x},${y}`;
    });

    const lineColor = values[values.length - 1] >= values[0] ? "#00ff88" : "#ff3355";

    let svg = `<svg width="${w}" height="${h}" style="width:100%;height:${h}px">`;
    for (let gi = 0; gi <= 4; gi++) {
      const gy = h - padding - (gi / 4) * chartH;
      const gval = minVal + (gi / 4) * range;
      svg += `<line x1="${padding}" y1="${gy}" x2="${w - 10}" y2="${gy}" stroke="#1a2230" stroke-width="1"/>`;
      svg += `<text x="${padding - 5}" y="${gy + 3}" fill="#445566" font-size="9" font-family="IBM Plex Mono" text-anchor="end">${displayUnit === "usd" ? "$" + gval.toFixed(0) : gval.toFixed(2)}</text>`;
    }
    svg += `<polyline points="${points.join(" ")}" fill="none" stroke="${lineColor}" stroke-width="2"/>`;
    points.forEach((pt) => {
      const [cx, cy] = pt.split(",");
      svg += `<circle cx="${cx}" cy="${cy}" r="3" fill="${lineColor}"/>`;
    });
    const labelEvery = Math.max(1, Math.floor(dates.length / 5));
    dates.forEach((dt, i) => {
      if (i % labelEvery === 0 || i === dates.length - 1) {
        const x = padding + (i / (dates.length - 1)) * chartW;
        svg += `<text x="${x}" y="${h - 5}" fill="#445566" font-size="9" font-family="IBM Plex Mono" text-anchor="middle">${dt.slice(5)}</text>`;
      }
    });
    svg += "</svg>";
    return svg;
  }

  /* ── Password match indicator ─────────────────────────────── */

  const passwordMatch = confirmPassword
    ? password === confirmPassword
      ? "match"
      : "mismatch"
    : null;

  /* ── Derived values ───────────────────────────────────────── */

  const mult = portfolioData ? (displayUnit === "usd" ? portfolioData.tao_usd : 1) : 1;
  const hasWallet = !!(profile?.wallet_address);
  const strategyLabel = `${optimizeMode.toUpperCase()} | ${(profile?.risk_preference || "balanced").toUpperCase()} | ${sliderRoot}% root | ${sliderMaxN} max positions`;

  /* ── RENDER ───────────────────────────────────────────────── */

  // Loading
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="font-mono text-[11px] text-muted">Loading...</div>
      </div>
    );
  }

  // Auth gate
  if (!user) {
    return (
      <div className="max-w-[800px] mx-auto px-6 py-10">
        <div className="max-w-[420px] mx-auto relative z-10">
          <div className="bg-surface border border-border p-8 sm:px-10 animate-[fadeUp_0.4s_ease_both] mb-6">
            <div className="font-mono text-sm font-semibold text-text text-center mb-1.5">TAO Signals Portfolio</div>
            <div className="text-xs text-muted text-center mb-6 leading-relaxed">
              Personalized subnet allocations powered by our quantitative model.
              Set your risk profile, connect your wallet, get recommendations.
            </div>

            {/* Feature list */}
            <div className="mb-5">
              {[
                "Risk-adjusted portfolio recommendations",
                "Connect wallet to track positions",
                "Conservative, balanced, or aggressive profiles",
                "Self-custody — we never touch your keys",
              ].map((feat) => (
                <div key={feat} className="flex items-center gap-2 py-1.5 text-xs text-muted">
                  <span className="text-green text-sm">+</span> {feat}
                </div>
              ))}
            </div>

            {/* Auth tabs */}
            <div className="flex border-b border-border2 mb-5">
              <button
                className={`flex-1 font-mono text-[10px] tracking-[0.12em] uppercase py-2.5 text-center border-b-2 transition-all ${authTab === "signin" ? "text-cyan border-cyan" : "text-muted border-transparent"}`}
                onClick={() => { setAuthTab("signin"); setAuthError(""); setAuthSuccess(""); }}
              >Sign In</button>
              <button
                className={`flex-1 font-mono text-[10px] tracking-[0.12em] uppercase py-2.5 text-center border-b-2 transition-all ${authTab === "signup" ? "text-cyan border-cyan" : "text-muted border-transparent"}`}
                onClick={() => { setAuthTab("signup"); setAuthError(""); setAuthSuccess(""); }}
              >Sign Up</button>
            </div>

            {/* Email */}
            <div className="mb-4">
              <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">Email</label>
              <input
                type="email"
                className="font-mono text-[13px] bg-surface2 border border-border2 text-text px-3.5 py-2.5 w-full outline-none focus:border-cyan transition-colors placeholder:text-dim"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {/* Password */}
            <div className="mb-4">
              <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">
                {authTab === "signup" ? "Create Password" : "Password"}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  className="font-mono text-[13px] bg-surface2 border border-border2 text-text px-3.5 py-2.5 w-full pr-10 outline-none focus:border-cyan transition-colors placeholder:text-dim"
                  placeholder="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <span
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer font-mono text-[9px] text-muted uppercase tracking-[0.08em] select-none"
                >{showPassword ? "hide" : "show"}</span>
              </div>
            </div>

            {/* Confirm password (signup only) */}
            {authTab === "signup" && (
              <div className="mb-4">
                <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">
                  Confirm Password
                  {passwordMatch && (
                    <span className={`ml-2 ${passwordMatch === "match" ? "text-green" : "text-red"}`}>
                      {passwordMatch === "match" ? "Passwords match" : "Passwords do not match"}
                    </span>
                  )}
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    className="font-mono text-[13px] bg-surface2 border border-border2 text-text px-3.5 py-2.5 w-full pr-10 outline-none focus:border-cyan transition-colors placeholder:text-dim"
                    placeholder="confirm password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  <span
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer font-mono text-[9px] text-muted uppercase tracking-[0.08em] select-none"
                  >{showConfirmPassword ? "hide" : "show"}</span>
                </div>
              </div>
            )}

            {authError && <div className="font-mono text-[11px] text-red mt-2">{authError}</div>}
            {authSuccess && <div className="font-mono text-[11px] text-green mt-2">{authSuccess}</div>}

            <div className="mt-5">
              <button
                className="font-mono text-[11px] tracking-[0.1em] uppercase py-3 px-6 w-full bg-cyan text-bg font-semibold cursor-pointer hover:brightness-110 transition-all border-none"
                onClick={handleAuth}
              >{authTab === "signup" ? "Create Account" : "Sign In"}</button>
            </div>
          </div>
        </div>

        {/* Blurred preview */}
        <div className="blur-[6px] pointer-events-none select-none opacity-30 mt-6">
          <div className="bg-surface border border-border p-6 mb-6">
            <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-green mb-4 pb-2.5 border-b border-border">Risk Profile</div>
            <div className="flex">
              <button className="font-mono text-[10px] uppercase px-4 py-2 border border-border2 text-muted bg-transparent">Conservative</button>
              <button className="font-mono text-[10px] uppercase px-4 py-2 border border-border2 border-l-0 text-cyan bg-cyan/[0.08]">Balanced</button>
              <button className="font-mono text-[10px] uppercase px-4 py-2 border border-border2 border-l-0 text-muted bg-transparent">Aggressive</button>
            </div>
          </div>
          <div className="bg-surface border border-border p-6 mb-6">
            <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-yellow mb-4 pb-2.5 border-b border-border">Recommended Allocations</div>
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="bg-surface2 border border-border p-3.5 mb-2 grid grid-cols-[auto_1fr_auto_auto] gap-4 items-center">
                <div className="font-mono text-lg font-bold text-dim w-[30px] text-center">{i}</div>
                <div className="font-semibold text-sm">SN--- --------</div>
                <div className="font-mono text-[11px]">Score: --.-</div>
                <div className="font-mono text-sm font-semibold text-cyan text-right">--- TAO<span className="block text-[9px] text-muted font-normal">--%</span></div>
              </div>
            ))}
          </div>
          <div className="bg-surface border border-border p-6">
            <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-cyan mb-4 pb-2.5 border-b border-border">Wallet Connection</div>
            <div className="py-4 text-dim">Connect your wallet to track positions...</div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Logged-in view ───────────────────────────────────────── */

  return (
    <div className="max-w-[800px] mx-auto px-6 py-10">

      {/* ── Portfolio Hero (when wallet connected) ──────────── */}
      {hasWallet && (
        <>
          {/* Value + P&L header */}
          <div className="bg-surface border border-border p-6 sm:px-8 sm:py-8 mb-6 animate-[fadeUp_0.4s_ease_both]">
            <div className="flex justify-between items-start mb-4">
              <div>
                <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">Total Portfolio Value</div>
                <div className="font-mono text-4xl font-bold leading-none">
                  {portfolioData ? fmtVal(portfolioData.total_value_tao * mult, displayUnit) : "-"}
                </div>
                {portfolioData && (
                  <div
                    className="font-mono text-base mt-1.5"
                    style={{ color: portfolioData.total_pnl_tao >= 0 ? "#00ff88" : "#ff3355" }}
                  >
                    {fmtPnl(portfolioData.total_pnl_tao * mult, portfolioData.total_pnl_pct, displayUnit)}
                  </div>
                )}
              </div>
              <div className="flex gap-2 items-start">
                <div className="flex">
                  <button
                    className={`font-mono text-[10px] uppercase px-3 py-1.5 border border-border2 transition-all ${displayUnit === "tao" ? "text-cyan bg-cyan/[0.08]" : "text-muted bg-transparent"}`}
                    onClick={() => setDisplayUnit("tao")}
                  >TAO</button>
                  <button
                    className={`font-mono text-[10px] uppercase px-3 py-1.5 border border-border2 border-l-0 transition-all ${displayUnit === "usd" ? "text-cyan bg-cyan/[0.08]" : "text-muted bg-transparent"}`}
                    onClick={() => setDisplayUnit("usd")}
                  >USD</button>
                </div>
                <button
                  className="font-mono text-[10px] tracking-[0.08em] uppercase px-3.5 py-1.5 cursor-pointer bg-green text-bg font-semibold border-none"
                  onClick={handleTradeClick}
                >Trade</button>
              </div>
            </div>

            {/* Active strategy label */}
            {managerEnabled && (
              <div className="font-mono text-[9px] tracking-[0.1em] uppercase text-muted mb-3">
                Strategy: <span className="text-cyan">{strategyLabel}</span>
              </div>
            )}

            {/* Pool split */}
            <div className="grid grid-cols-2 gap-px bg-border border border-border mb-3">
              <div className="bg-surface p-3.5">
                <div className="flex justify-between items-center mb-1.5">
                  <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted">Managed Pool</div>
                  {managerEnabled && (
                    <div className="font-mono text-[8px] px-1.5 py-0.5 bg-cyan/[0.08] border border-cyan text-cyan">BOT</div>
                  )}
                </div>
                <div className="font-mono text-xl font-semibold text-cyan">
                  {portfolioData
                    ? managerEnabled
                      ? fmtVal(portfolioData.total_staked_tao * mult, displayUnit)
                      : fmtVal(0, displayUnit)
                    : "-"}
                </div>
                <div className="font-mono text-[9px] text-dim mt-1">
                  {managerEnabled ? `${optimizeMode.toUpperCase()} strategy` : "Portfolio manager off"}
                </div>
              </div>
              <div className="bg-surface p-3.5">
                <div className="flex justify-between items-center mb-1.5">
                  <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted">Free Pool</div>
                  <div className="font-mono text-[8px] px-1.5 py-0.5 bg-green/[0.08] border border-green text-green">MANUAL</div>
                </div>
                <div className="font-mono text-xl font-semibold text-green">
                  {portfolioData
                    ? managerEnabled
                      ? fmtVal(portfolioData.free_balance_tao * mult, displayUnit)
                      : fmtVal(portfolioData.total_value_tao * mult, displayUnit)
                    : "-"}
                </div>
                <div className="font-mono text-[9px] text-dim mt-1">Available for manual trades</div>
              </div>
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-4 gap-px bg-border border border-border">
              <div className="bg-surface p-2.5 text-center">
                <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">Unstaked</div>
                <div className="font-mono text-[13px] font-semibold text-cyan">
                  {portfolioData ? fmtVal(portfolioData.free_balance_tao * mult, displayUnit) : "-"}
                </div>
              </div>
              <div className="bg-surface p-2.5 text-center">
                <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">Staked</div>
                <div className="font-mono text-[13px] font-semibold text-green">
                  {portfolioData ? fmtVal(portfolioData.total_staked_tao * mult, displayUnit) : "-"}
                </div>
              </div>
              <div className="bg-surface p-2.5 text-center">
                <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">Positions</div>
                <div className="font-mono text-[13px] font-semibold text-text">
                  {portfolioData ? portfolioData.n_positions : "-"}
                </div>
              </div>
              <div className="bg-surface p-2.5 text-center">
                <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">TAO/USD</div>
                <div className="font-mono text-[13px] font-semibold text-yellow">
                  {portfolioData ? "$" + portfolioData.tao_usd.toFixed(2) : "-"}
                </div>
              </div>
            </div>
          </div>

          {/* Chart with time range */}
          <div className="bg-surface border border-border p-6 mb-6 animate-[fadeUp_0.4s_ease_both]">
            <div className="flex justify-between items-center mb-3">
              <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-muted">Portfolio History</div>
              <div className="flex gap-1">
                {CHART_RANGES.map((r) => (
                  <button
                    key={r}
                    className={`font-mono text-[10px] uppercase px-3 py-1.5 border border-border2 transition-all cursor-pointer ${chartRange === r ? "text-cyan bg-cyan/[0.08]" : "text-muted bg-transparent hover:text-text hover:bg-surface2"}`}
                    onClick={() => setChartRange(r)}
                  >{r}</button>
                ))}
              </div>
            </div>
            <div
              ref={chartRef}
              className="h-[200px] flex items-center justify-center font-mono text-[11px] text-muted"
              dangerouslySetInnerHTML={
                portfolioData && portfolioData.history && portfolioData.history.length >= 2
                  ? { __html: renderChart(portfolioData) }
                  : { __html: portfolioData ? "Chart requires 2+ days of data" : "Loading chart..." }
              }
            />
          </div>

          {/* Managed Holdings (when manager on) */}
          {managerEnabled && (
            <div className="bg-surface border border-border p-6 mb-6 animate-[fadeUp_0.4s_ease_both]">
              <div className="flex justify-between items-center mb-3">
                <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-cyan">Managed Holdings</div>
                <div className="font-mono text-[8px] px-1.5 py-0.5 bg-cyan/[0.08] border border-cyan text-cyan">BOT CONTROLLED</div>
              </div>
              <div className="font-mono text-[11px] text-muted py-5 text-center">
                Enable portfolio manager to see managed positions
              </div>
            </div>
          )}

          {/* Holdings */}
          <div className="bg-surface border border-border p-6 mb-6 animate-[fadeUp_0.4s_ease_both]">
            <div className="flex justify-between items-center mb-3">
              <div
                className="font-mono text-[10px] tracking-[0.15em] uppercase"
                style={{ color: managerEnabled ? "#00ff88" : undefined }}
              >
                {managerEnabled ? "Free Holdings" : "Holdings"}
              </div>
              <button
                className="font-mono text-[9px] tracking-[0.1em] uppercase px-3 py-1.5 border border-border2 text-muted bg-transparent cursor-pointer hover:border-cyan hover:text-cyan transition-all"
                onClick={loadPortfolio}
              >Refresh</button>
            </div>

            {!portfolioData ? (
              <div className="font-mono text-[11px] text-muted py-3 text-center">Loading...</div>
            ) : (
              <>
                {portfolioData.positions.map((p) => {
                  const val = p.tao_value * mult;
                  const pnl = p.pnl_tao * mult;
                  const color = p.pnl_tao >= 0 ? "#00ff88" : "#ff3355";
                  const sign = p.pnl_tao >= 0 ? "+" : "";
                  const costVal = p.cost_basis * mult;
                  const expanded = expandedPositions.has(p.netuid);

                  return (
                    <div key={p.netuid} className="bg-surface2 border border-border mb-1.5">
                      {/* Main row */}
                      <div
                        className="p-3.5 grid grid-cols-[60px_1fr_auto] gap-3 items-center cursor-pointer"
                        onClick={() => {
                          const next = new Set(expandedPositions);
                          if (next.has(p.netuid)) next.delete(p.netuid);
                          else next.add(p.netuid);
                          setExpandedPositions(next);
                        }}
                      >
                        <div className="text-center">
                          <div className="font-mono text-[11px] text-muted">SN{p.netuid}</div>
                          <div className="text-[10px] text-dim">{p.pct_of_portfolio.toFixed(1)}%</div>
                        </div>
                        <div>
                          <div className="font-semibold text-[13px] mb-1">
                            {p.name} <span className="text-[9px] text-dim">click to expand</span>
                          </div>
                          <div className="font-mono text-[10px] text-muted">
                            {p.alpha_tokens.toFixed(2)} tokens @ {p.price_tao.toFixed(6)} TAO
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-sm font-semibold">{fmtVal(val, displayUnit)}</div>
                          {p.cost_basis > 0 && (
                            <div className="font-mono text-[11px]" style={{ color }}>
                              {sign}{p.pnl_pct.toFixed(1)}% ({displayUnit === "usd" ? sign + "$" + Math.abs(pnl).toFixed(2) : sign + Math.abs(pnl).toFixed(4) + " TAO"})
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Expanded detail */}
                      {expanded && (
                        <div className="px-3.5 pb-3.5 border-t border-border">
                          <div className="grid grid-cols-3 gap-3 mt-3">
                            <div>
                              <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">Cost Basis</div>
                              <div className="font-mono text-xs">{fmtVal(costVal, displayUnit)}</div>
                            </div>
                            <div>
                              <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">Current Value</div>
                              <div className="font-mono text-xs">{fmtVal(val, displayUnit)}</div>
                            </div>
                            <div>
                              <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">P&L</div>
                              <div className="font-mono text-xs" style={{ color }}>{fmtPnl(pnl, p.pnl_pct, displayUnit)}</div>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-3 mt-2">
                            <div>
                              <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">Alpha Tokens</div>
                              <div className="font-mono text-xs">{p.alpha_tokens.toFixed(4)}</div>
                            </div>
                            <div>
                              <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">Token Price</div>
                              <div className="font-mono text-xs">{p.price_tao.toFixed(6)} TAO</div>
                            </div>
                            <div>
                              <div className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1">% of Portfolio</div>
                              <div className="font-mono text-xs">{p.pct_of_portfolio.toFixed(1)}%</div>
                            </div>
                          </div>
                          <div className="mt-2">
                            <Link href={`/subnet?id=${p.netuid}`} className="font-mono text-[10px] text-cyan no-underline">
                              View subnet detail &rarr;
                            </Link>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Free balance row */}
                <div className="bg-surface border border-cyan p-3.5 mb-1.5 grid grid-cols-[60px_1fr_auto] gap-3 items-center">
                  <div className="text-center font-mono text-[11px] text-cyan">FREE</div>
                  <div className="font-semibold text-[13px] text-cyan">Unstaked Balance</div>
                  <div className="text-right font-mono text-sm font-semibold text-cyan">
                    {fmtVal(portfolioData.free_balance_tao * mult, displayUnit)}
                  </div>
                </div>

                <div className="font-mono text-[9px] text-dim mt-2 text-right">
                  Updated: {new Date(portfolioData.timestamp).toLocaleString()}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* Wallet connection (when no wallet) */}
      {!hasWallet && (
        <div className="bg-surface border border-border p-6 mb-6 animate-[fadeUp_0.4s_ease_both]">
          <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-cyan mb-4 pb-2.5 border-b border-border">Connect Your Wallet</div>
          <div className="mb-4">
            <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">Bittensor Coldkey Address</label>
            <input
              type="text"
              className="font-mono text-[13px] bg-surface2 border border-border2 text-text px-3.5 py-2.5 w-full outline-none focus:border-cyan transition-colors placeholder:text-dim"
              placeholder="5Fgft...mPvB (your public address, NOT your seed phrase)"
              value={walletInput}
              onChange={(e) => setWalletInput(e.target.value)}
            />
          </div>
          <div className="font-mono text-[9px] text-muted mb-3 leading-relaxed">
            Paste your public coldkey address (starts with 5). This is NOT your seed phrase or private key.
            Your address is already public on the blockchain. We use it to read your positions.
          </div>
          <button
            className="font-mono text-[11px] tracking-[0.1em] uppercase px-5 py-2.5 bg-cyan text-bg font-semibold cursor-pointer hover:brightness-110 transition-all border-none"
            onClick={connectWallet}
          >Connect Wallet</button>
        </div>
      )}

      {/* Portfolio Manager Toggle */}
      <div className="bg-surface border border-border p-6 mb-6 animate-[fadeUp_0.4s_ease_both]">
        <div className="flex justify-between items-center">
          <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-muted">Portfolio Manager</div>
          <div className="flex items-center gap-2.5">
            <span className={`font-mono text-[10px] ${managerEnabled ? "text-green" : "text-muted"}`}>
              {managerEnabled ? "ON" : "OFF"}
            </span>
            <div
              onClick={toggleManager}
              className="w-11 h-6 rounded-xl cursor-pointer relative transition-colors"
              style={{ background: managerEnabled ? "#00ff88" : "#243040" }}
            >
              <div
                className="w-5 h-5 rounded-full absolute top-0.5 transition-all"
                style={{
                  left: managerEnabled ? "22px" : "2px",
                  background: managerEnabled ? "#050709" : "#445566",
                }}
              />
            </div>
          </div>
        </div>
        <div className="font-mono text-[10px] text-dim mt-2 leading-relaxed">
          When enabled, the TAO Signals bot will automatically manage your portfolio based on the strategy you configure below.
        </div>

        {/* Manager warning */}
        {showManagerWarning && (
          <div className="mt-3 p-3.5 bg-yellow/[0.06] border border-yellow">
            <div className="font-mono text-[10px] text-yellow font-semibold mb-2">IMPORTANT: AUTOMATED PORTFOLIO MANAGEMENT</div>
            <div className="font-mono text-[10px] text-muted leading-relaxed">
              By enabling the portfolio manager, you authorize the TAO Signals bot to automatically
              stake and unstake TAO on your behalf according to your configured strategy. This means:
            </div>
            <ul className="font-mono text-[10px] text-muted leading-[1.8] my-2 ml-4 p-0 list-disc">
              <li>Your current positions may be rebalanced or exited</li>
              <li>New positions may be opened in subnets selected by the model</li>
              <li>Trades are executed within the limits you set (max position size, root allocation, etc.)</li>
              <li>You can disable the bot at any time — all positions remain yours</li>
              <li>Your private keys never leave your device — the bot signs locally</li>
            </ul>
            <div className="flex gap-2 mt-3">
              <button
                className="font-mono text-[10px] tracking-[0.08em] uppercase px-4 py-2 cursor-pointer bg-yellow text-bg font-semibold border-none"
                onClick={() => confirmManager(true)}
              >I Understand, Enable</button>
              <button
                className="font-mono text-[10px] tracking-[0.08em] uppercase px-4 py-2 cursor-pointer bg-transparent border border-border2 text-muted"
                onClick={() => confirmManager(false)}
              >Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* Portfolio Builder (when manager ON) */}
      {managerEnabled && (
        <>
          <div className="bg-surface border border-border p-6 mb-6 animate-[fadeUp_0.4s_ease_both]">
            <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-yellow mb-4 pb-2.5 border-b border-border">Portfolio Strategy</div>

            {/* Optimization target */}
            <div className="mb-4">
              <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">Optimization Target</label>
              <div className="flex">
                {["sortino", "sharpe", "calmar", "alpha"].map((m) => (
                  <button
                    key={m}
                    className={`font-mono text-[10px] tracking-[0.08em] uppercase px-4 py-2 cursor-pointer border border-border2 transition-all ${m !== "sortino" ? "border-l-0" : ""} ${optimizeMode === m ? "text-cyan bg-cyan/[0.08]" : "text-muted bg-transparent hover:text-text hover:bg-surface2"}`}
                    onClick={() => setOptimizeMode(m)}
                  >{m}</button>
                ))}
              </div>
              <div className="font-mono text-[9px] text-dim mt-1">{OPTIM_DESCRIPTIONS[optimizeMode] || ""}</div>
            </div>

            {/* Risk profile */}
            <div className="mb-4">
              <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">Risk Profile</label>
              <div className="flex">
                {["conservative", "balanced", "aggressive", "custom"].map((r, i) => (
                  <button
                    key={r}
                    className={`font-mono text-[10px] tracking-[0.08em] uppercase px-4 py-2 cursor-pointer border border-border2 transition-all ${i > 0 ? "border-l-0" : ""} ${
                      profile?.risk_preference === r
                        ? r === "conservative"
                          ? "text-green bg-green/[0.08]"
                          : r === "aggressive"
                            ? "text-orange bg-orange/[0.08]"
                            : "text-cyan bg-cyan/[0.08]"
                        : "text-muted bg-transparent hover:text-text hover:bg-surface2"
                    }`}
                    onClick={() => setRisk(r)}
                  >{r}</button>
                ))}
              </div>
            </div>

            {/* Budget */}
            <div className="mb-4">
              <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">TAO Budget</label>
              <input
                type="number"
                className="font-mono text-[13px] bg-surface2 border border-border2 text-text px-3.5 py-2.5 outline-none focus:border-cyan transition-colors max-w-[200px]"
                value={taoBudget}
                min={1}
                step={1}
                onChange={(e) => setTaoBudget(parseFloat(e.target.value) || 0)}
              />
            </div>

            {/* Advanced sliders */}
            <div className="grid grid-cols-2 gap-3 mt-4">
              {/* Root Allocation */}
              <div className="mb-3">
                <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">Root Allocation (min %)</label>
                <div className="flex items-center gap-2">
                  <input type="range" min={0} max={60} value={sliderRoot} onChange={(e) => setSliderRoot(parseInt(e.target.value))} className="flex-1" />
                  <span className="font-mono text-[11px] text-cyan w-[35px]">{sliderRoot}%</span>
                </div>
              </div>
              {/* Max Per Position */}
              <div className="mb-3">
                <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">Max Per Position (%)</label>
                <div className="flex items-center gap-2">
                  <input type="range" min={3} max={30} value={sliderMaxPos} onChange={(e) => setSliderMaxPos(parseInt(e.target.value))} className="flex-1" />
                  <span className="font-mono text-[11px] text-cyan w-[35px]">{sliderMaxPos}%</span>
                </div>
              </div>
              {/* Max Positions */}
              <div className="mb-3">
                <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">Max Positions</label>
                <div className="flex items-center gap-2">
                  <input type="range" min={3} max={30} value={sliderMaxN} onChange={(e) => setSliderMaxN(parseInt(e.target.value))} className="flex-1" />
                  <span className="font-mono text-[11px] text-cyan w-[35px]">{sliderMaxN}</span>
                </div>
              </div>
              {/* Min Sortino */}
              <div className="mb-3">
                <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">Min Sortino Ratio</label>
                <div className="flex items-center gap-2">
                  <input type="range" min={-10} max={20} value={sliderMinSortino} onChange={(e) => setSliderMinSortino(parseInt(e.target.value))} className="flex-1" />
                  <span className="font-mono text-[11px] text-cyan w-[35px]">{(sliderMinSortino / 10).toFixed(1)}</span>
                </div>
              </div>
              {/* Max Volatility */}
              <div className="mb-3">
                <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">Max Volatility (%)</label>
                <div className="flex items-center gap-2">
                  <input type="range" min={10} max={200} value={sliderMaxVol} onChange={(e) => setSliderMaxVol(parseInt(e.target.value))} className="flex-1" />
                  <span className="font-mono text-[11px] text-cyan w-[35px]">{sliderMaxVol}%</span>
                </div>
              </div>
              {/* Max Drawdown */}
              <div className="mb-3">
                <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">Max Drawdown (%)</label>
                <div className="flex items-center gap-2">
                  <input type="range" min={20} max={300} value={sliderMaxDD} onChange={(e) => setSliderMaxDD(parseInt(e.target.value))} className="flex-1" />
                  <span className="font-mono text-[11px] text-cyan w-[35px]">{sliderMaxDD}%</span>
                </div>
              </div>
            </div>

            {/* Rebalance frequency */}
            <div className="mt-4">
              <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">Rebalance Frequency</label>
              <div className="flex">
                {["daily", "weekly", "manual"].map((f, i) => (
                  <button
                    key={f}
                    className={`font-mono text-[10px] tracking-[0.08em] uppercase px-4 py-2 cursor-pointer border border-border2 transition-all ${i > 0 ? "border-l-0" : ""} ${rebalanceFreq === f ? "text-cyan bg-cyan/[0.08]" : "text-muted bg-transparent hover:text-text hover:bg-surface2"}`}
                    onClick={() => setRebalance(f)}
                  >{f}</button>
                ))}
              </div>
            </div>

            {/* Generate button */}
            <div className="mt-5">
              <button
                className="font-mono text-[11px] tracking-[0.1em] uppercase py-3 px-6 w-full bg-cyan text-bg font-semibold cursor-pointer hover:brightness-110 transition-all border-none"
                onClick={loadRecommendations}
                disabled={recsLoading}
              >{recsLoading ? "Generating..." : "Generate Portfolio"}</button>
            </div>
          </div>

          {/* Manual Trade */}
          <div className="bg-surface border border-border p-6 mb-6 animate-[fadeUp_0.4s_ease_both]">
            <div
              className="font-mono text-[10px] tracking-[0.15em] uppercase text-muted pb-2.5 border-b border-border cursor-pointer mb-4"
              onClick={() => setShowManualTrade(!showManualTrade)}
            >
              Manual Trade <span className="text-[8px] text-dim">click to expand</span>
            </div>
            {showManualTrade && (
              <div>
                <div className="font-mono text-[11px] text-muted mb-3 leading-relaxed">
                  Stake into a specific subnet manually. This bypasses the portfolio builder.
                  You maintain full control — the bot (when available) will only execute trades you approve.
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">Subnet (SN#)</label>
                    <input
                      type="number"
                      className="font-mono text-[13px] bg-surface2 border border-border2 text-text px-3.5 py-2.5 w-full outline-none focus:border-cyan transition-colors placeholder:text-dim"
                      placeholder="64"
                      min={0}
                      max={128}
                      value={manualSubnet}
                      onChange={(e) => setManualSubnet(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">Amount (TAO)</label>
                    <input
                      type="number"
                      className="font-mono text-[13px] bg-surface2 border border-border2 text-text px-3.5 py-2.5 w-full outline-none focus:border-cyan transition-colors placeholder:text-dim"
                      placeholder="100"
                      min={0.01}
                      step={0.01}
                      value={manualAmount}
                      onChange={(e) => setManualAmount(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="font-mono text-[9px] tracking-[0.15em] uppercase text-muted mb-1.5 block">Action</label>
                    <div className="flex">
                      <button
                        className={`font-mono text-[10px] uppercase px-4 py-2 border border-border2 transition-all ${manualAction === "stake" ? "text-cyan bg-cyan/[0.08]" : "text-muted bg-transparent"}`}
                        onClick={() => setManualAction("stake")}
                      >Stake</button>
                      <button
                        className={`font-mono text-[10px] uppercase px-4 py-2 border border-border2 border-l-0 transition-all ${manualAction === "unstake" ? "text-cyan bg-cyan/[0.08]" : "text-muted bg-transparent"}`}
                        onClick={() => setManualAction("unstake")}
                      >Unstake</button>
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <button
                    className="font-mono text-[9px] tracking-[0.1em] uppercase px-4 py-2 border border-border2 text-muted bg-transparent cursor-pointer hover:border-cyan hover:text-cyan transition-all"
                    onClick={previewManualTrade}
                  >Preview Trade</button>
                </div>
                {manualTradePreview === "error" && (
                  <div className="font-mono text-[11px] text-red mt-3">Enter a valid subnet number and amount</div>
                )}
                {manualTradePreview === "ok" && (
                  <div className="mt-3 bg-surface border border-border p-3.5">
                    <div className="font-mono text-[9px] text-muted uppercase tracking-[0.1em] mb-2">Trade Preview</div>
                    <div className="font-mono text-[13px] text-text">
                      <span style={{ color: manualAction === "stake" ? "#00ff88" : "#ff3355" }}>{manualAction.toUpperCase()}</span>{" "}
                      {parseFloat(manualAmount).toFixed(2)} TAO &rarr; SN{manualSubnet}
                    </div>
                    <div className="font-mono text-[10px] text-muted mt-2">
                      Execution requires the local bot (coming soon). For now, use btcli or the Bittensor wallet to execute this trade manually.
                    </div>
                    <div className="font-mono text-[9px] text-dim mt-2">
                      btcli stake add --netuid {manualSubnet} --amount {parseFloat(manualAmount).toFixed(2)} --wallet.name default
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Recommendations output */}
          <div className="bg-surface border border-border p-6 mb-6 animate-[fadeUp_0.4s_ease_both]">
            <div className="font-mono text-[10px] tracking-[0.15em] uppercase text-green mb-4 pb-2.5 border-b border-border">Recommended Allocations</div>
            {!recommendations ? (
              <div className="font-mono text-[11px] text-muted py-5 text-center">
                Configure your strategy above and click Generate Portfolio
              </div>
            ) : recommendations === "empty" ? (
              <div className="font-mono text-[11px] text-muted py-5 text-center">
                No subnets pass the risk filters for this profile
              </div>
            ) : recommendations.startsWith("error:") ? (
              <div className="font-mono text-[11px] text-red py-5 text-center">
                Error loading recommendations: {recommendations.slice(6)}
              </div>
            ) : (() => {
              const data = JSON.parse(recommendations);
              return (
                <>
                  {/* Root row */}
                  <div className="bg-surface border border-cyan p-3.5 mb-2 grid grid-cols-[auto_1fr_auto_auto] gap-4 items-center">
                    <div className="font-mono text-lg font-bold text-cyan w-[30px] text-center">R</div>
                    <div className="font-semibold text-sm text-cyan">Root Stake <span className="font-mono text-[10px] text-muted ml-2">base yield</span></div>
                    <div className="font-mono text-[11px] text-muted">{data.rootPct}% reserved</div>
                    <div className="font-mono text-sm font-semibold text-cyan text-right">{data.rootTao.toFixed(0)} TAO<span className="block text-[9px] text-muted font-normal">root</span></div>
                  </div>
                  {data.candidates.map((c: { rank: number; netuid: number; name: string; score: number; alloc: number; pct: string }) => (
                    <div key={c.netuid} className="bg-surface2 border border-border p-3.5 mb-2 grid grid-cols-[auto_1fr_auto_auto] gap-4 items-center">
                      <div className="font-mono text-lg font-bold text-dim w-[30px] text-center">{c.rank}</div>
                      <div className="font-semibold text-sm">
                        <Link href={`/subnet?id=${c.netuid}`} className="text-inherit no-underline border-b border-border2">SN{c.netuid} {c.name}</Link>
                      </div>
                      <div className="font-mono text-[11px]">Score: {c.score.toFixed(1)}</div>
                      <div className="font-mono text-sm font-semibold text-cyan text-right">{c.alloc.toFixed(1)} TAO<span className="block text-[9px] text-muted font-normal">{c.pct}%</span></div>
                    </div>
                  ))}
                  <div className="font-mono text-[9px] text-muted mt-3 text-center">
                    {data.risk.toUpperCase()} profile | {data.budget} TAO budget | {data.count} positions | Updated: {data.generated_at}
                  </div>
                </>
              );
            })()}
          </div>
        </>
      )}

      {/* Account settings */}
      <div className="bg-surface border border-border p-6 mb-6 animate-[fadeUp_0.4s_ease_both]">
        <div
          className="font-mono text-[10px] tracking-[0.15em] uppercase text-muted pb-2.5 border-b border-border cursor-pointer"
          onClick={() => setShowAccount(!showAccount)}
        >
          Account <span className="text-[8px] text-dim">click to expand</span>
        </div>
        {showAccount && (
          <div className="mt-4">
            <div className="flex justify-between items-center py-2.5 border-b border-border/50">
              <span className="text-xs text-muted">Email</span>
              <span className="font-mono text-xs text-text">{user.email}</span>
            </div>
            <div className="flex justify-between items-center py-2.5 border-b border-border/50">
              <span className="text-xs text-muted">Member since</span>
              <span className="font-mono text-xs text-text">{user.created_at ? new Date(user.created_at).toLocaleDateString() : "-"}</span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-xs text-muted">Wallet</span>
              <span className="font-mono text-[10px] text-cyan break-all">{profile?.wallet_address || "-"}</span>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                className="font-mono text-[9px] tracking-[0.1em] uppercase px-4 py-2 border border-red text-red bg-transparent cursor-pointer hover:bg-red/[0.08] transition-all"
                onClick={disconnectWallet}
              >Disconnect Wallet</button>
              <button
                className="font-mono text-[9px] tracking-[0.1em] uppercase px-4 py-2 border border-red text-red bg-transparent cursor-pointer hover:bg-red/[0.08] transition-all"
                onClick={handleSignOut}
              >Sign Out</button>
            </div>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="border-t border-border pt-5 pb-5 bg-surface px-5 font-mono text-[10px] text-muted leading-relaxed mt-10">
        <strong className="text-text">DISCLAIMER:</strong> TAO Signals provides quantitative data analysis tools for informational and educational purposes only. Nothing on this platform constitutes financial advice. Your wallet connection is read-only — we cannot access your private keys or move your funds. Past performance is not indicative of future results.
      </div>

      {/* Trade warning toast */}
      {tradeWarning && (
        <div className="fixed top-[60px] left-1/2 -translate-x-1/2 bg-surface2 border border-yellow p-4 px-6 z-[10001] max-w-[400px] shadow-lg shadow-black/50">
          <div className="font-mono text-[10px] text-yellow font-semibold mb-2">PORTFOLIO MANAGER ACTIVE</div>
          <div className="font-mono text-[10px] text-muted leading-relaxed mb-3">
            Manual trades are disabled while the portfolio manager is running.
            Manual trades would conflict with the bot&apos;s next rebalance cycle.
            <br /><br />
            To trade manually, disable the portfolio manager first.
          </div>
          <button
            onClick={() => setTradeWarning(false)}
            className="font-mono text-[10px] px-3.5 py-1.5 bg-transparent border border-border2 text-muted cursor-pointer"
          >Dismiss</button>
        </div>
      )}
    </div>
  );
}
