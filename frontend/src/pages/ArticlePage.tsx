import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, ApiError, type Article, type Lang } from "../api";
import { usePolling } from "../hooks/usePolling";
import { useTitle } from "../hooks/useTitle";
import { fmtDay, fmtDayRange, fmtDayTimeUtc, fmtInt, fmtSigned, fmtTime, fmtTimeUtc, plural } from "../lib/format";
import { LANG_NAME, dirOf, isLang, wikiName, wikiUrl } from "../lib/lang";
import { reasonSentence, themePath, themeSourceSentence } from "../lib/themes";
import { cleanComment, cleanSnippet, isRevert, textLength } from "../lib/wikitext";
import { AlertsTable } from "../components/AlertsTable";
import { EditText, FactBox, WikiImage } from "../components/blocks";
import { ChartFrame, ColumnChart } from "../components/charts";
import { EventCompact, ForeignDescription } from "../components/EventItem";
import { EmptyState, ErrorState, Loading } from "../components/states";
import { Coll, ExtLink, Kicker, LangCode, MetaLine, SectionHeader, SourceNote, Timestamp } from "../components/text";

const BUCKET = 5 * 60 * 1000;

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** lang + title from the raw (still encoded) pathname, so titles containing "/" survive. */
function useArticleParams(): { lang: string; title: string } {
  const { pathname } = useLocation();
  const m = pathname.match(/^\/article\/([^/]+)\/(.+)$/);
  if (!m) return { lang: "", title: "" };
  return { lang: m[1], title: safeDecode(m[2]).replace(/_/g, " ").trim() };
}

function EditsChart({ a }: { a: Article }) {
  const data = useMemo(() => {
    const map = new Map(a.timeline.map((p) => [new Date(p.t).getTime(), p.edits]));
    const keys = [...map.keys()].sort((x, y) => x - y);
    if (!keys.length) return { xs: [] as number[], vs: [] as number[] };
    const xs: number[] = [];
    const last = keys[keys.length - 1];
    const first = Math.min(keys[0], last - 35 * BUCKET); // at least 3 h so a few edits do not become wide blocks
    for (let t = first; t <= last; t += BUCKET) xs.push(t);
    return { xs, vs: xs.map((t) => map.get(t) ?? 0) };
  }, [a.timeline]);
  const alertWindows = a.alerts.map((al) => [new Date(al.window_start).getTime(), new Date(al.window_end).getTime()]);
  const total = data.vs.reduce((s, v) => s + v, 0);
  if (!data.xs.length)
    return (
      <EmptyState reason={a.stats.last_edit ? `Dernière modification : ${fmtDayTimeUtc(a.stats.last_edit)}.` : undefined}>Aucune modification ces dernières 24 heures.</EmptyState>
    );
  return (
    <ChartFrame
      title={`Modifications par tranche de 5 min, de ${fmtTimeUtc(data.xs[0]).replace(" UTC", "")} à ${fmtTimeUtc(data.xs[data.xs.length - 1] + BUCKET)}${alertWindows.length ? " ; en rouge, les fenêtres d’alerte" : ""}`}
      source={
        <SourceNote>
          collection <Coll name="edits" /> (MongoDB) : {fmtInt(total)} des {plural(a.stats.edits_total, "modification")} de l’article ont eu lieu ces 24 dernières heures (robots compris).
        </SourceNote>
      }
    >
      <ColumnChart
        xs={data.xs}
        values={data.vs}
        bucketMs={BUCKET}
        height={180}
        xFormat={(t) => fmtTime(t)}
        tipTitle={(t) => `${fmtDay(t)}, ${fmtTime(t)}–${fmtTimeUtc(t + BUCKET)}`}
        unit="modifications"
        ariaLabel={`${plural(total, "modification")} sur 24 heures.`}
        highlight={(i) => alertWindows.some(([s, e]) => data.xs[i] >= s - BUCKET && data.xs[i] < e)}
      />
    </ChartFrame>
  );
}

function EditsTable({ a }: { a: Article }) {
  const [all, setAll] = useState(false);
  const rows = all ? a.edits : a.edits.slice(0, 10);
  return (
    <>
      <div className="table-wrap">
        <table className="dt">
          <thead>
            <tr>
              <th>Heure</th>
              <th>Contributeur</th>
              <th className="r">Octets</th>
              <th className="hide-m">Résumé</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="nw">{fmtDayTimeUtc(e.timestamp)}</td>
                <td className="break">
                  <bdi>{e.user}</bdi>
                  {e.bot ? <span className="muted"> (robot)</span> : ""}
                </td>
                <td className="r">{fmtSigned(e.delta_bytes)}</td>
                <td className="hide-m muted" style={{ maxWidth: 360 }}>
                  {isRevert(e.comment) && <span className="kicker" style={{ display: "block" }}>Annulation</span>}
                  <bdi dir="auto">{cleanComment(e.comment) || "–"}</bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {a.edits.length > 10 && (
        <button type="button" className="btn-text" style={{ marginTop: 8 }} onClick={() => setAll((v) => !v)}>
          {all ? "Afficher moins" : `Afficher les ${fmtInt(a.edits.length)} dernières modifications`}
        </button>
      )}
      <SourceNote>
        collection <Coll name="edits" />, Wikimedia EventStreams.
      </SourceNote>
    </>
  );
}

function Why({ a }: { a: Article }) {
  const en = a.enrichment;
  if (!en) return <p className="t-14 muted">Cet article n’a pas encore été classé par l’enrichisseur (Wikipédia + Wikidata).</p>;
  const sentence = reasonSentence(en.theme_reason, en.theme_label);
  return (
    <div className="stack-8">
      <p className="t-14">{themeSourceSentence(en.theme_source, en.theme_confidence)}</p>
      {sentence && <p className="t-14">{sentence}</p>}
      {en.theme_reason && (
        <p className="mono faint" style={{ fontSize: 12 }}>
          {en.theme_reason}
        </p>
      )}
      {en.categories.length > 0 && (
        <p className="t-14 muted">
          Catégories Wikipédia : {en.categories.slice(0, 3).join(" · ")}
          {en.categories.length > 3 ? ` (et ${fmtInt(en.categories.length - 3)} autres)` : ""}
        </p>
      )}
    </div>
  );
}

export default function ArticlePage() {
  const p = useArticleParams();
  const lang = isLang(p.lang) ? (p.lang as Lang) : null;
  const st = usePolling((s) => (lang ? api.article(lang, p.title, s) : Promise.reject(new ApiError(400, "langue inconnue"))), 60000, [p.lang, p.title]);
  const a = st.data;
  useTitle(a ? a.title : p.title || "Article");

  if (!a) {
    if (st.error instanceof ApiError && (st.error.status === 404 || st.error.status === 400))
      return (
        <div>
          <header className="page-head">
            <p className="kicker">Article</p>
            <h1 className="t-40" dir={lang ? dirOf(lang) : undefined}>
              {p.title || "Article introuvable"}
            </h1>
            <p className="standfirst">
              {lang
                ? `Aucune donnée pour cet article dans MongoDB : pas de modification reçue, pas de texte, pas de vues chargées.`
                : "La langue doit être ar, fr ou en."}
            </p>
          </header>
          <EmptyState>
            {lang && p.title ? (
              <>
                <ExtLink href={wikiUrl(lang, p.title)}>Lire l’article sur {wikiName(lang)}</ExtLink> · <Link to="/recherche">Chercher un autre article</Link>
              </>
            ) : (
              <Link to="/">Retour à la une</Link>
            )}
          </EmptyState>
        </div>
      );
    if (st.error) return <ErrorState error={st.error} onRetry={st.refresh} retryMs={60000} />;
    return (
      <div className="split-main">
        <div>
          <Loading lines={2} height={36} />
          <Loading lines={1} height={180} />
        </div>
        <Loading lines={1} height={240} />
      </div>
    );
  }

  const en = a.enrichment;
  const dir = dirOf(a.lang);
  const descFr = en?.description_fr ?? null;
  const robots = a.stats.edits_total - a.stats.edits_human;
  // Quotes: at most 3, meaningful additions first (≥ 20 characters).
  const prose = (t: { added_text: string | null }) => {
    const c = cleanSnippet(t.added_text);
    return c.length >= 30 && !/[|=]/.test(c) ? 1 : 0;
  };
  const quotes = [...a.texts].sort((x, y) => prose(y) - prose(x) || textLength(y.added_text) - textLength(x.added_text)).slice(0, 3);
  const facts = (
    <FactBox
      title="Repères"
      facts={[
        { label: "Modifications reçues", value: fmtInt(a.stats.edits_total), note: robots > 0 ? `dont ${plural(robots, "par un robot", "par des robots")}` : undefined },
        { label: "Contributeurs", value: fmtInt(a.stats.distinct_users) },
        {
          label: "Taille ajoutée",
          value: `${fmtSigned(a.stats.delta_bytes)} octets`,
          note: a.stats.delta_bytes === 0 && a.stats.edits_total > 1 ? "les ajouts et les retraits s’annulent" : undefined,
        },
        { label: "Première modification", value: a.stats.first_edit ? fmtDayTimeUtc(a.stats.first_edit) : "–" },
        { label: "Dernière modification", value: a.stats.last_edit ? fmtDayTimeUtc(a.stats.last_edit) : "–" },
        a.pageviews_count > 0
          ? { label: "Pages vues", value: `${fmtInt(a.pageviews_count)} heures chargées` }
          : { label: "Pages vues", value: <span className="t-14 muted">non chargées pour cet article</span> },
      ]}
    />
  );
  const photo = <WikiImage eager url={en?.thumbnail_url} lang={a.lang} title={a.title} alt={a.title} />;

  return (
    <div>
      {en?.theme && en.theme_label ? (
        <Link to={themePath(en.theme)} className="crumb quiet">
          ← Thème : {en.theme_label}
        </Link>
      ) : (
        <Link to="/direct" className="crumb quiet">
          ← En direct
        </Link>
      )}
      <header className="page-head">
        <Kicker theme={en?.theme} label={en?.theme_label ?? "Non classé"} extra={<span style={{ marginLeft: 12 }}>Article · {wikiName(a.lang)}</span>} />
        <h1 className="t-40" dir={dir} lang={a.lang} style={{ maxWidth: "28ch" }}>
          {a.title}
        </h1>
        <p className="standfirst">
          {descFr
            ? descFr.charAt(0).toUpperCase() + descFr.slice(1)
            : `${plural(a.stats.edits_total, "modification")} par ${plural(a.stats.distinct_users, "contributeur")} reçues par le flux${
                a.stats.first_edit && a.stats.last_edit ? `, ${fmtDayRange(a.stats.first_edit, a.stats.last_edit)}` : ""
              }.`}
        </p>
        {!descFr && en?.description && <ForeignDescription text={en.description} lang={a.lang === "fr" ? "en" : a.lang} />}
        <MetaLine
          items={[
            <LangCode lang={a.lang} />,
            a.stats.last_edit ? <Timestamp iso={a.stats.last_edit} prefix="modifié" /> : null,
            plural(a.stats.distinct_users, "contributeur"),
            plural(a.stats.edits_total, "modification"),
          ]}
        />
      </header>

      <div className="show-m-block stack-16" style={{ marginBottom: 32 }}>
        {photo}
        {facts}
      </div>

      <div className="split-main">
        <div className="vr">
          <section aria-labelledby="a-edits">
            <SectionHeader id="a-edits" title="Dernières modifications" right={a.edits.length ? `${fmtInt(a.edits.length)} plus récentes` : null} />
            {a.edits.length ? <EditsTable a={a} /> : <EmptyState>Aucune modification reçue par le flux pour cet article.</EmptyState>}
          </section>
          {(a.events?.length ?? 0) > 0 && (
            <section aria-labelledby="a-events">
              <SectionHeader id="a-events" title="Événements liés" />
              <ul>
                {a.events!.map((ev) => (
                  <EventCompact key={ev.id} ev={ev} showTheme />
                ))}
              </ul>
            </section>
          )}
          <section aria-labelledby="a-tl">
            <SectionHeader id="a-tl" title="Activité des dernières 24 heures" />
            <EditsChart a={a} />
          </section>
          <section aria-labelledby="a-texts">
            <SectionHeader id="a-texts" title="Textes ajoutés et retirés" right={a.texts.length > 3 ? `3 sur ${fmtInt(a.texts.length)} révisions lues` : null} />
            {quotes.length ? (
              <>
                <ul>
                  {quotes.map((t) => (
                    <EditText key={t.id} lang={a.lang} timestamp={t.timestamp} comment={t.comment} added={t.added_text} removed={t.removed_text} rev={t.rev_new} />
                  ))}
                </ul>
                <SourceNote>
                  API Wikipédia <code>action=compare</code>, collection <Coll name="edit_texts" />. Balisage wiki retiré pour la lecture.
                </SourceNote>
              </>
            ) : (
              <EmptyState reason="Le texte n’est récupéré que pour les modifications humaines ; la file donne la priorité à l’arabe, au français et aux articles actifs.">
                Aucun texte de révision récupéré pour cet article.
              </EmptyState>
            )}
          </section>
          {a.alerts.length > 0 && (
            <section aria-labelledby="a-alerts">
              <SectionHeader id="a-alerts" title="Alertes du détecteur" right={plural(a.alerts.length, "alerte")} />
              <AlertsTable alerts={a.alerts} compact />
              <SourceNote>
                collection <Coll name="alerts" />.
              </SourceNote>
            </section>
          )}
        </div>

        <aside className="stack-24" aria-label="Repères">
          <div className="hide-m-block stack-24">
            {photo}
            {facts}
          </div>
          <section>
            <SectionHeader as="h3" title="Pourquoi ce thème ?" thin />
            <Why a={a} />
          </section>
          <section>
            <SectionHeader as="h3" title="Sur Wikipédia" thin />
            <ul className="links-list">
              <li>
                <ExtLink href={a.url}>{wikiName(a.lang)}</ExtLink>
              </li>
              {en?.wikidata_url && (
                <li>
                  <ExtLink href={en.wikidata_url}>
                    Wikidata <span className="mono">{en.qid}</span>
                  </ExtLink>
                </li>
              )}
            </ul>
          </section>
          <p className="source">
            Article en {LANG_NAME[a.lang]} ; document <span className="mono">{`${a.lang}:${a.title}`}</span> de la collection <Coll name="articles" />
            {en?.enriched_at ? `, enrichi le ${fmtDayTimeUtc(en.enriched_at)}` : ""}.
          </p>
        </aside>
      </div>
    </div>
  );
}
