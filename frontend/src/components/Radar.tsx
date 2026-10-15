import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { RadarItem } from "../api";
import { fmtInt, fmtRelative, fmtDec1 } from "../lib/format";
import { LANG_CODE, LANG_COLOR, LANG_NAME, articlePath, hashString } from "../lib/lang";
import { useNow, useReducedMotion } from "../hooks/usePolling";
import { LangBadge, LangText } from "./ui";

const SIZE = 600; // viewBox is [-300, 300]
const R = 270; // outer ring radius
const SWEEP_MS = 6000;
const CYAN = "#3FD0C9";
const ALERT = "#FF8A4C";

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}
const overlaps = (a: Box, b: Box, pad = 0) => a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;
const LABEL_CHARS = 26;

interface LabelPos {
  p: Placed;
  text: string;
  toLeft: boolean;
  offset: number;
}

interface Placed {
  key: string;
  item: RadarItem;
  x: number;
  y: number;
  r: number;
  ageSec: number;
  angleDeg: number;
}

/** Blip radius: sqrt scale of the edit count. */
const blipRadius = (edits: number) => Math.min(20, 3 + 3.4 * Math.sqrt(Math.max(1, edits)));

function place(items: RadarItem[], serverTime: number, windowMin: number): Placed[] {
  const windowSec = Math.max(60, windowMin * 60);
  return items.map((item) => {
    const key = `${item.lang}:${item.title}`;
    const angleDeg = (hashString(key) % 3600) / 10;
    const ageSec = Math.max(0, (serverTime - new Date(item.last_edit).getTime()) / 1000);
    const frac = Math.min(1, ageSec / windowSec);
    const dist = R * (0.07 + 0.9 * frac);
    const a = (angleDeg * Math.PI) / 180;
    return { key, item, angleDeg, ageSec, r: blipRadius(item.edits), x: dist * Math.sin(a), y: -dist * Math.cos(a) };
  });
}

/** CSS animation delay that keeps a looped animation in phase with the sweep (shared time origin). */
function phaseDelay(mountedAt: number, offsetMs = 0): string {
  const d = (((mountedAt - offsetMs) % SWEEP_MS) + SWEEP_MS) % SWEEP_MS;
  return `${-d}ms`;
}

function Blip({ p, active, reduced, onEnter, onLeave, onActivate }: {
  p: Placed;
  active: boolean;
  reduced: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onActivate: (pointerType: string) => void;
}) {
  const mountedAt = useRef(performance.now()).current;
  const color = LANG_COLOR[p.item.lang];
  const pointerType = useRef("mouse");
  const label = `${p.item.title} (${LANG_CODE[p.item.lang]}), ${p.item.edits} modifications${p.item.alert ? ", alerte active" : ""}`;
  return (
    <g style={{ transform: `translate(${p.x}px, ${p.y}px)`, transition: "transform 1.2s ease" }}>
      <g className="blip-in">
        <g
          role="link"
          tabIndex={0}
          aria-label={label}
          className="cursor-pointer outline-none"
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          onFocus={onEnter}
          onBlur={onLeave}
          onPointerDown={(e) => (pointerType.current = e.pointerType)}
          onClick={() => onActivate(pointerType.current)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onActivate("keyboard");
            }
          }}
        >
          {/* hit target bigger than the mark */}
          <circle r={Math.max(p.r + 4, 12)} fill="transparent" />
          {p.item.alert && (
            <>
              <circle r={p.r + 3} fill="none" stroke={ALERT} strokeWidth={2} className="pulse-ring" />
              <circle r={p.r + 4} fill="none" stroke={ALERT} strokeWidth={2} />
            </>
          )}
          <g
            style={
              reduced
                ? undefined
                : { animation: `blip-glow ${SWEEP_MS}ms linear infinite`, animationDelay: phaseDelay(mountedAt, (p.angleDeg / 360) * SWEEP_MS) }
            }
          >
            <circle r={p.r} fill={color} fillOpacity={0.85} stroke="#0A1020" strokeWidth={1.5} />
            <circle r={p.r * 0.38} fill="#fff" fillOpacity={0.55} />
          </g>
          {active && <circle r={p.r + 7} fill="none" stroke="#fff" strokeOpacity={0.9} strokeWidth={1.5} strokeDasharray="3 3" />}
        </g>
      </g>
    </g>
  );
}

function Tooltip({ p, now, width }: { p: Placed; now: number; width: number }) {
  const k = width / SIZE;
  const cx = (p.x + SIZE / 2) * k;
  const cy = (p.y + SIZE / 2) * k;
  const w = Math.min(240, width - 16);
  const gap = p.r * k + 12;
  // Beside the blip when there is room, otherwise above/below it; always clamped inside the box.
  let left: number;
  let top: number;
  let ty: string;
  if (cx + gap + w <= width - 8) {
    left = cx + gap;
    top = cy;
    ty = "-50%";
  } else if (cx - gap - w >= 8) {
    left = cx - gap - w;
    top = cy;
    ty = "-50%";
  } else {
    left = Math.min(Math.max(cx - w / 2, 8), width - w - 8);
    top = cy < width / 2 ? cy + gap : cy - gap;
    ty = cy < width / 2 ? "0" : "-100%";
  }
  const it = p.item;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 rounded-xl border border-line2 bg-[#0d1528]/95 p-3 text-xs shadow-2xl backdrop-blur"
      style={{ left, top, width: w, transform: `translateY(${ty})` }}
    >
      <p className="text-sm font-semibold leading-snug text-white">
        <LangText lang={it.lang}>{it.title}</LangText>
      </p>
      <div className="mt-1.5 flex items-center gap-2 text-ink-2">
        <LangBadge lang={it.lang} /> Wikipédia en {LANG_NAME[it.lang]}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-ink-3">Modifications</dt>
        <dd className="num text-right text-white">{fmtInt(it.edits)}</dd>
        <dt className="text-ink-3">Contributeurs</dt>
        <dd className="num text-right text-white">{fmtInt(it.distinct_users)}</dd>
        <dt className="text-ink-3">z-score</dt>
        <dd className={`num text-right ${it.z_score !== null && it.z_score > 3 ? "text-alert" : "text-white"}`}>
          {it.z_score === null ? "z : en calcul" : fmtDec1(it.z_score)}
        </dd>
        <dt className="text-ink-3">Dernière modif.</dt>
        <dd className="num text-right text-white">{fmtRelative(it.last_edit, now)}</dd>
      </dl>
      {it.baseline_type && <p className="mt-1.5 text-[11px] text-ink-3">Base de comparaison : {it.baseline_type}</p>}
      {it.alert && <p className="mt-1.5 font-semibold text-alert">🚨 Alerte active (pic anormal)</p>}
      <p className="mt-2 text-[11px] text-cyan/80">Cliquer pour ouvrir l'article →</p>
    </div>
  );
}

export interface RadarProps {
  items: RadarItem[];
  serverTime: string | null;
  windowMinutes: number;
  /** Overlay shown in the center (loading / empty / error). */
  overlay?: ReactNode;
}

export default function RadarScope({ items, serverTime, windowMinutes, overlay }: RadarProps) {
  const reduced = useReducedMotion();
  const navigate = useNavigate();
  const now = useNow(5000);
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const sweepStart = useRef(performance.now()).current;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const srvMs = serverTime ? new Date(serverTime).getTime() : now;
  const placed = useMemo(() => place(items, srvMs, windowMinutes), [items, srvMs, windowMinutes]);
  // Draw small first so big blips stay on top; alerts last.
  const drawOrder = useMemo(
    () => [...placed].sort((a, b) => Number(a.item.alert) - Number(b.item.alert) || a.r - b.r),
    [placed],
  );

  // Direct labels: alerts first, then most edits; a label is skipped if its box would overlap
  // an already placed label, the ring-label column or the scope edge.
  const labels = useMemo(() => {
    const max = width < 420 ? 3 : width < 560 ? 4 : 6;
    const k = width / SIZE;
    const ranked = [...placed].sort((a, b) => Number(b.item.alert) - Number(a.item.alert) || b.item.edits - a.item.edits);
    const boxes: Box[] = [
      // vertical column of ring labels (top axis) and the "maintenant" caption
      { x0: width / 2 - 34, x1: width / 2 + 34, y0: (SIZE / 2 - R - 4) * k, y1: width / 2 + 4 },
      { x0: width / 2 - 44, x1: width / 2 + 44, y0: width / 2 + 2, y1: width / 2 + 26 },
    ];
    const out: LabelPos[] = [];
    for (const p of ranked) {
      if (out.length >= max) break;
      const text = p.item.title.length > LABEL_CHARS ? `${p.item.title.slice(0, LABEL_CHARS - 1)}…` : p.item.title;
      const w = 52 + text.length * 6.1;
      const h = 18;
      const cx = (p.x + SIZE / 2) * k;
      const cy = (p.y + SIZE / 2) * k;
      const gap = p.r * k + 6;
      let placedBox: Box | null = null;
      let toLeft = false;
      for (const left of p.x > 0 ? [true, false] : [false, true]) {
        const b: Box = left
          ? { x0: cx - gap - w, x1: cx - gap, y0: cy - h / 2, y1: cy + h / 2 }
          : { x0: cx + gap, x1: cx + gap + w, y0: cy - h / 2, y1: cy + h / 2 };
        if (b.x0 < 2 || b.x1 > width - 2) continue;
        if (boxes.some((o) => overlaps(o, b, 3))) continue;
        placedBox = b;
        toLeft = left;
        break;
      }
      if (!placedBox) continue;
      boxes.push(placedBox);
      out.push({ p, text, toLeft, offset: gap });
    }
    return out;
  }, [placed, width]);
  const fs = Math.max(10, (10 * SIZE) / Math.max(width, 1)); // ~10px on screen at any size

  const active = placed.find((p) => p.key === (hover ?? selected)) ?? null;
  const ringMinutes = Array.from({ length: Math.max(1, windowMinutes) }, (_, i) => i + 1);
  const ringR = (min: number) => R * (0.07 + 0.9 * (min / Math.max(1, windowMinutes)));

  return (
    <div ref={boxRef} className="relative mx-auto aspect-square w-full max-w-[640px] select-none [overflow-x:clip]" onMouseLeave={() => setHover(null)}>
      {/* Layer 1: scope background */}
      <svg viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`} className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <radialGradient id="scope-bg">
            <stop offset="0%" stopColor="#0F2236" />
            <stop offset="70%" stopColor="#0B1528" />
            <stop offset="100%" stopColor="#0A1020" />
          </radialGradient>
        </defs>
        <circle r={R + 6} fill="url(#scope-bg)" stroke="#1E2A47" strokeWidth={2} />
        {ringMinutes.map((m) => (
          <circle key={m} r={ringR(m)} fill="none" stroke={CYAN} strokeOpacity={m === windowMinutes ? 0.35 : 0.14} strokeDasharray={m === windowMinutes ? undefined : "2 5"} />
        ))}
        <line x1={-R} x2={R} y1={0} y2={0} stroke={CYAN} strokeOpacity={0.1} />
        <line y1={-R} y2={R} x1={0} x2={0} stroke={CYAN} strokeOpacity={0.1} />
        {Array.from({ length: 72 }).map((_, i) => {
          const a = (i * 5 * Math.PI) / 180;
          const long = i % 6 === 0;
          const r1 = R + 6;
          const r0 = r1 - (long ? 10 : 5);
          return (
            <line
              key={i}
              x1={r0 * Math.sin(a)}
              y1={-r0 * Math.cos(a)}
              x2={r1 * Math.sin(a)}
              y2={-r1 * Math.cos(a)}
              stroke={CYAN}
              strokeOpacity={long ? 0.45 : 0.2}
            />
          );
        })}
        <circle r={3} fill={CYAN} />
      </svg>

      {/* Layer 2: rotating sweep with fading trail */}
      <div className="pointer-events-none absolute rounded-full" style={{ inset: `${((SIZE / 2 - R) / SIZE) * 100}%` }} aria-hidden>
        <div
          className={`absolute inset-0 rounded-full ${reduced ? "" : "radar-sweep"}`}
          style={{
            background: `conic-gradient(from 0deg, rgba(63,208,201,0) 0deg, rgba(63,208,201,0) 250deg, rgba(63,208,201,0.06) 300deg, rgba(63,208,201,0.16) 340deg, rgba(63,208,201,0.42) 359.5deg, rgba(63,208,201,0) 360deg)`,
            animationDelay: phaseDelay(sweepStart),
            opacity: reduced ? 0.5 : 1,
          }}
        >
          <div className="absolute left-1/2 top-0 h-1/2 w-[2px] -translate-x-1/2 bg-gradient-to-b from-cyan via-cyan/60 to-cyan/0 shadow-glow" />
        </div>
      </div>

      {/* Layer 3: blips */}
      <svg viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`} className="absolute inset-0 h-full w-full overflow-hidden" aria-label="Radar des articles actifs">
        {drawOrder.map((p) => (
          <Blip
            key={p.key}
            p={p}
            reduced={reduced}
            active={active?.key === p.key}
            onEnter={() => setHover(p.key)}
            onLeave={() => setHover((h) => (h === p.key ? null : h))}
            onActivate={(type) => {
              if (type === "touch" && selected !== p.key) {
                setSelected(p.key);
                return;
              }
              navigate(articlePath(p.item.lang, p.item.title));
            }}
          />
        ))}
      </svg>

      {/* Layer 4: direct labels (HTML for proper Arabic shaping / RTL) */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {labels.map(({ p, text, toLeft, offset }) => {
          const left = ((p.x + SIZE / 2) / SIZE) * 100;
          const top = ((p.y + SIZE / 2) / SIZE) * 100;
          return (
            <div
              key={p.key}
              className="absolute flex items-center gap-1 whitespace-nowrap rounded border border-line/60 bg-night/80 px-1 py-px text-[11px] leading-tight text-ink-2"
              style={{
                left: `${left}%`,
                top: `${top}%`,
                transform: `translate(${toLeft ? `calc(-100% - ${offset}px)` : `${offset}px`}, -50%)`,
                transition: "left 1.2s ease, top 1.2s ease",
              }}
            >
              <span className={`font-mono text-[10px] font-bold ${p.item.alert ? "text-alert" : "text-ink"}`}>{LANG_CODE[p.item.lang]}</span>
              <LangText lang={p.item.lang}>{text}</LangText>
              <span className="num text-[10px] text-ink-3">×{p.item.edits}</span>
            </div>
          );
        })}
      </div>

      {/* Ring labels on one clean axis (top), above the blips, with a panel-colored backing */}
      <svg viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        {[...ringMinutes.map((m) => ({ key: `r${m}`, y: -ringR(m), text: `${m} min` })), { key: "now", y: fs * 1.6, text: "maintenant" }].map((l) => {
          const w = l.text.length * fs * 0.62 + fs * 0.9;
          return (
            <g key={l.key} transform={`translate(0, ${l.y})`} opacity={0.82}>
              <rect x={-w / 2} y={-fs * 0.72} width={w} height={fs * 1.44} rx={fs * 0.35} fill="#121B30" fillOpacity={0.9} stroke="#2A3A5E" strokeWidth={0.6} />
              <text textAnchor="middle" dy={fs * 0.36} fill="#A9B4CC" fontSize={fs} fontFamily="JetBrains Mono, monospace">
                {l.text}
              </text>
            </g>
          );
        })}
      </svg>

      {active && <Tooltip p={active} now={now} width={width} />}

      {overlay && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="rounded-2xl border border-line bg-night/85 px-5 py-2 backdrop-blur">{overlay}</div>
        </div>
      )}
      <span className="sr-only">{placed.length} articles actifs sur le radar (liste détaillée sous le radar).</span>
    </div>
  );
}
