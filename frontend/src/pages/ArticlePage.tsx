import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, ApiError, type Article, type Lang } from "../api";
import { usePolling } from "../hooks/usePolling";
import { useTitle } from "../hooks/useTitle";
import { fmtDay, fmtDayTimeUtc, fmtInt, fmtSigned, fmtTime, fmtTimeUtc, plural } from "../lib/format";
import { LANG_NAME, dirOf, isLang, wikiName, wikiUrl } from "../lib/lang";
import { themePath, themeSourceSentence } from "../lib/themes";
import { cleanComment, isRevert } from "../lib/wikitext";
import { AlertsTable } from "../components/AlertsTable";
import { EditText, FactBox, WikiImage } from "../components/blocks";
import { ChartFrame, ColumnChart } from "../components/charts";
import { EventCompact } from "../components/EventItem";
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
          collection <Coll name="edits" /> (MongoDB), robots compris, 24 dernières heures : {plural(total, "modification")}.
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
  const rows = all ? a.edits : a.edits.slice(0, 15);
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
                  {isRevert(e.comment) ? "Annulation · " : ""}
                  <bdi dir="auto">{cleanComment(e.comment) || "–"}</bdi>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {a.edits.length > 15 && (
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
  return (
    <div className="stack-8">
      <p className="t-14">{themeSourceSentence(en.theme_source, en.theme_confidence)}</p>
      {en.theme_reason && (
        <p className="t-14 muted">
          Règle appliquée : <span className="mono" style={{ fontSize: 12.5 }}>{en.theme_reason}</span>
        </p>
      )}
      {en.instance_of.length > 0 && (
        <p className="t-14 muted">
          Nature (Wikidata P31) : {en.instance_of.map((i) => i.label ?? i.qid).join(", ")}
        </p>
      )}
      {en.occupations.length > 0 && <p className="t-14 muted">Métier (P106) : {en.occupations.map((i) => i.label ?? i.qid).join(", ")}</p>}
      {en.categories.length > 0 && (
        <p className="t-14 muted">
          Catégories : {en.categories.slice(0, 8).join(" · ")}
          {en.categories.length > 8 ? ` (et ${fmtInt(en.categories.length - 8)} autres)` : ""}
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
        {en?.description && (
          <p className="standfirst" dir="auto">
            {en.description.charAt(0).toUpperCase() + en.description.slice(1)}
          </p>
        )}
        <MetaLine
          items={[
            <LangCode lang={a.lang} />,
            a.stats.last_edit ? <Timestamp iso={a.stats.last_edit} prefix="modifié" /> : null,
            plural(a.stats.distinct_users, "contributeur"),
            plural(a.stats.edits_total, "modification"),
          ]}
        />
      </header>

      <div className="split-main">
        <div className="vr">
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
            <SectionHeader id="a-texts" title="Textes ajoutés et retirés" right={a.texts.length ? `${fmtInt(a.texts.length)} dernières révisions` : null} />
            {a.texts.length ? (
              <>
                <ul>
                  {a.texts.slice(0, 8).map((t) => (
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
              <AlertsTable alerts={a.alerts} />
              <SourceNote>
                collection <Coll name="alerts" />.
              </SourceNote>
            </section>
          )}
          <section aria-labelledby="a-edits">
            <SectionHeader id="a-edits" title="Dernières modifications" />
            {a.edits.length ? <EditsTable a={a} /> : <EmptyState>Aucune modification reçue par le flux pour cet article.</EmptyState>}
          </section>
        </div>

        <aside className="stack-24" aria-label="Fiche">
          <WikiImage eager url={en?.thumbnail_url} lang={a.lang} title={a.title} alt={a.title} />
          <FactBox
            title="Fiche"
            facts={[
              { label: "Modifications reçues", value: fmtInt(a.stats.edits_total), note: `dont ${fmtInt(a.stats.edits_human)} humaines` },
              { label: "Contributeurs", value: fmtInt(a.stats.distinct_users) },
              {
                label: "Octets ajoutés (somme)",
                value: fmtSigned(a.stats.delta_bytes),
                note: a.stats.delta_bytes === 0 && a.stats.edits_total > 1 ? "les ajouts et les retraits s’annulent" : undefined,
              },
              { label: "Première modification", value: a.stats.first_edit ? fmtDayTimeUtc(a.stats.first_edit) : "–" },
              { label: "Dernière modification", value: a.stats.last_edit ? fmtDayTimeUtc(a.stats.last_edit) : "–" },
              { label: "Heures de vues chargées", value: fmtInt(a.pageviews_count) },
            ]}
          />
          <section>
            <SectionHeader as="h3" title="Liens" thin />
            <ul className="links-list">
              <li>
                <ExtLink href={a.url}>Lire sur {wikiName(a.lang)}</ExtLink>
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
          <section>
            <SectionHeader as="h3" title="Pourquoi ce thème ?" thin />
            <Why a={a} />
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
