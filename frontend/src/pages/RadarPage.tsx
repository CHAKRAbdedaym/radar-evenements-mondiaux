import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Edit, type Lang, type RadarItem } from "../api";
import { usePolling, useNow } from "../hooks/usePolling";
import { fmtBytes, fmtDec1, fmtInt, fmtRelative } from "../lib/format";
import { LANG_CODE, LANGS } from "../lib/lang";
import RadarScope from "../components/Radar";
import { LangLinesChart } from "../components/charts";
import {
  AnimatedNumber,
  ArticleLink,
  DataView,
  DeltaBytes,
  Empty,
  ErrorState,
  LangBadge,
  LangFilter,
  LangLegend,
  LiveIndicator,
  Loading,
  Panel,
  StaleBanner,
  StatTile,
  Toggle,
} from "../components/ui";

const LIVE_MS = 5000;

function Counters() {
  const stats = usePolling((s) => api.stats(s), LIVE_MS);
  const d = stats.data;
  if (!d) {
    return (
      <div className="panel px-4 py-3">
        {stats.error ? <ErrorState error={stats.error} onRetry={stats.refresh} /> : <Loading rows={1} label="Chargement des compteurs…" />}
      </div>
    );
  }
  const total = d.collections.edits?.count ?? 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      <StatTile label="Modifs / min" value={<AnimatedNumber value={d.edits_last_minute} />} hint={`${fmtInt(d.edits_last_hour)} sur la dernière heure`} />
      <StatTile label="Modifs stockées" value={<AnimatedNumber value={total} />} hint="dans MongoDB (edits)" />
      <StatTile label="Articles actifs" value={<AnimatedNumber value={d.active_articles} />} hint="modifiés ces 5 min (hors bots)" />
      <StatTile
        label="Alertes actives"
        accent={d.active_alerts > 0 ? "alert" : "none"}
        value={
          <Link to="/alertes" className="hover:underline">
            {d.active_alerts > 0 && <span aria-hidden>🚨 </span>}
            <AnimatedNumber value={d.active_alerts} />
          </Link>
        }
        hint="créées dans la dernière heure"
      />
      <StatTile
        label="Taille MongoDB"
        accent="none"
        value={fmtBytes(d.db.total_size_bytes)}
        hint={`bots : ${fmtDec1(d.bots.bot_pct)} % des modifs (1 h)`}
      />
    </div>
  );
}

function TickerRow({ e, now, fresh }: { e: Edit; now: number; fresh: boolean }) {
  return (
    <li className={`grid grid-cols-[auto_1fr_auto] items-start gap-x-3 gap-y-0.5 border-b border-line/70 px-1 py-2.5 last:border-0 ${fresh ? "row-in" : ""}`}>
      <LangBadge lang={e.lang} />
      <div className="min-w-0">
        <ArticleLink lang={e.lang} title={e.title} className={`block truncate text-[13.5px] text-ink ${e.lang === "ar" ? "text-right" : ""}`} />
        <p className="truncate text-[11.5px] text-ink-3">
          {e.type === "new" && <span className="mr-1 rounded bg-cyan/15 px-1 font-mono text-[10px] text-cyan">NOUVEL ARTICLE</span>}
          {e.bot && <span className="mr-1 rounded bg-white/10 px-1 font-mono text-[10px] text-ink-2">BOT</span>}
          par <span className="text-ink-2" dir="auto">{e.user || "anonyme"}</span>
        </p>
      </div>
      <div className="text-right">
        <DeltaBytes value={e.delta_bytes} className="block text-[12.5px]" />
        <time dateTime={e.timestamp} className="block whitespace-nowrap font-mono text-[10.5px] text-ink-3">
          {fmtRelative(e.timestamp, now)}
        </time>
      </div>
    </li>
  );
}

function Ticker({ lang, includeBots }: { lang: Lang | null; includeBots: boolean }) {
  const recent = usePolling((s) => api.recentEdits({ lang, includeBots, limit: 30 }, s), LIVE_MS, [lang, includeBots]);
  const now = useNow(5000);
  const seen = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  useEffect(() => {
    seen.current = new Set();
    firstLoad.current = true;
  }, [lang, includeBots]);
  const items = recent.data?.items ?? [];
  const fresh = useMemo(() => {
    const f = new Set<string>();
    if (!recent.data) return f;
    for (const e of recent.data.items) if (!seen.current.has(e.id) && !firstLoad.current) f.add(e.id);
    recent.data.items.forEach((e) => seen.current.add(e.id));
    firstLoad.current = false;
    return f;
  }, [recent.data]);
  return (
    <Panel
      title="Dernières modifications"
      right={<LiveIndicator lastUpdated={recent.lastUpdated} error={recent.error} />}
      bodyClass="px-3 pb-2 pt-1 sm:px-4"
    >
      <DataView state={recent} isEmpty={(d) => d.items.length === 0} empty={<Empty>Aucune modification reçue pour ce filtre pour l'instant.</Empty>} loadingRows={6}>
        {() => (
          <ul className="max-h-[560px] overflow-y-auto pr-1" aria-live="off">
            {items.map((e) => (
              <TickerRow key={e.id} e={e} now={now} fresh={fresh.has(e.id)} />
            ))}
          </ul>
        )}
      </DataView>
    </Panel>
  );
}

function TopList({ items, now }: { items: RadarItem[]; now: number }) {
  const top = [...items].sort((a, b) => b.edits - a.edits || b.distinct_users - a.distinct_users).slice(0, 10);
  return (
    <ol className="divide-y divide-line/70">
      {top.map((it, i) => (
        <li key={`${it.lang}:${it.title}`} className="grid grid-cols-[1.5rem_auto_1fr_auto] items-center gap-2 py-2">
          <span className="num text-xs text-ink-3">{i + 1}</span>
          <LangBadge lang={it.lang} />
          <div className="min-w-0">
            <ArticleLink lang={it.lang} title={it.title} className={`block truncate text-[13.5px] ${it.lang === "ar" ? "text-right" : ""}`} />
            <p className="text-[11px] text-ink-3">
              {fmtInt(it.distinct_users)} contributeur{it.distinct_users > 1 ? "s" : ""} · {fmtRelative(it.last_edit, now)}
            </p>
          </div>
          <div className="text-right">
            <p className="num text-sm font-bold text-white">{fmtInt(it.edits)}</p>
            <p className={`num text-[10.5px] ${it.alert ? "font-bold text-alert" : "text-ink-3"}`}>
              {it.alert && "🚨 "}z {it.z_score === null ? "en calcul" : fmtDec1(it.z_score)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export default function RadarPage() {
  const [lang, setLang] = useState<Lang | null>(null);
  const [hideBots, setHideBots] = useState(true);
  const includeBots = !hideBots;
  const radar = usePolling((s) => api.radar({ lang, includeBots }, s), LIVE_MS, [lang, includeBots]);
  const timeline = usePolling((s) => api.timeline({ lang, includeBots, minutes: 60 }, s), LIVE_MS * 2, [lang, includeBots]);
  const now = useNow(5000);

  const radarItems = radar.data?.items ?? [];
  const alerting = radarItems.filter((i) => i.alert).length;
  let overlay = null;
  if (!radar.data) {
    overlay = radar.error ? <ErrorState error={radar.error} onRetry={radar.refresh} /> : <p className="font-mono text-xs text-ink-2">Chargement du radar…</p>;
  } else if (radarItems.length === 0) {
    overlay = <Empty>Aucun article modifié ces {radar.data.window_minutes} dernières minutes pour ce filtre.</Empty>;
  }

  const tlData = useMemo(
    () => (timeline.data?.items ?? []).map((p) => ({ ts: new Date(p.t).getTime(), ar: p.ar, fr: p.fr, en: p.en })),
    [timeline.data],
  );

  return (
    <div className="space-y-6">
      {/* Hero */}
      <header className="fade-up flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="label text-cyan/80">Projet Big Data · Wikipédia en temps réel</p>
          <h1 className="mt-2 font-display text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
            <span aria-hidden>🛰️ </span>Radar d'événements mondiaux
          </h1>
          <p className="mt-3 text-[15.5px] leading-relaxed text-ink-2">
            Quand un événement majeur arrive, les articles Wikipédia liés s'emballent. Ce radar surveille en direct les
            modifications en <strong className="text-ink">arabe</strong>, <strong className="text-ink">français</strong> et{" "}
            <strong className="text-ink">anglais</strong> et signale les <strong className="text-alert">pics anormaux</strong>.
          </p>
        </div>
        <LiveIndicator lastUpdated={radar.lastUpdated} error={radar.error} />
      </header>

      <Counters />

      {/* Filters */}
      <div className="panel flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="label">Langue</span>
          <LangFilter value={lang} onChange={setLang} />
        </div>
        <Toggle checked={hideBots} onChange={setHideBots} label="Masquer les bots" />
        <LangLegend className="lg:ml-auto" />
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        <Panel
          className="xl:col-span-7"
          title={
            <>
              Radar en direct
              <span className="ml-2 font-mono text-xs font-normal text-ink-3">
                {radar.data ? `${fmtInt(radarItems.length)} articles · ${radar.data.window_minutes} dernières min` : ""}
              </span>
            </>
          }
          right={
            alerting > 0 ? (
              <Link to="/alertes" className="rounded-md border border-alert/50 bg-alert-soft px-2 py-0.5 font-mono text-xs font-bold text-alert">
                🚨 {alerting} en alerte
              </Link>
            ) : null
          }
        >
          <StaleBanner error={radar.data ? radar.error : null} />
          <RadarScope items={radarItems} serverTime={radar.data?.time ?? null} windowMinutes={radar.data?.window_minutes ?? 5} overlay={overlay} />
          <div className="mt-4 grid gap-2 text-xs text-ink-3 sm:grid-cols-2">
            <p>
              <span className="text-ink-2">Un point = un article.</span> Taille = nombre de modifications ; couleur et code = langue.
            </p>
            <p>
              Centre = modifié à l'instant, bord = il y a {radar.data?.window_minutes ?? 5} min.{" "}
              <span className="text-alert">Anneau orange pulsant = alerte.</span>
            </p>
          </div>
        </Panel>

        <div className="xl:col-span-5">
          <Ticker lang={lang} includeBots={includeBots} />
        </div>

        <Panel
          className="xl:col-span-7"
          title="Modifications par minute (60 dernières min)"
          right={<span className="font-mono text-[11px] text-ink-3">heures en UTC</span>}
        >
          <DataView
            state={timeline}
            isEmpty={(d) => d.items.every((p) => p.total === 0)}
            empty={<Empty>Aucune modification sur la dernière heure pour ce filtre.</Empty>}
          >
            {() => (
              <>
                <LangLegend className="mb-2" />
                <LangLinesChart data={tlData} langs={lang ? [lang] : LANGS} height={230} unit="modifications" />
              </>
            )}
          </DataView>
        </Panel>

        <Panel className="xl:col-span-5" title="Articles les plus actifs (5 min)">
          {radar.data ? (
            radarItems.length ? (
              <TopList items={radarItems} now={now} />
            ) : (
              <Empty />
            )
          ) : radar.error ? (
            <ErrorState error={radar.error} onRetry={radar.refresh} />
          ) : (
            <Loading rows={5} />
          )}
        </Panel>
      </div>

      <p className="text-center text-xs text-ink-3">
        Données réelles : flux EventStreams de Wikimedia ({LANGS.map((l) => LANG_CODE[l]).join(", ")}), stockées dans MongoDB ·
        rafraîchissement toutes les 5 s · heures en UTC
      </p>
    </div>
  );
}
