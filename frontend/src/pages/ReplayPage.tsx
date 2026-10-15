import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, type Lang, type Replay } from "../api";
import { usePolling } from "../hooks/usePolling";
import { fmtInt, fmtShortDateTime } from "../lib/format";
import { LANG_CODE, LANG_COLOR, LANG_NAME, LANGS } from "../lib/lang";
import { AXIS, GRID, TooltipCard, endLabel, endLabelOffsets } from "../components/charts";
import { ArticleLink, Empty, ErrorState, LangBadge, LangLegend, LangText, Loading, PageHeader, Panel, StaleBanner, Toggle } from "../components/ui";

const HOUR = 3600 * 1000;

type Row = { ts: number } & Partial<Record<Lang, number | null>>;

function buildRows(r: Replay, log: boolean): Row[] {
  const start = new Date(r.start).getTime();
  const end = new Date(r.end).getTime();
  const rows: Row[] = [];
  const byLang = new Map<Lang, Map<number, number>>();
  for (const s of r.series) byLang.set(s.lang, new Map(s.items.map((i) => [new Date(i.hour).getTime(), i.views])));
  for (let t = start; t <= end; t += HOUR) {
    const row: Row = { ts: t };
    for (const [l, m] of byLang) {
      const v = m.get(t);
      // Hours not loaded are omitted by the API -> gap. Log scale cannot show 0 -> gap.
      row[l] = v === undefined ? null : log && v <= 0 ? null : v;
    }
    rows.push(row);
  }
  return rows;
}

/** Loaded hours (any series has a row for them, 0 included). */
function loadedHours(r: Replay): number[] {
  const set = new Set<number>();
  for (const s of r.series) for (const i of s.items) set.add(new Date(i.hour).getTime());
  return [...set].sort((a, b) => a - b);
}

function ReplayChart({ r, log, full }: { r: Replay; log: boolean; full: boolean }) {
  const quakeHour = Math.floor(new Date(r.event.time).getTime() / HOUR) * HOUR;
  const loaded = loadedHours(r);
  // Default: only the loaded range (always including the earthquake hour); "full" = the 49 h with gaps.
  let start = new Date(r.start).getTime();
  let end = new Date(r.end).getTime();
  if (!full && loaded.length) {
    start = Math.min(loaded[0], quakeHour);
    end = Math.max(loaded[loaded.length - 1], quakeHour + HOUR);
    if (end - start < 2 * HOUR) {
      start -= HOUR;
      end += HOUR;
    }
  }
  const rows = useMemo(() => buildRows(r, log).filter((row) => row.ts >= start && row.ts <= end), [r, log, start, end]);
  const spanH = (end - start) / HOUR;
  const step = spanH <= 8 ? 1 : spanH <= 16 ? 2 : spanH <= 30 ? 3 : 6;
  const ticks: number[] = [];
  for (let t = Math.ceil(start / (step * HOUR)) * step * HOUR; t <= end; t += step * HOUR) ticks.push(t);
  const quakeLabel = `Séisme : ${new Date(r.event.time).toISOString().slice(11, 16)} UTC`;
  const langs = r.series.map((s) => s.lang);
  // End label only for series with at least one positive value; offsets avoid stacked labels.
  const lastIdx = (l: Lang) => {
    if (!rows.some((row) => (row[l] ?? 0) > 0)) return -1;
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i][l] !== null && rows[i][l] !== undefined) return i;
    return -1;
  };
  const max = Math.max(1, ...rows.flatMap((row) => langs.map((l) => row[l] ?? 0)));
  const lastVals: Partial<Record<Lang, number | null>> = {};
  for (const l of langs) {
    const i = lastIdx(l);
    lastVals[l] = i >= 0 ? (rows[i][l] ?? null) : null;
  }
  const dys = endLabelOffsets(lastVals, max, log);
  return (
    <div className="h-[340px] w-full sm:h-[420px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 28, right: 36, bottom: 4, left: 4 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="ts" type="number" scale="time" domain={[start, end]} ticks={ticks} tickFormatter={(v) => fmtShortDateTime(v)} {...AXIS} />
          <YAxis
            scale={log ? "log" : "linear"}
            domain={log ? [1, "auto"] : [0, (dataMax: number) => Math.max(10, dataMax)]}
            allowDataOverflow={log}
            tickFormatter={(v) => fmtInt(v)}
            width={64}
            {...AXIS}
          />
          <Tooltip
            cursor={{ stroke: "#3FD0C9", strokeOpacity: 0.4 }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipCard
                  title={`${fmtShortDateTime(Number(label))} UTC · vues sur 1 h`}
                  rows={langs.map((l) => ({
                    key: l,
                    color: LANG_COLOR[l],
                    label: <span className="font-mono font-bold text-ink">{LANG_CODE[l]}</span>,
                    value: (payload[0].payload as Row)[l] ?? null,
                  }))}
                />
              ) : null
            }
          />
          <ReferenceLine
            x={quakeHour}
            stroke="#FF8A4C"
            strokeWidth={2}
            strokeDasharray="5 4"
            label={{ value: quakeLabel, position: "insideTopRight", fill: "#FF8A4C", fontSize: 12, fontWeight: 700, fontFamily: "JetBrains Mono, monospace" }}
          />
          {langs.map((l) => (
            <Line
              key={l}
              type="monotone"
              dataKey={l}
              name={LANG_CODE[l]}
              stroke={LANG_COLOR[l]}
              strokeWidth={2}
              dot={{ r: 2.5, fill: LANG_COLOR[l], strokeWidth: 0 }}
              activeDot={{ r: 4, stroke: "#0A1020", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
              label={endLabel(l, lastIdx(l), dys[l] ?? 0)}
            />
          ))}
          {r.series.map((s) =>
            s.peak && s.peak.views > 0 ? (
              <ReferenceDot
                key={s.lang}
                x={new Date(s.peak.hour).getTime()}
                y={s.peak.views}
                r={5}
                fill={LANG_COLOR[s.lang]}
                stroke="#fff"
                strokeWidth={1.5}
                ifOverflow="extendDomain"
              />
            ) : null,
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function ReplayPage() {
  const replay = usePolling((s) => api.replayAlHaouz(s), 60000);
  const [log, setLog] = useState(false);
  const [full, setFull] = useState(false);
  const r = replay.data;
  const expectedHours = r ? Math.round((new Date(r.end).getTime() - new Date(r.start).getTime()) / HOUR) + 1 : 49;
  const ordered = r ? [...r.series].sort((a, b) => LANGS.indexOf(a.lang) - LANGS.indexOf(b.lang)) : [];

  return (
    <div>
      <PageHeader icon="⏪" title="Rejouer : séisme d'Al Haouz">
        <p>
          Le 8 septembre 2023 à 22:11 UTC, un séisme de magnitude 6,8 (USGS) frappe la région d'Al Haouz, au sud de Marrakech. Voici les vues
          horaires des articles Wikipédia sur ce séisme, du 8 septembre 12:00 au 10 septembre 12:00 (UTC).
        </p>
      </PageHeader>

      {!r ? (
        <div className="panel p-5">
          {replay.error ? <ErrorState error={replay.error} onRetry={replay.refresh} /> : <Loading rows={5} label="Chargement des vues horaires…" />}
        </div>
      ) : r.hours_loaded === 0 ? (
        <div className="panel p-5">
          <Empty>
            Aucune heure de vues n'est encore chargée. Lancez le chargeur :{" "}
            <code className="mt-2 block rounded bg-night px-2 py-1 font-mono text-[11px] text-ink-2">
              docker compose --profile batch run --rm pageviews-loader
            </code>
          </Empty>
        </div>
      ) : (
        <>
          <StaleBanner error={replay.error} />
          <p className="fade-up mb-5 font-display text-2xl font-bold leading-snug text-white sm:text-3xl">
            Voici le pic que notre radar doit <span className="text-alert">détecter</span>.
          </p>

          <Panel
            title="Vues par heure (ordinateur + mobile)"
            right={
              <div className="flex flex-wrap items-center gap-4">
                <span
                  className={`rounded-md border px-2 py-0.5 font-mono text-[11px] ${
                    r.hours_loaded < expectedHours ? "border-yellow-300/40 bg-yellow-300/10 text-yellow-100" : "border-cyan/40 text-cyan"
                  }`}
                >
                  {fmtInt(r.hours_loaded)} heures chargées sur {fmtInt(expectedHours)}
                </span>
                <Toggle checked={full} onChange={setFull} label="Afficher les 49 h" />
                <Toggle checked={log} onChange={setLog} label="Échelle logarithmique" />
              </div>
            }
          >
            <LangLegend className="mb-3" />
            {r.series.every((s) => s.total === 0) && (
              <p className="mb-2 rounded-lg border border-line2 bg-night/50 px-3 py-2 text-xs text-ink-2">
                Les heures chargées ({fmtInt(r.hours_loaded)}) ne contiennent encore aucune vue pour ces articles : la courbe montera dès que
                les heures qui suivent le séisme seront chargées.
              </p>
            )}
            <ReplayChart r={r} log={log} full={full} />
            <p className="mt-2 text-xs text-ink-3">
              Axe horizontal : heures UTC.{" "}
              {full ? "Période complète (49 h)." : "Par défaut, seules les heures chargées (et l'heure du séisme) sont affichées."} L'anglais a
              beaucoup plus de lecteurs : activez l'échelle logarithmique pour comparer la forme des trois courbes.
              {r.hours_loaded < expectedHours && " Les heures pas encore chargées apparaissent comme des trous."}
            </p>
          </Panel>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {ordered.map((s) => (
              <article key={s.lang} className="panel p-4">
                <div className="flex items-center gap-2">
                  <LangBadge lang={s.lang} size="md" />
                  <span className="text-sm text-ink-3">{LANG_NAME[s.lang]}</span>
                </div>
                <p className="label mt-3">Pic</p>
                {s.peak && s.peak.views > 0 ? (
                  <>
                    <p className="num text-3xl font-bold text-white">{fmtInt(s.peak.views)}</p>
                    <p className="text-xs text-ink-3">vues/heure à {fmtShortDateTime(s.peak.hour)} UTC</p>
                  </>
                ) : (
                  <p className="text-sm text-ink-3">pas encore de vues chargées</p>
                )}
                <p className="mt-2 text-xs text-ink-2">
                  Total sur la période : <span className="num font-semibold text-white">{fmtInt(s.total)}</span> vues
                </p>
                <div className="mt-3 border-t border-line pt-3 text-xs text-ink-3">
                  <p>
                    Article :{" "}
                    <ArticleLink lang={s.lang} title={s.title} className="text-ink" />
                  </p>
                  <p className="mt-1">
                    Titre à l'époque :{" "}
                    <LangText lang={s.lang} className="text-ink-2">
                      {s.title_at_time}
                    </LangText>
                  </p>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-cyan/80 hover:text-cyan">
                      {fmtInt(s.titles_counted.length)} {s.titles_counted.length > 1 ? "titres comptés" : "titre compté"}
                    </summary>
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                      {s.titles_counted.map((t) => (
                        <li key={t}>
                          <LangText lang={s.lang}>{t}</LangText>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              </article>
            ))}
          </div>

          <Panel className="mt-6" title="D'où viennent ces chiffres ?">
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
              <li>
                Source : les fichiers horaires <em>pageviews</em> publiés par Wikimedia sur{" "}
                <a className="link" href="https://dumps.wikimedia.org/other/pageviews/" target="_blank" rel="noreferrer">
                  dumps.wikimedia.org
                </a>{" "}
                (plusieurs millions de lignes par heure), chargés dans MongoDB (collection <code className="font-mono">pageviews</code>).
              </li>
              <li>
                Pour chaque langue, on additionne les vues du titre utilisé à l'époque (<code className="font-mono">title_at_time</code>), du
                titre actuel et de leurs redirections : les vues d'une redirection sont comptées sous le nom de la redirection.
              </li>
              <li>Vues = ordinateur + mobile. Une heure chargée sans ligne compte 0 ; une heure non chargée est absente.</li>
            </ul>
          </Panel>

          <details className="panel mt-6 p-4">
            <summary className="cursor-pointer font-display text-[15px] font-semibold text-ink">Voir les données en tableau</summary>
            <div className="mt-3 max-h-96 overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-panel">
                  <tr className="label">
                    <th className="py-1.5 pr-4 font-normal">Heure (UTC)</th>
                    {ordered.map((s) => (
                      <th key={s.lang} className="py-1.5 pr-4 text-right font-normal">
                        {LANG_CODE[s.lang]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {buildRows(r, false).map((row) => (
                    <tr key={row.ts} className="border-t border-line/60">
                      <td className="num py-1 pr-4 text-ink-2">{fmtShortDateTime(row.ts)}</td>
                      {ordered.map((s) => (
                        <td key={s.lang} className="num py-1 pr-4 text-right text-white">
                          {row[s.lang] === null || row[s.lang] === undefined ? "–" : fmtInt(row[s.lang] as number)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
