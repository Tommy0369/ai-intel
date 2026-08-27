/**
 * previous/current 件数から velocity / acceleration を算出。
 * 少数母数の暴騰を抑える smoothing あり。
 */
export function computeVelocity(
  previous: number,
  current: number,
): { velocity: number; acceleration: number } {
  const prev = Math.max(0, previous);
  const cur = Math.max(0, current);
  const base = Math.max(2, prev); // 0除算・1件→2件の過剰HOT抑制
  const ratio = cur / base;
  const delta = cur - prev;
  const velocity = Math.max(
    0,
    Math.min(100, Math.round((ratio - 1) * 40 + cur * 2)),
  );
  const acceleration = Math.round(delta / Math.sqrt(base));
  return { velocity, acceleration };
}

export { applyTrends, runTrendEngine, trendStatusOf } from "./trend-engine.js";
