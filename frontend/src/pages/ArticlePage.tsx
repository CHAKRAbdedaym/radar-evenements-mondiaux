import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, ApiError, type Article, type EditText, type Lang } from "../api";
import { usePolling } from "../hooks/usePolling";
import { fmtDateTimeUtc, fmtDec1, fmtInt, fmtShortDateTime, fmtTimeUtc } from "../lib/format";
import { LANG_NAME, dirOf, isLang, wikiDiffUrl, wikiUrl } from "../lib/lang";
import { AXIS, GRID, TooltipCard } from "../components/charts";
import { BaselineBadge, DeltaBytes, Empty, ErrorState, LangBadge, Loading, Panel, StaleBanner, StatTile, TimeAgo } from "../components/ui";

const BUCKET_MS = 5 * 60 * 1000;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Reads lang + title from the raw (still encoded) pathname, so titles containing "/" survive. */
function useArticleParams(): { lang: string; title: string } {
  const { pathname } = useLocation();
  const m = pathname.match(/^\/article\/([^/]+)\/(.+)$/);
  if (!m) return { lang: "", title: "" };
  return { lang: m[1], title: safeDecode(m[2]).replace(/_/g, " ").trim() };
}

function LongText({ text, lang, kind }: { text: string; lang: Lang; kind: "added" | "removed" }) {
  const [open, setOpen] = useState(false);
  const LIMIT = 420;
  const long = text.length > LIMIT;
  const shown = open || !long ? text : `${text.slice(0, LIMIT)}…`;
  const added = kind === "added";
  return (
    <div
      className={`rounded-lg border-l-2 px-3 py-2 text-[13.5px] leading-relaxed ${
        added ? "border-plus bg-plus/[0.07] text-[#CFF5DF]" : "border-minus bg-minus/[0.07] text-[#F6C4C4]"
      }`}
    >
      <p className="mb-1 font-mono text-[10.5px] uppercase tracking-wider opacity-80">{added ? "+ texte ajouté" : "− texte retiré"}</p>
      <p dir={dirOf(lang)} className={`whitespace-pre-wrap break-words ${added ? "" : "line-through decoration-minus/60"} ${lang === "ar" ? "font-arabic" : ""}`}>
        {shown}
      </p>
      {long && (
        <button className="mt-1 font-mono text-[11px] text-cyan hover:underline" onClick={() => setOpen((v) => !v)}>
          {open ? "Réduire" : `Afficher tout (${fmtInt(text.length)} caractères)`}
        </button>
      )}
    </div>
  );
}

function TextItem({ t, lang }: { t: EditText; lang: Lang }) {
  const empty = !t.added_text && !t.removed_text;
  return (
    <li className="border-b border-line/70 py-4 last:border-0">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
        <span className="num text-ink-2">{fmtDateTimeUtc(t.timestamp)}</span>
        <a className="link font-mono" href={wikiDiffUrl(lang, t.rev_new)} target="_blank" rel="noreferrer">
          révision {t.rev_new} ↗
        </a>
        {t.comment && (
          <span className="min-w-0 truncate italic" dir="auto">
            « {t.comment} »
          </span>
        )}
      </div>
      <div className="space-y-2">
        {t.added_text && <LongText text={t.added_text} lang={lang} kind="added" />}
        {t.removed_text && <LongText text={t.removed_text} lang={lang} kind="removed" />}
        {empty && <p className="text-xs text-ink-3">Modification sans texte visible (mise en forme, liens ou modèles).</p>}
      </div>
    </li>
  );
}

function EditsTimeline({ a }: { a: Article }) {
  const data = useMemo(() => {
    if (!a.timeline.length) return [];
    const map = new Map(a.timeline.map((p) => [new Date(p.t).getTime(), p.edits]));
    const keys = [...map.keys()].sort((x, y) => x - y);
    const out: { ts: number; edits: number }[] = [];
    const start = keys[0];
    const end = keys[keys.length - 1];
    if ((end - start) / BUCKET_MS > 300) return keys.map((k) => ({ ts: k, edits: map.get(k)! }));
    for (let t = start; t <= end; t += BUCKET_MS) out.push({ ts: t, edits: map.get(t) ?? 0 });
    return out;
  }, [a.timeline]);
  if (!data.length) return <Empty>Aucune modification de cet article sur les dernières 24 h.</Empty>;
  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="ts" tickFormatter={(v) => fmtShortDateTime(v)} minTickGap={50} {...AXIS} />
          <YAxis allowDecimals={false} {...AXIS} width={44} />
          <Tooltip
            cursor={{ fill: "rgba(63,208,201,0.08)" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <TooltipCard
                  title={`${fmtShortDateTime((payload[0].payload as { ts: number }).ts)} UTC (tranche de 5 min)`}
                  rows={[{ key: "e", label: "Modifications", color: "#3FD0C9", value: payload[0].value as number }]}
                />
              ) : null
            }
          />
          <Bar dataKey="edits" fill="#3FD0C9" fillOpacity={0.85} radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PageviewsChart({ lang, title }: { lang: Lang; title: string }) {
  const pv = usePolling((s) => api.pageviews(lang, title, undefined, s), null, [lang, title]);
  if (!pv.data) return pv.error ? <ErrorState error={pv.error} onRetry={pv.refresh} /> : <Loading rows={3} />;
  const data = pv.data.items.map((p) => ({ ts: new Date(p.hour).getTime(), views: p.views }));
  if (!data.length) return <Empty>Pas de vues horaires chargées pour cet article.</Empty>;
  return (
    <>
      <p className="mb-2 text-xs text-ink-3">
        {fmtInt(data.length)} heures · vues ordinateur + mobile · source : dumps horaires Wikimedia (heures en UTC)
      </p>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -6 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="ts" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={(v) => fmtShortDateTime(v)} minTickGap={60} {...AXIS} />
            <YAxis tickFormatter={(v) => fmtInt(v)} width={56} {...AXIS} />
            <Tooltip
              cursor={{ stroke: "#3FD0C9", strokeOpacity: 0.4 }}
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TooltipCard
                    title={`${fmtShortDateTime((payload[0].payload as { ts: number }).ts)} UTC`}
                    rows={[{ key: "v", label: "Vues (1 h)", color: "#3FD0C9", value: payload[0].value as number }]}
                  />
                ) : null
              }
            />
            <Line type="monotone" dataKey="views" stroke="#3FD0C9" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

export default function ArticlePage() {
  const { lang, title } = useArticleParams();
  const valid = isLang(lang) && title.length > 0;
  const art = usePolling((s) => (valid ? api.article(lang as Lang, title, s) : Promise.reject(new ApiError(400, "Adresse d'article invalide."))), 30000, [lang, title]);

  if (!valid) {
    return (
      <Empty title="Adresse d'article invalide">
        La langue doit être ar, fr ou en. <Link className="link" to="/">Retour au radar</Link>
      </Empty>
    );
  }
  const l = lang as Lang;

  const header = (
    <header className="fade-up mb-6">
      <Link to="/" className="font-mono text-xs text-ink-3 hover:text-cyan">
        ← Radar en direct
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <LangBadge lang={l} size="md" />
        <span className="text-sm text-ink-3">Wikipédia en {LANG_NAME[l]}</span>
      </div>
      <h1 dir={dirOf(l)} className={`mt-2 text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl ${l === "ar" ? "font-arabic text-right" : "font-display"}`}>
        <span aria-hidden>📄 </span>
        {title}
      </h1>
      <a className="link mt-2 inline-block text-sm" href={art.data?.url ?? wikiUrl(l, title)} target="_blank" rel="noreferrer">
        Voir sur Wikipédia ↗
      </a>
    </header>
  );

  if (!art.data) {
    return (
      <div>
        {header}
        <div className="panel p-5">
          {art.error ? (
            art.error instanceof ApiError && art.error.status === 404 ? (
              <Empty title="Aucune donnée pour cet article">
                Cet article n'a encore aucune modification, aucun texte ni aucune vue horaire dans notre base.
              </Empty>
            ) : (
              <ErrorState error={art.error} onRetry={art.refresh} />
            )
          ) : (
            <Loading rows={4} label="Chargement de l'article…" />
          )}
        </div>
      </div>
    );
  }

  const a = art.data;
  return (
    <div>
      {header}
      <StaleBanner error={art.error} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Modifications" value={fmtInt(a.stats.edits_total)} hint={`${fmtInt(a.stats.edits_human)} humaines`} />
        <StatTile label="Contributeurs" value={fmtInt(a.stats.distinct_users)} hint="distincts" />
        <StatTile label="Octets (somme)" accent="none" value={<DeltaBytes value={a.stats.delta_bytes} />} />
        <StatTile label="Alertes" accent={a.alerts.length ? "alert" : "none"} value={fmtInt(a.alerts.length)} />
        <StatTile label="Première modif." accent="none" value={<span className="text-base">{a.stats.first_edit ? fmtTimeUtc(a.stats.first_edit) : "–"}</span>} hint={a.stats.first_edit ? fmtDateTimeUtc(a.stats.first_edit).slice(0, 10) : undefined} />
        <StatTile label="Dernière modif." accent="none" value={<span className="text-base"><TimeAgo iso={a.stats.last_edit} /></span>} hint={a.stats.last_edit ? fmtDateTimeUtc(a.stats.last_edit) : undefined} />
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        <Panel className="xl:col-span-7" title="Modifications par tranche de 5 min (24 h)" right={<span className="font-mono text-[11px] text-ink-3">UTC</span>}>
          <EditsTimeline a={a} />
        </Panel>

        <Panel className="xl:col-span-5" title="Alertes pour cet article">
          {a.alerts.length === 0 ? (
            <Empty title="Aucune alerte">Aucun pic anormal détecté pour cet article.</Empty>
          ) : (
            <ul className="divide-y divide-line/70">
              {a.alerts.map((al) => (
                <li key={al.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-ink-2">{fmtDateTimeUtc(al.window_end)}</p>
                    <p className="text-xs text-ink-3">
                      {fmtInt(al.edits)} modifs · {fmtInt(al.distinct_users)} contributeurs
                    </p>
                    <div className="mt-1">
                      <BaselineBadge type={al.baseline_type} />
                    </div>
                  </div>
                  <p className="num text-2xl font-bold text-alert">z {fmtDec1(al.z_score)}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="xl:col-span-12" title={`Textes ajoutés et retirés (${fmtInt(a.texts.length)} dernières révisions)`}>
          {a.texts.length === 0 ? (
            <Empty>
              Aucun texte récupéré pour l'instant. Le diff-worker télécharge le contenu des modifications humaines via l'API
              Wikipédia (action=compare).
            </Empty>
          ) : (
            <ul>
              {a.texts.map((t) => (
                <TextItem key={t.id} t={t} lang={l} />
              ))}
            </ul>
          )}
        </Panel>

        {a.pageviews_count > 0 && (
          <Panel className="xl:col-span-7" title="Vues par heure">
            <PageviewsChart lang={l} title={a.title} />
          </Panel>
        )}

        <Panel className={a.pageviews_count > 0 ? "xl:col-span-5" : "xl:col-span-12"} title={`Dernières modifications (${fmtInt(a.edits.length)})`}>
          {a.edits.length === 0 ? (
            <Empty>Aucune modification enregistrée.</Empty>
          ) : (
            <ul className="max-h-[420px] divide-y divide-line/70 overflow-y-auto pr-1">
              {a.edits.map((e) => (
                <li key={e.id} className="grid grid-cols-[1fr_auto] gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-ink-2">
                      <span dir="auto">{e.user || "anonyme"}</span>
                      {e.bot && <span className="ml-1 rounded bg-white/10 px-1 font-mono text-[10px]">BOT</span>}
                    </p>
                    {e.comment && (
                      <p className="truncate text-xs italic text-ink-3" dir="auto">
                        {e.comment}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <DeltaBytes value={e.delta_bytes} className="block text-xs" />
                    <span className="font-mono text-[10.5px] text-ink-3">{fmtDateTimeUtc(e.timestamp)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
