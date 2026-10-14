// ── Composite v1 score surface — shared types + helpers ──────────────
// Data contract: /data/composite_scores_v1.json
//   { generated_at, date, scores: [{ netuid, name, composite_score,
//     rank, in_portfolio, ingredients: { <signal>: <0-100 pctile> } }] }
// The file may not exist yet (ships with the next model deploy) — every
// consumer must treat a null fetch result as "scores coming soon".

export interface CompositeScoreRow {
  netuid: number;
  name?: string;
  composite_score?: number | null;
  rank?: number | null;
  in_portfolio?: boolean;
  ingredients?: Record<string, number | null | undefined>;
}

export interface CompositeScoresFile {
  generated_at?: string;
  date?: string;
  scores?: CompositeScoreRow[];
}

// Plain-language labels for the composite's ingredient signals
// (raw signal names come from the model pipeline — keep them out of the UI).
const INGREDIENT_LABELS: Record<string, string> = {
  volume_x_pricestable: "Accumulation (volume × price stability)",
  emission_share_zscore_30d: "Emission strength (30d z-score)",
  PROD_emission_vs_network: "Old-model inverse",
};

export function ingredientLabel(key: string): string {
  return INGREDIENT_LABELS[key] ?? key.replace(/_/g, " ");
}

// Scores/ingredients are documented as 0-100 percentiles, but defend against
// a 0-1 fraction encoding: if every value in the series is <= 1.5, scale by 100.
export function scaleFor(values: number[]): number {
  const finite = values.filter((v) => typeof v === "number" && isFinite(v));
  if (finite.length === 0) return 1;
  return Math.max(...finite) <= 1.5 ? 100 : 1;
}

// Color band for a 0-100 score, using the site's existing accent palette.
export function scoreBand(score: number): { text: string; bar: string; chip: string } {
  if (score >= 80) return { text: "text-green", bar: "bg-green", chip: "text-green border-green bg-green/10" };
  if (score >= 60) return { text: "text-cyan", bar: "bg-cyan", chip: "text-cyan border-cyan bg-cyan/10" };
  if (score >= 40) return { text: "text-yellow", bar: "bg-yellow", chip: "text-yellow border-yellow bg-yellow/10" };
  if (score >= 20) return { text: "text-orange", bar: "bg-orange", chip: "text-orange border-orange bg-orange/10" };
  return { text: "text-red", bar: "bg-red", chip: "text-red border-red bg-red/10" };
}

// Fetch that treats 404s / network errors / non-JSON as "not available yet".
export async function safeFetch<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url + (url.includes("?") ? "&" : "?") + "t=" + Date.now());
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
