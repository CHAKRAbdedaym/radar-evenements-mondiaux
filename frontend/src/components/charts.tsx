import { useMemo, useState, type ReactNode } from "react";
import { useWidth } from "../hooks/useTitle";
import { fmtInt } from "../lib/format";
import { CHART } from "../styles/chart";

// Hand-made SVG charts (DESIGN_SYSTEM §2 chart rules): straight segments, no smoothing,
// null = gap (never drawn as zero), direct end labels, 1px accent marker, recessive grid.

const FONT = '"IBM Plex Sans", system-ui, sans-serif';

/* ------------------------------------------------------------------ sparkline */

export function Sparkline({
  values,
  width = 96,
  height = 24,
  alert = false,
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  alert?: boolean;
  label: string;
}) {
  if (!values.length) return null;
  const max = Math.max(1, ...values);
  const n = values.length;
  const x = (i: number) => (n === 1 ? width / 2 : 1 + (i * (width - 4)) / (n - 1));
  const y = (v: number) => height - 2 - (v / max) * (height - 4);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const last = values[n - 1];
  return (
    <svg className="ev-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <line x1={0} x2={width} y1={height - 1.5} y2={height - 1.5} stroke={CHART.rule} strokeWidth={1} />
      <path d={d} fill="none" stroke={CHART.ink} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={y(last)} r={2.25} fill={alert ? CHART.accent : CHART.ink} />
    </svg>
  );
}

/* ------------------------------------------------------------------ scales */

function niceStep(max: number, count: number): number {
  const raw = max / count;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const k = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return Math.max(1, k * p);
}

function linearTicks(max: number, count = 4): { top: number; ticks: number[] } {
  const step = niceStep(Math.max(max, 1), count);
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  return { top, ticks };
}

function axisWidth(ticks: number[], fmt: (v: number) => string): number {
  const longest = Math.max(...ticks.map((t) => fmt(t).length));
  return Math.max(24, longest * 7 + 10);
}

/* ------------------------------------------------------------------ line chart */

export interface Series {
  key: string;
  /** Direct label text, e.g. "EN". */
  label: string;
  color: string;
  values: (number | null)[];
  strokeWidth?: number;
}

export interface Band {
  from: number;
  to: number;
  label?: string;
}

export interface Marker {
  x: number;
  label: string;
}

interface LineChartProps {
  xs: number[];
  series: Series[];
  height?: number;
  log?: boolean;
  marker?: Marker | null;
  bands?: Band[];
  xDomain?: [number, number];
  xTicks?: number[];
  xFormat: (t: number) => string;
  tipTitle: (t: number) => string;
  unit: string;
  ariaLabel: string;
  /** Show the end-label value ("EN 1 579"). */
  endValues?: boolean;
}

export function LineChart({
  xs,
  series,
  height = 260,
  log = false,
  marker,
  bands = [],
  xDomain,
  xTicks,
  xFormat,
  tipTitle,
  unit,
  ariaLabel,
  endValues = true,
}: LineChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
    const max = Math.max(1, ...all);
    let ticks: number[];
    let top: number;
    if (log) {
      const exp = Math.max(1, Math.ceil(Math.log10(max)));
      top = Math.pow(10, exp);
      ticks = Array.from({ length: exp + 1 }, (_, i) => Math.pow(10, i));
    } else {
      ({ top, ticks } = linearTicks(max));
    }
    const left = axisWidth(ticks, fmtInt);
    const endLabelW = Math.max(...series.map((s) => (s.label.length + (endValues ? 6 : 0)) * 7.2)) + 12;
    const right = Math.max(24, endLabelW);
    const topPad = marker ? 26 : 10;
    const bottom = 26;
    const [x0, x1] = xDomain ?? [xs[0] ?? 0, xs[xs.length - 1] ?? 1];
    const plotW = Math.max(40, width - left - right);
    const plotH = height - topPad - bottom;
    const sx = (t: number) => left + (x1 === x0 ? plotW / 2 : ((t - x0) / (x1 - x0)) * plotW);
    const sy = (v: number) => {
      if (log) {
        const lv = Math.log10(Math.max(1, v));
        return topPad + plotH - (lv / Math.log10(top)) * plotH;
      }
      return topPad + plotH - (v / top) * plotH;
    };
    return { ticks, top, left, right, topPad, bottom, x0, x1, plotW, plotH, sx, sy };
  }, [series, log, width, height, marker, xDomain, xs, endValues]);

  const { ticks, left, topPad, plotW, plotH, sx, sy, x0, x1 } = geo;

  const visible = (v: number | null): v is number => v !== null && (!log || v > 0);

  // Paths split at gaps; isolated points drawn as small dots.
  const paths = series.map((s) => {
    let d = "";
    const dots: [number, number][] = [];
    let run = 0;
    s.values.forEach((v, i) => {
      if (!visible(v)) {
        if (run === 1) {
          const j = i - 1;
          dots.push([sx(xs[j]), sy(s.values[j] as number)]);
        }
        run = 0;
        return;
      }
      d += `${run ? "L" : "M"}${sx(xs[i]).toFixed(1)},${sy(v).toFixed(1)}`;
      run++;
    });
    if (run === 1) {
      const j = s.values.length - 1;
      dots.push([sx(xs[j]), sy(s.values[j] as number)]);
    }
    return { s, d, dots };
  });

  // Direct end labels with collision avoidance (min 15px apart).
  const ends = series
    .map((s) => {
      let i = s.values.length - 1;
      while (i >= 0 && !visible(s.values[i])) i--;
      if (i < 0) return null;
      return { s, i, x: sx(xs[i]), y: sy(s.values[i] as number), v: s.values[i] as number };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 15) ends[k].y = ends[k - 1].y + 15;
  const bottomLimit = topPad + plotH;
  for (let k = ends.length - 1; k >= 0; k--) {
    const limit = k === ends.length - 1 ? bottomLimit : ends[k + 1].y - 15;
    if (ends[k].y > limit) ends[k].y = limit;
  }

  // X ticks
  const autoTicks = useMemo(() => {
    if (xTicks) return xTicks;
    if (!xs.length) return [];
    const count = Math.max(2, Math.floor(plotW / 96));
    const step = Math.max(1, Math.ceil(xs.length / count));
    const out: number[] = [];
    for (let i = 0; i < xs.length; i += step) out.push(xs[i]);
    return out;
  }, [xTicks, xs, plotW]);

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - rect.left + left;
    let best = 0;
    let bd = Infinity;
    xs.forEach((t, i) => {
      const dd = Math.abs(sx(t) - px);
      if (dd < bd) {
        bd = dd;
        best = i;
      }
    });
    setHover(best);
  };

  const hx = hover !== null ? sx(xs[hover]) : 0;

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          <defs>
            <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke={CHART.rule} strokeWidth="1.5" />
            </pattern>
          </defs>
          {/* bands (hours not loaded) */}
          {bands.map((b, i) => {
            const bx0 = Math.max(left, sx(b.from));
            const bx1 = Math.min(left + plotW, sx(b.to));
            if (bx1 - bx0 < 2) return null;
            return (
              <g key={i}>
                <rect x={bx0} y={topPad} width={bx1 - bx0} height={plotH} fill="url(#hatch)" opacity={0.9} />
                {b.label && bx1 - bx0 > 92 && (
                  <text x={(bx0 + bx1) / 2} y={topPad + 14} textAnchor="middle" fontSize={12} fill={CHART.ink2} fontFamily={FONT}>
                    <tspan x={(bx0 + bx1) / 2} dy={0} style={{ paintOrder: "stroke" }} stroke={CHART.surface} strokeWidth={4}>
                      {b.label}
                    </tspan>
                  </text>
                )}
              </g>
            );
          })}
          {/* grid + y axis */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={left + plotW} y1={sy(t)} y2={sy(t)} stroke={CHART.rule} strokeWidth={1} />
              <text x={left - 8} y={sy(t) + 4} textAnchor="end" fontSize={12} fill={CHART.ink2} fontFamily={FONT} style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtInt(t)}
              </text>
            </g>
          ))}
          {/* x axis */}
          <line x1={left} x2={left + plotW} y1={topPad + plotH} y2={topPad + plotH} stroke={CHART.ink2} strokeWidth={1} />
          {autoTicks.map((t) => {
            if (t < x0 || t > x1) return null;
            const x = sx(t);
            return (
              <g key={t}>
                <line x1={x} x2={x} y1={topPad + plotH} y2={topPad + plotH + 4} stroke={CHART.ink2} />
                <text x={x} y={topPad + plotH + 18} textAnchor="middle" fontSize={12} fill={CHART.ink2} fontFamily={FONT} style={{ fontVariantNumeric: "tabular-nums" }}>
                  {xFormat(t)}
                </text>
              </g>
            );
          })}
          {/* marker */}
          {marker && marker.x >= x0 && marker.x <= x1 && (
            <g>
              <line x1={sx(marker.x)} x2={sx(marker.x)} y1={topPad - 6} y2={topPad + plotH} stroke={CHART.accent} strokeWidth={1} />
              <text
                x={sx(marker.x) + (sx(marker.x) > left + plotW * 0.7 ? -6 : 6)}
                y={topPad - 10}
                textAnchor={sx(marker.x) > left + plotW * 0.7 ? "end" : "start"}
                fontSize={12}
                fontWeight={500}
                fill={CHART.accent}
                fontFamily={FONT}
              >
                {marker.label}
              </text>
            </g>
          )}
          {/* series */}
          {paths.map(({ s, d, dots }) => (
            <g key={s.key}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={s.strokeWidth ?? 2} strokeLinejoin="round" strokeLinecap="round" />
              {dots.map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={2.5} fill={s.color} />
              ))}
            </g>
          ))}
          {/* direct end labels */}
          {ends.map((e) => (
            <text key={e.s.key} x={e.x + 8} y={e.y + 4} fontSize={12} fontFamily={FONT} fill={CHART.ink} style={{ fontVariantNumeric: "tabular-nums" }}>
              <tspan fontWeight={600}>{e.s.label}</tspan>
              {endValues && <tspan fill={CHART.ink2}>{` ${fmtInt(e.v)}`}</tspan>}
            </text>
          ))}
          {/* hover */}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={hx} x2={hx} y1={topPad} y2={topPad + plotH} stroke={CHART.ink2} strokeWidth={1} strokeDasharray="2 3" />
              {series.map((s) => {
                const v = s.values[hover];
                return visible(v) ? <circle key={s.key} cx={hx} cy={sy(v)} r={3.5} fill={s.color} stroke={CHART.surface} strokeWidth={1.5} /> : null;
              })}
            </g>
          )}
          <rect
            x={left}
            y={topPad}
            width={plotW}
            height={plotH}
            fill="transparent"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div
          className="chart-tip"
          style={{
            left: Math.min(Math.max(0, hx + 12), width - 180),
            top: topPad,
          }}
        >
          <div className="tip-t">{tipTitle(xs[hover])}</div>
          {series.map((s) => {
            const v = s.values[hover];
            return (
              <div key={s.key} className="tip-row">
                <span>{s.label}</span>
                <span>{v === null ? "non chargé" : `${fmtInt(v)} ${unit}`}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ column chart */

export function ColumnChart({
  xs,
  values,
  height = 180,
  bucketMs,
  xFormat,
  tipTitle,
  unit,
  ariaLabel,
  xTickEvery,
  color = CHART.ink,
  highlight,
}: {
  xs: number[];
  values: number[];
  height?: number;
  bucketMs: number;
  xFormat: (t: number) => string;
  tipTitle: (t: number) => string;
  unit: string;
  ariaLabel: string;
  xTickEvery?: number;
  color?: string;
  /** index → accent colour (e.g. the alert window). */
  highlight?: (i: number) => boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...values);
  const { top, ticks } = linearTicks(max, 3);
  const left = axisWidth(ticks, fmtInt);
  const right = 8;
  const topPad = 8;
  const bottom = 26;
  const plotW = Math.max(40, width - left - right);
  const plotH = height - topPad - bottom;
  const n = Math.max(1, xs.length);
  const slot = plotW / n;
  const gap = slot > 6 ? 2 : slot > 3 ? 1 : 0;
  const bw = Math.min(14, Math.max(1, slot - gap));
  const sy = (v: number) => topPad + plotH - (v / top) * plotH;
  const every = xTickEvery ?? Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 90))));
  void bucketMs;

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={left} x2={left + plotW} y1={sy(t)} y2={sy(t)} stroke={CHART.rule} />
              <text x={left - 8} y={sy(t) + 4} textAnchor="end" fontSize={12} fill={CHART.ink2} fontFamily={FONT} style={{ fontVariantNumeric: "tabular-nums" }}>
                {fmtInt(t)}
              </text>
            </g>
          ))}
          {values.map((v, i) => {
            const x = left + i * slot + (slot - bw) / 2;
            const h = Math.max(v > 0 ? 1 : 0, topPad + plotH - sy(v));
            return (
              <rect
                key={i}
                x={x}
                y={topPad + plotH - h}
                width={bw}
                height={h}
                fill={highlight?.(i) ? CHART.accent : color}
                opacity={hover === null || hover === i ? 1 : 0.55}
              />
            );
          })}
          <line x1={left} x2={left + plotW} y1={topPad + plotH} y2={topPad + plotH} stroke={CHART.ink2} />
          {xs.map((t, i) =>
            i % every === 0 ? (
              <text
                key={t}
                x={left + i * slot + slot / 2}
                y={topPad + plotH + 18}
                textAnchor="middle"
                fontSize={12}
                fill={CHART.ink2}
                fontFamily={FONT}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {xFormat(t)}
              </text>
            ) : null,
          )}
          <rect
            x={left}
            y={topPad}
            width={plotW}
            height={plotH}
            fill="transparent"
            onMouseMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const i = Math.min(n - 1, Math.max(0, Math.floor((e.clientX - r.left) / slot)));
              setHover(i);
            }}
            onMouseLeave={() => setHover(null)}
          />
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(0, left + hover * slot + 12), width - 170), top: topPad }}>
          <div className="tip-t">{tipTitle(xs[hover])}</div>
          <div>
            {fmtInt(values[hover])} {unit}
          </div>
        </div>
      )}
    </div>
  );
}

/** Frame + heading line + source note around a chart. */
export function ChartFrame({ title, aside, children, source }: { title: ReactNode; aside?: ReactNode; children: ReactNode; source?: ReactNode }) {
  return (
    <figure>
      <div className="chart-frame">
        <div className="chart-head">
          <span className="t-14">{title}</span>
          {aside}
        </div>
        {children}
      </div>
      {source}
    </figure>
  );
}
