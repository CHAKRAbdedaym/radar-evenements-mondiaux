import type { ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Lang } from "../api";
import { fmtInt, fmtShortDateTime, fmtTime } from "../lib/format";
import { LANG_CODE, LANG_COLOR, LANGS } from "../lib/lang";

export const AXIS = {
  stroke: "#2A3A5E",
  tick: { fill: "#7D89A6", fontSize: 11, fontFamily: "JetBrains Mono, monospace" },
  tickLine: false,
} as const;
export const GRID = { stroke: "#1E2A47", strokeDasharray: "2 4", vertical: false } as const;

interface TooltipRow {
  key: string;
  label: ReactNode;
  color?: string;
  value: number | null | undefined;
}

/** Shared tooltip card: title line + rows of (swatch, label, value) in French number format. */
export function TooltipCard({ title, rows, footer }: { title: ReactNode; rows: TooltipRow[]; footer?: ReactNode }) {
  return (
    <div className="rounded-xl border border-line2 bg-[#0d1528]/95 px-3 py-2 text-xs shadow-2xl backdrop-blur">
      <p className="mb-1 font-mono text-[11px] text-ink-3">{title}</p>
      <ul className="space-y-0.5">
        {rows.map((r) => (
          <li key={r.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-2">
              {r.color && <span className="h-2 w-2 rounded-full" style={{ background: r.color }} aria-hidden />}
              {r.label}
            </span>
            <span className="num font-medium text-white">{r.value === null || r.value === undefined ? "–" : fmtInt(r.value)}</span>
          </li>
        ))}
      </ul>
      {footer}
    </div>
  );
}

/** Direct label rendered only at the last point of a line ("FR 120"). */
export function endLabel(lang: Lang, lastIndex: number) {
  // eslint-disable-next-line react/display-name
  return (props: { x?: number | string; y?: number | string; index?: number; value?: number | string }) => {
    if (props.index !== lastIndex || props.value === null || props.value === undefined) return <g />;
    return (
      <text
        x={Number(props.x) + 6}
        y={Number(props.y)}
        dy={4}
        fill="#E6EDF7"
        fontSize={11}
        fontWeight={700}
        fontFamily="JetBrains Mono, monospace"
      >
        {LANG_CODE[lang]}
      </text>
    );
  };
}

export interface LangRow {
  ts: number;
  ar?: number | null;
  fr?: number | null;
  en?: number | null;
}

/** Per-language line chart over time (live timeline). */
export function LangLinesChart({ data, langs = LANGS, height = 220, unit = "modifs" }: {
  data: LangRow[];
  langs?: Lang[];
  height?: number;
  unit?: string;
}) {
  const last = data.length - 1;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 34, bottom: 0, left: -12 }}>
          <CartesianGrid {...GRID} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(v) => fmtTime(v)}
            minTickGap={40}
            {...AXIS}
          />
          <YAxis allowDecimals={false} tickFormatter={(v) => fmtInt(v)} width={48} {...AXIS} />
          <Tooltip
            cursor={{ stroke: "#3FD0C9", strokeOpacity: 0.4 }}
            content={({ active, payload, label }) =>
              active && payload && payload.length ? (
                <TooltipCard
                  title={`${fmtShortDateTime(Number(label))} UTC`}
                  rows={langs.map((l) => ({
                    key: l,
                    color: LANG_COLOR[l],
                    label: <span className="font-mono font-bold text-ink">{LANG_CODE[l]}</span>,
                    value: (payload[0].payload as LangRow)[l],
                  }))}
                  footer={<p className="mt-1 text-[10px] text-ink-3">{unit} par intervalle</p>}
                />
              ) : null
            }
          />
          {langs.map((l) => (
            <Line
              key={l}
              type="monotone"
              dataKey={l}
              name={LANG_CODE[l]}
              stroke={LANG_COLOR[l]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, stroke: "#0A1020", strokeWidth: 2 }}
              isAnimationActive={false}
              label={endLabel(l, last)}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
