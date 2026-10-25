import { useMemo } from "react";
import type { Lang, PageviewPoint } from "../api";
import { fmtDayShort, fmtInt, fmtTime, fmtTimeUtc } from "../lib/format";
import { LANG_CODE, LANG_ORDER } from "../lib/lang";
import { LANG_COLOR } from "../styles/chart";
import { LineChart, type Band } from "./charts";

const HOUR = 3600 * 1000;

export interface PvSeries {
  lang: Lang;
  items: PageviewPoint[];
}

/** Hourly pageviews per language with gaps for hours not loaded (no row = not loaded, CONTRACT §7 replay). */
export function buildPageviewRows(series: PvSeries[], range?: { start: number; end: number; full?: boolean; include?: number }) {
  const byLang = new Map<Lang, Map<number, number>>();
  const loaded = new Set<number>();
  for (const s of series) {
    const m = new Map<number, number>();
    for (const i of s.items) {
      const t = new Date(i.hour).getTime();
      m.set(t, i.views);
      loaded.add(t);
    }
    byLang.set(s.lang, m);
  }
  const loadedSorted = [...loaded].sort((a, b) => a - b);
  let start = range?.start ?? loadedSorted[0] ?? 0;
  let end = range?.end ?? loadedSorted[loadedSorted.length - 1] ?? 0;
  if (!range?.full && loadedSorted.length) {
    start = loadedSorted[0];
    end = loadedSorted[loadedSorted.length - 1];
    if (range?.include !== undefined) {
      const h = Math.floor(range.include / HOUR) * HOUR;
      start = Math.min(start, h);
      end = Math.max(end, h + HOUR);
    }
  }
  const xs: number[] = [];
  for (let t = start; t <= end; t += HOUR) xs.push(t);
  const langs = LANG_ORDER.filter((l) => byLang.has(l));
  const values: Record<string, (number | null)[]> = {};
  for (const l of langs) values[l] = xs.map((t) => byLang.get(l)!.get(t) ?? null);
  // Bands: runs of hours not loaded.
  const bands: Band[] = [];
  let i = 0;
  while (i < xs.length) {
    if (loaded.has(xs[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < xs.length && !loaded.has(xs[j + 1])) j++;
    bands.push({ from: i > 0 ? xs[i - 1] : xs[i], to: j + 1 < xs.length ? xs[j + 1] : xs[j], label: "heures non chargées" });
    i = j + 1;
  }
  return { xs, langs, values, bands, loaded: loadedSorted, start, end };
}

export const hourTick = (t: number) => {
  const d = new Date(t);
  return d.getUTCHours() === 0 ? fmtDayShort(t) : `${fmtTime(t).slice(0, 2)} h`;
};

export const hourRange = (t: number) => `${fmtDayShort(t)}, ${fmtTime(t)}–${fmtTimeUtc(t + HOUR)}`;

export function PageviewsChart({
  series,
  eventTime,
  eventLabel,
  height = 320,
  log = false,
  full = false,
  start,
  end,
}: {
  series: PvSeries[];
  eventTime?: number | null;
  eventLabel?: string;
  height?: number;
  log?: boolean;
  full?: boolean;
  start?: number;
  end?: number;
}) {
  const rows = useMemo(
    () => buildPageviewRows(series, start !== undefined && end !== undefined ? { start, end, full, include: eventTime ?? undefined } : undefined),
    [series, start, end, full, eventTime],
  );
  const peakTotal = rows.langs.map((l) => `${LANG_CODE[l]} ${fmtInt(Math.max(0, ...(rows.values[l].filter((v) => v !== null) as number[])))}`).join(", ");
  return (
    <LineChart
      xs={rows.xs}
      series={rows.langs.map((l) => ({ key: l, label: LANG_CODE[l], color: LANG_COLOR[l], values: rows.values[l], strokeWidth: l === "en" ? 2 : 1.75 }))}
      bands={rows.bands}
      height={height}
      log={log}
      marker={eventTime ? { x: eventTime, label: eventLabel ?? `Séisme · ${fmtTimeUtc(eventTime)}` } : null}
      xFormat={hourTick}
      tipTitle={hourRange}
      unit="vues"
      ariaLabel={`Vues par heure par langue. Maximum : ${peakTotal}.`}
    />
  );
}
