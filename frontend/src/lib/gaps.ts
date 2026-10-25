import { useEffect, useState } from "react";
import { api } from "../api";
import { fmtDayShort } from "./format";

// Stream interruptions, measured from the data: an hour in which NO human edit at all was stored
// (sum of every theme + "non classé" in /api/themes/timeline?hours=168) is an hour the stream was down.
// Charts use this to draw a hatched "flux interrompu" band instead of zeros.

export interface Gap {
  from: number; // ms, inclusive
  to: number; // ms, exclusive
}

const HOUR = 3600 * 1000;
let gaps: Gap[] | null = null;
let windowStart: number | null = null;
let loading: Promise<void> | null = null;
const subs = new Set<() => void>();

function load(): Promise<void> {
  if (loading) return loading;
  loading = api
    .themesTimeline(168)
    .then((tl) => {
      const keys = [...tl.themes.map((t) => t.id), "non_classe"] as string[];
      const out: Gap[] = [];
      let cur: Gap | null = null;
      for (const it of tl.items) {
        const t = new Date(it.t).getTime();
        const total = keys.reduce((a, k) => a + (Number((it as Record<string, unknown>)[k]) || 0), 0);
        if (total === 0) {
          if (cur) cur.to = t + HOUR;
          else cur = { from: t, to: t + HOUR };
        } else if (cur) {
          out.push(cur);
          cur = null;
        }
      }
      if (cur) out.push(cur);
      gaps = out;
      windowStart = tl.items.length ? new Date(tl.items[0].t).getTime() : null;
      subs.forEach((f) => f());
    })
    .catch(() => {
      gaps = [];
    })
    .finally(() => {
      window.setTimeout(() => (loading = null), 10 * 60 * 1000);
    });
  return loading;
}

/** Start loading the gaps early (called once by the Layout) so charts get them on first paint. */
export function preloadStreamGaps(): void {
  load();
}

/** Known stream gaps (empty until loaded). */
export function useStreamGaps(): { gaps: Gap[]; windowStart: number | null } {
  const [, tick] = useState(0);
  useEffect(() => {
    const f = () => tick((n) => n + 1);
    subs.add(f);
    load();
    return () => {
      subs.delete(f);
    };
  }, []);
  return { gaps: gaps ?? [], windowStart };
}

/**
 * Marks chart buckets that fall in a stream gap. A run of zero buckets that touches a known gap is
 * treated as part of it (the 7-day window cannot see further back than its own start).
 * Returns per-bucket flags and the merged bands to draw.
 */
export function gapBuckets(xs: number[], values: number[], bucketMs: number, known: { gaps: Gap[]; windowStart: number | null }) {
  const inGap = (t: number) => known.gaps.some((g) => t >= g.from && t + bucketMs <= g.to + 1);
  const flags = xs.map(() => false);
  let i = 0;
  while (i < xs.length) {
    if (values[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < xs.length && values[j + 1] === 0) j++;
    const runStart = xs[i];
    const runEnd = xs[j] + bucketMs;
    let touches = false;
    for (let k = i; k <= j && !touches; k++) if (inGap(xs[k])) touches = true;
    // A zero run that starts before the 7-day window and reaches into a gap at its first hour.
    if (!touches && known.windowStart !== null && runStart < known.windowStart && runEnd > known.windowStart) {
      touches = known.gaps.some((g) => g.from === known.windowStart);
    }
    if (touches && runEnd - runStart >= HOUR) for (let k = i; k <= j; k++) flags[k] = true;
    i = j + 1;
  }
  const bands: { from: number; to: number; label: string }[] = [];
  i = 0;
  while (i < xs.length) {
    if (!flags[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < xs.length && flags[j + 1]) j++;
    const from = xs[i];
    const to = xs[j] + bucketMs;
    const a = fmtDayShort(from);
    const b = fmtDayShort(to - 1);
    const sameMonth = a.split(" ")[1] === b.split(" ")[1];
    const span = a === b ? a : sameMonth ? `${a.split(" ")[0]}–${b}` : `${a}–${b}`;
    bands.push({ from: i > 0 ? xs[i - 1] : from, to: j + 1 < xs.length ? xs[j + 1] : xs[j], label: `flux interrompu (${span})` });
    i = j + 1;
  }
  return { flags, bands };
}
